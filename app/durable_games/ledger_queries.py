"""Coherent ledger projection with no read-triggered finalization or local host."""

from app.multiplayer.avatars import avatar_url
from .telemetry import observe
from contextlib import asynccontextmanager
from copy import deepcopy
from uuid import NAMESPACE_URL, UUID, uuid5

from app.ledger.service import LedgerService
from app.ledger.store import PostgresLedgerStore
from .checkpoint_store import user_uuid
from .queries import require_member
from .store import DurableGameConflict


class _SnapshotPool:
    def __init__(self, connection):
        self.bound_connection = connection

    @asynccontextmanager
    async def connection(self):
        yield self.bound_connection


class _AuthorizedRoom:
    def __init__(self, room_id, actor, name):
        self.room_id, self.actor, self.name = room_id, actor, name

    async def members(self, room_id):
        return {self.actor} if room_id == self.room_id else set()

    async def room(self, room_id):
        return {'name': self.name} if room_id == self.room_id else None


class PostgresLedgerQueries:
    def __init__(self, pool, *, max_records=1000):
        if type(max_records) is not int or max_records < 1:
            raise ValueError('Ledger read bound must be positive.')
        self.pool, self.max_records = pool, max_records

    async def pending_rooms(self, actor, *, after_room_id="", limit=50):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                return await PostgresLedgerStore(_SnapshotPool(connection)).pending_rooms(
                    actor, after_room_id=after_room_id, limit=limit)

    @observe('read.ledger')
    async def snapshot(self, room_id, actor):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await require_member(connection, room_id, actor)
                # Never truncate totals. Oversized histories need a larger tested
                # bound or a separate aggregate/pagination contract.
                for table in ('ledger_games', 'settlement_batches'):
                    rows = await (await connection.execute(f'SELECT 1 FROM {table} WHERE room_id=%s LIMIT %s',
                        (room_id, self.max_records + 1))).fetchall()
                    if len(rows) > self.max_records:
                        raise DurableGameConflict('Ledger history exceeds the configured snapshot bound.')
                name = (await (await connection.execute('SELECT name FROM rooms WHERE id=%s', (room_id,))).fetchone())[0]
                tables = await (await connection.execute('''SELECT DISTINCT t.table_id,t.name FROM room_tables t
                    JOIN ledger_games g ON g.table_id=t.table_id WHERE t.room_id=%s''', (room_id,))).fetchall()
                service = LedgerService(PostgresLedgerStore(_SnapshotPool(connection)), _AuthorizedRoom(room_id, actor, name))
                result = await service.snapshot(room_id, actor, {t.hex: name for t, name in tables})
                # Results with no payment (tied Call Break placement) intentionally
                # have no financial ledger rows. Retain them in display records
                # without changing settlement accounting or finalizing on reads.
                record_tables = deepcopy(result['tables'])
                by_table = {row['table_id']: row for row in record_tables}
                times = {identifier.hex: created for identifier, created in await
                    (await connection.execute('SELECT game_id,created_at FROM ledger_games WHERE room_id=%s', (room_id,))).fetchall()}
                # Order distributed game records by play order, even when a
                # finalization worker records their results in a different order.
                history = await (await connection.execute("""SELECT g.started_at,g.game_type,
                    j.round_number,j.payload->>'match_id' FROM game_finalization_jobs j
                    JOIN games g ON g.id=j.game_id WHERE g.room_id=%s
                    AND j.job_type='hosted_settlement' ORDER BY g.started_at,g.id LIMIT %s""",
                    (room_id, self.max_records + 1))).fetchall()
                if len(history) > self.max_records:
                    raise DurableGameConflict('Table record history exceeds the configured snapshot bound.')
                for started, kind, round_number, match_id in history:
                    identity = (uuid5(NAMESPACE_URL, f'bhidne-ho:{match_id}:flush:{round_number}').hex
                        if kind == 'flush' else UUID(match_id).hex)
                    times[identity] = started
                missing = await (await connection.execute("""SELECT j.job_id FROM game_finalization_jobs j
                    JOIN games g ON g.id=j.game_id WHERE g.room_id=%s AND g.game_type='callbreak'
                    AND j.completed_at IS NOT NULL AND j.job_type='hosted_settlement'
                    AND j.round_number=0 AND NOT EXISTS (SELECT 1 FROM ledger_games l
                        WHERE l.game_id=(j.payload->>'match_id')::uuid)
                    ORDER BY j.completed_at,j.job_id LIMIT %s""", (room_id, self.max_records + 1))).fetchall()
                if len(missing) > self.max_records:
                    raise DurableGameConflict('Table record history exceeds the configured snapshot bound.')
                if missing:
                    from .finalization import resolve_match, project_match
                    from .checkpoint_store import PostgresCheckpointStore
                    from .room_recovery import RecoveredFinalization
                    from app.ledger.service import record_balances
                    for (job_id,) in missing:
                        row = await (await connection.execute("""SELECT job_id,game_id,round_number,job_type,
                            payload_version,payload,next_attempt_at,attempts,completed_at
                            FROM game_finalization_jobs WHERE job_id=%s""", (job_id,))).fetchone()
                        decoded = await resolve_match(connection, PostgresCheckpointStore(self.pool), RecoveredFinalization(*row[:8]))
                        if project_match(decoded) is not None:
                            raise DurableGameConflict('Completed payment result is missing its ledger projection.')
                        data = decoded.record.data
                        table = by_table.get(data.table_id)
                        if table is None:
                            table = dict(table_id=data.table_id,table_name=data.name,game_count=0,balances=[],record_balances=[],games=[],suggested_transfers=[],transactions=[])
                            record_tables.append(table); by_table[data.table_id] = table
                        zeros = record_balances(dict.fromkeys(data.host.users, 0))
                        table['games'].append(dict(game_id=data.match_id,game_type='callbreak',settled=False,balances=[],record_balances=zeros))
                        table['game_count'] += 1
                        totals = {r['player_id']:r['amount'] for r in table['record_balances']}
                        for user in data.host.users:
                            totals.setdefault(user, 0); result['players'].setdefault(user,user)
                        table['record_balances'] = record_balances(totals)
                        times.setdefault(data.match_id, row[8])
                for table in record_tables:
                    table['games'].sort(key=lambda game: (times[game['game_id']], game['game_id']))
                result['record_tables'] = record_tables
                players = await (await connection.execute('''SELECT u.id,p.display_name,a.username,p.avatar_id FROM users u
                    LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN account_credentials a ON a.user_id=u.id
                    WHERE u.id=ANY(%s::uuid[])''', ([str(user_uuid(u)) for u in result['players']],))).fetchall()
                for identifier, display, username, avatar in players:
                    result['players'][f'user-{identifier}'] = display or username or f'user-{identifier}'
                result['player_profiles'] = {f'user-{identifier}': dict(display_name=display or '', avatar_url=avatar_url(avatar))
                    for identifier, display, _, avatar in players}
                return result
