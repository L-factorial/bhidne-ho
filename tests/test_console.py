import asyncio

import pytest
from fastapi.testclient import TestClient

from app.auth.service import InMemoryAuthService, UsernameTakenError
from app.main import create_app


def register(client, username="alice"):
    response = client.post('/auth/signup', json={'username': username, 'password': 'testing-password'})
    assert response.status_code == 201
    return response.json()


def headers(account):
    return {'Authorization': f"Bearer {account['token']}"}


def test_console_assets_and_protected_rooms():
    with TestClient(create_app()) as client:
        assert 'Test console' in client.get('/').text
        for path in ('styles.css', 'app.js'):
            assert client.get(f'/test-ui/{path}').status_code == 200
        assert client.get('/rooms').status_code == 401
        assert client.post('/rooms', json={'name': 'table'}).status_code == 401


def test_expo_room_requests_allow_local_origin_without_bypassing_auth():
    with TestClient(create_app()) as client:
        origin = 'http://localhost:8083'
        response = client.options('/rooms', headers={
            'Origin': origin, 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
        })
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == origin
        unauthorized = client.get('/rooms', headers={'Origin': origin})
        assert unauthorized.status_code == 401
        assert unauthorized.headers['access-control-allow-origin'] == origin
        rejected = client.options('/rooms', headers={
            'Origin': 'https://unrelated.example', 'Access-Control-Request-Method': 'POST',
        })
        assert rejected.status_code == 400
        assert 'access-control-allow-origin' not in rejected.headers


def test_signup_signin_identity_and_validation():
    with TestClient(create_app()) as client:
        account = register(client, 'Alice')
        assert account['username'] == 'alice'
        duplicate = client.post('/auth/signup', json={'username': 'ALICE', 'password': 'testing-password'})
        assert duplicate.status_code == 409
        response = client.post('/auth/signin', json={'username': 'alice', 'password': 'testing-password'})
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        signed_in = response.json()
        assert signed_in['user_id'] == account['user_id']
        assert signed_in['token'] != account['token']
        assert client.get('/auth/me', headers=headers(signed_in)).json() == {'user_id': account['user_id']}
        for username, password in [('alice', 'wrong-password'), ('missing', 'testing-password')]:
            assert client.post('/auth/signin', json={'username': username, 'password': password}).status_code == 401
        for username, password in [('x', 'testing-password'), ('valid', 'short'), ('<script>', 'testing-password')]:
            assert client.post('/auth/signup', json={'username': username, 'password': password}).status_code == 422


def test_created_room_is_discoverable_and_accounts_can_chat():
    app = create_app()
    with TestClient(app) as client:
        alice, bob = register(client), register(client, 'bob')
        room_response = client.post('/rooms', headers=headers(alice), json={'name': '  Test table  '})
        assert room_response.status_code == 201
        room = room_response.json()
        assert room['name'] == 'Test table' and room['members'] == []
        assert client.get('/rooms', headers=headers(bob)).json() == [room]
        url = f"/ws/rooms/{room['room_id']}?token="
        with client.websocket_connect(url + alice['token']) as a, client.websocket_connect(url + bob['token']) as b:
            a.receive_json()
            b.receive_json()
            snapshot = client.get('/rooms', headers=headers(bob)).json()[0]
            assert set(snapshot['members']) == {alice['user_id'], bob['user_id']}
            a.send_json({'type': 'MESSAGE', 'payload': {'text': 'hello from account'}})
            assert b.receive_json()['sender_id'] == alice['user_id']
        assert client.get('/rooms', headers=headers(bob)).json() == [room]
        assert client.post('/rooms', headers=headers(alice), json={'name': '   '}).status_code == 422


async def test_concurrent_signup_preserves_one_account():
    auth = InMemoryAuthService()
    results = await asyncio.gather(*(auth.sign_up('alice', 'testing-password') for _ in range(2)), return_exceptions=True)
    assert sum(isinstance(result, UsernameTakenError) for result in results) == 1
    winner = next(result for result in results if not isinstance(result, Exception))
    assert (await auth.sign_in('alice', 'testing-password')).user_id == winner.user_id
