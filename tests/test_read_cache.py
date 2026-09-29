import asyncio
import json
from uuid import UUID

import pytest

from app.durable_games.read_cache import ReadCache
from app.durable_games.queries import PostgresHostedQueries, QueryAccessDenied
from app.durable_games.checkpoints import capture_checkpoint
from test_checkpoint_store import database, host_game


class Redis:
    def __init__(self):
        self.values = {}
        self.failed = False

    async def get(self, key):
        if self.failed:
            raise OSError('offline')
        return self.values.get(key)

    async def set(self, key, raw, **options):
        if self.failed:
            raise OSError('offline')
        self.values[key] = raw


async def test_two_levels_versions_copies_bounds_and_failures():
    redis = Redis()
    first = ReadCache(redis, max_entries=2)
    second = ReadCache(redis)
    key = first.key('room', ['room', 'alice'], [1])
    other = first.key('room', ['room', 'bob'], [1])
    newer = first.key('room', ['room', 'alice'], [2])
    assert key != other != newer
    await first.put(key, {'users': ['alice']})
    value = await second.get(key)
    value['users'].append('uncommitted')
    assert await second.get(key) == {'users': ['alice']}
    assert await second.get(newer) is None
    await first.put(newer, {'users': []})
    # An older in-flight fill cannot overwrite the newer version.
    await first.put(key, {'users': ['alice']})
    assert await first.get(newer) == {'users': []}
    await first.put(other, {'users': ['bob']})
    assert len(first._local) == 2
    redis.failed = True
    assert await first.get(other) == {'users': ['bob']}
    assert await second.get(other) is None
    await second.put(other, {'users': []})  # Cache outage never breaks a read.
    assert await second.get(other) == {'users': []}


async def test_expiry_corrupt_values_size_and_cancellation():
    redis = Redis()
    cache = ReadCache(redis, ttl=.001, max_value_bytes=50)
    await cache.put('key', {'data': 'safe'})
    redis.values.clear()
    await asyncio.sleep(.01)
    assert await cache.get('key') is None
    redis.values['key'] = b'not JSON'
    assert await cache.get('key') is None
    await cache.put('large', {'data': 'x' * 100})
    assert 'large' not in redis.values and 'large' not in cache._local
    async def cancelled(key):
        raise asyncio.CancelledError()
    redis.get = cancelled
    with pytest.raises(asyncio.CancelledError):
        await cache.get('missing')


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_committed_projection_cache_cross_server_versions_and_authorization(database, kind):
    pool, store, fence, users = database
    host, game = await host_game(users, kind, started=False)
    redis = Redis()
    one = PostgresHostedQueries(pool, cache=ReadCache(redis))
    two = PostgresHostedQueries(pool, cache=ReadCache(redis))
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        before = await one.room('room', users[0], table_id=game.table.table_id)
        async def no_load(*args):
            raise AssertionError('A second server must use the Redis projection')
        two.checkpoints.load_in_snapshot = no_load
        assert await two.room('room', users[0], table_id=game.table.table_id) == json.loads(json.dumps(before))
        # A committed table update produces a new key without waiting for TTL.
        game.name = 'Renamed table'
        await store.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence)
        updated = await one.room('room', users[0], table_id=game.table.table_id)
        assert updated['snapshot']['table_name'] == 'Renamed table'
        assert updated['snapshot']['table_revision'] == 1
        before['tables'].clear()
        assert (await one.room('room', users[0]))['tables']
        # Same table revision but changed profile must invalidate both cache tiers.
        await pool.execute("INSERT INTO user_profiles(user_id,display_name) VALUES (%s,'New name')", (UUID(users[0][5:]),))
        renamed = await one.room('room', users[0], table_id=game.table.table_id)
        assert renamed['snapshot']['players'][0]['display_name'] == 'New name'
        assert len(redis.values) >= 3
        # Database membership revocation wins even while both cached versions live.
        await pool.execute('DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s', ('room', UUID(users[0][5:])))
        with pytest.raises(QueryAccessDenied):
            await one.room('room', users[0], table_id=game.table.table_id)
        with pytest.raises(QueryAccessDenied):
            await two.room('room', users[0], table_id=game.table.table_id)
    finally:
        await host.close()


async def test_public_cache_does_not_survive_private_room_change(database):
    pool, store, fence, users = database
    query = PostgresHostedQueries(pool, cache=ReadCache(Redis()))
    await pool.execute("UPDATE rooms SET visibility='public' WHERE id='room'")
    await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
    assert await query.room('room', users[-1], public_preview=True)
    await pool.execute("UPDATE rooms SET visibility='private' WHERE id='room'")
    with pytest.raises(QueryAccessDenied):
        await query.room('room', users[-1], public_preview=True)


@pytest.mark.parametrize('kind', ['callbreak', 'marriage'])
async def test_completed_games_hidden_from_active_tabs_but_results_selectable(database, kind):
    from test_rematch import completed
    pool, _, _, users = database
    host, game, *_ = await completed(database, kind)
    try:
        query = PostgresHostedQueries(pool, cache=ReadCache(Redis()))
        view = await query.room('room', users[0], table_id=game.table.table_id)
        assert view['tables'] == []
        assert view['active_game'] is None
        assert view['snapshot']['status'] == 'finished'
        assert (await query.activity(users[0]))['items'] == []
    finally:
        await host.close()
