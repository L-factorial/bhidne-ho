"""Test-only in-memory host. Automatic actions never live in the core engine."""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from random import SystemRandom
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError

from card_utils import Rank, Suit, shuffle, standard_52
from callbreak.house_rules import RedealPolicy
from callbreak import (
    CompleteShuffle, GameConfig, GameQuery, MatchState, Phase, PrepareDeal,
    available_cards, create_match,
)
from app.adapters.callbreak import AdapterResult, PlayerCommand, dispatch_control, dispatch_player
from app.adapters.callbreak.host import CallBreakCommandTarget
from app.games.base import GameCommandRejected
from app.runtime.command_runtime import CommandAccessError, CommandRuntime, CommandSession, OutgoingEvent

logger = logging.getLogger(__name__)


@dataclass
class HostedGame:
    room_id: str
    capacity: int
    users: list[str]
    commands: CommandSession = field(default_factory=CommandSession)
    settings: dict = field(default_factory=lambda: {"weak_hand_enabled": True, "no_spades_enabled": True, "payments": [0, 0, 0, 0]})
    state: MatchState | None = None
    deadline: float | None = None
    task: asyncio.Task | None = None
    log: list[dict] = field(default_factory=list)
    error: str | None = None
    play_mode: str = "auto"
    ended: bool = False

    @property
    def match_id(self):
        return self.commands.match_id

    @property
    def lock(self):
        return self.commands.lock


