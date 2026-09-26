"""Explicit match/round settlement workers. No startup task or payment transfers."""
from uuid import NAMESPACE_URL, UUID, uuid5

from callbreak import Phase
from marriage.scoring import calculate_scores
from app.ledger.models import GameLedgerAmount, GameLedgerResult
from app.ledger.store import PostgresLedgerStore
from .checkpoint_store import PostgresCheckpointStore, user_uuid
from .checkpoints import CheckpointError, Record, Identity, Nonnegative, canonical_json, decode_checkpoint
from .ownership import validate_room_fence
from .room_recovery import RecoveredFinalization, UnsupportedRecoveryWork
from .store import DurableGameConflict, DurableGameNotFound


class SettlementPayload(Record):
    room_id: Identity
    table_id: Identity
    match_id: Identity
    revision: Nonnegative


def validate_match_job(job):
    if job.job_type != 'hosted_settlement' or job.payload_version != 1 or job.round_number != 0:
        raise UnsupportedRecoveryWork('This worker supports version-one match settlement only.')
    payload = SettlementPayload.model_validate_json(canonical_json(job.payload))
    UUID(payload.table_id)
    if UUID(payload.match_id) != job.game_id:
        raise CheckpointError('Match settlement job has a different game identity.')


async def resolve_match(connection, checkpoints, job):
    return await _resolve(connection, checkpoints, job, validate_match_job, ('callbreak', 'marriage'))


async def _resolve(connection, checkpoints, job, validator, kinds):
    validator(job)
    payload = SettlementPayload.model_validate_json(canonical_json(job.payload))
    table_id = UUID(payload.table_id)
    row = await (await connection.execute('''SELECT room_id,table_id,game_type,status,current_sequence,
        current_revision FROM games WHERE id=%s''', (job.game_id,))).fetchone()
    if (row is None or row[:2] != (payload.room_id, table_id) or row[3] != 'completed'
            or row[5] != payload.revision):
        raise CheckpointError('Settlement job disagrees with completed game.')
    if row[2] not in kinds:
        raise UnsupportedRecoveryWork('Settlement requires another executor capability.')
    current = await (await connection.execute("SELECT state->'data'->'host'->>'durable_game_id' FROM table_recovery_state WHERE table_id=%s",
                                             (table_id,))).fetchone()
    if current and current[0] is not None and UUID(current[0]) == job.game_id:
        checkpoint = (await checkpoints.load_in_snapshot(connection, table_id)).checkpoint
    else:
        archived = await (await connection.execute('''SELECT table_id,match_id,table_revision,checkpoint
            FROM hosted_match_archives WHERE game_id=%s''', (job.game_id,))).fetchone()
        if archived is None or archived[:2] != (table_id, UUID(payload.match_id)):
            raise CheckpointError('Historical settlement is missing its matching archive.')
        checkpoint = archived[3]
        if checkpoint.get('data', {}).get('table_revision') != archived[2]:
            raise CheckpointError('Archive table revision is inconsistent.')
    decoded = decode_checkpoint(checkpoint)
    data = decoded.record.data
    if (data.room_id != payload.room_id or UUID(data.table_id) != table_id or data.match_id != payload.match_id
            or data.game_type != row[2] or data.host.durable_game_id is None
            or UUID(data.host.durable_game_id) != job.game_id or data.engine is None
            or data.engine.revision != payload.revision):
        raise CheckpointError('Settlement checkpoint has mismatched identity or revision.')
    engine = await checkpoints._load_engine(connection, job.game_id, table_id, payload.room_id, row[2], row[4])
    if engine != data.engine.model_dump(mode='json'):
        raise CheckpointError('Settlement checkpoint differs from committed engine history.')
    return decoded


def project_match(decoded):
    data, state = decoded.record.data, decoded.engine_state
    users = data.host.users
    for user in users:
        user_uuid(user)
    if data.game_type == 'marriage':
        if state.status.value != 'finished':
            raise CheckpointError('Marriage settlement requires a finished engine.')
        scores = calculate_scores(state)
        amounts = {users[int(row.player_id)-1]: row.net_points for row in scores.players}
    elif data.game_type == 'callbreak':
        if state.phase != Phase.MATCH_COMPLETE:
            raise CheckpointError('Call Break settlement requires a completed match.')
        ranked = sorted(enumerate(state.score_tenths), key=lambda row: (-row[1], row[0]))
        if len({score for _, score in ranked}) != len(ranked):
            return None  # Preserve legacy policy: tied placement has no payment projection.
        payments = data.host.settings.get('payments')
        if (not isinstance(payments, list) or len(payments) < len(users)-1
                or any(type(payment) is not int or payment < 0 for payment in payments)):
            raise CheckpointError('Call Break placement payments are invalid.')
        amounts = dict.fromkeys(users, 0)
        winner = users[ranked[0][0]]
        for place, (index, _) in enumerate(ranked[1:]):
            amounts[users[index]] -= payments[place]
            amounts[winner] += payments[place]
    else:
        raise UnsupportedRecoveryWork('Unsupported match settlement type.')
    return GameLedgerResult(room_id=data.room_id, table_id=data.table_id, table_name=data.name,
        game_id=data.match_id, game_type=data.game_type,
        amounts=[GameLedgerAmount(player_id=user, amount=value) for user, value in amounts.items()])


