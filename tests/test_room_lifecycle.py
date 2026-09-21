"""Membership is independent of UI location and WebSocket availability."""
import asyncio
from contextlib import ExitStack
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import create_app
from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.lifecycle import RoomLifecycle
from app.multiplayer.room_service import RoomService
from app.test_games.service import TestGameService as Host
from tests.test_multiplayer import FakeSocket


@pytest.fixture(params=['callbreak', 'marriage', 'flush'])
def table(request):
    with TestClient(create_app()) as client:
        count = 4 if request.param == 'callbreak' else 3
        users = [client.post('/auth/guest').json() for _ in range(count + 1)]
        headers = [{'Authorization': 'Bearer ' + user['token']} for user in users]
        for header in headers:
            for _ in range(2):
                assert client.post('/rooms/r/enter', headers=header, json={}).status_code == 200
        root = '/test-games/r'
        waiting = client.post(root, headers=headers[0], json={
            'game_type': request.param, 'player_count': count}).json()
        body = {'match_id': waiting['match_id']}
        for header in headers[1:count]:
            assert client.post(root + '/join', headers=header, json=body).status_code == 200
        yield client, users, headers, root, body, request.param, count


def start(table):
    client, _, headers, root, body, _, _ = table
    if table[5] != 'callbreak':
        assert client.post(root + '/table/lock', headers=headers[0], json=body).status_code == 200
    response = client.post(root + '/start', headers=headers[0], json={**body, 'rules_revision': 0})
    assert response.status_code == 200, response.text
    return response.json()


def test_navigation_resync_and_disconnect_preserve_match_seats_and_private_state(table, monkeypatch):
    client, users, headers, root, body, _, count = table
    start(table)
    host = client.app.state.test_games
    target = host._leave_target(host.games['r'])
    leave = Mock(wraps=target.handle_player_leave)
    monkeypatch.setattr(type(target), 'handle_player_leave', leave)
    before = client.get(root, headers=headers[1]).json()
    url = '/ws/rooms/r?token=' + users[1]['token']
    with client.websocket_connect(url) as ws:
        assert ws.receive_json()['type'] == 'CONNECTED'
        # Back is navigation: query the room, never send a departure command.
        room = client.get('/rooms/r', headers=headers[1]).json()
        assert room['active_game']['player_is_participant']
        assert room['active_game']['game_id'] == body['match_id']
        assert room['active_game']['seat'] == before['your_player_id']
        assert client.get(root, headers=headers[1]).json() == before
    # Offline HTTP state access is still authorized by membership.
    assert client.get(root, headers=headers[1]).json() == before
    offline = client.get('/memberships', headers=headers[1]).json()
    assert len(offline) == 1 and offline[0]['connected_members'] == []
    assert offline[0]['active_game']['seat'] == before['your_player_id']
    with ExitStack() as stack:
        for _ in range(2):
            stack.enter_context(client.websocket_connect(url)).receive_json()
        for _ in range(2):
            assert client.post(root + '/join', headers=headers[1], json=body).json() == before
            assert client.get(root, headers=headers[1]).json() == before
        members = client.get('/rooms/r', headers=headers[1]).json()
        assert len(members['members']) == count + 1
        assert members['connected_members'] == [users[1]['user_id']]
    assert len(host.games['r'].users) == count
    leave.assert_not_called()


def test_waiting_leave_is_once_and_distinct_from_room_leave(table, monkeypatch):
    client, users, headers, root, body, _, count = table
    host = client.app.state.test_games
    target = host._leave_target(host.games['r'])
    callback = Mock(wraps=target.handle_player_leave)
    monkeypatch.setattr(type(target), 'handle_player_leave', callback)
    for _ in range(2):
        left = client.post(root + '/leave', headers=headers[1], json=body)
        assert left.status_code == 200
        assert left.json()['your_player_id'] is None
        assert not left.json()['active_game']['player_is_participant']
    assert sum(e['event'] == 'SEAT_RELEASED' for e in host.games['r'].table.events) == 1
    assert users[1]['user_id'] in client.get('/rooms/r', headers=headers[0]).json()['members']
    for _ in range(2):
        assert client.post('/rooms/r/leave', headers=headers[1], json={}).status_code == 200
    assert client.get('/memberships', headers=headers[1]).json() == []
    assert client.get(root, headers=headers[1]).status_code == 403
    assert len(host.games['r'].users) == count - 1


