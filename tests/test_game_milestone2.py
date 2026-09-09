import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.games.base import GameCommandRejected
from app.games.echo import EchoGameEngine
from app.main import create_app
from app.models.game import GameCommand, GameEvent
from app.runtime.game_registry import GameRegistry
from app.runtime.game_runtime import GameRuntime
from scripts.client import parse_input


def ping(**payload):
    return GameCommand(command='PING', payload=payload)


def test_envelopes_and_independent_defaults():
    command = GameCommand.model_validate_json('{"type":"GAME_COMMAND","command":"PING"}')
    assert command.payload == {}
    command.payload['x'] = 1
    assert ping().payload == {}
    event = GameEvent(event='PONG')
    assert event.model_dump(mode='json') == {'type': 'GAME_EVENT', 'event': 'PONG', 'payload': {}}
    event.payload['x'] = 1
    assert GameEvent(event='PONG').payload == {}


@pytest.mark.parametrize('data', [
    {}, {'command': ''}, {'command': '  '}, {'command': 1},
    {'command': 'PING', 'payload': []}, {'command': 'PING', 'payload': None},
    {'type': 'GAME_EVENT', 'command': 'PING'},
])
def test_invalid_envelopes(data):
    with pytest.raises(ValidationError):
        GameCommand.model_validate(data)


def test_registry_ownership_and_lifecycle():
    registry = GameRegistry()
    a, b = EchoGameEngine(), EchoGameEngine()
    registry.register('a', a)
    registry.register('b', b)
    assert registry.get_engine('a') is a
    assert registry.engine_for('b') is b
    assert registry.get_engine('missing') is None
    assert registry.get_room('a').lock is not registry.get_room('b').lock
    with pytest.raises(ValueError):
        registry.register('a', b)
    with pytest.raises(ValueError):
        registry.register('c', a)
    registry.clear()
    assert registry.get_engine('a') is None


async def test_runtime_identity_routing_and_room_state():
    registry, broadcaster = GameRegistry(), AsyncMock()
    a, b = EchoGameEngine(), EchoGameEngine()
    registry.register('a', a)
    registry.register('b', b)
    runtime = GameRuntime(broadcaster, registry)
    forged = GameCommand.model_validate({
        'command': 'PING', 'user_id': 'forged', 'room_id': 'b',
        'payload': {'message': 'hello', 'user_id': 'forged', 'player_id': 'forged'},
    })
    assert await runtime.handle('a', 'trusted', forged) is None
    broadcaster.broadcast.assert_awaited_once_with('a', {
        'type': 'GAME_EVENT', 'event': 'PONG',
        'payload': {'message': 'hello', 'player_id': 'trusted', 'sequence': 1},
    })
    assert a.command_count == 1 and b.command_count == 0
    await runtime.handle('b', 'other', ping())
    assert b.command_count == 1


async def test_runtime_multiple_and_zero_events():
    class Engine:
        def handle_command(self, user_id, command):
            assert user_id == 'trusted'
            assert isinstance(command, GameCommand)
            return [GameEvent(event=name) for name in command.payload['events']]
    registry, broadcaster = GameRegistry(), AsyncMock()
    registry.register('room', Engine())
    runtime = GameRuntime(broadcaster, registry)
    await runtime.handle('room', 'trusted', ping(events=['FIRST', 'SECOND']))
    assert [c.args[1]['event'] for c in broadcaster.broadcast.await_args_list] == ['FIRST', 'SECOND']
    broadcaster.reset_mock()
    await runtime.handle('room', 'trusted', ping(events=[]))
    broadcaster.broadcast.assert_not_awaited()


async def test_runtime_errors_and_recovery():
    registry, broadcaster = GameRegistry(), AsyncMock()
    engine = EchoGameEngine()
    registry.register('room', engine)
    runtime = GameRuntime(broadcaster, registry)
    assert (await runtime.handle('missing', 'u', ping())).code == 'ENGINE_NOT_FOUND'
    error = await runtime.handle('room', 'u', GameCommand(command='PLAY_CARD'))
    assert (error.category, error.code) == ('game', 'UNKNOWN_COMMAND')
    error = await runtime.handle('room', 'u', ping(message=3))
    assert (error.category, error.code) == ('game', 'INVALID_PAYLOAD')
    assert engine.command_count == 0
    broadcaster.broadcast.assert_not_awaited()
    assert await runtime.handle('room', 'u', ping()) is None


async def test_unexpected_engine_failure_is_sanitized_and_unlocks():
    class Engine:
        fail = True
        def handle_command(self, user_id, command):
            if self.fail:
                self.fail = False
                raise RuntimeError('private implementation detail')
            return []
    registry = GameRegistry()
    registry.register('r', Engine())
    runtime = GameRuntime(AsyncMock(), registry)
    error = await runtime.handle('r', 'u', ping())
    assert error.category == 'infrastructure' and error.code == 'ENGINE_FAILURE'
    assert 'private' not in error.model_dump_json()
    assert await runtime.handle('r', 'u', ping()) is None


