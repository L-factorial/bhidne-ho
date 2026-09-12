from contextlib import ExitStack

from fastapi.testclient import TestClient
from app.main import create_app


def test_profile_names_are_owned_validated_and_visible_at_table():
    with TestClient(create_app()) as client, ExitStack() as stack:
        users = [client.post('/auth/guest').json() for _ in range(2)]
        headers = [{'Authorization': f"Bearer {u['token']}"} for u in users]
        assert client.get('/me/profile').status_code == 401
        assert client.patch('/me/profile', json={'display_name': 'Name'}).status_code == 401
        for value in ['x' * 26, 'bad\nname', 'bad\x00name']:
            assert client.patch('/me/profile', headers=headers[0], json={'display_name': value}).status_code == 422
        assert client.patch('/me/profile', headers=headers[0], json={'display_name': 'Name', 'user_id': users[1]['user_id']}).status_code == 422
        result = client.patch('/me/profile', headers=headers[0], json={'display_name': '  Ace   Player  '})
        assert result.status_code == 200 and result.json() == {'display_name': 'Ace Player'}
        assert result.headers['cache-control'] == 'no-store'
        assert client.get('/me/profile', headers=headers[1]).json() == {'display_name': ''}
        for user in users:
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/room?token={user['token']}"))
            socket.receive_json()
        mid = client.post('/test-games/room', headers=headers[0], json={'player_count': 4}).json()['match_id']
        client.post('/test-games/room/join', headers=headers[1], json={'match_id': mid})
        def snapshot(): return client.get('/test-games/room', headers=headers[1]).json()
        assert [p['display_name'] for p in snapshot()['players']] == ['Ace Player', 'Player 2']
        client.patch('/me/profile', headers=headers[0], json={'display_name': 'New name'})
        assert snapshot()['players'][0]['display_name'] == 'New name'
        assert snapshot()['match_id'] == mid
        client.patch('/me/profile', headers=headers[0], json={'display_name': ''})
        assert snapshot()['players'][0]['display_name'] == 'Player 1'


def test_account_profile_survives_sign_in_with_another_token():
    with TestClient(create_app()) as client:
        from app.multiplayer.player_profiles import PlayerProfileService
        # Account sessions share the same identity; names do not belong to tokens.
        import asyncio
        async def check():
            auth = client.app.state.auth
            first = await auth.sign_up('profile-user', 'test-password-123')
            second = await auth.sign_in('profile-user', 'test-password-123')
            profiles = PlayerProfileService()
            profiles.update(first.user_id, 'Same player')
            assert first.token != second.token
            assert profiles.get(second.user_id)['display_name'] == 'Same player'
        asyncio.run(check())
