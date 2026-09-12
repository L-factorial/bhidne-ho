import asyncio
from contextlib import ExitStack

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from app.models.poke import CallBreakPokeInput, RoomPhraseInput
from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.room_pokes import RoomPokeService
from app.multiplayer.room_service import RoomService
from app.test_games.service import TestGameService as GameHost


class Socket:
    def __init__(self): self.messages = []
    async def send_json(self, message): self.messages.append(message)
    async def close(self, code): pass


async def social_table():
    rooms = RoomService()
    connections = ConnectionManager(rooms)
    sockets = [Socket() for _ in range(7)]
    ids = []
    for index in range(5):
        ids.append(await connections.connect('room', f'u{index}', sockets[index]))
    await connections.connect('room', 'u1', sockets[5])  # Same player's second tab.
    await connections.connect('elsewhere', 'u1', sockets[6])
    host, social = GameHost(rooms, connections), RoomPokeService(rooms, connections)
    game = await host.create('room', 'u0', 4)
    for index in range(1, 4): await host.join('room', f'u{index}', game['match_id'])
    await host.start('room', 'u0', game['match_id'], 'manual')
    for socket in sockets: socket.messages.clear()
    return host, social, connections, sockets, ids


async def test_private_poke_only_reaches_target_in_this_room_without_changing_game():
    host, social, _, sockets, _ = await social_table()
    game = host.games['room']
    state, log, deadline = game.state, list(game.log), game.deadline
    body = CallBreakPokeInput(match_id=game.match_id, recipient_player_id=2, text='Your move, legend!')
    ack = await host.poke('room', 'u0', body, social)
    assert ack['scope'] == 'private'
    assert [len(socket.messages) for socket in sockets] == [0, 1, 0, 0, 0, 1, 0]
    event = sockets[1].messages[0]
    assert event['sender_id'] == 'u0' and event['sender_player_id'] == 1
    assert event['recipient_id'] == 'u1' and event['recipient_player_id'] == 2
    assert event['text'] == body.text and event['id'] == ack['id']
    assert event['type'] == 'ROOM_POKE' and event['match_id'] == game.match_id
    assert game.state is state and game.log == log and game.deadline == deadline and game.commands.receipts == {}
    assert 'ROOM_POKE' not in str(await host.snapshot('room', 'u2'))
    await host.close()


async def test_table_poke_reaches_every_room_identity_including_spectator_and_sender():
    host, social, _, sockets, _ = await social_table()
    ack = await host.poke('room', 'u0', CallBreakPokeInput(match_id=host.games['room'].match_id, text='Plot twist!'), social)
    assert ack['scope'] == 'table'
    assert [len(socket.messages) for socket in sockets] == [1, 1, 1, 1, 1, 1, 0]
    assert all(socket.messages[0]['recipient_id'] is None for socket in sockets[:6])
    await host.close()


async def test_poke_authorization_stale_match_empty_seat_self_offline_and_cooldown():
    host, social, connections, sockets, ids = await social_table()
    mid = host.games['room'].match_id
    for user, match, recipient, status in [('u4', mid, 2, 403), ('outsider', mid, 2, 403),
        ('u0', 'old-match', 2, 409), ('u0', mid, 5, 409), ('u0', mid, 1, 409)]:
        with pytest.raises(HTTPException) as error:
            await host.poke('room', user, CallBreakPokeInput(match_id=match, recipient_player_id=recipient, text='Hey!'), social)
        assert error.value.status_code == status
    await connections.disconnect('room', ids[2])
    with pytest.raises(HTTPException) as error:
        await host.poke('room', 'u0', CallBreakPokeInput(match_id=mid, recipient_player_id=3, text='Hey!'), social)
    assert error.value.status_code == 409
    body = CallBreakPokeInput(match_id=mid, recipient_player_id=2, text='Hey!')
    result = await asyncio.gather(host.poke('room', 'u0', body, social), host.poke('room', 'u0', body, social), return_exceptions=True)
    assert sum(isinstance(value, dict) for value in result) == 1
    errors = [value for value in result if isinstance(value, HTTPException)]
    assert len(errors) == 1 and errors[0].status_code == 429
    assert len(sockets[1].messages) == 1
    await host.close()


async def test_room_phrase_sharing_isolation_ownership_duplicate_and_capacity():
    host, social, _, _, _ = await social_table()
    first = await social.add_phrase('room', 'u0', 'Spades have entered!')
    duplicate = await social.add_phrase('room', 'u1', 'spades have entered!')
    assert first['id'] == duplicate['id']
    assert await social.phrases('room', 'u1') == [first]
    assert await social.phrases('elsewhere', 'u1') == []
    with pytest.raises(HTTPException) as error:
        await social.remove_phrase('room', 'u1', first['id'])
    assert error.value.status_code == 403
    for number in range(23): await social.add_phrase('room', 'u0', f'Phrase {number}')
    with pytest.raises(HTTPException) as error:
        await social.add_phrase('room', 'u0', 'Too many')
    assert error.value.status_code == 409
    await social.remove_phrase('room', 'u0', first['id'])
    assert len(await social.phrases('room', 'u1')) == 23
    with pytest.raises(HTTPException): await social.phrases('room', 'outsider')
    await host.close()


@pytest.mark.parametrize('text', ['', '   ', 'a' * 26, '😏' * 26, 'bad\x00text'])
def test_phrase_validation_rejects_empty_long_and_control_text(text):
    with pytest.raises(ValidationError): RoomPhraseInput(text=text)


def test_phrase_validation_accepts_25_characters_and_unicode():
    assert RoomPhraseInput(text='a' * 25).text == 'a' * 25
    assert RoomPhraseInput(text='😏' * 25).text == '😏' * 25
    assert RoomPhraseInput(text='  nice   hand! ').text == 'nice hand!'


def test_http_phrases_and_pokes_enforce_membership_identity_and_length():
    with TestClient(create_app()) as client, ExitStack() as stack:
        assert client.get('/rooms/room/phrases').status_code == 401
        users = [client.post('/auth/guest').json() for _ in range(2)]
        headers = [{'Authorization': f"Bearer {u['token']}"} for u in users]
        assert client.post('/rooms/room/phrases', headers=headers[0], json={'text': 'Hey'}).status_code == 403
        for user in users:
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/room?token={user['token']}"))
            socket.receive_json()
        phrase = client.post('/rooms/room/phrases', headers=headers[0], json={'text': 'Nice hand!'})
        assert phrase.status_code == 201 and phrase.headers['cache-control'] == 'no-store'
        assert client.get('/rooms/room/phrases', headers=headers[1]).json()[0]['text'] == 'Nice hand!'
        assert client.post('/rooms/room/phrases', headers=headers[0], json={'text': 'x' * 26}).status_code == 422
        mid = client.post('/test-games/room', headers=headers[0], json={'player_count': 4}).json()['match_id']
        client.post('/test-games/room/join', headers=headers[1], json={'match_id': mid})
        body = {'match_id': mid, 'recipient_player_id': 2, 'text': 'Poke!'}
        assert client.post('/test-games/room/poke', headers=headers[0], json={**body, 'sender_id': users[1]['user_id']}).status_code == 422
        assert client.post('/test-games/room/poke', headers=headers[0], json={**body, 'text': 'x' * 26}).status_code == 422
        sent = client.post('/test-games/room/poke', headers=headers[0], json=body)
        assert sent.status_code == 200 and sent.json()['scope'] == 'private'
        removed = client.delete('/rooms/room/phrases/' + phrase.json()['id'], headers=headers[0])
        assert removed.status_code == 200
