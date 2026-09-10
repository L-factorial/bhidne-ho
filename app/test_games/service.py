"""Test-only in-memory host. Automatic actions never live in the core engine."""

import asyncio
import logging
import time
from dataclasses import dataclass, field, fields, is_dataclass
from enum import Enum
from random import SystemRandom
from uuid import uuid4

from fastapi import HTTPException

from card_utils import Card, Rank, Suit, shuffle, standard_52
from callbreak import (
    AcceptHand, ClaimRedeal, CompleteShuffle, CutDeck, GameConfig, GameQuery,
    MatchState, Phase, PlaceBid, PlayCard, PrepareDeal, ShuffleDeck, SkipCut,
    StartDistribution, Transition, apply_control, apply_player, available_cards, create_match,
)

logger = logging.getLogger(__name__)


def json_value(value):
    if isinstance(value, Card):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {f.name: json_value(getattr(value, f.name)) for f in fields(value)}
    if isinstance(value, dict):
        return {k: json_value(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_value(v) for v in value]
    return value


@dataclass
class HostedGame:
    room_id: str
    capacity: int
    users: list[str]
    match_id: str = field(default_factory=lambda: uuid4().hex)
    state: MatchState | None = None
    deadline: float | None = None
    task: asyncio.Task | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    log: list[dict] = field(default_factory=list)
    error: str | None = None


class TestGameService:
    def __init__(self, rooms, connections, timeout_seconds=3.0):
        self.rooms, self.connections = rooms, connections
        self.timeout_seconds = timeout_seconds
        self.games: dict[str, HostedGame] = {}
        self._catalog_lock = asyncio.Lock()
        self._random = SystemRandom()

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
            "players": [{"player_id": i + 1, "user_id": u} for i, u in enumerate(game.users)],
            "your_player_id": seat, "status": "waiting" if game.state is None else
                "finished" if game.state.phase == Phase.MATCH_COMPLETE else "playing",
            "can_join": game.state is None and seat is None and len(game.users) < game.capacity,
            "timeout_seconds": self.timeout_seconds,
            "remaining_ms": max(0, int((game.deadline - time.monotonic()) * 1000)) if game.deadline else None,
            "log": list(game.log), "error": game.error,
        }
        if game.state:
            query = GameQuery(game.state)
            result.update(game=query.get_state(), deal=query.get_deal(), rules=query.get_rules(),
                          scoreboard=query.get_scoreboard(),
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
            if existing and (existing.state is None or existing.state.phase != Phase.MATCH_COMPLETE):
                raise HTTPException(409, "This room already has a waiting or active game.")
            game = HostedGame(room_id, capacity, [user_id])
            self.games[room_id] = game
        async with game.lock:
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def join(self, room_id, user_id, match_id):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            if match_id != game.match_id:
                raise HTTPException(409, "Game changed. Refresh and join again.")
            if user_id in game.users:
                return self._snapshot(game, user_id)
            if game.state is not None or len(game.users) >= game.capacity:
                raise HTTPException(409, "The game is full; you can watch it.")
            game.users.append(user_id)
            if len(game.users) == game.capacity:
                game.state = create_match(GameConfig(game.capacity), initial_dealer=1)
                await self._controllers(game)
                game.deadline = time.monotonic() + self.timeout_seconds
                game.task = asyncio.create_task(self._run(game))
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def action(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            if body.match_id != game.match_id or game.state is None:
                raise HTTPException(409, "This game is not active. Refresh its state.")
            if user_id not in game.users:
                raise HTTPException(403, "Spectators cannot play.")
            if body.expected_revision != game.state.revision:
                raise HTTPException(409, "The turn changed. Your view has been refreshed; try again.")
            actor = game.users.index(user_id) + 1
            command = self._command(body.command, body.payload)
            before = game.state.phase
            await self._player(game, actor, command)
            await self._controllers(game)
            self._deadline(game, before)
            await self._publish(game)
            return self._snapshot(game, user_id)

    @staticmethod
    def _command(name, payload):
        commands = {"SHUFFLE_DECK": ShuffleDeck, "SKIP_CUT": SkipCut,
                    "START_DISTRIBUTION": StartDistribution, "ACCEPT_HAND": AcceptHand,
                    "CLAIM_REDEAL": ClaimRedeal}
        if name in commands:
            return commands[name]()
        if name == "CUT_DECK":
            return CutDeck(payload["position"])
        if name == "PLACE_BID":
            return PlaceBid(payload["amount"])
        if name == "PLAY_CARD":
            return PlayCard(Card.parse(payload["card"]))
        raise HTTPException(422, "Unknown test action.")

    def _deadline(self, game, before):
        if game.state.phase == Phase.MATCH_COMPLETE:
            game.deadline = None
        elif before != Phase.HAND_REVIEW or game.state.phase != Phase.HAND_REVIEW:
            game.deadline = time.monotonic() + self.timeout_seconds
        # All reviewing players share the same original three-second window.

    async def _player(self, game, actor, command, automatic=False):
        result = apply_player(game.state, actor, command)
        if not isinstance(result, Transition):
            raise HTTPException(409, result.detail)
        await self._record(game, result)
        if automatic:
            entry = {"event": "AutoAction", "player_id": actor, "action": type(command).__name__,
                     "revision": game.state.revision}
            game.log.append(entry)
            await self.connections.broadcast(game.room_id, {"type": "TEST_GAME_EVENT", "match_id": game.match_id, **entry})
        game.log[:] = game.log[-30:]

    async def _controllers(self, game):
        while game.state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE, Phase.AWAITING_REDEAL, Phase.SHUFFLING):
            command = (CompleteShuffle(shuffle(standard_52(), rng=self._random))
                       if game.state.phase == Phase.SHUFFLING else PrepareDeal())
            result = apply_control(game.state, command)
            if not isinstance(result, Transition):
                raise RuntimeError(result)
            await self._record(game, result)

    async def _record(self, game, result):
        game.state = result.state
        for event in result.events:
            envelope = {"type": "TEST_GAME_EVENT", "match_id": game.match_id,
                        "event": event.name, "revision": event.revision, "index": event.index,
                        "payload": json_value(dict(event.data))}
            if event.recipient is None:
                await self.connections.broadcast(game.room_id, envelope)
                if event.name not in ("CardDistributed", "TurnChanged"):
                    game.log.append({"event": event.name, "revision": event.revision,
                                     "payload": envelope["payload"]})
            else:
                await self.connections.send_to_room_user(game.room_id, game.users[event.recipient - 1], envelope)
        game.log[:] = game.log[-30:]

    async def _publish(self, game):
        for user in await self.rooms.members(game.room_id):
            await self.connections.send_to_room_user(game.room_id, user, {
                "type": "TEST_GAME_STATE", "payload": self._snapshot(game, user)})

    def _heuristic(self, state, player):
        if state.phase == Phase.AWAITING_SHUFFLE:
            return ShuffleDeck()
        if state.phase == Phase.AWAITING_CUT:
            return SkipCut()
        if state.phase == Phase.AWAITING_DISTRIBUTION:
            return StartDistribution()
        if state.phase == Phase.BIDDING:
            hand = state.current_deal.players[player - 1].hand
            estimate = sum(c.rank == Rank.ACE or c.suit == Suit.SPADES and c.rank >= Rank.JACK for c in hand)
            return PlaceBid(max(1, min(state.config.tricks_per_deal, estimate)))
        if state.phase == Phase.PLAYING:
            return PlayCard(min(available_cards(state, player), key=lambda c: (c.suit == Suit.SPADES, c.rank, c.suit.value)))
        raise RuntimeError("No test fallback for this phase.")

    async def _run(self, game):
        try:
            while True:
                await asyncio.sleep(min(0.1, self.timeout_seconds))
                async with game.lock:
                    if game.state.phase == Phase.MATCH_COMPLETE:
                        return
                    if game.deadline is None or time.monotonic() < game.deadline:
                        continue
                    before = game.state.phase
                    if before == Phase.HAND_REVIEW:
                        pending = [p for p in game.state.config.players if p not in game.state.current_deal.accepted_hands]
                        for player in pending:
                            await self._player(game, player, AcceptHand(), automatic=True)
                    else:
                        player = game.state.current_player
                        await self._player(game, player, self._heuristic(game.state, player), automatic=True)
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
