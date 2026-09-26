"""In-memory host for manually played multiplayer games."""

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from copy import deepcopy
from dataclasses import asdict, dataclass, field, fields
import json
import logging
from random import SystemRandom
from time import monotonic, time
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

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
from marriage.scoring import calculate_scores as calculate_marriage_scores
from app.adapters.marriage import MarriageAdapter
from app.test_games.marriage import HostedMarriageTarget
from flush import FlushGameEngine, FlushRulesConfig, FlushError
from app.adapters.flush import FlushAdapter
from app.test_games.flush import HostedFlushTarget
from app.games.base import GameCommandRejected
from app.multiplayer.table import TableState, GameTablePolicy, reject
from app.multiplayer.table_lifecycle import GameTableLifecycle
from app.multiplayer.rule_proposals import RuleProposals
from app.games.lifecycle import PlayerDeparture, WaitingGameDeparture
from app.runtime.command_runtime import CommandAccessError, CommandRuntime, CommandSession, OutgoingEvent
from app.ledger import GameLedgerAmount, GameLedgerResult
from app.durable_games import HostedEngineDefinition
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.players.service import PlayerNotFound

logger = logging.getLogger(__name__)

@dataclass
class HostedGame:
    room_id: str
    capacity: int
    users: list[str]
    name: str = "Table"
    table: TableState = field(default_factory=TableState)
    previous_match_id: str | None = None
    rule_proposal: dict | None = None
    departed: set[str] = field(default_factory=set)
    pending_flush_departures: set[str] = field(default_factory=set)
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
    flush_rules: FlushRulesConfig = field(default_factory=lambda: FlushRulesConfig(5, 1))
    flush_rules_revision: int = 0
    marriage_target: object | None = None
    marriage_queries: dict = field(default_factory=dict)
    marriage_moves: list[dict] = field(default_factory=list)
    marriage_scoring: ScoringRules = field(default_factory=ScoringRules)
    ledgered_games: set[str] = field(default_factory=set)
    ledger_retry_at: float = 0
    durable_definition: object | None = None
    durable_ownership: object | None = None
    durable_game_id: object | None = None
    durable_table_reserved: bool = False

    @property
    def started(self):
        return self.state is not None or self.marriage_target is not None or self.flush_target is not None

    @property
    def flush_open(self):
        return self.game_type == "flush" and (not self.started or self.flush_target.adapter.snapshot()["view"]["status"] == "finished")

    @property
    def replaceable(self):
        return self.table.phase != "LOCKED" and (self.ended or self.finished or (self.started and self.flush_open))

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


