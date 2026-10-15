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


async def test_public_cache_remains_public_after_legacy_privacy_request(database):
    pool, store, fence, users = database
    query = PostgresHostedQueries(pool, cache=ReadCache(Redis()))
    await pool.execute("UPDATE rooms SET visibility='public' WHERE id='room'")
    await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
    assert await query.room('room', users[-1], public_preview=True)
    await pool.execute("UPDATE rooms SET visibility='private' WHERE id='room'")
    assert await query.room('room', users[-1], public_preview=True)
    assert (await pool.execute("SELECT visibility FROM rooms WHERE id='room'")).rows == [('public',)]


@pytest.mark.parametrize('kind', ['callbreak', 'marriage'])
async def test_completed_games_returnable_in_play_until_reserved_seat_is_released(database, kind):
    from test_rematch import completed, execute, request
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, kind)
    try:
        query = PostgresHostedQueries(pool, cache=ReadCache(Redis()))
        view = await query.room('room', users[0], table_id=game.table.table_id)
        assert len(view['tables']) == 1
        assert view['tables'][0]['phase'] == 'COMPLETED'
        assert view['tables'][0]['current_user']['is_seated'] is True
        assert view['tables'][0]['current_user']['can_leave_seat'] is True
        assert view['tables'][0]['table_id'] == game.table.table_id
        assert (await query.room('room', users[-1]))['tables'] == []
        assert (await query.game_view('room', users[0]))['match_id'] == game.match_id
        assert view['active_game'] is None
        assert view['snapshot']['status'] == 'finished'
        play = (await query.activity(users[0]))['items']
        assert len(play) == 1
        assert play[0]['phase'] == 'COMPLETED'
        assert play[0]['current_user']['is_seated'] is True
        # Explicit departure releases the reservation and invalidates cached
        # visibility without closing the other players' completed table.
        outcome = await execute(inbox, lane, fence, users[0],
            request(await store.load(game.table.table_id), 'leave-seat'))
        assert outcome['status'] == 'accepted'
        owner_view = await query.room('room', users[0])
        assert owner_view['tables'][0]['current_user']['is_seated'] is False
        assert (await query.activity(users[0]))['items'] == []
        assert owner_view['tables'][0]['can_end_table'] is True
        assert (await query.room('room', users[1]))['tables'][0]['phase'] == 'COMPLETED'
    finally:
        await host.close()


async def test_flush_departed_participant_profile_is_loaded_and_invalidates_cache(database):
    from test_flush_restart import finished, table_action
    pool, store, fence, users = database
    host, game, inbox, lane, *_ = await finished(database)
    try:
        await pool.execute("INSERT INTO user_profiles(user_id,display_name) VALUES (%s,'ekraj'),(%s,'')",
                           (UUID(users[0][5:]), UUID(users[1][5:])))
        await pool.execute("INSERT INTO account_credentials(user_id,username,password_salt,password_hash) VALUES (%s,'prabingiri',%s,%s)", (UUID(users[1][5:]), b'salt', b'hash'))
        assert (await table_action(database, game, inbox, lane, 'leave-seat', actor=users[1]))[0]['status'] == 'accepted'
        # Historical participants must be hydrated even outside current membership.
        await pool.execute('DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s', ('room', UUID(users[1][5:])))
        query = PostgresHostedQueries(pool, cache=ReadCache(Redis()))
        async def participant_name():
            snapshot = (await query.room('room', users[0], table_id=game.table.table_id))['snapshot']
            assert users[1] not in [p['user_id'] for p in snapshot['players']]
            return next(p['display_name'] for p in snapshot['flush']['participants'] if p['player_id'] == '2')
        assert await participant_name() == 'prabingiri'
        await pool.execute("UPDATE user_profiles SET display_name='Prabin' WHERE user_id=%s", (UUID(users[1][5:]),))
        assert await participant_name() == 'Prabin'
        # The asynchronous update path must hydrate the same historical identity.
        from uuid import uuid4
        from app.durable_games.view_generation import GenerationClaim, ViewGenerationWorker, projected_view
        from app.durable_games.view_delta import apply_delta
        from test_view_generation import Presence
        saved = await store.load(game.table.table_id)
        checkpoint = saved.checkpoint
        from copy import deepcopy
        before = deepcopy(checkpoint)
        before['data']['table_revision'] -= 1
        from hashlib import sha256
        from app.durable_games.checkpoints import canonical_json, Checkpoint
        normalized = Checkpoint.model_validate_json(canonical_json(before)).data.model_dump(mode='json')
        before['digest'] = sha256(canonical_json(normalized).encode()).hexdigest()
        claim = GenerationClaim(UUID(game.table.table_id), checkpoint['data']['table_revision'],
                                before['data']['table_revision'], uuid4(), before, checkpoint)
        [(recipient, payload)] = await ViewGenerationWorker(pool, Presence([users[0]])).generate(claim)
        names = {users[0]: 'ekraj', users[1]: 'Prabin'}
        assert recipient == UUID(users[0][5:])
        base = projected_view(before, users[0], names)
        assert payload['type'] == 'VIEW_DELTA'
        assert apply_delta(base, payload['delta'], game_id=game.match_id,
                           revision=before['data']['table_revision']) == projected_view(checkpoint, users[0], names)
    finally:
        await host.close()