class TestGameService:
    def __init__(self, rooms, connections, timeout_seconds=3.0, command_runtime=None, profiles=None, round_summary_seconds=0):
        self.rooms, self.connections = rooms, connections
        self.profiles = profiles
        self.round_summary_seconds = round_summary_seconds
        self.command_runtime = command_runtime or CommandRuntime()
        self.timeout_seconds = timeout_seconds
        self.games: dict[str, HostedGame] = {}
        self._catalog_lock = asyncio.Lock()
        self._random = SystemRandom()

    def is_playing(self, room_id: str, user_id: str) -> bool:
        """Expose participation without leaking Call Break state to room services."""
        game = self.games.get(room_id)
        return bool(game and not game.ended and game.state
                    and game.state.phase != Phase.MATCH_COMPLETE and user_id in game.users)

    async def close(self):
        tasks = [g.task for g in self.games.values() if g.task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _member(self, room_id, user_id):
        if user_id not in await self.rooms.members(room_id):
            raise HTTPException(403, "Connect to this room before using its test game.")

    def _get(self, room_id):
        game = self.games.get(room_id)
        if game is None:
            raise HTTPException(404, "No test game in this room.")
        return game

    def _snapshot(self, game, user_id):
        seat = game.users.index(user_id) + 1 if user_id in game.users else None
        result = {
            "room_id": game.room_id, "match_id": game.match_id, "capacity": game.capacity,
            "players": [{"player_id": i + 1, "user_id": u, "display_name": self.profiles.name(u, i + 1) if self.profiles else f"Player {i + 1}"} for i, u in enumerate(game.users)],
            "is_creator": bool(game.users) and user_id == game.users[0],
            "ready": len(game.users) == game.capacity, "settings": game.settings,
            "your_player_id": seat, "status": "ended" if game.ended else "waiting" if game.state is None else
                "finished" if game.state.phase == Phase.MATCH_COMPLETE else "playing",
            "can_join": not game.ended and game.state is None and seat is None and len(game.users) < game.capacity,
            "play_mode": game.play_mode,
            "timeout_seconds": self.timeout_seconds if game.play_mode == "auto" else None,
            "remaining_ms": max(0, int((game.deadline - time.monotonic()) * 1000)) if game.deadline else None,
            "log": list(game.log), "error": game.error,
        }
        if game.state and game.state.phase == Phase.DEAL_COMPLETE and self.round_summary_seconds and not game.ended:
            result["round_review"] = {"deal_number": len(game.state.completed_deals),
                                      "can_continue": user_id == game.users[0]}
        if game.state:
            query = GameQuery(game.state)
            result.update(game=query.get_state(), deal=query.get_deal(), rules=query.get_rules(),
                          scoreboard=query.get_scoreboard(),
                          deal_history=[{key: deal[key] for key in ("deal_number", "complete", "players")}
                                        for deal in query.get_deals()],
                          player_stats=[query.get_player(p) for p in game.state.config.players],
                          private=query.get_player_view(seat) if seat else None)
        return result

    async def snapshot(self, room_id, user_id):
        await self._member(room_id, user_id)
        game = self.games.get(room_id)
        if not game:
            return {"room_id": room_id, "status": "empty"}
        async with game.lock:
            return self._snapshot(game, user_id)

    async def create(self, room_id, user_id, capacity):
        await self._member(room_id, user_id)
        if type(capacity) is not int or capacity not in (4, 5):
            raise HTTPException(422, "Choose four or five players.")
        async with self._catalog_lock:
            existing = self.games.get(room_id)
            if existing and not existing.ended and (existing.state is None or existing.state.phase != Phase.MATCH_COMPLETE):
                raise HTTPException(409, "This room already has a waiting or active game.")
            game = HostedGame(room_id, capacity, [user_id])
            self.games[room_id] = game
        async with game.lock:
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def next_deal(self, room_id, user_id, match_id, deal_number):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            if game.ended or match_id != game.match_id or not game.state or not self.round_summary_seconds:
                raise HTTPException(409, "This round is no longer available.")
            if not game.users or user_id != game.users[0]:
                raise HTTPException(403, "Only the creator can start the next deal.")
            if deal_number != len(game.state.completed_deals) or game.state.phase == Phase.MATCH_COMPLETE:
                raise HTTPException(409, "The round changed. Refresh the table.")
            if game.state.phase == Phase.DEAL_COMPLETE:
                await self._controllers(game, advance_deal=True)
                self._deadline(game, Phase.DEAL_COMPLETE)
                await self._publish(game)
            return self._snapshot(game, user_id)

    async def end(self, room_id, user_id, match_id):
        await self._member(room_id, user_id)
        # Serialize replacement with ending, then serialize with actions and timers.
        async with self._catalog_lock:
            game = self._get(room_id)
            async with game.lock:
                if match_id != game.match_id:
                    raise HTTPException(409, "The game changed. Refresh before ending it.")
                if not game.users or user_id != game.users[0]:
                    raise HTTPException(403, "Only the game creator can end the game.")
                if game.ended:
                    return self._snapshot(game, user_id)
                if game.state and game.state.phase == Phase.MATCH_COMPLETE:
                    raise HTTPException(409, "This game has already finished.")
                game.ended = True
                game.deadline = None
                if game.task:
                    game.task.cancel()
                await self._publish(game)
                return self._snapshot(game, user_id)

    async def join(self, room_id, user_id, match_id):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            if match_id != game.match_id or game.ended:
                raise HTTPException(409, "Game changed. Refresh and join again.")
            if user_id in game.users:
                return self._snapshot(game, user_id)
            if game.state is not None or len(game.users) >= game.capacity:
                raise HTTPException(409, "The game is full; you can watch it.")
            game.users.append(user_id)
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def leave(self, room_id, user_id, match_id):
        await self._member(room_id, user_id)
        async with self._catalog_lock:
            game = self._get(room_id)
            async with game.lock:
                if match_id != game.match_id:
                    raise HTTPException(409, "The game changed. Refresh before leaving.")
                if game.state is not None:
                    raise HTTPException(409, "You can only leave a game before it starts.")
                if user_id in game.users:
                    game.users.remove(user_id)
                    if not game.users:
                        game.ended = True
                    await self._publish(game)
                return self._snapshot(game, user_id)

    async def configure(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            self._creator(game, user_id, body.match_id)
            game.settings = body.model_dump(exclude={"match_id"})
            await self._publish(game)
            return self._snapshot(game, user_id)

    def _creator(self, game, user_id, match_id):
        if not game.users or user_id != game.users[0]:
            raise HTTPException(403, "Only the game creator can do this.")
        if match_id != game.match_id or game.state is not None or game.ended:
            raise HTTPException(409, "Settings and start are only available before this game begins.")

    async def start(self, room_id, user_id, match_id, play_mode="auto"):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            self._creator(game, user_id, match_id)
            if len(game.users) != game.capacity:
                raise HTTPException(409, "Wait for all players to take a seat.")
            if play_mode not in ("manual", "auto"):
                raise HTTPException(422, "Choose manual or auto play.")
            game.play_mode = play_mode
            policy = RedealPolicy(weak_hand_enabled=game.settings["weak_hand_enabled"],
                                  no_spades_enabled=game.settings["no_spades_enabled"])
            game.state = create_match(GameConfig(game.capacity, redeal_policy=policy),
                                      initial_dealer=self._random.randint(1, game.capacity))
            await self._controllers(game)
            self._deadline(game, None)
            if game.play_mode == "auto":
                game.task = asyncio.create_task(self._run(game))
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def action(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async def deliver(events):
            for event in events:
                await self._deliver(game, event)
            await self._publish(game)

        try:
            return await self.command_runtime.execute(
                game.commands, CallBreakCommandTarget(self, game), user_id, body, deliver)
        except CommandAccessError as error:
            raise HTTPException(error.status, error.detail) from error
        except GameCommandRejected as error:
            # Legacy requests without command IDs keep their HTTP rejection shape.
            raise HTTPException(409, error.detail) from error

    async def poke(self, room_id, user_id, body, social):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        # Pokes never acquire the gameplay lock or change revisions/deadlines.
        # Roster validation is synchronous; social delivery has its own room checks.
        if body.match_id != game.match_id or game.ended:
            raise HTTPException(409, "The game changed. Reopen the table to send a poke.")
        if user_id not in game.users:
            raise HTTPException(403, "Take a seat before sending a poke.")
        recipient = body.recipient_player_id
        if recipient is not None and recipient > len(game.users):
            raise HTTPException(409, "That seat is empty.")
        return await social.send(room_id, user_id, match_id=game.match_id,
            sender_player_id=game.users.index(user_id) + 1,
            recipient_user_id=game.users[recipient - 1] if recipient else None,
            recipient_player_id=recipient, text=body.text)

    def _deadline(self, game, before):
        if game.play_mode == "manual" or game.state.phase == Phase.MATCH_COMPLETE:
            game.deadline = None
        elif game.state.phase == Phase.DEAL_COMPLETE and self.round_summary_seconds:
            game.deadline = time.monotonic() + self.round_summary_seconds
        elif before != Phase.HAND_REVIEW or game.state.phase != Phase.HAND_REVIEW:
            game.deadline = time.monotonic() + self.timeout_seconds
        # All reviewing players share the same original three-second window.

    def _apply_player(self, game, actor, command, payload=None, *, command_id=None):
        context = game.state.preparation or game.state.current_deal or game.state.completed_deals[-1].deal
        try:
            request = PlayerCommand(
                match_id=game.match_id, deal_number=context.number, attempt=context.attempt,
                command_id=command_id or uuid4().hex, expected_revision=game.state.revision,
                command=command, payload=payload or {},
            )
        except ValidationError as error:
            raise GameCommandRejected("INVALID_COMMAND", "Invalid Call Break command or payload.") from error
        result = dispatch_player(game.state, request, match_id=game.match_id, player_id=actor)
        if not isinstance(result, AdapterResult):
            raise GameCommandRejected(result.code, result.detail)
        return self._record(game, result)

    async def _player(self, game, actor, command, payload=None, automatic=False):
        events = self._apply_player(game, actor, command, payload)
        for event in events:
            await self._deliver(game, event)
        if automatic:
            entry = {"event": "AutoAction", "player_id": actor, "action": command,
                     "revision": game.state.revision}
            game.log.append(entry)
            await self.connections.broadcast(game.room_id, {"type": "TEST_GAME_EVENT", "match_id": game.match_id, **entry})
        game.log[:] = game.log[-30:]

    def _apply_controllers(self, game, advance_deal=False):
        events = []
        while game.state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE, Phase.AWAITING_REDEAL, Phase.SHUFFLING):
            if game.state.phase == Phase.DEAL_COMPLETE and self.round_summary_seconds and not advance_deal:
                break
            command = (CompleteShuffle(shuffle(standard_52(), rng=self._random))
                       if game.state.phase == Phase.SHUFFLING else PrepareDeal())
            result = dispatch_control(game.state, command, match_id=game.match_id)
            if not isinstance(result, AdapterResult):
                raise RuntimeError(result)
            events.extend(self._record(game, result))
        return events

    async def _controllers(self, game, advance_deal=False):
        for event in self._apply_controllers(game, advance_deal):
            await self._deliver(game, event)

    def _record(self, game, result):
        game.state = result.state
        events = []
        for routed in result.messages:
            event = routed.message
            envelope = event.model_dump(mode="json")
            if routed.recipient_player_id is None:
                if event.event not in ("CARD_DISTRIBUTED", "TURN_CHANGED"):
                    game.log.append({"event": event.event.value, "revision": event.revision,
                                     "payload": envelope["payload"]})
            recipient = game.users[routed.recipient_player_id - 1] if routed.recipient_player_id else None
            events.append(OutgoingEvent(envelope, recipient))
        game.log[:] = game.log[-30:]
        return events

    async def _deliver(self, game, event):
        if event.recipient is None:
            await self.connections.broadcast(game.room_id, event.message)
        else:
            await self.connections.send_to_room_user(game.room_id, event.recipient, event.message)

    async def _publish(self, game):
        for user in await self.rooms.members(game.room_id):
            await self.connections.send_to_room_user(game.room_id, user, {
                "type": "TEST_GAME_STATE", "payload": self._snapshot(game, user)})

    def _heuristic(self, state, player):
        if state.phase == Phase.AWAITING_SHUFFLE:
            return "SHUFFLE_DECK", {}
        if state.phase == Phase.AWAITING_CUT:
            return "SKIP_CUT", {}
        if state.phase == Phase.AWAITING_DISTRIBUTION:
            return "START_DISTRIBUTION", {}
        if state.phase == Phase.BIDDING:
            hand = state.current_deal.players[player - 1].hand
            estimate = sum(c.rank == Rank.ACE or c.suit == Suit.SPADES and c.rank >= Rank.JACK for c in hand)
            return "PLACE_BID", {"amount": max(1, min(state.config.tricks_per_deal, estimate))}
        if state.phase == Phase.PLAYING:
            return "PLAY_CARD", {"card": str(min(available_cards(state, player), key=lambda c: (c.suit == Suit.SPADES, c.rank, c.suit.value)))}
        raise RuntimeError("No test fallback for this phase.")

    async def _run(self, game):
        try:
            while True:
                await asyncio.sleep(min(0.1, self.timeout_seconds))
                async with game.lock:
                    if game.ended or game.state.phase == Phase.MATCH_COMPLETE:
                        return
                    if game.deadline is None or time.monotonic() < game.deadline:
                        continue
                    before = game.state.phase
                    if before == Phase.DEAL_COMPLETE and self.round_summary_seconds:
                        await self._controllers(game, advance_deal=True)
                        self._deadline(game, before)
                        await self._publish(game)
                        continue
                    if before == Phase.HAND_REVIEW:
                        pending = [p for p in game.state.config.players if p not in game.state.current_deal.accepted_hands]
                        for player in pending:
                            await self._player(game, player, "ACCEPT_HAND", automatic=True)
                    else:
                        player = game.state.current_player
                        await self._player(game, player, *self._heuristic(game.state, player), automatic=True)
                    await self._controllers(game)
                    self._deadline(game, before)
                    await self._publish(game)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Test game automation failed in room %s", game.room_id)
            game.error = "Test automation stopped. Check the server logs."
            game.deadline = None
            await self._publish(game)