class TestGameService(GameTableLifecycle, RuleProposals):
    def __init__(self, rooms, connections, command_runtime=None, profiles=None, round_summary_seconds=0,
                 ledger=None, durable_runtime=None, runtime_mode="memory", players=None):
        self.rooms, self.connections = rooms, connections
        self.profiles = profiles
        self.players = players
        self.table_invitations: dict[str, dict] = {}
        self.invitation_attempts: dict[str, list[float]] = {}
        self.ledger = ledger
        self.durable_runtime = durable_runtime
        self.runtime_mode = runtime_mode
        self.round_summary_seconds = round_summary_seconds
        self.command_runtime = command_runtime or CommandRuntime()
        self.games: dict[str, HostedGame] = {}
        self.tables: dict[str, dict[str, HostedGame]] = {}
        self._catalog_lock = asyncio.Lock()
        self._random = SystemRandom()
        self.instance_id = uuid4().hex
        self._offer_tasks: dict[str, asyncio.Task] = {}

    @asynccontextmanager
    async def membership_guard(self, room_id):
        """Coordinate room departure with replacement and roster mutations."""
        async with self._catalog_lock:
            async with AsyncExitStack() as stack:
                for game in self._room_games(room_id):
                    await stack.enter_async_context(game.lock)
                yield

    def _room_games(self, room_id):
        return list(self.tables.get(room_id, {}).values())

    def has_active_tables(self, room_id):
        return any(not game.ended for game in self._room_games(room_id))

    def table_summaries(self, room_id):
        """Public invitation/directory metadata; never includes engine or card state."""
        return [{"match_id": game.match_id, "name": game.name, "game_type": game.game_type,
                 "status": "ended" if game.ended else "finished" if game.finished else
                           "playing" if game.started else "waiting"}
                for game in self._room_games(room_id) if not game.ended]

    def _contains(self, game):
        return self.tables.get(game.room_id, {}).get(game.match_id) is game

    def _occupied_game(self, user_id, room_id=None, *, excluding=None):
        for room in self.tables.values():
            for game in room.values():
                if game is not excluding and not game.ended and user_id in game.table.seats(game):
                    return game
        return None

    def _ensure_available(self, user_id, game=None, room_id=None):
        room_id = game.room_id if game else room_id
        occupied = self._occupied_game(user_id, room_id, excluding=game)
        if occupied:
            if user_id in occupied.pending_flush_departures:
                raise HTTPException(409, {"code": "SEAT_RESERVED_UNTIL_ROUND_END",
                    "detail": "Your folded Flush seat remains reserved until the current round finishes."})
            current = occupied.table.view(occupied, user_id)['current_user']
            blocked = occupied.table.phase == 'LOCKED'
            raise HTTPException(409, {"code": "PLAYER_ALREADY_AT_TABLE",
                "detail": (f"Ask the creator to end {occupied.room_id}/{occupied.name} before joining another table."
                           if blocked else f"Leave {occupied.room_id}/{occupied.name} before joining another table."),
                "room_id": occupied.room_id, "match_id": occupied.match_id,
                "requires_leave_game": True,
                "departure_command": "end" if blocked else "abandon" if current['can_abandon_match'] else "leave"})

    def membership(self, room_id, user_id):
        games = self._room_games(room_id)
        game = next((g for g in games if not g.ended and (user_id in g.table.seats(g) or user_id in g.table.queue
                    or any(o.offered_to_player_id == user_id for o in g.table.pending()))), None)
        game = game or next((g for g in reversed(games) if not g.ended), None)
        if not game:
            return None
        view = game.table.view(game, user_id)
        me = view['current_user']
        return {"game_id": game.match_id, "table_id": game.table.table_id,
                "game_type": game.game_type,
                "status": "ended" if game.ended else "finished" if game.finished else "playing" if game.started else "waiting",
                "active": not game.ended and not game.finished,
                "player_is_participant": me['is_seated'], "seat": me['seat_id'], "table": view}

    def _leave_target(self, game) -> PlayerDeparture:
        if not game.started:
            return WaitingGameDeparture()
        return game.flush_target or game.marriage_target or CallBreakCommandTarget(self, game)

    def is_playing(self, room_id: str, user_id: str) -> bool:
        """Expose participation without leaking Call Break state to room services."""
        return any(not game.ended and game.started and not game.finished and not game.flush_open
                   and user_id in game.users and user_id not in game.departed for game in self._room_games(room_id))

    def chat_blocked(self, room_id, user_id):
        game = next((g for g in self._room_games(room_id) if user_id in g.users and not g.ended), None)
        return bool(game) and self.is_playing(room_id, user_id) and not (
            game.game_type == 'callbreak' and game.state and game.state.phase == Phase.DEAL_COMPLETE)

    async def close(self):
        games = [game for room in self.tables.values() for game in room.values()]
        for game in games:
            await self._release_durable_players(game)
        tasks = [g.task for g in games if g.task is not None] + list(self._offer_tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def delete_room(self, room_id, before_delete=None):
        """Persist deletion before discarding tables; serialize with table creation."""
        async with self.membership_guard(room_id):
            if self.has_active_tables(room_id):
                raise HTTPException(409, "End every active table before deleting this room.")
            games = self.tables.get(room_id, {})
            for game in games.values():
                await self._release_durable_players(game)
            if before_delete is not None:
                await before_delete()
            self.tables.pop(room_id, None)
            self.games.pop(room_id, None)
            tasks = [game.task for game in games.values() if game.task is not None]
            for task in tasks:
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _member(self, room_id, user_id, game=None):
        if user_id not in await self.rooms.members(room_id):
            raise HTTPException(403, "Connect to this room before using its test game.")
        if game is not None and not self._contains(game):
            reject("GAME_CHANGED", "The match changed. Refresh the table.")

    def _get(self, room_id, match_id=None):
        room = self.tables.get(room_id, {})
        game = (room.get(match_id) or self.games.get(room_id)) if match_id else self.games.get(room_id)
        if game is None:
            raise HTTPException(404, "No test game in this room.")
        return game

    def table_previews(self, room_id, user_id):
        summaries = []
        for hosted in self._room_games(room_id):
            if hosted.ended:
                continue
            view = hosted.table.view(hosted, user_id)
            summaries.append({
                "match_id": hosted.match_id, "name": hosted.name, "game_type": hosted.game_type,
                "status": "ended" if hosted.ended else "finished" if hosted.finished else "playing" if hosted.started else "waiting",
                "players": len(view["seated_players"]), "capacity": hosted.capacity,
                "phase": view["phase"], "queue_size": len(view["queue"]),
                "current_user": view["current_user"],
                "seated_players": [{"seat_id": seat["seat_id"], "display_name":
                    self.profiles.name(seat["user_id"], seat["seat_id"]) if self.profiles else f"Player {seat['seat_id']}"}
                    for seat in view["seated_players"]],
            })
        return summaries

    def _snapshot(self, game, user_id):
        result = self._game_snapshot(game, user_id)
        result["table_name"] = game.name
        result["path"] = f"{game.room_id}/{game.name}"
        result["tables"] = self.table_previews(game.room_id, user_id)
        result["rule_proposal"] = self._proposal_view(game, user_id)
        result["active_game"] = self.membership(game.room_id, user_id)
        result["chat_enabled"] = not self.chat_blocked(game.room_id, user_id)
        result["table"] = game.table.view(game, user_id)
        for player in result["table"]["seated_players"]:
            player["display_name"] = self.profiles.name(player["user_id"], player["seat_id"]) if self.profiles else f"Player {player['seat_id']}"
        result["can_join"] = result["table"]["current_user"]["can_join"]
        result["ready"] = result["table"]["min_players"] <= len(result["table"]["seated_players"]) <= result["table"]["max_players"]
        if game.table.next_seats is not None:
            # Replacement players receive only public completed-match data.
            if user_id not in game.users or user_id in game.departed:
                result["your_player_id"] = None
        if user_id in game.departed:
            result["is_creator"] = False
            result["query_result"] = None
        return result

    def _game_snapshot(self, game, user_id):
        if game.game_type == "flush":
            return self._flush_snapshot(game, user_id)
        if game.game_type == "marriage":
            return self._marriage_snapshot(game, user_id)
        seat = game.users.index(user_id) + 1 if user_id in game.users and user_id not in game.departed else None
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
        seat = game.users.index(user_id) + 1 if user_id in game.users and user_id not in game.departed else None
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
        seat = game.flush_seats.get(user_id) if user_id in game.users and user_id not in game.departed and user_id not in game.pending_flush_departures else None
        result = {
            "room_id": game.room_id, "match_id": game.match_id, "game_type": "flush",
            "capacity": game.capacity, "ready": len(game.users) >= 2,
            "players": [{"player_id": game.flush_seats[user], "user_id": user,
                "display_name": self.profiles.name(user, game.flush_seats[user]) if self.profiles else f"Player {game.flush_seats[user]}"}
                for i, user in enumerate(game.users)],
            "your_player_id": seat, "is_creator": bool(game.users) and game.users[0] == user_id,
            "roster_open": game.flush_open and not game.ended,
            "can_create_new_game": game.replaceable,
            "status": "ended" if game.ended else "finished" if game.finished else "playing" if game.started else "waiting",
            "can_join": not game.ended and game.flush_open and seat is None and len(game.users) < game.capacity,
            "play_mode": "manual", "remaining_ms": None, "error": game.error,
            "flush_settings": {"rules": asdict(game.flush_rules), "rules_revision": game.flush_rules_revision,
                "locked": game.started or game.ended},
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
        game = self._get(room_id, body.match_id)
        async with game.lock:
            await self._member(room_id, user_id, game)
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
            except (ValueError, TypeError, FlushError) as error:
                raise HTTPException(422, str(error)) from error
            self._propose(game, user_id, {"rules": asdict(rules)})
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def snapshot(self, room_id, user_id, match_id=None):
        await self._member(room_id, user_id)
        game = self.tables.get(room_id, {}).get(match_id) if match_id else None
        game = game or next((g for g in self._room_games(room_id) if user_id in g.table.seats(g) and not g.ended), None)
        game = game or next((g for g in reversed(self._room_games(room_id)) if not g.ended), None)
        if not game:
            return {"room_id": room_id, "status": "empty", "tables": []}
        async with game.lock:
            await self._member(room_id, user_id, game)
            await self._advance_table(game)
            await self._try_record_completed_ledger(game)
            return self._snapshot(game, user_id)

    async def retry_completed_ledgers(self, room_id):
        """Retry completed projections even after clients have left the game screen."""
        for game in self._room_games(room_id):
            async with game.lock:
                await self._try_record_completed_ledger(game)

    async def create(self, room_id, user_id, capacity, game_type="callbreak", name="Table", invitees=None):
        await self._member(room_id, user_id)
        invitees = list(dict.fromkeys(invitees or []))
        if len(invitees) > 20:
            raise HTTPException(422, "Invite at most 20 players at once.")
        eligibility = await self.invitation_eligibility(room_id, user_id, invitees)
        blocked = next((item for item in eligibility if not item["eligible"]), None)
        if blocked:
            raise HTTPException(409, blocked["reason"])
        if game_type not in ("callbreak", "marriage", "flush"):
            raise HTTPException(422, "Choose a supported game.")
        if type(capacity) is not int or capacity not in (tuple(range(2, 11)) if game_type == "flush" else (2, 3, 4, 5) if game_type == "marriage" else (4, 5)):
            raise HTTPException(422, "Choose 2-10 players for Flush, 2-5 for Marriage or 4-5 for Call Break.")
        async with self._catalog_lock:
            await self._member(room_id, user_id)
            eligibility = await self.invitation_eligibility(room_id, user_id, invitees)
            blocked = next((item for item in eligibility if not item["eligible"]), None)
            if blocked: raise HTTPException(409, blocked["reason"])
            occupied = self._occupied_game(user_id, room_id)
            if occupied and occupied.room_id == room_id and occupied.replaceable:
                await self._release_durable_players(occupied)
                occupied.ended = True
                occupied.table.phase = 'ENDED'
            else:
                self._ensure_available(user_id, room_id=room_id)
            normalized = " ".join(name.split())
            if not normalized or len(normalized) > 60:
                raise HTTPException(422, "Table name must be between 1 and 60 characters.")
            if any(g.name.casefold() == normalized.casefold() and not g.ended for g in self._room_games(room_id)):
                raise HTTPException(409, "An open table with that name already exists in this room.")
            game = HostedGame(room_id, capacity, [user_id], name=normalized, game_type=game_type)
            if game_type == "flush": game.flush_seats[user_id] = 1
            self.tables.setdefault(room_id, {})[game.match_id] = game
            self.games[room_id] = game  # Legacy default: most recently created table.
            await self._invite_players(game, user_id, invitees)
        async with game.lock:
            await self._member(room_id, user_id, game)
            await self._publish(game)
            return self._snapshot(game, user_id)

    def _sync_invitation(self, item):
        game = self.tables.get(item["room_id"], {}).get(item["match_id"])
        if not game or game.ended:
            if item["status"] == "pending": item["status"] = "cancelled"
        elif item["recipient_id"] in game.table.seats(game) or item["recipient_id"] in game.table.queue:
            if item["status"] == "pending": item["status"] = "accepted"
        return game

    async def _invitation_view(self, item):
        room = await self.rooms.room(item["room_id"])
        result = dict(item)
        result["room_name"] = room["name"] if room else item["room_id"]
        game = self.tables.get(item["room_id"], {}).get(item["match_id"])
        result["seated"] = len(game.table.seats(game)) if game else 0
        result["capacity"] = game.capacity if game else 0
        result["seat_available"] = bool(game and not game.ended and not game.started and len(game.table.seats(game)) < game.capacity)
        if self.players:
            for field, user_id in (("inviter", item["inviter_id"]), ("recipient", item["recipient_id"])):
                try: result[field] = await self.players.public_player(user_id)
                except PlayerNotFound: result[field] = {"user_id": user_id, "display_name": "", "username": None}
        return result

    async def invitation_eligibility(self, room_id, user_id, player_ids):
        await self._member(room_id, user_id)
        output = []
        for target in dict.fromkeys(player_ids):
            reason = None
            if target == user_id: reason = "You cannot invite yourself"
            else:
                try: await self.players.player(user_id, target)
                except PlayerNotFound: reason = "Player not found"
            room = await self.rooms.room(room_id)
            if reason is None and room and room["visibility"] != "public" and room["creator_id"] != user_id:
                if not await self.rooms.can_enter(room_id, target, None):
                    reason = "Ask the room owner to invite this player first"
            occupied = self._occupied_game(target) if reason is None else None
            if occupied: reason = "Already seated at another active table"
            output.append({"user_id": target, "eligible": reason is None, "reason": reason})
        return output

    def _rate_limit_invitations(self, user_id, count):
        now = monotonic()
        attempts = [value for value in self.invitation_attempts.get(user_id, []) if now - value < 60]
        if len(attempts) + count > 30:
            raise HTTPException(429, "Too many invitations. Wait a minute before inviting more players.")
        attempts.extend([now] * count)
        self.invitation_attempts[user_id] = attempts

    async def _invite_players(self, game, user_id, recipients):
        room = await self.rooms.room(game.room_id)
        if recipients and room and room["visibility"] != "public" and room["creator_id"] == user_id:
            await self.rooms.invite(game.room_id, user_id, recipients)
        pending = {(item["match_id"], item["recipient_id"]) for item in self.table_invitations.values() if item["status"] == "pending"}
        self._rate_limit_invitations(user_id, sum((game.match_id, target) not in pending for target in recipients))
        output = []
        for target_id in recipients:
            existing = next((item for item in self.table_invitations.values()
                             if item["match_id"] == game.match_id and item["recipient_id"] == target_id), None)
            if existing and existing["status"] == "pending":
                output.append(existing); continue
            item = existing or {"id": uuid4().hex, "room_id": game.room_id,
                "match_id": game.match_id, "table_name": game.name, "game_type": game.game_type,
                "inviter_id": user_id, "recipient_id": target_id}
            item.update({"status": "pending", "created_at": int(time() * 1000)})
            self.table_invitations[item["id"]] = item
            output.append(item)
        return output

    async def invitations_for(self, user_id):
        items = [item for item in self.table_invitations.values() if item["recipient_id"] == user_id]
        for item in items: self._sync_invitation(item)
        return [await self._invitation_view(item) for item in items if item["status"] == "pending"
                and await self.rooms.can_enter(item["room_id"], user_id, None)]

    async def answer_invitation(self, user_id, invitation_id, accept):
        invitation = self.table_invitations.get(invitation_id)
        if not invitation or invitation["recipient_id"] != user_id or invitation["status"] != "pending":
            raise HTTPException(404, "Table invitation not found.")
        game = self.tables.get(invitation["room_id"], {}).get(invitation["match_id"])
        if not game or game.ended:
            invitation["status"] = "cancelled"
            raise HTTPException(409, "This table is no longer active.")
        if not accept:
            invitation["status"] = "declined"
            return {"status": "declined"}
        await self.rooms.join(invitation["room_id"], user_id)
        invitation["status"] = "accepted"
        return {key: invitation[key] for key in ("room_id", "match_id", "table_name", "game_type")}

    async def next_deal(self, room_id, user_id, match_id, deal_number):
        await self._member(room_id, user_id)
        game = self._get(room_id, match_id)
        async with game.lock:
            await self._member(room_id, user_id, game)
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
            game = self._get(room_id, match_id)
            async with game.lock:
                await self._member(room_id, user_id, game)
                if match_id != game.match_id:
                    raise HTTPException(409, "The game changed. Refresh before ending it.")
                members = await self.rooms.members(room_id)
                if user_id not in members:
                    raise HTTPException(403, "Connect to this room before using its test game.")
                is_creator = bool(game.users) and user_id == game.users[0]
                if not is_creator and members != [user_id]:
                    raise HTTPException(403, "Only the game creator or the sole person in the room can end the game.")
                if game.ended:
                    return self._snapshot(game, user_id)
                if game.finished:
                    raise HTTPException(409, "This game has already finished.")
                # Ending a Flush table must not strand a completed round whose first
                # ledger projection failed just before the creator pressed End.
                game.ledger_retry_at = 0
                await self._try_record_completed_ledger(game)
                await self._release_durable_players(game)
                game.ended = True
                game.table.queue.clear()
                await self._advance_table(game)
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
        async with self._catalog_lock:
            game = self._get(room_id, match_id)
            async with game.lock:
                await self._member(room_id, user_id, game)
                await self._advance_table(game)
                if match_id != game.match_id or game.ended or not self._contains(game):
                    reject('GAME_CHANGED', 'Game changed. Refresh and join again.')
                if user_id in game.table.seats(game):
                    return self._snapshot(game, user_id)
                if game.table.phase != 'OPEN':
                    reject('GAME_LOCKED', 'The roster is closed. You can join the waitlist.')
                if len(game.users) >= game.capacity:
                    reject('GAME_FULL', 'The game is full. You can join the waitlist.')
                self._ensure_available(user_id, game)
                self._seat_user(game, user_id)
                await self._publish(game)
                return self._snapshot(game, user_id)

    async def leave(self, room_id, user_id, match_id):
        await self._member(room_id, user_id)
        current = self._get(room_id, match_id)
        if current.finished:
            await self._release_durable_players(current)
        current.table.sync(current)
        if current.table.phase != 'STARTED':
            return await self.table_command(room_id, user_id, match_id, 'leave-seat')
        if GameTablePolicy.for_game(current.game_type, current.capacity).supports_abandonment:
            return await self.table_command(room_id, user_id, match_id, 'abandon')
        async with self._catalog_lock:
            game = self._get(room_id, match_id)
            async with game.lock:
                await self._member(room_id, user_id, game)
                if match_id != game.match_id:
                    raise HTTPException(409, "The game changed. Refresh before leaving.")
                if user_id not in game.users or user_id in game.departed or user_id in game.pending_flush_departures:
                    return self._snapshot(game, user_id)
                try:
                    if game.marriage_target or game.flush_target:
                        from uuid import uuid4
                        from app.models.action import ActionCommand
                        target = game.marriage_target or game.flush_target
                        player = next(p for p in target.adapter.checkpoint().get_state().players
                                      if p.player_id == target.seat_by_user[user_id])
                        events = []
                        active = not player.folded if game.marriage_target else player.status.value == 'active'
                        if active and not game.finished:
                            command = ActionCommand(match_id=game.match_id, command_id=uuid4().hex,
                                                    expected_revision=target.revision, command="FOLD" if game.marriage_target else "FOLD_FOR_LEAVE")
                            checkpoint = target.checkpoint()
                            try:
                                events = target.apply(user_id, command)
                                if self.runtime_mode == "durable":
                                    await self._commit_durable_state(game, user_id, command)
                            except Exception:
                                target.restore(checkpoint)
                                raise
                        if self.runtime_mode == "durable" and game.marriage_target:
                            await self.durable_runtime.store.release_departed_player(
                                game.durable_game_id, game.table.table_id, user_id)
                    else:
                        events = self._leave_target(game).handle_player_leave(user_id)
                except GameCommandRejected as error:
                    raise HTTPException(409, {"code": error.code, "detail": error.detail}) from error
                if game.flush_target:
                    game.pending_flush_departures.add(user_id)
                elif game.started and game.game_type != "flush":
                    # Fixed engine seats are historical state, not current membership.
                    game.departed.add(user_id)
                else:
                    game.users.remove(user_id)
                if not game.users or all(u in game.departed for u in game.users):
                    game.ended = True
                    await self._release_durable_players(game)
                game.flush_queries.pop(user_id, None)
                game.marriage_queries.pop(user_id, None)
                if game.marriage_target or game.flush_target:
                    game.table.emit('DEPARTURE_PENDING' if game.flush_target else 'SEAT_RELEASED', user_id=user_id, match_id=game.match_id, reason='FOLDED_AND_LEFT')
                    await self._try_record_completed_ledger(game)
                for event in events:
                    await self._deliver(game, event)
                await self._publish(game)
                return self._snapshot(game, user_id)

    async def configure(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id, body.match_id)
        if game.game_type != "callbreak":
            raise HTTPException(409, "Call Break settings only apply to Call Break.")
        async with game.lock:
            await self._member(room_id, user_id, game)
            self._creator(game, user_id, body.match_id)
            self._propose(game, user_id, body.model_dump(exclude={"match_id"}))
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def configure_marriage(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id, body.match_id)
        async with game.lock:
            await self._member(room_id, user_id, game)
            self._creator(game, user_id, body.match_id)
            if game.game_type != "marriage":
                raise HTTPException(409, "Marriage scoring only applies to Marriage.")
            try:
                rules = ScoringRules.from_dict(body.scoring)
            except (ValueError, TypeError) as error:
                raise HTTPException(422, str(error)) from error
            self._propose(game, user_id, asdict(rules))
            await self._publish(game)
            return self._snapshot(game, user_id)

    def _creator(self, game, user_id, match_id, *, relock=False):
        if not game.users or user_id != game.users[0]:
            raise HTTPException(403, "Only the game creator can do this.")
        if match_id != game.match_id or (game.started and not (relock and game.flush_open)) or game.ended:
            raise HTTPException(409, "Settings and start are only available before this game begins.")

    async def start(self, room_id, user_id, match_id, play_mode=None, rules_revision=None):
        await self._member(room_id, user_id)
        game = self._get(room_id, match_id)
        async with game.lock:
            await self._member(room_id, user_id, game)
            await self._advance_table(game)
            if game.table.phase == 'STARTED' and match_id == game.match_id and user_id == game.users[0]:
                return self._snapshot(game, user_id)
            self._creator(game, user_id, match_id, relock=True)
            self._sync_proposal(game)
            if game.rule_proposal and game.rule_proposal['status'] == 'PENDING':
                reject('RULE_APPROVAL_PENDING', 'All seated players must accept the proposed rules before starting.')
            policy = GameTablePolicy.for_game(game.game_type, game.capacity)
            if policy.requires_explicit_lock and game.table.phase != 'LOCKED':
                reject('LOCK_REQUIRED', 'Lock the roster before starting the game.')
            if not policy.min_players <= len(game.users) <= policy.max_players:
                reject('NOT_ENOUGH_PLAYERS', 'Wait for enough players to take a seat.')
            if not set(game.users).issubset(await self.rooms.members(room_id)):
                reject('INVALID_ROSTER', 'All seated players must belong to this room.')
            if game.table.pending() or game.table.releases:
                reject('SEAT_TRANSFER_PENDING', 'Resolve seat transfers before starting.')
            if play_mode not in (None, "manual"):
                raise HTTPException(422, "Games support manual multiplayer only.")
            play_mode = "manual"
            start_checkpoint = self._start_checkpoint(game)
            if game.game_type == "flush":
                from app.adapters.flush import PlayerCommand as FlushCommand, AdapterResult as FlushResult
                if rules_revision != game.flush_rules_revision or type(rules_revision) is not int:
                    raise HTTPException(409, "Flush rules changed. Review the saved rules before starting.")
                seats = tuple(str(game.flush_seats[u]) for u in game.users)
                owner = str(game.flush_seats[user_id])
                if game.flush_target:
                    engine = deepcopy(game.flush_target.adapter.checkpoint())
                    old = engine.get_state()
                    dealer = next((p for p in old.settlement.winner_ids if p in seats), owner)
                    try:
                        engine.prepare_next_round(dealer, player_ids=seats)
                    except (FlushError, ValueError) as error:
                        raise HTTPException(409, str(error)) from error
                    adapter = FlushAdapter(engine, match_id=game.match_id, owner_player_id=owner)
                else:
                    adapter = FlushAdapter(FlushGameEngine(seats,
                        rules=game.flush_rules,
                        dealer_id=self._random.choice(seats)), match_id=game.match_id, owner_player_id=owner)
                    outcome = adapter.dispatch_player(FlushCommand(match_id=game.match_id, command_id=uuid4().hex,
                        expected_revision=0, command="START_GAME"), player_id=owner)
                    if not isinstance(outcome, FlushResult): raise HTTPException(409, outcome.detail)
                game.flush_target = HostedFlushTarget(self, game, adapter)
                game.flush_queries = {}
                game.table.phase = 'STARTED'
                game.table.emit('GAME_STARTED', match_id=game.match_id)
                await self._start_durable_state(game, start_checkpoint)
                await self._publish(game)
                return self._snapshot(game, user_id)
            if game.game_type == "marriage":
                from app.adapters.marriage import PlayerCommand as MarriageCommand, AdapterResult as MarriageResult
                adapter = MarriageAdapter(MarriageGameEngine(tuple(str(i + 1) for i in range(len(game.users))),
                                          rules=MarriageRules(scoring=game.marriage_scoring)),
                                          match_id=game.match_id, owner_player_id="1")
                outcome = adapter.dispatch_player(MarriageCommand(match_id=game.match_id, command_id=uuid4().hex,
                    expected_revision=0, command="START_GAME"), player_id="1")
                if not isinstance(outcome, MarriageResult):
                    raise HTTPException(409, outcome.detail)
                game.marriage_target = HostedMarriageTarget(self, game, adapter)
                game.table.phase = 'STARTED'
                game.table.emit('GAME_STARTED', match_id=game.match_id)
                game.play_mode = play_mode
                await self._start_durable_state(game, start_checkpoint)
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
            game.table.phase = 'STARTED'
            game.table.emit('GAME_STARTED', match_id=game.match_id)
            initial_events = self._apply_controllers(game)
            await self._start_durable_state(game, start_checkpoint)
            for event in initial_events:
                await self._deliver(game, event)
            await self._publish(game)
            return self._snapshot(game, user_id)

    async def action(self, room_id, user_id, body):
        await self._member(room_id, user_id)
        game = self._get(room_id, body.match_id)
        return await self._execute_action(game, user_id, body)

    async def _execute_action(self, game, user_id, body):
        """Shared revisioned command execution after transport authorization."""
        async def deliver(events):
            for event in events:
                await self._deliver(game, event)
            await self._publish(game)

        try:
            result = await self.command_runtime.execute(
                game.commands, game.flush_target or game.marriage_target or CallBreakCommandTarget(self, game),
                user_id, body, deliver,
                commit_outcome=(lambda outcome: self._commit_durable_state(game, user_id, body, outcome=outcome))
                if self.runtime_mode == "durable" else None)
            await self._try_record_completed_ledger(game)
            return result
        except CommandAccessError as error:
            raise HTTPException(error.status, error.detail) from error
        except GameCommandRejected as error:
            # Legacy requests without command IDs keep their HTTP rejection shape.
            raise HTTPException(409, error.detail) from error

    def _engine_state(self, game):
        if game.flush_target:
            state = game.flush_target.adapter.checkpoint().get_state()
        elif game.marriage_target:
            state = game.marriage_target.adapter.checkpoint().get_state()
        else:
            state = game.state
        return {"revision": state.revision,
                "value": TypeAdapter(type(state)).dump_python(state, mode="json")}

    def _locked_rules(self, game):
        if game.game_type == "flush":
            return {"rules": asdict(game.flush_rules)}
        if game.game_type == "marriage":
            return {"scoring": asdict(game.marriage_scoring)}
        return dict(game.settings)

    @staticmethod
    def _start_checkpoint(game):
        return {
            "table": deepcopy(game.table),
            "state": game.state,
            "play_mode": game.play_mode,
            "flush_target": game.flush_target,
            "flush_queries": game.flush_queries,
            "marriage_target": game.marriage_target,
            "durable_definition": game.durable_definition,
            "durable_ownership": game.durable_ownership,
            "durable_game_id": game.durable_game_id,
            "durable_table_reserved": game.durable_table_reserved,
        }

    @staticmethod
    def _restore_failed_start(game, checkpoint):
        for name, value in checkpoint.items():
            setattr(game, name, value)

    async def _start_durable_state(self, game, start_checkpoint):
        if self.runtime_mode != "durable":
            return
        definition = HostedEngineDefinition(game.game_type)
        previous_game_id = game.durable_game_id
        durable_game_id = uuid4() if game.game_type == "flush" else UUID(game.match_id)
        players = tuple((user, game.flush_seats[user] if game.game_type == "flush" else seat)
                        for seat, user in enumerate(game.users, 1))
        released_previous = False
        reserved_here = False
        try:
            if not game.durable_table_reserved:
                await self._reserve_table_players(game)
                reserved_here = True
            if previous_game_id is not None:
                await self.durable_runtime.store.release_players(previous_game_id)
                released_previous = True
            started = await self.durable_runtime.start_owned(durable_game_id, game.room_id, definition,
                start_command_id=f"start:{durable_game_id.hex}", owner_instance_id=self.instance_id,
                players=players, initial_state=self._engine_state(game),
                rules=self._locked_rules(game), lease_seconds=30)
        except Exception as error:
            self._restore_failed_start(game, start_checkpoint)
            if reserved_here:
                await self.durable_runtime.store.release_table(game.table.table_id)
            if released_previous:
                await self.durable_runtime.store.reserve_players(previous_game_id, game.room_id, players)
            if isinstance(error, DurableGameConflict):
                raise HTTPException(409,
                    "A seated player is still assigned to another active game. "
                    "End or abandon that game, then try again.") from error
            raise
        game.durable_definition = definition
        game.durable_ownership = started.ownership
        game.durable_game_id = durable_game_id

    async def _release_durable_players(self, game):
        if self.runtime_mode == "durable":
            if game.durable_game_id is not None:
                await self.durable_runtime.store.release_players(game.durable_game_id)
            if game.durable_table_reserved:
                await self.durable_runtime.store.release_table(game.table.table_id)
                game.durable_table_reserved = False

    async def _reserve_table_players(self, game):
        if self.runtime_mode != "durable" or game.durable_table_reserved:
            return
        players = tuple((user, game.flush_seats[user] if game.game_type == "flush" else seat)
                        for seat, user in enumerate(game.table.seats(game), 1) if user is not None)
        try:
            await self.durable_runtime.store.reserve_table(
                game.table.table_id, game.match_id, game.room_id, game.game_type, players)
        except DurableGameConflict as error:
            raise HTTPException(409,
                "A seated player is still assigned to another table. Leave or abandon it, then try again.") from error
        game.durable_table_reserved = True

    async def _commit_durable_state(self, game, user_id, command, *, outcome=None):
        store = self.durable_runtime.store
        ownership = game.durable_ownership
        if ownership is None:
            ownership = await store.acquire(game.durable_game_id, self.instance_id, 30)
        else:
            try:
                ownership = await store.renew(ownership, 30)
            except StaleGameOwner:
                ownership = await store.acquire(game.durable_game_id, self.instance_id, 30)
        game.durable_ownership = ownership
        payload = {"command_payload": command.payload, "authoritative_state": self._engine_state(game)}
        result = await store.execute(game.durable_game_id, game.durable_definition, actor_id=user_id,
            command_id=command.command_id, expected_revision=command.expected_revision,
            command=command.model_dump(mode="json")["command"], payload=payload, ownership=ownership,
            original_request=command.model_dump(mode="json"),
            rejection_detail=outcome["detail"] if outcome and outcome["status"] == "rejected" else None)
        if result.receipt.status != (outcome["status"] if outcome else "accepted"):
            raise DurableGameConflict(result.receipt.detail or "Durable command was rejected.")
        if (result.game.state != self._engine_state(game) or
                (outcome and (result.receipt.revision != outcome["revision"] or
                              result.receipt.detail != outcome.get("detail")))):
            # A retry after an unknown commit can have rerolled speculative cards.
            # Never publish those cards; recovery must reload the committed state.
            raise DurableGameConflict("Committed state differs; reload the durable game before continuing.")

    async def _record_completed_ledger(self, game):
        """Publish an engine-authored, zero-sum result once per completed game/round."""
        if not self.ledger:
            return
        amounts, game_id = None, game.match_id
        if game.marriage_target:
            state = game.marriage_target.adapter.checkpoint().get_state()
            scores = calculate_marriage_scores(state) if state.status.value == "finished" else None
            if scores:
                amounts = {game.users[int(row.player_id) - 1]: row.net_points for row in scores.players}
        elif game.flush_target:
            state = game.flush_target.adapter.checkpoint().get_state()
            if state.settlement:
                game_id = uuid5(NAMESPACE_URL, f"bhidne-ho:{game.match_id}:flush:{state.round_number}").hex
                user_by_seat = {str(seat): user for user, seat in game.flush_seats.items()}
                amounts = {user_by_seat[row.player_id]: row.amount
                           for row in state.round_results[-1].net_changes}
        elif game.state and game.state.phase == Phase.MATCH_COMPLETE:
            # Placement bets are unambiguous only when every final score differs.
            ranked = sorted(enumerate(game.state.score_tenths), key=lambda row: (-row[1], row[0]))
            if len({score for _, score in ranked}) == len(ranked):
                amounts = dict.fromkeys(game.users, 0)
                winner = game.users[ranked[0][0]]
                for place, (index, _) in enumerate(ranked[1:], 1):
                    payment = game.settings["payments"][place - 1]
                    amounts[game.users[index]] -= payment
                    amounts[winner] += payment
        if not amounts or game_id in game.ledgered_games:
            return
        await self.ledger.record_game(GameLedgerResult(room_id=game.room_id, table_id=game.table.table_id, table_name=game.name,
            game_id=game_id, game_type=game.game_type,
            amounts=[GameLedgerAmount(player_id=player, amount=amount) for player, amount in amounts.items()]))
        game.ledgered_games.add(game_id)

    async def _try_record_completed_ledger(self, game):
        """Keep an already-committed game command independent from its ledger projection.

        Until the real engines use the atomic durable runtime, a ledger/database failure
        must not cause clients to retry a command whose engine mutation already succeeded.
        Snapshots retry the idempotent projection with a small backoff.
        """
        if monotonic() < game.ledger_retry_at:
            return
        try:
            await self._record_completed_ledger(game)
            game.ledger_retry_at = 0
        except Exception:
            game.ledger_retry_at = monotonic() + 5
            logger.exception("Completed %s game %s; ledger projection will be retried",
                             game.game_type, game.match_id)

    def social_roster(self, room_id, match_id):
        game = self._get(room_id, match_id)
        if game.match_id != match_id or game.ended:
            raise HTTPException(409, "This table is no longer available.")
        users = game.table.next_seats if game.table.next_seats is not None else game.users
        seats = {user: game.flush_seats[user] if game.game_type == 'flush' else index + 1
                 for index, user in enumerate(users) if user is not None and user not in game.departed}
        return seats, list(game.table.queue)

    async def poke(self, room_id, user_id, body, social):
        await self._member(room_id, user_id)
        game = self._get(room_id, body.match_id)
        # Pokes never acquire the gameplay lock or change revisions/deadlines.
        # Roster validation is synchronous; social delivery has its own room checks.
        if body.match_id != game.match_id or game.ended:
            raise HTTPException(409, "The game changed. Reopen the table to send a poke.")
        seats, _ = self.social_roster(room_id, body.match_id)
        if user_id not in seats:
            raise HTTPException(403, "Take a seat before sending a poke.")
        recipient = body.recipient_player_id
        target = next((user for user, seat in seats.items() if seat == recipient), None)
        if recipient is not None and target is None:
            raise HTTPException(409, "That seat is empty.")
        return await social.send(room_id, user_id, match_id=game.match_id,
            sender_player_id=seats[user_id],
            recipient_user_id=target,
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
        await self._advance_table(game)
        for event in game.table.events[game.table.published_sequence:]:
            await self.connections.broadcast(game.room_id, {
                'type': 'TABLE_EVENT', 'table_id': game.table.table_id, **event})
        game.table.published_sequence = len(game.table.events)
        for user in await self.rooms.members(game.room_id):
            await self.connections.send_to_room_user(game.room_id, user, {
                "type": "TEST_GAME_STATE", "payload": self._snapshot(game, user)})