async def test_same_room_batches_serialize_while_other_room_progresses():
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []
    class Engine:
        def __init__(self): self.count = 0
        def handle_command(self, user_id, command):
            self.count += 1
            return [GameEvent(event=f'{self.count}.{i}') for i in range(2)]
    class Broadcaster:
        async def broadcast(self, room_id, event):
            calls.append((room_id, event['event']))
            if (room_id, event['event']) == ('a', '1.0'):
                entered.set()
                await release.wait()
    registry = GameRegistry()
    a = Engine()
    registry.register('a', a)
    registry.register('b', Engine())
    runtime = GameRuntime(Broadcaster(), registry)
    first = asyncio.create_task(runtime.handle('a', 'u', ping()))
    await asyncio.wait_for(entered.wait(), 1)
    second = asyncio.create_task(runtime.handle('a', 'v', ping()))
    try:
        await asyncio.wait_for(runtime.handle('b', 'w', ping()), 1)
        assert a.count == 1
        assert ('b', '1.1') in calls
    finally:
        release.set()
        await asyncio.wait_for(asyncio.gather(first, second), 1)
    assert [event for room, event in calls if room == 'a'] == ['1.0', '1.1', '2.0', '2.1']


def guest(client):
    return client.post('/auth/guest').json()


def url(user, room='one'):
    return f"/ws/rooms/{room}?token={user['token']}"


def test_websocket_ping_identity_isolation_errors_and_reconnect():
    app = create_app()
    with TestClient(app) as client:
        alice, bob, carol = [guest(client) for _ in range(3)]
        with client.websocket_connect(url(alice)) as a, client.websocket_connect(url(bob)) as b, client.websocket_connect(url(carol, 'two')) as c:
            for socket in (a, b, c): assert socket.receive_json()['type'] == 'CONNECTED'
            a.send_json({'type': 'GAME_COMMAND', 'command': 'PING', 'user_id': 'forged', 'room_id': 'two',
                         'payload': {'message': 'hello', 'user_id': 'forged'}})
            event = {'type': 'GAME_EVENT', 'event': 'PONG',
                     'payload': {'message': 'hello', 'player_id': alice['user_id'], 'sequence': 1}}
            assert a.receive_json() == b.receive_json() == event
            c.send_json(ping(message='other').model_dump())
            assert c.receive_json()['payload'] == {'message': 'other', 'player_id': carol['user_id'], 'sequence': 1}
            for raw, code in [('not json', 'INVALID_MESSAGE'), ('[]', 'INVALID_MESSAGE'),
                              ('{"type":"GAME_COMMAND"}', 'INVALID_COMMAND'),
                              ('{"type":"GAME_COMMAND","command":"PING","payload":[]}', 'INVALID_COMMAND'),
                              ('{"type":"GAME_COMMAND","command":"UNKNOWN"}', 'UNKNOWN_COMMAND'),
                              ('{"type":"GAME_COMMAND","command":"PING","payload":{"message":1}}', 'INVALID_PAYLOAD')]:
                a.send_text(raw)
                assert a.receive_json()['code'] == code
            a.send_bytes(b'no')
            assert a.receive_json()['code'] == 'INVALID_MESSAGE'
            # Ordered sentinels prove errors and game events did not leak to peers/other rooms.
            for socket in (b, c):
                socket.send_text('invalid')
                assert socket.receive_json()['type'] == 'ERROR'
            a.send_json(ping(message='recovered').model_dump())
            assert a.receive_json()['payload']['sequence'] == 2
            assert b.receive_json()['payload']['sequence'] == 2
        with client.websocket_connect(url(alice)) as a:
            a.receive_json()
            a.send_json(ping().model_dump())
            assert a.receive_json()['payload']['sequence'] == 3
    assert app.state.game_registry.get_engine('one') is None


def test_websocket_missing_engine_error_is_requester_only():
    app = create_app()
    with TestClient(app) as client:
        identity = guest(client)
        with client.websocket_connect(url(identity)) as a, client.websocket_connect(url(identity)) as other_tab:
            a.receive_json()
            other_tab.receive_json()
            # Simulate missing registry configuration, without changing transport behavior.
            client.portal.call(app.state.game_registry.clear)
            a.send_json(ping().model_dump())
            assert a.receive_json()['code'] == 'ENGINE_NOT_FOUND'
            other_tab.send_text('invalid')
            assert other_tab.receive_json()['code'] == 'INVALID_MESSAGE'
            client.portal.call(app.state.provision_room, 'one')
            a.send_json(ping().model_dump())
            assert a.receive_json()['event'] == other_tab.receive_json()['event'] == 'PONG'


def test_console_input_and_created_room_engine():
    assert parse_input('PING hello') == ping(message='hello').model_dump()
    assert parse_input('hello') == {'type': 'MESSAGE', 'payload': {'text': 'hello'}}
    assert parse_input('{"type":"GAME_COMMAND","command":"PING"}')['command'] == 'PING'
    with pytest.raises(ValueError): parse_input('{invalid')
    app = create_app()
    with TestClient(app) as client:
        identity = guest(client)
        response = client.post('/rooms', headers={'Authorization': f"Bearer {identity['token']}"}, json={'name': 'test'})
        assert response.status_code == 201
        assert isinstance(app.state.game_registry.get_engine(response.json()['room_id']), EchoGameEngine)
        assert 'PING hello' in client.get('/').text
