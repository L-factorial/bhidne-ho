"""Durable ingress and transaction-scoped lane heads; no scheduling or delivery.

Ingress authenticates actors before calling. Executors reauthorize inside the
claim, write effects and completion on claim.connection, and publish only AFTER
successful context exit. No lock or pending row is an accepted game command.
"""
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
from typing import Literal
from uuid import UUID, uuid4

from pydantic import Field, JsonValue, model_validator
from psycopg.pq import TransactionStatus
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from app.models.action import CommandId, ReliableActionCommand
from app.runtime.command_runtime import request_fingerprint
from .checkpoint_store import PostgresCheckpointStore
from .checkpoints import Record, Identity, Nonnegative, canonical_json
from .recovery import ReceiptOutcome
from .store import DurableGameConflict, DurableGameNotFound, StaleGameOwner


class LaneTarget(Record):
    kind: Literal['room', 'table', 'game', 'room_chat', 'table_chat', 'game_chat', 'conversation', 'recipient']
    room_id: Identity | None = None
    table_id: UUID | None = None
    game_id: UUID | None = None
    user_low: UUID | None = None
    user_high: UUID | None = None
    recipient_id: UUID | None = None

    @model_validator(mode='after')
    def valid_target(self):
        required = {'room': {'room_id'}, 'room_chat': {'room_id'},
                    'table_chat': {'room_id', 'table_id'}, 'game_chat': {'room_id', 'table_id', 'game_id'},
                    'table': {'room_id', 'table_id'}, 'game': {'room_id', 'table_id', 'game_id'},
                    'conversation': {'user_low', 'user_high'}, 'recipient': {'recipient_id'}}[self.kind]
        supplied = {k for k, v in self.model_dump().items() if k != 'kind' and v is not None}
        if required != supplied or (self.kind == 'conversation' and self.user_low >= self.user_high):
            raise ValueError('Lane target fields must match its kind; conversation users must be sorted.')
        return self


class InboxRequest(Record):
    command_id: CommandId
    command: str = Field(min_length=1, pattern=r'\S')
    match_id: Identity | None = None
    expected_revision: Nonnegative | None = None
    payload: dict[str, JsonValue] = Field(default_factory=dict)


class InboxOutcome(Record):
    command_id: CommandId
    status: Literal['accepted', 'rejected']
    revision: Nonnegative | None = None
    detail: str | None = None
    table_id: Identity | None = None
    match_id: Identity | None = None

    @model_validator(mode='after')
    def creation_identity(self):
        if self.table_id is not None or self.match_id is not None:
            if self.status != 'accepted' or self.table_id is None or self.match_id is None:
                raise ValueError('Created table and match identities require an accepted paired result.')
            UUID(self.table_id)
            UUID(self.match_id)
        return self


@dataclass(frozen=True)
class InboxEntry:
    lane_id: UUID
    sequence: int
    actor_id: str
    request: InboxRequest
    fingerprint: str
    status: str
    outcome: dict | None
    duplicate: bool = False


@dataclass
class LaneClaim:
    connection: object
    target: LaneTarget
    entry: InboxEntry
    _store: object
    _active: bool = True
    _completed: bool = False

    async def complete(self, outcome: dict):
        if not self._active or self._completed:
            raise DurableGameConflict('This claim is inactive or already completed.')
        await self._store._complete(self, outcome)
        self._completed = True


def _transaction(connection):
    if connection.info.transaction_status != TransactionStatus.INTRANS:
        raise RuntimeError('Inbox writes require an open transaction.')


def _fingerprint(request):
    # Same bytes as gameplay receipt identity, including original match spelling.
    return json.dumps(request.model_dump(mode='json', exclude={'command_id'}), sort_keys=True)


class InboxCapacityExceeded(DurableGameConflict):
    """Temporary lane backpressure; admitted commands must be allowed to drain."""


