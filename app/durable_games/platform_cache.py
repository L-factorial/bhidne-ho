"""Snapshot-consistent profile and relationship caches for distributed gateways.

SQL dependency versions are authoritative; cache entries never authorize actions.
The miss loader uses the exact snapshot used to build the immutable cache key.
"""
from contextlib import asynccontextmanager

from app.multiplayer.player_profiles import PostgresPlayerProfileService
from app.players.store import PostgresPlayerStore, internal_id


class SnapshotPool:
    def __init__(self, connection):
        self.current = connection

    @asynccontextmanager
    async def connection(self):
        yield self.current


class PlatformReadCache:
    def __init__(self, pool, cache):
        self.pool, self.cache = pool, cache

    async def read(self, family, identity, sql, params, loader):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                rows = await (await connection.execute(sql, params)).fetchall()
                key = self.cache.key(family, identity, rows)
                cached = await self.cache.get(key)
                if cached is not None and 'value' in cached:
                    return cached['value']
                value = await loader(SnapshotPool(connection))
                await self.cache.put(key, {'value': value})
                return value


PROFILE_VERSIONS = '''SELECT u.id, u.xmin::text AS user_version,
    p.xmin::text AS profile_version, a.xmin::text AS account_version
    FROM users u JOIN user_profiles p ON p.user_id=u.id
    LEFT JOIN account_credentials a ON a.user_id=u.id'''


class CachedProfiles(PostgresPlayerProfileService):
    def __init__(self, pool, cache):
        super().__init__(pool)
        self.reads = PlatformReadCache(pool, cache)

    async def _read(self, method, user_id):
        async def load(pool):
            profiles = PostgresPlayerProfileService(pool)
            value = await getattr(profiles, method)(user_id)
            return {'profile': value, 'username': profiles.usernames.get(user_id)}
        return await self.reads.read('profile-' + method, user_id,
            PROFILE_VERSIONS + ' WHERE u.id=%s', (self._uuid(user_id),),
            load)

    async def get(self, user_id):
        cached = await self._read('get', user_id)
        value = cached['profile']
        self.names[user_id] = value['display_name']
        if cached['username']:
            self.usernames[user_id] = cached['username']
        else:
            self.usernames.pop(user_id, None)
        return value

    async def appearance(self, user_id):
        return (await self._read('appearance', user_id))['profile']


class CachedPlayers(PostgresPlayerStore):
    def __init__(self, pool, cache):
        super().__init__(pool)
        self.reads = PlatformReadCache(pool, cache)

    async def _read(self, method, args, sql, params):
        return await self.reads.read('players-' + method, args, sql, params,
            lambda pool: getattr(PostgresPlayerStore(pool), method)(*args))

    async def get_player(self, user_id):
        return await self._read('get_player', (user_id,),
            PROFILE_VERSIONS + ' WHERE u.id=%s', (internal_id(user_id),))

    async def get_players(self, user_ids):
        user_ids = list(dict.fromkeys(user_ids))
        if not user_ids:
            return []
        return await self._read('get_players', (user_ids,),
            PROFILE_VERSIONS + ' WHERE u.id=ANY(%s) ORDER BY u.id',
            ([internal_id(user) for user in user_ids],))

    async def find_exact(self, user_id, query):
        # Recompute the bounded candidate page so inserts and renames invalidate
        # negative results and changes at the page boundary immediately.
        return await self._read('find_exact', (user_id, query),
            '''WITH matches AS (
                SELECT user_id FROM user_profiles WHERE lower(display_name)=lower(%s)
                UNION SELECT user_id FROM account_credentials WHERE lower(username)=lower(%s)
            ) ''' + PROFILE_VERSIONS +
            ''' JOIN matches m ON m.user_id=u.id WHERE u.id<>%s
            ORDER BY CASE WHEN lower(a.username)=lower(%s) THEN 0 ELSE 1 END,
                p.display_name,a.username,u.id LIMIT 20''',
            (query, query, internal_id(user_id), query))

    async def search(self, user_id, query):
        return await self._read('search', (user_id, query), PROFILE_VERSIONS +
            ''' WHERE u.id<>%s AND (p.display_name ILIKE %s OR a.username ILIKE %s)
            ORDER BY CASE WHEN lower(a.username)=lower(%s) THEN 0 ELSE 1 END,
                p.display_name,a.username,u.id LIMIT 20''',
            (internal_id(user_id), f'%{query}%', f'%{query}%', query))

    async def snapshot(self, user_id):
        current = internal_id(user_id)
        return await self._read('snapshot', (user_id,), '''
            SELECT f.user_low,f.user_high,f.xmin::text AS friendship_version,
                u.xmin::text AS user_version,p.xmin::text AS profile_version,
                a.xmin::text AS account_version
            FROM friendships f
            JOIN users u ON u.id=CASE WHEN f.user_low=%s THEN f.user_high ELSE f.user_low END
            JOIN user_profiles p ON p.user_id=u.id
            LEFT JOIN account_credentials a ON a.user_id=u.id
            WHERE f.user_low=%s OR f.user_high=%s ORDER BY f.user_low,f.user_high
        ''', (current, current, current))
