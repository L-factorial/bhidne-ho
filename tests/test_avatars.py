from uuid import UUID

from fastapi.testclient import TestClient
from psycopg.errors import CheckViolation
import pytest

from app.main import create_app
from app.multiplayer.avatars import AVATAR_IDS
from app.durable_games.platform_cache import CachedProfiles, CachedPlayers
from app.durable_games.read_cache import ReadCache
from test_checkpoint_store import database
from test_read_cache import Redis


def test_avatar_selection_auth_validation_reset_and_game_views():
    with TestClient(create_app()) as client:
        user = client.post('/auth/guest', json={'display_name': 'Avatar player'}).json()
        headers = {'Authorization': f"Bearer {user['token']}"}
        path = '/me/profile/avatar'
        assert client.patch(path, json={'avatar_id': 'male_01'}).status_code == 401
        assert client.get(path, headers=headers).json() == {'avatar_id': None, 'avatar_url': None}
        for identifier in ['male_00', 'female_16', '../male_01', 'https://example.test/image', 'male_1']:
            assert client.patch(path, headers=headers, json={'avatar_id': identifier}).status_code == 422
        assert len(AVATAR_IDS) == 30
        for identifier in ['male_01', 'female_15']:
            result = client.patch(path, headers=headers, json={'avatar_id': identifier})
            assert result.status_code == 200 and result.json()['avatar_url'] == 'preset:' + identifier
            assert result.headers['cache-control'] == 'no-store'
            assert client.get('/auth/me', headers=headers).json()['avatar_url'] == 'preset:' + identifier
        client.patch('/me/profile', headers=headers, json={'display_name': 'New name'})
        assert client.get(path, headers=headers).json()['avatar_id'] == 'female_15'
        for kind in ['callbreak', 'marriage', 'flush']:
            room = client.post('/rooms', headers=headers, json={'name': kind, 'visibility': 'public'}).json()['room_id']
            client.post(f'/rooms/{room}/enter', headers=headers)
            game = client.post(f'/test-games/{room}', headers=headers, json={'game_type': kind, 'player_count': 4})
            assert game.status_code == 201, game.text
            assert game.json()['players'][0]['avatar_url'] == 'preset:female_15'
            assert game.json()['table']['seated_players'][0]['avatar_url'] == 'preset:female_15'
            chat = client.post(f'/rooms/{room}/chat', headers=headers, json={'text': 'Hello avatar'})
            assert chat.status_code == 200, chat.text
            assert chat.json()['sender_avatar_url'] == 'preset:female_15'
            assert client.get(f'/rooms/{room}/chat', headers=headers).json()[0]['sender_avatar_url'] == 'preset:female_15'
            # Release the seat before creating a table in the next room.
            client.post(f'/test-games/{room}/leave', headers=headers, json={'match_id': game.json()['match_id']})
        assert client.patch(path, headers=headers, json={'avatar_id': None}).json()['avatar_url'] is None


async def test_avatar_persistence_and_cross_gateway_cache(database):
    pool, _, _, users = database
    for user in users:
        await pool.execute("INSERT INTO user_profiles(user_id,display_name) VALUES (%s,'Player')", (UUID(user[5:]),))
    redis = Redis()
    first, second = [CachedProfiles(pool, ReadCache(redis)) for _ in range(2)]
    directory = CachedPlayers(pool, ReadCache(redis))
    await second.get(users[0])
    assert (await directory.get_player(users[0]))['avatar_url'] is None
    await first.update_avatar(users[0], 'male_07')
    await second.get(users[0])
    assert second.avatar(users[0]) == 'preset:male_07'
    assert (await directory.get_player(users[0]))['avatar_url'] == 'preset:male_07'
    from app.durable_games.queries import PostgresHostedQueries
    profiles = await PostgresHostedQueries(pool).profile_summaries([users[0]])
    assert profiles[0]['avatar_url'] == 'preset:male_07'
    await first.update(users[0], 'Renamed')
    assert (await second.get_avatar(users[0]))['avatar_id'] == 'male_07'
    await first.update_avatar(users[0], None)
    assert (await directory.get_player(users[0]))['avatar_url'] is None
    with pytest.raises(CheckViolation):
        await pool.execute("UPDATE user_profiles SET avatar_id='male_16' WHERE user_id=%s", (UUID(users[0][5:]),))


async def test_direct_chat_and_friend_list_use_saved_avatar():
    from app.multiplayer.player_profiles import PlayerProfileService
    from app.players.store import InMemoryPlayerStore
    from app.players.service import PlayerSocialService
    profiles = PlayerProfileService()
    profiles.update_avatar('alice', 'female_04')
    store = InMemoryPlayerStore(profiles)
    await store.ensure_user('alice')
    await store.ensure_user('bob')
    await store.request_friend('alice', 'bob')
    await store.accept('bob', 'alice')
    service = PlayerSocialService(store)
    assert (await store.snapshot('bob'))['friends'][0]['avatar_url'] == 'preset:female_04'
    assert (await service.send('alice', 'bob', 'Hello'))['sender_avatar_url'] == 'preset:female_04'
    assert (await service.history('bob', 'alice'))[0]['sender_avatar_url'] == 'preset:female_04'
    profiles.update_avatar('alice', None)
    assert (await service.history('bob', 'alice'))[0]['sender_avatar_url'] is None