class MatchFinalizationWorker:
    game_types = ('callbreak', 'marriage')
    round_settlement = False
    resolve = staticmethod(resolve_match)
    project = staticmethod(project_match)

    def __init__(self, pool):
        self.pool = pool
        self.checkpoints = PostgresCheckpointStore(pool)
        self.ledger = PostgresLedgerStore(pool)

    async def execute(self, job_id, fence):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                target = await (await connection.execute('''SELECT g.room_id,g.table_id FROM game_finalization_jobs j
                    JOIN games g ON g.id=j.game_id WHERE j.job_id=%s''', (job_id,))).fetchone()
                if target is None:
                    raise DurableGameNotFound(str(job_id))
                await validate_room_fence(connection, fence, target[0])
                # Commands/rematches lock table before touching finalization jobs.
                # Match that order; never hold a job lock while waiting for its table.
                await connection.execute('SELECT table_id FROM room_tables WHERE table_id=%s FOR UPDATE', (target[1],))
                row = await (await connection.execute('''SELECT job_id,game_id,round_number,job_type,payload_version,
                    payload,next_attempt_at,attempts,completed_at FROM game_finalization_jobs
                    WHERE job_id=%s FOR UPDATE SKIP LOCKED''', (job_id,))).fetchone()
                if row is None:
                    return None
                if row[8] is not None:
                    return 'already_completed'
                job = RecoveredFinalization(*row[:8])
                decoded = await self.resolve(connection, self.checkpoints, job)
                result = self.project(decoded)
                if result is not None:
                    await self.ledger.record_game_in_transaction(connection, result)
                elif await (await connection.execute('SELECT 1 FROM ledger_games WHERE game_id=%s', (job.game_id,))).fetchone():
                    raise DurableGameConflict('Tied placement unexpectedly has a ledger projection.')
                await connection.execute('''UPDATE game_finalization_jobs SET completed_at=clock_timestamp(),
                    attempts=attempts+1,last_error=NULL WHERE job_id=%s''', (job_id,))
                await validate_room_fence(connection, fence, target[0])
                return 'projected' if result is not None else 'no_payment'

    async def pending(self, fence, *, limit=100, after_job_id=None):
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('Finalization batch limit must be between 1 and 1000.')
        async with self.pool.connection() as connection:
            rows = await (await connection.execute('''SELECT j.job_id FROM game_finalization_jobs j
                JOIN games g ON g.id=j.game_id WHERE g.room_id=%s AND g.game_type=ANY(%s::text[])
                AND ((%s AND j.round_number>0) OR (NOT %s AND j.round_number=0))
                AND j.job_type='hosted_settlement' AND j.payload_version=1
                AND j.completed_at IS NULL AND j.next_attempt_at<=clock_timestamp()
                AND (%s::uuid IS NULL OR j.job_id>%s)
                ORDER BY ''' + ('j.job_id' if after_job_id is not None else 'j.next_attempt_at,j.job_id') + ' LIMIT %s',
                (fence.room_id, list(self.game_types), self.round_settlement, self.round_settlement,
                 after_job_id, after_job_id, limit))).fetchall()
        return tuple(row[0] for row in rows)


def validate_flush_job(job):
    if job.job_type != 'hosted_settlement' or job.payload_version != 1 or job.round_number < 1:
        raise UnsupportedRecoveryWork('Flush settlement requires a version-one positive round job.')
    payload = SettlementPayload.model_validate_json(canonical_json(job.payload))
    UUID(payload.table_id)
    UUID(payload.match_id)


async def resolve_flush(connection, checkpoints, job):
    decoded = await _resolve(connection, checkpoints, job, validate_flush_job, ('flush',))
    state = decoded.engine_state
    if (state.status.value != 'finished' or state.round_number != job.round_number
            or not state.round_results or state.round_results[-1].round_number != job.round_number):
        raise CheckpointError('Flush settlement job does not identify this completed round.')
    return decoded


def project_flush(decoded):
    data, state = decoded.record.data, decoded.engine_state
    if data.game_type != 'flush' or state.status.value != 'finished' or state.settlement is None:
        raise CheckpointError('Flush projection requires a settled round.')
    # Current users can be entirely different after FIFO roster replacement.
    # Only the retained historical stable seat map identifies this round's players.
    by_seat = {str(seat): user for user, seat in data.host.flush_seats.items()}
    changes = state.round_results[-1].net_changes
    if {row.player_id for row in changes} != set(state.config.player_ids):
        raise CheckpointError('Flush net changes do not match the completed engine roster.')
    amounts = []
    for row in changes:
        if row.player_id not in by_seat:
            raise CheckpointError('Flush settlement player has no historical seat mapping.')
        user = by_seat[row.player_id]
        user_uuid(user)
        amounts.append(GameLedgerAmount(player_id=user, amount=row.amount))
    # Preserve legacy ledger identity; the durable round game ID serves storage,
    # while this UUID remains stable across old and distributed projection paths.
    identity = uuid5(NAMESPACE_URL, f'bhidne-ho:{data.match_id}:flush:{state.round_number}').hex
    return GameLedgerResult(room_id=data.room_id, table_id=data.table_id, table_name=data.name,
        game_id=identity, game_type='flush', amounts=amounts)


class FlushFinalizationWorker(MatchFinalizationWorker):
    game_types = ('flush',)
    round_settlement = True
    resolve = staticmethod(resolve_flush)
    project = staticmethod(project_flush)
