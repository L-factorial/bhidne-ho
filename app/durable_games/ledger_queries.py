"""Coherent ledger projection with no read-triggered finalization or local host."""
from contextlib import asynccontextmanager

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
                players = await (await connection.execute('''SELECT u.id,p.display_name,a.username FROM users u
                    LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN account_credentials a ON a.user_id=u.id
                    WHERE u.id=ANY(%s::uuid[])''', ([str(user_uuid(u)) for u in result['players']],))).fetchall()
                for identifier, display, username in players:
                    result['players'][f'user-{identifier}'] = display or username or f'user-{identifier}'
                result['player_profiles'] = {f'user-{identifier}': dict(display_name=display or '', avatar_url=None)
                    for identifier, display, _ in players}
                return result