def test_active_room_departure_rejected_and_end_then_leave_preserves_other_seats(table):
    client, users, headers, root, body, kind, count = table
    state = start(table)
    before = client.get(root, headers=headers[2]).json()
    rejected = client.post('/rooms/r/leave', headers=headers[1], json={})
    assert rejected.status_code == 409
    assert rejected.json()['detail']['game_id'] == body['match_id']
    # Preserve existing fixed-roster departure policy; Flush also rejects during preparation.
    if kind != 'callbreak':
        rejected = client.post(root + '/leave', headers=headers[1], json=body)
        assert rejected.status_code == 409
        assert client.get(root, headers=headers[2]).json() == before
    assert client.post(root + '/end', headers=headers[0], json=body).status_code == 200
    for _ in range(2):
        left = client.post(root + '/leave', headers=headers[1], json=body).json()
        assert left['your_player_id'] is None
    assert client.post('/rooms/r/leave', headers=headers[1], json={}).status_code == 200
    assert client.get(root, headers=headers[2]).json()['status'] == 'empty'
    remaining = client.get(root, headers=headers[2], params=body).json()
    assert remaining['your_player_id'] == before['your_player_id']
    assert remaining['game']['revision'] == state['game']['revision']


@pytest.mark.parametrize('table', ['flush'], indirect=True)
def test_flush_active_leave_folds_once_and_retains_hand_history(table, monkeypatch):
    client, users, headers, root, body, kind, count = table
    state = start(table)
    for command in ['DEAL_CARDS', 'SKIP_CUT']:
        actor = state['game']['turn']['player_id'] - 1
        response = client.post(root + '/action', headers=headers[actor], json={**body,
            'command': command, 'command_id': command, 'expected_revision': state['game']['revision']})
        assert response.status_code == 200, response.text
        state = response.json()
    actor = state['game']['turn']['player_id'] - 1
    target = client.app.state.test_games.games['r'].flush_target
    callback = Mock(wraps=target.handle_player_leave)
    monkeypatch.setattr(target, 'handle_player_leave', callback)
    revision = state['game']['revision']
    for _ in range(2):
        response = client.post(root + '/leave', headers=headers[actor], json=body)
        assert response.status_code == 200, response.text
        left = response.json()
        assert left['game']['revision'] == revision + 1
        assert left['your_player_id'] is None and left['flush']['private'] is None
    callback.assert_called_once_with(users[actor]['user_id'])
    assert len(left['flush']['folds']) == 1
    assert len(left['flush']['public']['players']) == count  # Engine seat retained for settlement.
    assert len(left['players']) == count - 1
    assert client.post('/rooms/r/leave', headers=headers[actor], json={}).status_code == 200


async def test_room_only_reconnect_duplicate_disconnect_and_explicit_leave_all_tabs():
    rooms = RoomService()
    connections = ConnectionManager(rooms)
    host = Host(rooms, connections)
    lifecycle = RoomLifecycle(rooms, connections, host)
    first = await connections.connect('r', 'u', FakeSocket())
    await connections.disconnect('r', first)
    await connections.disconnect('r', first)
    assert (await lifecycle.lookup('u'))[0]['active_game'] is None
    a, b = FakeSocket(), FakeSocket()
    await connections.connect('r', 'u', a)
    await connections.connect('r', 'u', b)
    await lifecycle.leave('r', 'u')
    await lifecycle.leave('r', 'u')
    assert await rooms.members('r') == []
    assert await connections.connected_members('r') == []
    assert a.closed and b.closed
    assert a.messages == b.messages == [{'type': 'ROOM_LEFT', 'room_id': 'r'}]


@pytest.mark.parametrize('operation', ['join', 'create'])
async def test_room_leave_racing_seating_never_orphans_membership(operation):
    rooms = RoomService()
    connections = ConnectionManager(rooms)
    host = Host(rooms, connections)
    lifecycle = RoomLifecycle(rooms, connections, host)
    await rooms.join('r', 'owner')
    await rooms.join('r', 'u')
    if operation == 'join':
        game = await host.create('r', 'owner', 4)
        seat = lambda: host.join('r', 'u', game['match_id'])
    else:
        seat = lambda: host.create('r', 'u', 4)
    outcomes = await asyncio.gather(lifecycle.leave('r', 'u'), seat(), return_exceptions=True)
    assert any(isinstance(result, HTTPException) for result in outcomes)
    membership = host.membership('r', 'u')
    assert not membership or not membership['player_is_participant'] or 'u' in await rooms.members('r')


def test_lost_tab_cannot_reenter_after_explicit_leave_by_reconnecting():
    with TestClient(create_app()) as client:
        user = client.post('/auth/guest').json()
        headers = {'Authorization': 'Bearer ' + user['token']}
        url = '/ws/rooms/r?token=' + user['token']
        with client.websocket_connect(url) as ws:
            assert ws.receive_json()['membership']['is_member']
        with client.websocket_connect(url + '&resume=1') as ws:
            assert ws.receive_json()['type'] == 'CONNECTED'
        assert client.post('/rooms/r/leave', headers=headers, json={}).status_code == 200
        with client.websocket_connect(url + '&resume=1') as ws:
            assert ws.receive_json() == {'type': 'ROOM_LEFT', 'room_id': 'r'}
        assert client.get('/memberships', headers=headers).json() == []
        # Legacy first connections remain an intentional room-entry API.
        with client.websocket_connect(url) as ws:
            assert ws.receive_json()['type'] == 'CONNECTED'
