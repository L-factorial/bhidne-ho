"""Trusted gateway connection leases for disconnect policy, independent of Redis.

Only authenticated sockets register scopes after subscription authorization. A
missing record is UNKNOWN. Closing one device cannot disconnect another device.
Unsubscribing a view is navigation, so leases remain until socket closure/expiry.
"""
from uuid import UUID
from .checkpoint_store import user_uuid

ZERO = UUID(int=0)
LEASE_SECONDS = 60



class SessionConnections:
    def __init__(self, pool):
        self.pool = pool

    async def register(self, identity, actor, room, table=None, alias='room'):
        async with self.pool.connection() as connection:
            await connection.execute('''INSERT INTO game_connection_leases
                (connection_id,room_id,user_id,table_id,alias_id,expires_at)
                SELECT %s,%s,%s,%s,%s,clock_timestamp()+interval '60 seconds'
                WHERE EXISTS(SELECT 1 FROM room_memberships WHERE room_id=%s AND user_id=%s)
                ON CONFLICT(connection_id,room_id,alias_id) DO UPDATE
                SET expires_at=EXCLUDED.expires_at,disconnected_at=NULL,watching=true,table_id=EXCLUDED.table_id''',
                (identity, room, user_uuid(actor), table or ZERO, alias, room, user_uuid(actor)))

    async def subscribe(self, identity, actor, room, lane, alias):
        async with self.pool.connection() as connection:
            row = await (await connection.execute('SELECT table_id FROM command_lanes WHERE lane_id=%s', (lane,))).fetchone()
        await self.register(identity, actor, room, row[0] if row else None, alias)

    async def unsubscribe(self, identity, alias):
        async with self.pool.connection() as connection:
            await connection.execute('UPDATE game_connection_leases SET watching=false WHERE connection_id=%s AND alias_id=%s',
                (identity, alias))

    async def refresh(self, identity):
        async with self.pool.connection() as connection:
            await connection.execute('''UPDATE game_connection_leases
                SET expires_at=clock_timestamp()+interval '60 seconds'
                WHERE connection_id=%s AND disconnected_at IS NULL''', (identity,))

    async def close(self, identity):
        async with self.pool.connection() as connection:
            await connection.execute('''UPDATE game_connection_leases
                SET disconnected_at=clock_timestamp(),expires_at=clock_timestamp()
                WHERE connection_id=%s AND disconnected_at IS NULL''', (identity,))


async def evidence(connection, room, *, now):
    rows = await (await connection.execute('''SELECT user_id,
        bool_or(disconnected_at IS NULL AND expires_at>to_timestamp(%s)),
        max(coalesce(disconnected_at,expires_at)) FROM game_connection_leases
        WHERE room_id=%s GROUP BY user_id''', (now, room))).fetchall()
    return {f'user-{user}': True if live else stamp.timestamp() for user,live,stamp in rows}


async def watchers(connection, room, table, *, now):
    rows = await (await connection.execute('''SELECT DISTINCT c.user_id FROM game_connection_leases c
        JOIN room_memberships m ON m.room_id=c.room_id AND m.user_id=c.user_id
        WHERE c.room_id=%s AND c.table_id=%s AND c.watching AND c.disconnected_at IS NULL
        AND c.expires_at>to_timestamp(%s) ORDER BY c.user_id''', (room, table, now))).fetchall()
    return [f'user-{row[0]}' for row in rows]