class PostgresInboxStore:
    def __init__(self, pool, *, max_pending=1000, max_request_bytes=65536):
        if type(max_pending) is not int or max_pending <= 0 or type(max_request_bytes) is not int or max_request_bytes <= 0:
            raise ValueError('Inbox bounds must be positive integers.')
        self.pool = pool
        self.max_pending, self.max_request_bytes = max_pending, max_request_bytes
        self.checkpoints = PostgresCheckpointStore(pool)

    async def ensure_lane(self, target: LaneTarget):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                return await self.ensure_lane_in_transaction(connection, target)

    async def ensure_lane_in_transaction(self, connection, target: LaneTarget):
        _transaction(connection)
        target = LaneTarget.model_validate(target)
        values = tuple(target.model_dump().values())
        await connection.execute('''INSERT INTO command_lanes
            (lane_id,kind,room_id,table_id,game_id,user_low,user_high,recipient_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''', (uuid4(), *values))
        row = await (await connection.execute('''SELECT lane_id FROM command_lanes WHERE kind=%s
            AND room_id IS NOT DISTINCT FROM %s AND table_id IS NOT DISTINCT FROM %s
            AND game_id IS NOT DISTINCT FROM %s AND user_low IS NOT DISTINCT FROM %s
            AND user_high IS NOT DISTINCT FROM %s AND recipient_id IS NOT DISTINCT FROM %s''', values)).fetchone()
        if row is None:
            raise DurableGameConflict('Lane target conflicts with an existing lane.')
        return row[0]

    async def _lane(self, connection, lane_id, *, lock=False):
        row = await (await connection.execute('''SELECT kind,room_id,table_id,game_id,user_low,user_high,
            recipient_id,enqueued_sequence,processed_sequence FROM command_lanes WHERE lane_id=%s'''
            + (' FOR UPDATE SKIP LOCKED' if lock else ''), (lane_id,))).fetchone()
        if row is None:
            if lock:
                return None
            raise DurableGameNotFound(str(lane_id))
        return LaneTarget(**dict(zip(LaneTarget.model_fields, row[:7]))), row[7], row[8]

    async def enqueue(self, lane_id, actor_id, request):
        # A round rollover can race ingress on two lanes for the same hosted
        # match. The unique match/request key picks one; retry resolves its row.
        for attempt in range(2):
            try:
                async with self.pool.connection() as connection:
                    async with connection.transaction():
                        return await self.enqueue_in_transaction(connection, lane_id, actor_id, request)
            except UniqueViolation:
                if attempt:
                    raise

    async def enqueue_in_transaction(self, connection, lane_id, actor_id, request):
        """Compose with timer dispatch or other ingress bookkeeping in one commit."""
        _transaction(connection)
        lane_id = UUID(str(lane_id))
        if not isinstance(actor_id, str) or not actor_id.strip():
            raise ValueError('An authenticated actor or trusted system identity is required.')
        request = InboxRequest.model_validate_json(canonical_json(request))
        if len(canonical_json(request.model_dump(mode='json')).encode()) > self.max_request_bytes:
            raise DurableGameConflict('Command exceeds the inbox request size limit.')
        # Allocation waits for this lane; never allocate a gap on a failed insert.
        locked = await (await connection.execute('SELECT lane_id FROM command_lanes WHERE lane_id=%s FOR UPDATE', (lane_id,))).fetchone()
        if locked is None:
            raise DurableGameNotFound(str(lane_id))
        target, enqueued, processed = await self._lane(connection, lane_id)
        prior = await self._lookup(connection, lane_id, actor_id, request.command_id)
        if target.kind == 'game' and request.match_id and prior is None:
            previous_lane = await (await connection.execute('''SELECT lane_id FROM command_inbox
                WHERE dedup_match_id=%s AND actor_id=%s AND command_id=%s''',
                (UUID(request.match_id), actor_id, request.command_id))).fetchone()
            if previous_lane:
                previous_target, _, _ = await self._lane(connection, previous_lane[0])
                if (previous_target.room_id, previous_target.table_id) != (target.room_id, target.table_id):
                    raise DurableGameConflict('Hosted match identity belongs to a different table.')
                prior = await self._lookup(connection, previous_lane[0], actor_id, request.command_id)
        if prior:
            if prior.fingerprint != _fingerprint(request):
                raise DurableGameConflict('Command ID already identifies a different request.')
            return InboxEntry(**{**prior.__dict__, 'duplicate': True})
        if enqueued - processed >= self.max_pending:
            raise InboxCapacityExceeded('This command lane has reached its pending limit.')
        routed_match = UUID(request.match_id) if request.match_id else None
        if target.kind == 'game':
            reliable = ReliableActionCommand.model_validate(request.model_dump())
            # Reserve receipt capacity across pending round lanes under the same
            # table lock as execution. Already queued commands must have room for
            # their eventual accepted OR rejected receipt.
            await connection.execute('SELECT table_id FROM room_tables WHERE table_id=%s FOR UPDATE',
                                     (target.table_id,))
            # Durable round identity and client-visible match identity differ for
            # Flush. Retried completed requests were already resolved above.
            current = await (await connection.execute('''SELECT r.match_id,r.state,g.status
                FROM table_recovery_state r JOIN games g ON g.table_id=r.table_id
                WHERE r.table_id=%s AND g.id=%s''', (target.table_id, target.game_id))).fetchone()
            if (current is None or current[0] != UUID(reliable.match_id) or current[2] != 'active' or
                    UUID(current[1]['data']['host']['durable_game_id']) != target.game_id):
                raise DurableGameConflict('The requested game is no longer the active match on this lane.')
            pending = await (await connection.execute('''SELECT count(*) FROM command_inbox
                WHERE dedup_match_id=%s AND status='pending' ''', (UUID(reliable.match_id),))).fetchone()
            if current[1]['receipt_count'] + pending[0] >= current[1]['receipt_limit']:
                raise DurableGameConflict('This match has reached its command receipt admission limit.')
            routed_match = target.game_id
        sequence = enqueued + 1
        await connection.execute('''INSERT INTO command_inbox
            (lane_id,sequence,actor_id,command_id,request_version,command,match_id,expected_revision,
             payload,request_fingerprint,original_request,dedup_match_id)
            VALUES (%s,%s,%s,%s,1,%s,%s,%s,%s,%s,%s,%s)''',
            (lane_id, sequence, actor_id, request.command_id, request.command, routed_match,
             request.expected_revision, Jsonb(request.payload), _fingerprint(request), Jsonb(request.model_dump(mode='json')),
             UUID(request.match_id) if target.kind == 'game' else None))
        await connection.execute('UPDATE command_lanes SET enqueued_sequence=%s WHERE lane_id=%s', (sequence, lane_id))
        return await self._lookup(connection, lane_id, actor_id, request.command_id)

    def _entry(self, lane_id, row):
        sequence, actor, command_id, version, command, match_id, expected, payload, fingerprint, original, status, outcome = row
        if version != 1 or original is None:
            raise DurableGameConflict('Inbox entry has no supported original request.')
        request = InboxRequest.model_validate_json(canonical_json(original))
        if (request.command_id != command_id or request.command != command or
                request.expected_revision != expected or request.payload != payload or _fingerprint(request) != fingerprint):
            raise DurableGameConflict('Inbox entry disagrees with its original request.')
        if status != 'pending':
            stored_outcome = InboxOutcome.model_validate_json(canonical_json(outcome))
            if stored_outcome.command_id != command_id or stored_outcome.status != status:
                raise DurableGameConflict('Inbox outcome disagrees with its command identity.')
        return InboxEntry(lane_id, sequence, actor, request, fingerprint, status, outcome)

    async def _lookup(self, connection, lane_id, actor, command_id):
        row = await (await connection.execute('''SELECT sequence,actor_id,command_id,request_version,command,
            match_id,expected_revision,payload,request_fingerprint,original_request,status,outcome
            FROM command_inbox WHERE lane_id=%s AND actor_id=%s AND command_id=%s''', (lane_id, actor, command_id))).fetchone()
        return self._entry(lane_id, row) if row else None

    async def lookup(self, lane_id, actor_id, command_id):
        """Trusted actor-scoped status lookup; API must authenticate/authorize first."""
        async with self.pool.connection() as connection:
            return await self._lookup(connection, UUID(str(lane_id)), actor_id, command_id)

    async def pending_lanes(self, *, room_id=None, limit=100, kind=None, after_lane_id=None):
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('Polling batch limit must be between 1 and 1000.')
        if kind is not None and kind not in ('room', 'table', 'game', 'room_chat', 'table_chat', 'game_chat', 'conversation', 'recipient'):
            raise ValueError('Unsupported lane kind.')
        clauses, params = ['processed_sequence < enqueued_sequence'], []
        for column, value in (('room_id', room_id), ('kind', kind)):
            if value is not None:
                clauses.append(f'{column}=%s')
                params.append(value)
        if after_lane_id is not None:
            clauses.append('lane_id>%s')
            params.append(UUID(str(after_lane_id)))
        async with self.pool.connection() as connection:
            rows = await (await connection.execute('SELECT lane_id FROM command_lanes WHERE '
                + ' AND '.join(clauses) + ' ORDER BY lane_id LIMIT %s', (*params, limit))).fetchall()
        return tuple(row[0] for row in rows)

    @asynccontextmanager
    async def claim(self, lane_id, *, fence=None):
        """Own exactly the next command until commit/rollback, skipping busy lanes.

        This is a short DB transaction, not a lease held across network calls.
        A yielded claim must complete; otherwise all composed effects roll back.
        """
        lane_id = UUID(str(lane_id))
        claimed = None
        async with self.pool.connection() as connection:
            async with connection.transaction():
                target, _, _ = await self._lane(connection, lane_id)
                if target.room_id:
                    if fence is None:
                        raise StaleGameOwner('Room lanes require the serving owner fence.')
                    await self.checkpoints._fence(connection, fence, target.room_id)
                locked = await self._lane(connection, lane_id, lock=True)
                if locked is None or locked[1] == locked[2]:
                    yield None
                    return
                _, enqueued, processed = locked
                row = await (await connection.execute('''SELECT sequence,actor_id,command_id,request_version,command,
                    match_id,expected_revision,payload,request_fingerprint,original_request,status,outcome
                    FROM command_inbox WHERE lane_id=%s AND sequence=%s FOR UPDATE''', (lane_id, processed + 1))).fetchone()
                if row is None or row[10] != 'pending':
                    raise DurableGameConflict('Lane head is missing or already terminal; refusing to skip it.')
                claimed = LaneClaim(connection, target, self._entry(lane_id, row), self)
                try:
                    yield claimed
                    if not claimed._completed:
                        raise DurableGameConflict('Claim exited without atomic completion.')
                    if target.room_id:
                        await self.checkpoints._fence(connection, fence, target.room_id)
                finally:
                    claimed._active = False

    async def _complete(self, claim, outcome):
        connection, entry = claim.connection, claim.entry
        _transaction(connection)
        parsed = InboxOutcome.model_validate_json(canonical_json(outcome))
        if parsed.command_id != entry.request.command_id:
            raise DurableGameConflict('Outcome belongs to another command.')
        outcome = parsed.model_dump(exclude_none=True)
        if claim.target.kind == 'game':
            parsed = ReceiptOutcome.model_validate_json(canonical_json(outcome))
            request = ReliableActionCommand.model_validate(entry.request.model_dump())
            # The engine checkpoint/receipt store must have committed its part in
            # this transaction before completion can advance the lane head.
            row = await (await connection.execute('''SELECT request_fingerprint,original_request,status,
                resulting_revision,rejection_detail FROM game_commands
                WHERE game_id=%s AND actor_id=%s AND command_id=%s''',
                (claim.target.game_id, entry.actor_id, request.command_id))).fetchone()
            if (row is None or row != (request_fingerprint(request), request.model_dump(mode='json'),
                                      parsed.status, parsed.revision, parsed.detail)):
                raise DurableGameConflict('Game completion requires the identical durable game receipt.')
        result = await (await connection.execute('''UPDATE command_inbox SET status=%s,outcome=%s,
            completed_at=clock_timestamp() WHERE lane_id=%s AND sequence=%s AND status='pending'
            RETURNING sequence''', (parsed.status, Jsonb(outcome), entry.lane_id, entry.sequence))).fetchone()
        if result is None:
            raise DurableGameConflict('Claim no longer identifies a pending head.')
        updated = await (await connection.execute('''UPDATE command_lanes SET processed_sequence=%s
            WHERE lane_id=%s AND processed_sequence=%s RETURNING processed_sequence''',
            (entry.sequence, entry.lane_id, entry.sequence - 1))).fetchone()
        if updated is None:
            raise DurableGameConflict('Only the next lane sequence can complete.')
