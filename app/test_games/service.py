"""In-memory host for manually played multiplayer games."""

import asyncio
from dataclasses import asdict, dataclass, field, fields
import json
from random import SystemRandom
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError, TypeAdapter

from card_utils import shuffle, standard_52
from callbreak.house_rules import RedealPolicy
from callbreak import (
    CompleteShuffle, GameConfig, GameQuery, MatchState, Phase, PrepareDeal,
    create_match,
)
from app.adapters.callbreak import AdapterResult, PlayerCommand, dispatch_control, dispatch_player
from app.adapters.callbreak.host import CallBreakCommandTarget
from marriage import MarriageGameEngine
from marriage.rules import MarriageRules
from marriage.scoring_rules import ScoringRules, SCORING_PRESETS
from app.adapters.marriage import MarriageAdapter
from app.test_games.marriage import HostedMarriageTarget
from flush import FlushGameEngine, FlushRulesConfig, FlushError
from app.adapters.flush import FlushAdapter
from app.test_games.flush import HostedFlushTarget
from app.games.base import GameCommandRejected
from app.runtime.command_runtime import CommandAccessError, CommandRuntime, CommandSession, OutgoingEvent

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
    play_mode: str = "manual"
    ended: bool = False
    game_type: str = "callbreak"
    flush_target: object | None = None
    flush_queries: dict = field(default_factory=dict)
    flush_seats: dict = field(default_factory=dict)
    flush_balances: dict = field(default_factory=dict)
    flush_rules: FlushRulesConfig = field(default_factory=lambda: FlushRulesConfig(5, 1))
    flush_rules_revision: int = 0
    flush_starting_chips: int = 1000
    marriage_target: object | None = None
    marriage_queries: dict = field(default_factory=dict)
    marriage_moves: list[dict] = field(default_factory=list)
    marriage_scoring: ScoringRules = field(default_factory=ScoringRules)

    @property
    def started(self):
        return self.state is not None or self.marriage_target is not None or self.flush_target is not None

    @property
    def flush_open(self):
        return self.game_type == "flush" and (not self.started or self.flush_target.adapter.snapshot()["view"]["status"] == "finished")

    @property
    def finished(self):
        if self.flush_target:
            return False  # Flush continues between rounds until the table is explicitly ended.
        if self.marriage_target:
            return self.marriage_target.adapter.snapshot()["view"]["status"] == "finished"
        return bool(self.state and self.state.phase == Phase.MATCH_COMPLETE)

    @property
    def match_id(self):
        return self.commands.match_id

    @property
    def lock(self):
        return self.commands.lock


