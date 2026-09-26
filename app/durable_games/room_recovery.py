"""Consistent, detached room inventory. Never installs hosts or activates ownership.

An inventory is a point-in-time view, not an activation permit. The activation
coordinator must reconcile ingress/membership/work changes and recheck fencing.
Pending timers/jobs require explicit semantic validators from their executors;
unknown work fails closed instead of disappearing during recovery.
"""
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
import inspect
from uuid import UUID

from .checkpoint_store import PostgresCheckpointStore, StoredCheckpoint
from .checkpoints import CheckpointError
from .ownership import RoomWriteFence, _matches
from .recovery import rebuild_hosted_game
from .store import DurableGameNotFound, StaleGameOwner


class RecoveryLimitExceeded(CheckpointError):
    """Retry with an appropriate budget; this is not evidence of corruption."""


class UnsupportedRecoveryWork(CheckpointError):
    """Required runtime capability/codec is absent; never discard the work."""


@dataclass(frozen=True)
class RecoveredTable:
    table_id: UUID
    status: str
    stored: StoredCheckpoint = field(repr=False)


@dataclass(frozen=True)
class RecoveredLane:
    lane_id: UUID
    kind: str
    table_id: UUID | None
    game_id: UUID | None
    enqueued_sequence: int
    processed_sequence: int


@dataclass(frozen=True)
class RecoveredTimer:
    action_id: UUID
    lane_id: UUID
    action_type: str
    generation: int
    due_at: datetime
    command_id: str
    command: str
    match_id: UUID | None
    expected_revision: int | None
    payload: dict = field(repr=False)


@dataclass(frozen=True)
class RecoveredFinalization:
    job_id: UUID
    game_id: UUID
    round_number: int
    job_type: str
    payload_version: int
    payload: dict = field(repr=False)
    next_attempt_at: datetime
    attempts: int


@dataclass(frozen=True)
class RoomRecoveryInventory:
    fence: RoomWriteFence
    observed_at: datetime
    member_ids: tuple[UUID, ...]
    tables: tuple[RecoveredTable, ...]
    lanes: tuple[RecoveredLane, ...]
    timers: tuple[RecoveredTimer, ...]
    finalization: tuple[RecoveredFinalization, ...]


