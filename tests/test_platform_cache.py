from uuid import UUID

import pytest

from app.durable_games.platform_cache import CachedPlayers, CachedProfiles
from app.durable_games.read_cache import ReadCache
from app.players.store import PostgresPlayerStore
from test_checkpoint_store import database
from test_read_cache import Redis


async def seed(pool, users):
    for index, user in enumerate(users):
        await pool.execute('INSERT INTO user_profiles(user_id,display_name) VALUES (%s,%s)',
                           (UUID(user[5:]), f'Player {index}'))


async def test_profiles_refresh_both_gateways_after_edit(database):
    pool, _, _, users = database
    await seed(pool, users)
    redis = Redis()
    one, two = [CachedProfiles(pool, ReadCache(redis)) for _ in range(2)]
    await pool.execute('''INSERT INTO account_credentials(user_id,username,password_salt,password_hash)
        VALUES (%s,'account-name',%s,%s)''', (UUID(users[0][5:]), b'salt', b'hash'))
    assert await one.get(users[0]) == await two.get(users[0]) == {'display_name': 'Player 0'}
    assert two.usernames[users[0]] == 'account-name'
    await one.update(users[0], 'नयाँ नाम')
    assert await two.get(users[0]) == {'display_name': 'नयाँ नाम'}
    assert (await two.appearance(users[0]))['mode'] == 'system'
    await one.update_appearance(users[0], 'heritage', 'dark')
    assert (await two.appearance(users[0]))['mode'] == 'dark'
    redis.failed = True
    await one.update(users[0], 'Changed while Redis is offline')
    assert (await two.get(users[0]))['display_name'] == 'Changed while Redis is offline'


async def test_directory_negative_results_renames_and_redis_hits(database, monkeypatch):
    pool, _, _, users = database
    await seed(pool, users)
    redis = Redis()
    one, two = [CachedPlayers(pool, ReadCache(redis)) for _ in range(2)]
    expected = await one.get_player(users[1])
    original = PostgresPlayerStore.get_player
    async def must_hit(*args):
        raise AssertionError('Second gateway should use cached payload')
    monkeypatch.setattr(PostgresPlayerStore, 'get_player', must_hit)
    assert await two.get_player(users[1]) == expected
    monkeypatch.setattr(PostgresPlayerStore, 'get_player', original)
    assert await one.find_exact(users[0], 'Changed') == []
    assert await two.find_exact(users[0], 'Changed') == []
    assert len(await one.search(users[0], 'Player')) == 5
    await CachedProfiles(pool, ReadCache(redis)).update(users[1], 'Changed')
    assert (await two.find_exact(users[0], 'Changed'))[0]['user_id'] == users[1]
    assert len(await one.search(users[0], 'Player')) == 4
    assert (await two.get_player(users[1]))['display_name'] == 'Changed'
    batch = await one.get_players(users[1:3])
    batch[0]['display_name'] = 'caller mutation'
    assert (await two.get_players(users[1:3]))[0]['display_name'] != 'caller mutation'


async def test_friendship_versions_include_relationship_and_profile_updates(database):
    pool, _, _, users = database
    await seed(pool, users)
    redis = Redis()
    one, two = [CachedPlayers(pool, ReadCache(redis)) for _ in range(2)]
    assert (await one.snapshot(users[0]))['friends'] == []
    await one.request_friend(users[0], users[1])
    assert (await two.snapshot(users[0]))['outgoing'][0]['user_id'] == users[1]
    await two.accept(users[1], users[0])
    assert (await one.snapshot(users[0]))['friends'][0]['user_id'] == users[1]
    await CachedProfiles(pool, ReadCache(redis)).update(users[1], 'Renamed friend')
    assert (await two.snapshot(users[0]))['friends'][0]['display_name'] == 'Renamed friend'
    await two.remove(users[1], users[0])
    assert await one.snapshot(users[0]) == {'friends': [], 'incoming': [], 'outgoing': []}


async def test_new_directory_entries_invalidate_cached_empty_results(database):
    pool, _, _, users = database
    await seed(pool, users)
    redis = Redis()
    one, two = [CachedPlayers(pool, ReadCache(redis)) for _ in range(2)]
    assert await one.find_exact(users[0], 'New arrival') == []
    new_id = UUID(int=100)
    await pool.execute("INSERT INTO users(id,kind) VALUES (%s,'account')", (new_id,))
    await pool.execute("INSERT INTO user_profiles(user_id,display_name) VALUES (%s,'New arrival')", (new_id,))
    assert (await two.find_exact(users[0], 'New arrival'))[0]['user_id'] == f'user-{new_id}'
    # A cached directory response is scoped to its searching actor.
    assert await two.find_exact(f'user-{new_id}', 'New arrival') == []
    await pool.execute('DELETE FROM users WHERE id=%s', (new_id,))
    assert await one.find_exact(users[0], 'New arrival') == []
