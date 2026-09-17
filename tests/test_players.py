from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import create_app


def account(client, username, name):
    credentials = client.post('/auth/signup', json={
        'username': username, 'password': 'testing-password-123',
    }).json()
    headers = {'Authorization': f"Bearer {credentials['token']}"}
    assert client.patch('/me/profile', headers=headers, json={'display_name': name}).status_code == 200
    return credentials, headers


def test_player_search_friend_request_acceptance_and_removal():
    with TestClient(create_app()) as client:
        alice, ah = account(client, 'alice-friends', 'Alice Ace')
        bob, bh = account(client, 'bob-friends', 'Bob Buddy')
        _, ch = account(client, 'carol-friends', 'Carol')

        assert client.get('/players/search?q=a', headers=ah).status_code == 422
        results = client.get('/players/search?q=bob', headers=ah).json()
        assert results == [{'user_id': bob['user_id'], 'display_name': 'Bob Buddy', 'username': 'bob-friends'}]
        assert client.get('/players/search?q=alice', headers=ah).json() == []

        requested = client.post(f"/friends/requests/{bob['user_id']}", headers=ah)
        assert requested.status_code == 201 and requested.json()['user_id'] == bob['user_id']
        assert client.post(f"/friends/requests/{bob['user_id']}", headers=ah).status_code == 409
        assert client.post(f"/friends/requests/{alice['user_id']}", headers=ah).status_code == 409

        assert [p['user_id'] for p in client.get('/friends', headers=ah).json()['outgoing']] == [bob['user_id']]
        assert [p['user_id'] for p in client.get('/friends', headers=bh).json()['incoming']] == [alice['user_id']]
        assert client.get('/friends', headers=ch).json() == {'friends': [], 'incoming': [], 'outgoing': []}

        accepted = client.post(f"/friends/requests/{alice['user_id']}/accept", headers=bh)
        assert accepted.status_code == 200
        assert client.post(f"/friends/requests/{alice['user_id']}/accept", headers=bh).status_code == 409
        assert [p['user_id'] for p in client.get('/friends', headers=ah).json()['friends']] == [bob['user_id']]

        assert client.delete(f"/friends/{bob['user_id']}", headers=ah).status_code == 204
        assert client.get('/friends', headers=ah).json()['friends'] == []
        assert client.delete(f"/friends/{bob['user_id']}", headers=ah).status_code == 409


def test_direct_messages_are_private_friend_only_validated_and_rate_limited():
    with TestClient(create_app()) as client:
        alice, ah = account(client, 'alice-chat', 'Alice')
        bob, bh = account(client, 'bob-chat', 'Bob')
        carol, ch = account(client, 'carol-chat', 'Carol')
        path = f"/friends/{bob['user_id']}/messages"

        assert client.get(path, headers=ah).status_code == 403
        assert client.post(path, headers=ah, json={'text': 'No friendship'}).status_code == 403
        client.post(f"/friends/requests/{bob['user_id']}", headers=ah)
        assert client.get(path, headers=ah).status_code == 403
        client.post(f"/friends/requests/{alice['user_id']}/accept", headers=bh)

        for invalid in ['', ' ', 'x' * 501, 'bad\x00']:
            assert client.post(path, headers=ah, json={'text': invalid}).status_code == 422
        with patch.object(client.app.state.players, 'clock', side_effect=[10, 10.5, 12]):
            first = client.post(path, headers=ah, json={'text': ' Hello Bob '})
            assert first.status_code == 201 and first.json()['text'] == 'Hello Bob'
            assert client.post(path, headers=ah, json={'text': 'Too fast'}).status_code == 429
            second = client.post(path, headers=ah, json={'text': 'Second'}).json()

        history = client.get(f"/friends/{alice['user_id']}/messages", headers=bh).json()
        assert [m['text'] for m in history] == ['Hello Bob', 'Second']
        assert all(m['sender_id'] == alice['user_id'] and m['recipient_id'] == bob['user_id'] for m in history)
        assert client.get(f"/friends/{alice['user_id']}/messages", headers=ch).status_code == 403
        assert client.delete(f"/friends/{alice['user_id']}", headers=bh).status_code == 204
        assert client.get(path, headers=ah).status_code == 403


def test_player_endpoints_require_authentication_and_reject_unknown_users():
    with TestClient(create_app()) as client:
        _, headers = account(client, 'known-player', 'Known')
        unknown = 'user-00000000-0000-0000-0000-000000000000'
        assert client.get('/friends').status_code == 401
        assert client.get('/players/search?q=known').status_code == 401
        assert client.post(f'/friends/requests/{unknown}', headers=headers).status_code == 404
        assert client.post('/friends/requests/not-an-id', headers=headers).status_code == 404
