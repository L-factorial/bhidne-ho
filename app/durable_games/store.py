"""Atomic journals for durable game state.

The in-memory implementation is the executable store contract. PostgreSQL uses a
row lock and one transaction for receipt lookup, event append, and revision advance.
Neither implementation performs authorization or transport delivery.
"""

import asyncio
import hashlib
import json
import secrets
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb
from psycopg.errors import UniqueViolation

from app.games.base import GameCommandRejected

from .models import (
    CanonicalGameEvent,
    CommittedGameEvent,
    DurableCommandReceipt,
    DurableCommandResult,
    DurableGameDefinition,
    GameOwnership,
    LoadedDurableGame,
    StartedDurableGame,
)
from .replay import replay


_UNSET = object()


class DurableGameNotFound(LookupError):
    pass


class DurableGameConflict(RuntimeError):
    pass


class DurableGameCompatibilityError(RuntimeError):
    pass


class StaleGameOwner(RuntimeError):
    pass


def command_fingerprint(expected_revision: int, command: str, payload: dict) -> str:
    return json.dumps({
        "expected_revision": expected_revision,
        "command": command,
        "payload": payload,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def _token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def _prepare_game(definition, rules, players, initial_state):
    supplied = {} if rules is _UNSET else deepcopy(rules)
    normalized = definition.normalize_rules(supplied)
    encoded_rules = json.loads(json.dumps(
        normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False,
    ))
    digest = _rules_digest(encoded_rules)
    state = (definition.initial_state(encoded_rules, players)
             if initial_state is _UNSET else initial_state)
    encoded_state = definition.encode_state(state)
    decoded = definition.decode_state(deepcopy(encoded_state))
    return encoded_rules, digest, encoded_state, definition.revision(decoded)


def _rules_digest(rules):
    canonical = json.dumps(rules, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_players(players):
    if not players:
        raise DurableGameConflict("A started game requires at least one player.")
    if (len({user for user, _ in players}) != len(players) or
            len({seat for _, seat in players}) != len(players) or
            any(not user or type(seat) is not int or seat <= 0 for user, seat in players)):
        raise DurableGameConflict("Game players and positive seats must be unique.")


def _committed(proposed, first_sequence: int):
    return tuple(CommittedGameEvent(first_sequence + index, CanonicalGameEvent(
        event_id=uuid4(), **item.model_dump()
    )) for index, item in enumerate(proposed))


def _apply(definition, state, events):
    candidate = state
    for stored in events:
        candidate = definition.reduce(candidate, stored.event)
    return candidate


def _check_definition(definition, game_type, engine_version, event_schema_version):
    if (definition.game_type, definition.engine_version, definition.event_schema_version) != (
        game_type, engine_version, event_schema_version,
    ):
        raise DurableGameCompatibilityError("The stored game requires an unsupported engine version.")


@dataclass
class _MemoryGame:
    game_id: UUID
    room_id: str
    game_type: str
    engine_version: int
    event_schema_version: int
    initial_state: Any
    current_sequence: int
    current_revision: int
    rules_schema_version: int = 1
    rules: dict = field(default_factory=dict)
    rules_digest: str = ""
    status: str = "active"
    ownership_epoch: int = 0
    owner_instance_id: str | None = None
    fencing_token_hash: bytes | None = None
    lease_expires_at: datetime | None = None
    start_command_id: str | None = None
    events: list[tuple[CommittedGameEvent, str, str]] = field(default_factory=list)
    commands: dict[tuple[str, str], tuple[str, DurableCommandReceipt]] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class InMemoryGameStore:
    def __init__(self):
        self.games: dict[UUID, _MemoryGame] = {}
        self.active_players: dict[str, tuple[UUID, str, int]] = {}
        self._catalog_lock = asyncio.Lock()

    async def create(self, game_id: UUID, room_id: str, definition: DurableGameDefinition,
                     initial_state: Any = _UNSET, rules: Any = _UNSET):
        normalized_rules, rules_digest, encoded, revision = _prepare_game(
            definition, rules, (), initial_state,
        )
        async with self._catalog_lock:
            existing = self.games.get(game_id)
            if existing:
                _check_definition(definition, existing.game_type, existing.engine_version,
                                  existing.event_schema_version)
                if (existing.room_id != room_id or existing.initial_state != encoded or
                        existing.rules_schema_version != definition.rules_schema_version or
                        existing.rules != normalized_rules or existing.rules_digest != rules_digest):
                    raise DurableGameConflict("Game ID already identifies different initial state.")
            else:
                self.games[game_id] = _MemoryGame(
                    game_id, room_id, definition.game_type, definition.engine_version,
                    definition.event_schema_version, deepcopy(encoded), 0, revision,
                    rules_schema_version=definition.rules_schema_version,
                    rules=deepcopy(normalized_rules), rules_digest=rules_digest,
                )
        return await self.load(game_id, definition)

    async def start(self, game_id: UUID, room_id: str, definition: DurableGameDefinition, *,
                    start_command_id: str, owner_instance_id: str,
                    players: tuple[tuple[str, int], ...], initial_state: Any = _UNSET,
                    rules: Any = _UNSET, lease_seconds: int = 30):
        if lease_seconds <= 0:
            raise ValueError("Lease duration must be positive.")
        _validate_players(players)
        normalized_rules, rules_digest, encoded, revision = _prepare_game(
            definition, rules, players, initial_state,
        )
        async with self._catalog_lock:
            existing = self.games.get(game_id)
            if existing:
                _check_definition(definition, existing.game_type, existing.engine_version,
                                  existing.event_schema_version)
                if (existing.room_id != room_id or existing.initial_state != encoded or
                        existing.start_command_id != start_command_id or
                        existing.rules_schema_version != definition.rules_schema_version or
                        existing.rules != normalized_rules or existing.rules_digest != rules_digest):
                    raise DurableGameConflict("Game ID already identifies different initial state.")
                reservations = {(user, value[2]) for user, value in self.active_players.items()
                                if value[0] == game_id}
                if reservations != set(players):
                    raise DurableGameConflict("Retried game start has a different roster.")
                return StartedDurableGame(self._load_locked(existing, definition), None, False)
            if any(user in self.active_players for user, _ in players):
                raise DurableGameConflict("A player is already participating in another active game.")
            now = datetime.now(timezone.utc)
            token = secrets.token_urlsafe(32)
            game = _MemoryGame(game_id, room_id, definition.game_type,
                definition.engine_version, definition.event_schema_version,
                deepcopy(encoded), 0, revision, ownership_epoch=1,
                rules_schema_version=definition.rules_schema_version,
                rules=deepcopy(normalized_rules), rules_digest=rules_digest,
                owner_instance_id=owner_instance_id, fencing_token_hash=_token_hash(token),
                lease_expires_at=now + timedelta(seconds=lease_seconds))
            game.start_command_id = start_command_id
            self.games[game_id] = game
            for user, seat in players:
                self.active_players[user] = (game_id, room_id, seat)
            ownership = GameOwnership(game_id, owner_instance_id, 1, token, game.lease_expires_at)
            return StartedDurableGame(self._load_locked(game, definition), ownership, True)

    async def load(self, game_id: UUID, definition: DurableGameDefinition):
        game = self.games.get(game_id)
        if game is None:
            raise DurableGameNotFound(str(game_id))
        async with game.lock:
            return self._load_locked(game, definition)

    def _load_locked(self, game, definition):
        _check_definition(definition, game.game_type, game.engine_version, game.event_schema_version)
        if (game.rules_schema_version != definition.rules_schema_version or
                definition.normalize_rules(deepcopy(game.rules)) != game.rules or
                _rules_digest(game.rules) != game.rules_digest):
            raise DurableGameCompatibilityError("Stored game rules are incompatible or corrupted.")
        state = replay(definition, deepcopy(game.initial_state),
                       ((item.sequence, item.event) for item, _, _ in game.events))
        if len(game.events) != game.current_sequence:
            raise DurableGameCompatibilityError("Stored event count does not match current sequence.")
        if definition.revision(state) != game.current_revision:
            raise DurableGameCompatibilityError("Replayed revision does not match the game record.")
        return LoadedDurableGame(game.game_id, game.room_id, game.status,
                                 game.current_sequence, game.current_revision,
                                 game.ownership_epoch, state, game.rules_schema_version,
                                 deepcopy(game.rules), game.rules_digest)

    async def execute(self, game_id: UUID, definition: DurableGameDefinition, *, actor_id: str,
                      command_id: str, expected_revision: int, command: str, payload: dict,
                      ownership: GameOwnership):
        game = self.games.get(game_id)
        if game is None:
            raise DurableGameNotFound(str(game_id))
        fingerprint = command_fingerprint(expected_revision, command, payload)
        async with game.lock:
            loaded = self._load_locked(game, definition)
            if game.status != "active":
                raise DurableGameConflict("The game is not active.")
            self._validate_owner(game, ownership)
            key = (actor_id, command_id)
            previous = game.commands.get(key)
            if previous:
                original, receipt = previous
                if original != fingerprint:
                    raise DurableGameConflict("Command ID already identifies a different request.")
                return DurableCommandResult(loaded, receipt, (), True)
            receipt, events, state = _decide(
                definition, loaded, actor_id, command_id, expected_revision, command, payload,
            )
            game.commands[key] = (fingerprint, receipt)
            if events:
                game.events.extend((item, actor_id, command_id) for item in events)
                game.current_sequence = events[-1].sequence
            game.current_revision = receipt.revision
            result_game = LoadedDurableGame(game.game_id, game.room_id, game.status,
                game.current_sequence, game.current_revision, game.ownership_epoch, state)
            return DurableCommandResult(result_game, receipt, events)

    async def acquire(self, game_id: UUID, owner_instance_id: str, lease_seconds: int = 30):
        game = self.games.get(game_id)
        if game is None:
            raise DurableGameNotFound(str(game_id))
        if lease_seconds <= 0:
            raise ValueError("Lease duration must be positive.")
        async with game.lock:
            now = datetime.now(timezone.utc)
            if game.lease_expires_at and game.lease_expires_at > now:
                raise DurableGameConflict("The game already has a live owner.")
            token = secrets.token_urlsafe(32)
            game.owner_instance_id = owner_instance_id
            game.ownership_epoch += 1
            game.fencing_token_hash = _token_hash(token)
            game.lease_expires_at = now + timedelta(seconds=lease_seconds)
            return GameOwnership(game_id, owner_instance_id, game.ownership_epoch,
                                 token, game.lease_expires_at)

    async def renew(self, ownership: GameOwnership, lease_seconds: int = 30):
        game = self.games.get(ownership.game_id)
        if game is None:
            raise DurableGameNotFound(str(ownership.game_id))
        if lease_seconds <= 0:
            raise ValueError("Lease duration must be positive.")
        async with game.lock:
            self._validate_owner(game, ownership)
            game.lease_expires_at = datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)
            return GameOwnership(ownership.game_id, ownership.owner_instance_id,
                                 ownership.epoch, ownership.fencing_token,
                                 game.lease_expires_at)

    async def reserve_players(self, game_id: UUID, room_id: str,
                              players: tuple[tuple[str, int], ...]):
        game = self.games.get(game_id)
        if game is None:
            raise DurableGameNotFound(str(game_id))
        if game.room_id != room_id:
            raise DurableGameConflict("Game does not belong to this room.")
        _validate_players(players)
        async with self._catalog_lock:
            conflicts = [user for user, _ in players
                         if user in self.active_players and self.active_players[user][0] != game_id]
            if conflicts:
                raise DurableGameConflict("A player is already participating in another active game.")
            for user, seat in players:
                existing = self.active_players.get(user)
                if existing and existing != (game_id, room_id, seat):
                    raise DurableGameConflict("The active game reservation has different seating.")
            for user, seat in players:
                self.active_players[user] = (game_id, room_id, seat)

    async def release_players(self, game_id: UUID):
        async with self._catalog_lock:
            self.active_players = {user: value for user, value in self.active_players.items()
                                   if value[0] != game_id}

    @staticmethod
    def _validate_owner(game, ownership):
        now = datetime.now(timezone.utc)
        if (ownership.game_id != game.game_id or
                ownership.owner_instance_id != game.owner_instance_id or
                ownership.epoch != game.ownership_epoch or
                game.fencing_token_hash is None or
                not secrets.compare_digest(_token_hash(ownership.fencing_token), game.fencing_token_hash) or
                game.lease_expires_at is None or game.lease_expires_at <= now):
            raise StaleGameOwner("The game lease is missing, expired, or fenced.")


def _decide(definition, loaded, actor_id, command_id, expected_revision, command, payload):
    if expected_revision != loaded.revision:
        receipt = DurableCommandReceipt(command_id, "rejected", loaded.revision,
            rejection_code="STALE_REVISION", detail="The game state changed; refresh and try again.")
        return receipt, (), loaded.state
    baseline = definition.encode_state(loaded.state)
    working = definition.decode_state(deepcopy(baseline))
    try:
        proposed = definition.decide(working, actor_id, command, deepcopy(payload))
        if definition.encode_state(working) != baseline:
            raise DurableGameCompatibilityError("Game decision mutated state before commit.")
        events = _committed(proposed, loaded.sequence + 1)
        state = _apply(definition, working, events)
    except GameCommandRejected as error:
        if definition.encode_state(working) != baseline:
            raise DurableGameCompatibilityError("Rejected game decision mutated state.")
        receipt = DurableCommandReceipt(command_id, "rejected", loaded.revision,
                                         rejection_code=error.code, detail=error.detail)
        return receipt, (), loaded.state
    revision = definition.revision(state)
    if events and revision <= loaded.revision:
        raise DurableGameCompatibilityError("Accepted events did not advance the game revision.")
    if not events and revision != loaded.revision:
        raise DurableGameCompatibilityError("Game state changed without a canonical event.")
    receipt = DurableCommandReceipt(command_id, "accepted", revision,
        first_sequence=events[0].sequence if events else None,
        last_sequence=events[-1].sequence if events else None)
    return receipt, events, state


class PostgresGameStore:
    def __init__(self, pool):
        self.pool = pool

    async def create(self, game_id: UUID, room_id: str, definition: DurableGameDefinition,
                     initial_state: Any = _UNSET, rules: Any = _UNSET):
        normalized_rules, rules_digest, initial, revision = _prepare_game(
            definition, rules, (), initial_state,
        )
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute("""
                    INSERT INTO games
                        (id,room_id,game_type,engine_version,event_schema_version,initial_state,
                         current_revision,status,rules_schema_version,rules,rules_digest)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,%s)
                    ON CONFLICT (id) DO NOTHING
                """, (game_id, room_id, definition.game_type, definition.engine_version,
                      definition.event_schema_version, Jsonb(initial), revision,
                      definition.rules_schema_version, Jsonb(normalized_rules), rules_digest))
                row = await self._game_row(connection, game_id, lock=True)
                self._validate_create(row, room_id, definition, initial,
                                      normalized_rules, rules_digest)
        return await self.load(game_id, definition)

    async def start(self, game_id: UUID, room_id: str, definition: DurableGameDefinition, *,
                    start_command_id: str, owner_instance_id: str,
                    players: tuple[tuple[str, int], ...], initial_state: Any = _UNSET,
                    rules: Any = _UNSET, lease_seconds: int = 30):
        if lease_seconds <= 0:
            raise ValueError("Lease duration must be positive.")
        _validate_players(players)
        normalized_rules, rules_digest, initial, revision = _prepare_game(
            definition, rules, players, initial_state,
        )
        token = secrets.token_urlsafe(32)
        try:
            async with self.pool.connection() as connection:
                async with connection.transaction():
                    result = await connection.execute("""
                        INSERT INTO games
                            (id,room_id,game_type,engine_version,event_schema_version,initial_state,
                             current_revision,status,start_command_id,owner_instance_id,
                             ownership_epoch,fencing_token_hash,lease_expires_at,
                             rules_schema_version,rules,rules_digest)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,1,%s,
                                now() + (%s * interval '1 second'),%s,%s,%s)
                        ON CONFLICT (id) DO NOTHING
                        RETURNING lease_expires_at
                    """, (game_id, room_id, definition.game_type, definition.engine_version,
                          definition.event_schema_version, Jsonb(initial), revision,
                          start_command_id, owner_instance_id, _token_hash(token), lease_seconds,
                          definition.rules_schema_version, Jsonb(normalized_rules), rules_digest))
                    inserted = await result.fetchone()
                    row = await self._game_row(connection, game_id, lock=True)
                    self._validate_create(row, room_id, definition, initial,
                                          normalized_rules, rules_digest)
                    if row[14] != start_command_id:
                        raise DurableGameConflict("Game ID already identifies a different start command.")
                    if inserted:
                        for user_id, seat in players:
                            await connection.execute("""
                                INSERT INTO active_game_players (user_id,game_id,room_id,seat)
                                VALUES (%s,%s,%s,%s)
                            """, (_internal_user_id(user_id), game_id, room_id, seat))
                        ownership = GameOwnership(game_id, owner_instance_id, 1, token, inserted[0])
                    else:
                        rows = await (await connection.execute("""
                            SELECT user_id,seat FROM active_game_players
                            WHERE game_id=%s ORDER BY seat
                        """, (game_id,))).fetchall()
                        stored = {(f"user-{item[0]}", item[1]) for item in rows}
                        if stored != set(players):
                            raise DurableGameConflict("Retried game start has a different roster.")
                        ownership = None
                    events = () if inserted else await self._events(connection, game_id)
                    loaded = self._loaded(row, events, definition)
            return StartedDurableGame(loaded, ownership, inserted is not None)
        except UniqueViolation as error:
            raise DurableGameConflict(
                "The start command, player, or seat is already assigned to another game."
            ) from error

    async def load(self, game_id: UUID, definition: DurableGameDefinition):
        async with self.pool.connection() as connection:
            row = await self._game_row(connection, game_id)
            events = await self._events(connection, game_id)
        return self._loaded(row, events, definition)

    async def execute(self, game_id: UUID, definition: DurableGameDefinition, *, actor_id: str,
                      command_id: str, expected_revision: int, command: str, payload: dict,
                      ownership: GameOwnership):
        fingerprint = command_fingerprint(expected_revision, command, payload)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row = await self._game_row(connection, game_id, lock=True)
                if row[7] != "active":
                    raise DurableGameConflict("The game is not active.")
                self._validate_owner(row, ownership)
                prior = await (await connection.execute("""
                    SELECT request_fingerprint,status,first_sequence,last_sequence,resulting_revision,
                           rejection_code,rejection_detail
                    FROM game_commands WHERE game_id=%s AND actor_id=%s AND command_id=%s
                """, (game_id, actor_id, command_id))).fetchone()
                events = await self._events(connection, game_id)
                loaded = self._loaded(row, events, definition)
                if prior:
                    if prior[0] != fingerprint:
                        raise DurableGameConflict("Command ID already identifies a different request.")
                    receipt = DurableCommandReceipt(command_id, prior[1], prior[4], prior[2], prior[3],
                                                    prior[5], prior[6])
                    return DurableCommandResult(loaded, receipt, (), True)
                receipt, committed, state = _decide(
                    definition, loaded, actor_id, command_id, expected_revision, command, payload,
                )
                await connection.execute("""
                    INSERT INTO game_commands
                        (game_id,actor_id,command_id,request_fingerprint,expected_revision,status,
                         first_sequence,last_sequence,resulting_revision,rejection_code,rejection_detail)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (game_id, actor_id, command_id, fingerprint, expected_revision, receipt.status,
                      receipt.first_sequence, receipt.last_sequence, receipt.revision,
                      receipt.rejection_code, receipt.detail))
                for item in committed:
                    await connection.execute("""
                        INSERT INTO game_events
                            (game_id,sequence,event_id,actor_id,command_id,event_type,event_version,payload)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    """, (game_id, item.sequence, item.event.event_id, actor_id, command_id,
                          item.event.event_type, item.event.event_version, Jsonb(item.event.payload)))
                sequence = committed[-1].sequence if committed else loaded.sequence
                await connection.execute("""
                    UPDATE games SET current_sequence=%s,current_revision=%s
                    WHERE id=%s
                """, (sequence, receipt.revision, game_id))
                result_game = LoadedDurableGame(game_id, loaded.room_id, loaded.status, sequence,
                    receipt.revision, loaded.ownership_epoch, state)
                return DurableCommandResult(result_game, receipt, committed)

    async def acquire(self, game_id: UUID, owner_instance_id: str, lease_seconds: int = 30):
        if lease_seconds <= 0:
            raise ValueError("Lease duration must be positive.")
        token = secrets.token_urlsafe(32)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row = await self._game_row(connection, game_id, lock=True)
                if row[12] is not None and row[13]:
                    raise DurableGameConflict("The game already has a live owner.")
                result = await connection.execute("""
                    UPDATE games
                    SET owner_instance_id=%s, ownership_epoch=ownership_epoch+1,
                        fencing_token_hash=%s,
                        lease_expires_at=now() + (%s * interval '1 second')
                    WHERE id=%s
                    RETURNING ownership_epoch,lease_expires_at
                """, (owner_instance_id, _token_hash(token), lease_seconds, game_id))
                epoch, expires = await result.fetchone()
        return GameOwnership(game_id, owner_instance_id, epoch, token, expires)

    async def renew(self, ownership: GameOwnership, lease_seconds: int = 30):
        if lease_seconds <= 0:
            raise ValueError("Lease duration must be positive.")
        async with self.pool.connection() as connection:
            result = await connection.execute("""
                UPDATE games
                SET lease_expires_at=now() + (%s * interval '1 second')
                WHERE id=%s AND owner_instance_id=%s AND ownership_epoch=%s
                  AND fencing_token_hash=%s AND lease_expires_at > now()
                RETURNING lease_expires_at
            """, (lease_seconds, ownership.game_id, ownership.owner_instance_id,
                  ownership.epoch, _token_hash(ownership.fencing_token)))
            row = await result.fetchone()
        if row is None:
            raise StaleGameOwner("The game lease is missing, expired, or fenced.")
        return GameOwnership(ownership.game_id, ownership.owner_instance_id,
                             ownership.epoch, ownership.fencing_token, row[0])

    async def reserve_players(self, game_id: UUID, room_id: str,
                              players: tuple[tuple[str, int], ...]):
        _validate_players(players)
        async with self.pool.connection() as connection:
            try:
                async with connection.transaction():
                    row = await self._game_row(connection, game_id, lock=True)
                    if row[1] != room_id:
                        raise DurableGameConflict("Game does not belong to this room.")
                    for user_id, seat in players:
                        await connection.execute("""
                            INSERT INTO active_game_players (user_id,game_id,room_id,seat)
                            VALUES (%s,%s,%s,%s)
                            ON CONFLICT (user_id) DO UPDATE SET seat=EXCLUDED.seat
                            WHERE active_game_players.game_id=EXCLUDED.game_id
                              AND active_game_players.room_id=EXCLUDED.room_id
                        """, (_internal_user_id(user_id), game_id, room_id, seat))
                    count = await (await connection.execute(
                        "SELECT count(*) FROM active_game_players WHERE game_id=%s", (game_id,),
                    )).fetchone()
                    if count[0] != len(players):
                        raise DurableGameConflict(
                            "A player is already participating in another active game."
                        )
            except UniqueViolation as error:
                raise DurableGameConflict("A player or seat is already reserved.") from error

    async def release_players(self, game_id: UUID):
        async with self.pool.connection() as connection:
            await connection.execute("DELETE FROM active_game_players WHERE game_id=%s", (game_id,))

    async def _game_row(self, connection, game_id, lock=False):
        row = await (await connection.execute("""
            SELECT id,room_id,game_type,engine_version,event_schema_version,initial_state,
                   current_sequence,status,ownership_epoch,current_revision,owner_instance_id,
                   fencing_token_hash,lease_expires_at,(lease_expires_at > now()) AS lease_valid
                   ,start_command_id,rules_schema_version,rules,rules_digest
            FROM games WHERE id=%s
        """ + (" FOR UPDATE" if lock else ""), (game_id,))).fetchone()
        if row is None:
            raise DurableGameNotFound(str(game_id))
        return row

    async def _events(self, connection, game_id):
        rows = await (await connection.execute("""
            SELECT sequence,event_id,event_type,event_version,payload
            FROM game_events WHERE game_id=%s ORDER BY sequence
        """, (game_id,))).fetchall()
        return tuple(CommittedGameEvent(row[0], CanonicalGameEvent(
            event_id=row[1], event_type=row[2], event_version=row[3], payload=row[4],
        )) for row in rows)

    def _loaded(self, row, events, definition):
        _check_definition(definition, row[2], row[3], row[4])
        if (row[15] != definition.rules_schema_version or
                definition.normalize_rules(deepcopy(row[16])) != row[16] or
                _rules_digest(row[16]) != row[17]):
            raise DurableGameCompatibilityError("Stored game rules are incompatible or corrupted.")
        state = replay(definition, row[5], ((item.sequence, item.event) for item in events))
        if len(events) != row[6] or (events and events[-1].sequence != row[6]):
            raise DurableGameCompatibilityError("Stored event count does not match current sequence.")
        if definition.revision(state) != row[9]:
            raise DurableGameCompatibilityError("Replayed revision does not match the game record.")
        return LoadedDurableGame(row[0], row[1], row[7], row[6], row[9], row[8], state,
                                 row[15], row[16], row[17])

    def _validate_create(self, row, room_id, definition, initial, rules, rules_digest):
        _check_definition(definition, row[2], row[3], row[4])
        if (row[1] != room_id or row[5] != initial or
                row[15] != definition.rules_schema_version or row[16] != rules or
                row[17] != rules_digest):
            raise DurableGameConflict("Game ID already identifies different initial state.")

    @staticmethod
    def _validate_owner(row, ownership):
        if (ownership.game_id != row[0] or ownership.owner_instance_id != row[10] or
                ownership.epoch != row[8] or row[11] is None or
                not secrets.compare_digest(_token_hash(ownership.fencing_token), bytes(row[11])) or
                not row[13]):
            raise StaleGameOwner("The game lease is missing, expired, or fenced.")


def _internal_user_id(user_id: str) -> UUID:
    try:
        return UUID(user_id.removeprefix("user-"))
    except (AttributeError, ValueError) as error:
        raise DurableGameConflict("Active game players require durable user IDs.") from error