class TestGameService:
    def __init__(self, rooms, connections, command_runtime=None, profiles=None, round_summary_seconds=0):
        self.rooms, self.connections = rooms, connections
        self.profiles = profiles
        self.round_summary_seconds = round_summary_seconds
        self.command_runtime = command_runtime or CommandRuntime()
        self.games: dict[str, HostedGame] = {}
        self._catalog_lock = asyncio.Lock()
        self._random = SystemRandom()

    def is_playing(self, room_id: str, user_id: str) -> bool:
        """Expose participation without leaking Call Break state to room services."""
        game = self.games.get(room_id)
        return bool(game and not game.ended and game.started and not game.finished and not game.flush_open and user_id in game.users)

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
        if game.game_type == "flush":
            return self._flush_snapshot(game, user_id)
        if game.game_type == "marriage":
            return self._marriage_snapshot(game, user_id)
        seat = game.users.index(user_id) + 1 if user_id in game.users else None
        result = {
            "room_id": game.room_id, "match_id": game.match_id, "capacity": game.capacity,
            "game_type": "callbreak",
            "players": [{"player_id": i + 1, "user_id": u, "display_name": self.profiles.name(u, i + 1) if self.profiles else f"Player {i + 1}"} for i, u in enumerate(game.users)],
            "is_creator": bool(game.users) and user_id == game.users[0],
            "ready": len(game.users) == game.capacity, "settings": game.settings,
            "your_player_id": seat, "status": "ended" if game.ended else "waiting" if game.state is None else
                "finished" if game.state.phase == Phase.MATCH_COMPLETE else "playing",
            "can_join": not game.ended and game.state is None and seat is None and len(game.users) < game.capacity,
            "play_mode": game.play_mode,
            "timeout_seconds": None,
            "remaining_ms": None,
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

    def _marriage_snapshot(self, game, user_id):
        seat = game.users.index(user_id) + 1 if user_id in game.users else None
        result = {
            "marriage_scoring": asdict(game.marriage_scoring),
            "marriage_scoring_presets": {key: asdict(value) for key, value in SCORING_PRESETS.items()},
            "room_id": game.room_id, "match_id": game.match_id, "game_type": "marriage",
            "capacity": game.capacity, "ready": len(game.users) == game.capacity,
            "players": [{"player_id": i + 1, "user_id": user,
                         "display_name": self.profiles.name(user, i + 1) if self.profiles else f"Player {i + 1}"}
                        for i, user in enumerate(game.users)],
            "your_player_id": seat, "is_creator": bool(game.users) and game.users[0] == user_id,
            "status": "ended" if game.ended else "finished" if game.finished else "playing" if game.started else "waiting",
            "can_join": not game.ended and not game.started and seat is None and len(game.users) < game.capacity,
            "play_mode": game.play_mode, "remaining_ms": None, "error": game.error,
        }
        if game.marriage_target:
            adapter = game.marriage_target.adapter
            public = adapter.snapshot()["view"]
            private = adapter.snapshot(str(seat))["view"] if seat else None
            result["marriage"] = {"public": public, "private": private, "moves": list(game.marriage_moves)}
            result["game"] = {"revision": adapter.revision, "phase": (public["phase"] or "waiting").upper(),
                              "finished": game.finished, "winners": [int(public["winner"])] if public["winner"] else [],
                              "turn": {"player_id": int(public["current_player_id"]) if public["current_player_id"] else None},
                              "current_trick": None, "scores_tenths": []}
            result["query_result"] = game.marriage_queries.get(user_id)
        return result

    def _flush_snapshot(self, game, user_id):
        seat = game.flush_seats.get(user_id) if user_id in game.users else None
        result = {
            "room_id": game.room_id, "match_id": game.match_id, "game_type": "flush",
            "capacity": game.capacity, "ready": len(game.users) >= 2,
            "players": [{"player_id": game.flush_seats[user], "user_id": user,
                "display_name": self.profiles.name(user, game.flush_seats[user]) if self.profiles else f"Player {game.flush_seats[user]}"}
                for i, user in enumerate(game.users)],
            "your_player_id": seat, "is_creator": bool(game.users) and game.users[0] == user_id,
            "roster_open": game.flush_open and not game.ended,
            "status": "ended" if game.ended else "finished" if game.finished else "playing" if game.started else "waiting",
            "can_join": not game.ended and game.flush_open and seat is None and len(game.users) < game.capacity,
            "play_mode": "manual", "remaining_ms": None, "error": game.error,
            "flush_settings": {"rules": asdict(game.flush_rules), "rules_revision": game.flush_rules_revision,
                "starting_chips": game.flush_starting_chips, "locked": game.started or game.ended},
        }
        if game.flush_target:
            adapter = game.flush_target.adapter
            public = adapter.snapshot()["view"]
            result["flush"] = {"public": public, "private": adapter.snapshot(str(seat))["view"] if str(seat) in adapter.seat_ids and user_id in game.users else None,
                "bets": [event for event in adapter.public_events() if event["revision"] >= adapter.checkpoint().get_state().round_start_revision and event["kind"] in ("BET_PLACED", "SHOW_REQUESTED", "SIDE_SHOW_REQUESTED")]}
            result["flush"]["folds"] = [{"sequence": event["sequence"], "revision": event["revision"],
                "player_id": event["player_id"] if event["kind"] == "PLAYER_FOLDED" else event["loser_player_id"]}
                for event in adapter.public_events() if event["revision"] >= adapter.checkpoint().get_state().round_start_revision
                and event["kind"] in ("PLAYER_FOLDED", "SIDE_SHOW_RESOLVED")]
            result["flush"]["participants"] = [{"player_id": str(s), "display_name": self.profiles.name(u, s) if self.profiles else f"Player {s}"} for u, s in game.flush_seats.items()]
            settlement = public["settlement"]
            result["game"] = {"revision": adapter.revision, "phase": public["status"].upper(),
                "finished": game.finished, "winners": [int(p) for p in settlement["winner_ids"]] if settlement else [],
                "turn": {"player_id": int(public["current_player_id"]) if public["current_player_id"] else None},
                "current_trick": None, "scores_tenths": []}
            result["query_result"] = game.flush_queries.get(user_id)
        return result

    async def configure_flush(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            self._creator(game, user_id, body.match_id)
            if game.game_type != "flush":
                raise HTTPException(409, "Flush settings only apply to Flush.")
            if body.rules_revision != game.flush_rules_revision:
                raise HTTPException(409, "Flush rules changed. Reload them before saving.")
            try:
                if set(body.rules) != {f.name for f in fields(FlushRulesConfig)}:
                    raise ValueError("Supply the complete Flush ruleset without unknown fields.")
                rules = TypeAdapter(FlushRulesConfig).validate_json(json.dumps(body.rules), strict=True)
                if rules.minimum_players != 2 or rules.maximum_players != 10:
                    raise ValueError("Flush tables require limits of 2 to 10 players.")
                if not rules.minimum_players <= game.capacity <= rules.maximum_players:
                    raise ValueError("Player limits must include this room's seat count.")
                if rules.boot_amount > body.starting_chips:
                    raise ValueError("Starting chips must cover the boot for every player.")
            except (ValueError, TypeError, FlushError) as error:
                raise HTTPException(422, str(error)) from error
            game.flush_rules = rules
            game.flush_starting_chips = body.starting_chips
            game.flush_rules_revision += 1
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def snapshot(self, room_id, user_id):
        await self._member(room_id, user_id)
        game = self.games.get(room_id)
        if not game:
            return {"room_id": room_id, "status": "empty"}
        async with game.lock:
            return self._snapshot(game, user_id)

    async def create(self, room_id, user_id, capacity, game_type="callbreak"):
        await self._member(room_id, user_id)
        if game_type not in ("callbreak", "marriage", "flush"):
            raise HTTPException(422, "Choose a supported game.")
        if type(capacity) is not int or capacity not in (tuple(range(2, 11)) if game_type == "flush" else (2, 3, 4, 5) if game_type == "marriage" else (4, 5)):
            raise HTTPException(422, "Choose 2-10 players for Flush, 2-5 for Marriage or 4-5 for Call Break.")
        async with self._catalog_lock:
            existing = self.games.get(room_id)
            if existing and not existing.ended and not existing.finished:
                raise HTTPException(409, "This room already has a waiting or active game.")
            game = HostedGame(room_id, capacity, [user_id], game_type=game_type)
            if game_type == "flush": game.flush_seats[user_id] = 1
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
                if game.finished:
                    raise HTTPException(409, "This game has already finished.")
                game.ended = True
                if game.marriage_target:
                    game.marriage_target.active = False
                if game.flush_target:
                    game.flush_target.active = False
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
            if (game.started and not game.flush_open) or len(game.users) >= game.capacity:
                raise HTTPException(409, "The game is full; you can watch it.")
            if game.game_type == "flush" and user_id not in game.flush_seats:
                game.flush_seats[user_id] = max(game.flush_seats.values(), default=0) + 1
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
                if game.started and not game.flush_open:
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
        if game.game_type != "callbreak":
            raise HTTPException(409, "Call Break settings only apply to Call Break.")
        async with game.lock:
            self._creator(game, user_id, body.match_id)
            game.settings = body.model_dump(exclude={"match_id"})
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def configure_marriage(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            self._creator(game, user_id, body.match_id)
            if game.game_type != "marriage":
                raise HTTPException(409, "Marriage scoring only applies to Marriage.")
            try:
                rules = ScoringRules.from_dict(body.scoring)
            except (ValueError, TypeError) as error:
                raise HTTPException(422, str(error)) from error
            game.marriage_scoring = rules
            await self._publish(game)
            return self._snapshot(game, user_id)

    def _creator(self, game, user_id, match_id, *, relock=False):
        if not game.users or user_id != game.users[0]:
            raise HTTPException(403, "Only the game creator can do this.")
        if match_id != game.match_id or (game.started and not (relock and game.flush_open)) or game.ended:
            raise HTTPException(409, "Settings and start are only available before this game begins.")

    async def start(self, room_id, user_id, match_id, play_mode=None, rules_revision=None):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        async with game.lock:
            self._creator(game, user_id, match_id, relock=True)
            if (len(game.users) < 2 if game.game_type == "flush" else len(game.users) != game.capacity):
                raise HTTPException(409, "Wait for all players to take a seat.")
            if play_mode not in (None, "manual"):
                raise HTTPException(422, "Games support manual multiplayer only.")
            play_mode = "manual"
            if game.game_type == "flush":
                from app.adapters.flush import PlayerCommand as FlushCommand, AdapterResult as FlushResult
                if rules_revision != game.flush_rules_revision or type(rules_revision) is not int:
                    raise HTTPException(409, "Flush rules changed. Review the saved rules before starting.")
                seats = tuple(str(game.flush_seats[u]) for u in game.users)
                owner = str(game.flush_seats[user_id])
                if game.flush_target:
                    from copy import deepcopy
                    engine = deepcopy(game.flush_target.adapter.checkpoint())
                    old = engine.get_state()
                    balances = {**game.flush_balances, **{p.player_id: p.chips for p in old.players}}
                    dealer = next((p for p in old.settlement.winner_ids if p in seats), owner)
                    try:
                        engine.prepare_next_round(dealer, player_ids=seats,
                            initial_chips={p: balances.get(p, game.flush_starting_chips) for p in seats})
                    except (FlushError, ValueError) as error:
                        raise HTTPException(409, str(error)) from error
                    adapter = FlushAdapter(engine, match_id=game.match_id, owner_player_id=owner)
                    game.flush_balances = balances
                else:
                    adapter = FlushAdapter(FlushGameEngine(seats,
                        initial_chips=dict.fromkeys(seats, game.flush_starting_chips), rules=game.flush_rules,
                        dealer_id=self._random.choice(seats)), match_id=game.match_id, owner_player_id=owner)
                    outcome = adapter.dispatch_player(FlushCommand(match_id=game.match_id, command_id=uuid4().hex,
                        expected_revision=0, command="START_GAME"), player_id=owner)
                    if not isinstance(outcome, FlushResult): raise HTTPException(409, outcome.detail)
                game.flush_target = HostedFlushTarget(self, game, adapter)
                game.flush_queries = {}
                await self._publish(game)
                return self._snapshot(game, user_id)
            if game.game_type == "marriage":
                from app.adapters.marriage import PlayerCommand as MarriageCommand, AdapterResult as MarriageResult
                adapter = MarriageAdapter(MarriageGameEngine(tuple(str(i + 1) for i in range(game.capacity)),
                                          rules=MarriageRules(scoring=game.marriage_scoring)),
                                          match_id=game.match_id, owner_player_id="1")
                outcome = adapter.dispatch_player(MarriageCommand(match_id=game.match_id, command_id=uuid4().hex,
                    expected_revision=0, command="START_GAME"), player_id="1")
                if not isinstance(outcome, MarriageResult):
                    raise HTTPException(409, outcome.detail)
                game.marriage_target = HostedMarriageTarget(self, game, adapter)
                game.play_mode = play_mode
                for event in outcome.messages:
                    recipient = game.marriage_target.user_by_seat[event.recipient_player_id] if event.recipient_player_id else None
                    await self._deliver(game, OutgoingEvent(event.message.model_dump(mode="json"), recipient))
                await self._publish(game)
                return self._snapshot(game, user_id)
            game.play_mode = play_mode
            policy = RedealPolicy(weak_hand_enabled=game.settings["weak_hand_enabled"],
                                  no_spades_enabled=game.settings["no_spades_enabled"])
            game.state = create_match(GameConfig(game.capacity, redeal_policy=policy),
                                      initial_dealer=self._random.randint(1, game.capacity))
            await self._controllers(game)
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def action(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id)
        return await self._execute_action(game, user_id, body)

    async def _execute_action(self, game, user_id, body):
        """Shared revisioned command execution after transport authorization."""
        async def deliver(events):
            for event in events:
                await self._deliver(game, event)
            await self._publish(game)

        try:
            return await self.command_runtime.execute(
                game.commands, game.flush_target or game.marriage_target or CallBreakCommandTarget(self, game), user_id, body, deliver)
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
        if game.game_type == "flush" and recipient is not None:
            raise HTTPException(403, "Flush only allows pokes to the whole table.")
        if recipient is not None and recipient > len(game.users):
            raise HTTPException(409, "That seat is empty.")
        return await social.send(room_id, user_id, match_id=game.match_id,
            sender_player_id=game.flush_seats[user_id] if game.game_type == "flush" else game.users.index(user_id) + 1,
            recipient_user_id=game.users[recipient - 1] if recipient else None,
            recipient_player_id=recipient, text=body.text)

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
