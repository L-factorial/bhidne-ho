"""Manual room turns, retries, and reconnection through the public HTTP API."""
from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.mark.parametrize('capacity', [2, 3, 4, 5])
def test_manual_turns_require_the_seated_player_and_survive_reconnect(capacity):
    with TestClient(create_app()) as client, ExitStack() as sockets:
        users = [client.post('/auth/guest').json() for _ in range(capacity)]
        headers = [{'Authorization': f"Bearer {u['token']}"} for u in users]
        root = '/test-games/manual-marriage'

        def connect(index):
            ws = client.websocket_connect(f"/ws/rooms/manual-marriage?token={users[index]['token']}")
            return ws

        for i in range(capacity - 1):
            sockets.enter_context(connect(i)).receive_json()
        with connect(capacity - 1) as last:
            last.receive_json()
            waiting = client.post(root, headers=headers[0], json={
                'game_type': 'marriage', 'player_count': capacity}).json()
            mid = waiting['match_id']
            assert waiting['play_mode'] == 'manual'
            for header in headers[1:]:
                assert client.post(root + '/join', headers=header, json={'match_id': mid}).status_code == 200
            rejected = client.post(root + '/start', headers=headers[0], json={
                'match_id': mid, 'play_mode': 'auto'})
            assert rejected.status_code == 422
            assert client.get(root, headers=headers[0]).json()['status'] == 'waiting'
            started = client.post(root + '/start', headers=headers[0], json={'match_id': mid}).json()
            assert started['play_mode'] == 'manual'
            game = client.app.state.test_games.games['manual-marriage']
            assert game.task is None and game.deadline is None

            def action(index, command, revision, payload=None, command_id=None):
                response = client.post(root + '/action', headers=headers[index], json={
                    'match_id': mid, 'command_id': command_id or f'{index}-{command}-{revision}',
                    'expected_revision': revision, 'command': command, 'payload': payload or {}})
                assert response.status_code == 200, response.text
                return response.json()

            revision = started['game']['revision']
            wrong = action(1, 'DRAW_CARD', revision, {'source': 'stock'})
            assert wrong['action_ack']['status'] == 'rejected'
            assert wrong['game']['revision'] == revision
            for i in range(capacity - 1):
                drawn = action(i, 'DRAW_CARD', revision, {'source': 'stock'})
                assert drawn['action_ack']['status'] == 'accepted'
                repeated = action(i, 'DRAW_CARD', revision, {'source': 'stock'})
                assert repeated['game']['revision'] == revision + 1
                assert repeated['marriage']['moves'] == drawn['marriage']['moves']
                card_id = drawn['marriage']['private']['actions']['discardable_card_ids'][0]
                stale = action(i, 'DISCARD_CARD', revision, {'card_id': card_id}, f'stale-{i}')
                assert stale['action_ack']['status'] == 'rejected'
                discarded = action(i, 'DISCARD_CARD', revision + 1, {'card_id': card_id})
                assert discarded['action_ack']['status'] == 'accepted'
                assert discarded['game']['turn']['player_id'] == i + 2
                revision += 2
            saved = client.get(root, headers=headers[-1]).json()['marriage']['private']['hand']

        # A disconnected seat keeps the turn; other players cannot take it over.
        state = client.get(root, headers=headers[0]).json()
        assert state['game']['revision'] == revision
        assert state['game']['turn']['player_id'] == capacity
        wrong = action(0, 'DRAW_CARD', revision, {'source': 'stock'}, 'takeover')
        assert wrong['action_ack']['status'] == 'rejected'
        assert client.post(root + '/action', headers=headers[-1], json={
            'match_id': mid, 'command_id': 'offline', 'expected_revision': revision,
            'command': 'DRAW_CARD', 'payload': {'source': 'stock'}}).status_code == 403
        with connect(capacity - 1) as returned:
            returned.receive_json()
            restored = client.get(root, headers=headers[-1]).json()
            assert restored['your_player_id'] == capacity
            assert restored['marriage']['private']['hand'] == saved
            drawn = action(capacity - 1, 'DRAW_CARD', revision, {'source': 'stock'})
            assert drawn['action_ack']['status'] == 'accepted'
            discarded = action(capacity - 1, 'DISCARD_CARD', revision + 1, {
                'card_id': drawn['marriage']['private']['actions']['discardable_card_ids'][0]})
            assert discarded['game']['turn']['player_id'] == 1