class PostgresRoomRecoveryStore:
    def __init__(self, pool, *, game_types=('callbreak', 'marriage', 'flush'),
                 timer_validators=None, finalization_validators=None, max_items=4096,
                 offer_expiry=False, callbreak_review=False, match_settlement=False,
                 flush_settlement=False):
        if type(max_items) is not int or max_items < 1:
            raise ValueError('Recovery inventory limit must be a positive integer.')
        self.pool, self.max_items = pool, max_items
        if type(offer_expiry) is not bool:
            raise ValueError('Offer expiry capability must be an explicit boolean.')
        self.offer_expiry = offer_expiry
        if type(callbreak_review) is not bool:
            raise ValueError('Call Break review capability must be an explicit boolean.')
        self.callbreak_review = callbreak_review
        if type(match_settlement) is not bool:
            raise ValueError('Match settlement capability must be an explicit boolean.')
        self.match_settlement = match_settlement
        if type(flush_settlement) is not bool:
            raise ValueError('Flush settlement capability must be an explicit boolean.')
        self.flush_settlement = flush_settlement
        self.checkpoints = PostgresCheckpointStore(pool)
        self.game_types = frozenset(game_types)
        # Timer identity is (lane kind, action type); job identity includes version.
        self.timer_validators = dict(timer_validators or {})
        if offer_expiry:
            from .offer_expiry import validate_deadline
            self.timer_validators[('table', 'seat_offer_expiry')] = validate_deadline
        self.finalization_validators = dict(finalization_validators or {})
        if any(not callable(v) or inspect.iscoroutinefunction(v)
               for v in (*self.timer_validators.values(), *self.finalization_validators.values())):
            raise ValueError('Work validators must be callable.')

    async def _rows(self, connection, sql, params=()):
        rows = await (await connection.execute(sql + ' LIMIT %s', (*params, self.max_items + 1))).fetchall()
        if len(rows) > self.max_items:
            raise RecoveryLimitExceeded('Room inventory exceeds the configured recovery budget.')
        return rows

    async def _fence(self, connection, fence):
        row = await (await connection.execute('''SELECT owner_instance_id,ownership_epoch,
            fencing_token_hash,lease_expires_at,runtime_status FROM room_ownership WHERE room_id=%s''',
            (fence.room_id,))).fetchone()
        now = (await (await connection.execute('SELECT clock_timestamp()')).fetchone())[0]
        if row is None or not _matches(row, fence) or row[3] is None or row[3] <= now or row[4] != 'recovering':
            raise StaleGameOwner('Room inventory requires this live recovering fence.')
        return now

    async def load(self, fence, host):
        """Validate every catalog table, including closed tables and old pending work.

        host supplies adapter dependencies for detached reconstruction; it must not
        publish or register recovered games. Work validators are synchronous pure
        functions that return None or raise; each receives a detached work copy.
        No work validator is enabled by default. offer_expiry=True explicitly
        enables offer deadline/inbox reconciliation; other work still needs its
        own executor validators. callbreak_review=True recognizes creator-driven
        deal review without inventing an automatic deadline. match_settlement and
        flush_settlement opt in to validated current/archive settlement inputs.
        """
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                observed_at = await self._fence(connection, fence)
                try:
                    result = await self._load(connection, fence, host, observed_at)
                except CheckpointError:
                    raise
                except (KeyError, TypeError, ValueError, IndexError, DurableGameNotFound) as error:
                    raise CheckpointError('Room recovery data is missing or malformed.') from error
        # A repeatable-read snapshot may still see an old owner after takeover.
        # Check again in a fresh transaction, without claiming atomic activation.
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await self._fence(connection, fence)
        return result

    async def _load(self, connection, fence, host, observed_at):
        room = await (await connection.execute('SELECT open_table_count,max_open_tables FROM rooms WHERE id=%s',
                                               (fence.room_id,))).fetchone()
        if room is None:
            raise DurableGameNotFound(fence.room_id)
        members = await self._rows(connection, 'SELECT user_id FROM room_memberships WHERE room_id=%s ORDER BY user_id',
                                   (fence.room_id,))
        catalog = await self._rows(connection, '''SELECT table_id,status,game_type,configuration FROM room_tables
            WHERE room_id=%s ORDER BY table_id''', (fence.room_id,))
        if sum(status != 'closed' for _, status, _, _ in catalog) != room[0] or room[0] > room[1]:
            raise CheckpointError('Room allocation count disagrees with its table catalog.')
        tables, current_games = [], set()
        for table_id, status, kind, configuration in catalog:
            if kind not in self.game_types or configuration:
                raise UnsupportedRecoveryWork('Table game type or configuration is unsupported.')
            stored = await self.checkpoints.load_in_snapshot(connection, table_id)
            rebuilt = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot)
            data = stored.checkpoint['data']
            if not self.offer_expiry and any(offer['status'] == 'PENDING' for offer in data['table']['offers']):
                raise UnsupportedRecoveryWork('Seat-offer timer reconciliation is not implemented.')
            if (not data['host']['ended'] and kind == 'callbreak' and data['engine'] and
                    data['engine']['state'].get('phase') == 'DEAL_COMPLETE' and
                    getattr(host, 'round_summary_seconds', 0) and not self.callbreak_review):
                raise UnsupportedRecoveryWork('Deal-summary continuation capability is unavailable.')
            if rebuilt.game.durable_game_id is not None:
                current_games.add(rebuilt.game.durable_game_id)
            tables.append(RecoveredTable(table_id, status, stored))
        table_ids = {t.table_id for t in tables}
        games = await self._rows(connection, '''SELECT id,table_id,status,game_type,engine_version,event_schema_version
            FROM games WHERE room_id=%s ORDER BY id''', (fence.room_id,))
        game_ids = {g[0] for g in games}
        for game_id, table_id, status, kind, engine_version, event_version in games:
            if status == 'active' and (table_id not in table_ids or game_id not in current_games):
                raise CheckpointError('An active game is absent from the recovered table state.')
            if status == 'active' and (kind not in self.game_types or (engine_version, event_version) != (1, 1)):
                raise UnsupportedRecoveryWork('Active game requires an unsupported runtime version.')
            if status == 'completed' and table_id is not None:
                intent = await (await connection.execute('''SELECT 1 FROM game_finalization_jobs
                    WHERE game_id=%s AND job_type='hosted_settlement' LIMIT 1''', (game_id,))).fetchone()
                if intent is None:
                    raise CheckpointError('Completed hosted game has no durable finalization intent.')
        reservations = await self._rows(connection, '''SELECT game_id FROM active_game_players
            WHERE room_id=%s ORDER BY user_id''', (fence.room_id,))
        if any(game_id not in current_games for (game_id,) in reservations):
            raise CheckpointError('Room has a reservation outside its current games.')
        lanes = tuple(RecoveredLane(*r) for r in await self._rows(connection, '''SELECT lane_id,kind,table_id,
            game_id,enqueued_sequence,processed_sequence FROM command_lanes WHERE room_id=%s ORDER BY lane_id''',
            (fence.room_id,)))
        for lane in lanes:
            if ((lane.table_id is not None and lane.table_id not in table_ids)
                    or (lane.game_id is not None and lane.game_id not in game_ids)):
                raise CheckpointError('Lane target is absent from room inventory.')
            head = await (await connection.execute('''SELECT count(*),min(sequence),max(sequence),
                COALESCE(bool_and(status='pending' AND request_version=1),true) AS supported
                FROM command_inbox WHERE lane_id=%s AND sequence>%s''',
                (lane.lane_id, lane.processed_sequence))).fetchone()
            count = lane.enqueued_sequence - lane.processed_sequence
            if (head[0] != count or not head[3] or (count and head[1:3] !=
                    (lane.processed_sequence + 1, lane.enqueued_sequence))):
                raise CheckpointError('Pending lane work is missing, unsupported, or outside its cursor.')
        by_lane = {lane.lane_id: lane for lane in lanes}
        timers = tuple(RecoveredTimer(*r) for r in await self._rows(connection, '''SELECT a.action_id,a.lane_id,
            a.action_type,a.generation,a.due_at,a.command_id,a.command,a.match_id,a.expected_revision,a.payload
            FROM scheduled_actions a JOIN command_lanes l USING(lane_id)
            WHERE l.room_id=%s AND a.status='pending' ORDER BY a.due_at,a.action_id''', (fence.room_id,)))
        for timer in timers:
            self._validate_work(self.timer_validators, (by_lane[timer.lane_id].kind, timer.action_type), timer)
        if self.offer_expiry:
            from .offer_expiry import COLUMNS, validate_recovery
            columns = ','.join('a.' + column for column in COLUMNS.split(','))
            offer_rows = await self._rows(connection, 'SELECT ' + columns + ''' FROM scheduled_actions a
                JOIN command_lanes l USING(lane_id) WHERE l.room_id=%s
                AND a.action_type='seat_offer_expiry' AND a.status IN ('pending','enqueued')
                ORDER BY a.action_id''', (fence.room_id,))
            await validate_recovery(connection, tables, lanes, offer_rows)
        jobs = tuple(RecoveredFinalization(*r) for r in await self._rows(connection, '''SELECT j.job_id,j.game_id,
            j.round_number,j.job_type,j.payload_version,j.payload,j.next_attempt_at,j.attempts
            FROM game_finalization_jobs j JOIN games g ON g.id=j.game_id
            WHERE g.room_id=%s AND j.completed_at IS NULL ORDER BY j.next_attempt_at,j.job_id''', (fence.room_id,)))
        game_tables = {g[0]: g[1] for g in games}
        game_kinds = {g[0]: g[3] for g in games}
        for job in jobs:
            if game_tables[job.game_id] not in table_ids:
                raise CheckpointError('Pending finalization belongs to an unrecoverable legacy game.')
            if self.match_settlement and game_kinds[job.game_id] in ('callbreak', 'marriage'):
                from .finalization import resolve_match, project_match
                project_match(await resolve_match(connection, self.checkpoints, job))
            elif self.flush_settlement and game_kinds[job.game_id] == 'flush':
                from .finalization import resolve_flush, project_flush
                project_flush(await resolve_flush(connection, self.checkpoints, job))
            else:
                self._validate_work(self.finalization_validators, (job.job_type, job.payload_version), job)
        return RoomRecoveryInventory(fence, observed_at, tuple(r[0] for r in members),
                                     tuple(tables), lanes, timers, jobs)

    @staticmethod
    def _validate_work(validators, key, work):
        validator = validators.get(key)
        if validator is None:
            raise UnsupportedRecoveryWork('Pending work requires an unavailable recovery validator.')
        result = validator(deepcopy(work))
        if inspect.iscoroutine(result):
            result.close()
        if result is not None:
            raise CheckpointError('Recovery validator must return None or raise on invalid work.')
