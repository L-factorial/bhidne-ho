from contextlib import ExitStack
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import create_app


def test_room_chat_membership_validation_history_and_rate_limit():
    with TestClient(create_app()) as client, ExitStack() as stack:
        users = [client.post('/auth/guest').json() for _ in range(3)]
        headers = [{'Authorization': f"Bearer {user['token']}"} for user in users]
        path = '/rooms/chat-room/chat'
        assert client.get(path).status_code == 401
        assert client.get(path, headers=headers[0]).status_code == 403
        assert client.post(path, headers=headers[0], json={'text': 'Hi'}).status_code == 403
        for user, room in zip(users, ['chat-room', 'chat-room', 'other-room']):
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/{room}?token={user['token']}"))
            socket.receive_json()
        client.patch('/me/profile', headers=headers[0], json={'display_name': 'Ram'})
        for body in [{'text': ''}, {'text': '   '}, {'text': 'a' * 501}, {'text': 'bad\x00'}, {'text': 'Hi', 'sender_id': 'spoof'}]:
            assert client.post(path, headers=headers[0], json=body).status_code == 422
        sent = client.post(path, headers=headers[0], json={'text': ' Hello room '})
        assert sent.status_code == 200
        message = sent.json()
        assert message['sender_id'] == users[0]['user_id'] and message['sender_name'] == 'Ram'
        assert message['text'] == 'Hello room'
        history = client.get(path, headers=headers[1])
        assert history.json() == [message] and history.headers['cache-control'] == 'no-store'
        assert client.get(path, headers=headers[2]).status_code == 403
        assert client.post(path, headers=headers[2], json={'text': 'Intrude'}).status_code == 403
        assert client.get('/rooms/other-room/chat', headers=headers[2]).json() == []
        assert client.post(path, headers=headers[0], json={'text': 'Too fast'}).status_code == 429
        with patch('app.multiplayer.room_chat.time.time') as clock:
            for i in range(101):
                clock.return_value = message['sent_at'] / 1000 + 2 + i * 2
                assert client.post(path, headers=headers[0], json={'text': str(i)}).status_code == 200
        history = client.get(path, headers=headers[1]).json()
        assert len(history) == 100 and history[0]['text'] == '1' and history[-1]['text'] == '100'
        stack.close()
        assert client.get(path, headers=headers[0]).status_code == 403


def test_leave_before_start_and_active_players_cannot_chat():
    with TestClient(create_app()) as client, ExitStack() as stack:
        users = [client.post('/auth/guest').json() for _ in range(5)]
        headers = [{'Authorization': f"Bearer {user['token']}"} for user in users]
        for user in users:
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/lobby?token={user['token']}"))
            socket.receive_json()
        base, chat = '/test-games/lobby', '/rooms/lobby/chat'
        match = client.post(base, headers=headers[0], json={'player_count': 4}).json()['match_id']
        body = {'match_id': match}
        for header in headers[1:4]:
            assert client.post(base+'/join', headers=header, json=body).status_code == 200
        assert client.get(chat, headers=headers[1]).status_code == 200
        assert client.post(base+'/leave', headers=headers[1], json={'match_id': 'stale'}).status_code == 409
        left = client.post(base+'/leave', headers=headers[1], json=body).json()
        assert left['your_player_id'] is None and not left['ready'] and left['can_join']
        assert client.post(base+'/leave', headers=headers[1], json=body).json()['players'] == left['players']
        assert client.post(base+'/start', headers=headers[0], json={**body, 'play_mode': 'manual'}).status_code == 409
        assert client.post(base+'/leave', headers=headers[0], json=body).status_code == 200
        assert client.get(base, headers=headers[2]).json()['is_creator']
        for header in headers[:2]:
            assert client.post(base+'/join', headers=header, json=body).status_code == 200
        assert client.post(base+'/start', headers=headers[2], json={**body, 'play_mode': 'manual'}).status_code == 200
        assert client.post(base+'/leave', headers=headers[1], json=body).status_code == 409
        for header in headers[:4]:
            assert client.get(chat, headers=header).status_code == 403
            assert client.post(chat, headers=header, json={'text': 'Playing'}).status_code == 403
        assert client.get(chat, headers=headers[4]).status_code == 200
        assert client.post(chat, headers=headers[4], json={'text': 'Spectator'}).status_code == 200
        assert client.post(base+'/end', headers=headers[2], json=body).status_code == 200
        assert client.get(chat, headers=headers[1]).status_code == 200
        new = client.post(base, headers=headers[0], json={'player_count': 4}).json()['match_id']
        empty = client.post(base+'/leave', headers=headers[0], json={'match_id': new}).json()
        assert empty['status'] == 'ended' and empty['players'] == [] and empty['your_player_id'] is None
        assert client.post(base, headers=headers[1], json={'player_count': 4}).status_code == 201
