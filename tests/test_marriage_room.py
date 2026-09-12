from contextlib import ExitStack

from fastapi.testclient import TestClient

from app.main import create_app


def test_marriage_http_lifecycle_private_hands_retries_and_room_chat_policy():
    with TestClient(create_app()) as client, ExitStack() as stack:
        users = [client.post('/auth/guest').json() for _ in range(3)]
        headers = [{'Authorization': f"Bearer {u['token']}"} for u in users]
        for user in users:
            ws = stack.enter_context(client.websocket_connect(f"/ws/rooms/marriage-room?token={user['token']}"))
            ws.receive_json()
        root = '/test-games/marriage-room'
        waiting = client.post(root, headers=headers[0], json={'game_type': 'marriage', 'player_count': 2})
        assert waiting.status_code == 201, waiting.text
        mid = waiting.json()['match_id']
        assert waiting.json()['game_type'] == 'marriage'
        scoring = waiting.json()['marriage_scoring']
        assert scoring['tiplu'] == [3, 8, 15]
        custom = {**scoring, 'seen_payment': 7, 'man': [1, 3, 6]}
        settings = {'match_id': mid, 'scoring': custom}
        assert client.post(root + '/marriage-settings', headers=headers[1], json=settings).status_code == 403
        assert client.post(root + '/marriage-settings', headers=headers[0], json={**settings, 'match_id': 'old'}).status_code == 409
        for bad in ({'man': [1, 2]}, {'seen_payment': True}, {'unknown': 5}):
            assert client.post(root + '/marriage-settings', headers=headers[0], json={**settings, 'scoring': {**custom, **bad}}).status_code == 422
        assert client.get(root, headers=headers[0]).json()['marriage_scoring'] == scoring
        assert client.post(root + '/marriage-settings', headers=headers[0], json=settings).json()['marriage_scoring'] == custom
        assert client.get(root, headers=headers[2]).json()['marriage_scoring'] == custom
        assert not client.app.state.participation.is_playing('marriage-room', users[0]['user_id'])
        # A Call Break and Marriage game cannot compete for the same room.
        assert client.post(root, headers=headers[1], json={'player_count': 4}).status_code == 409
        joined = client.post(root + '/join', headers=headers[1], json={'match_id': mid})
        assert joined.json()['ready']
        assert client.post(root + '/leave', headers=headers[1], json={'match_id': mid}).json()['your_player_id'] is None
        client.post(root + '/join', headers=headers[1], json={'match_id': mid})
        assert client.post(root + '/start', headers=headers[1], json={'match_id': mid}).status_code == 403
        started = client.post(root + '/start', headers=headers[0], json={'match_id': mid, 'play_mode': 'manual'})
        assert started.status_code == 200, started.text
        initial = started.json()
        assert initial['marriage']['public']['scoring_rules'] == custom
        assert initial['marriage']['public']['scores'] is None
        assert client.post(root + '/marriage-settings', headers=headers[0], json=settings).status_code == 409
        hand = initial['marriage']['private']['hand']
        assert len(hand) == 21 and initial['game']['revision'] == 1
        assert initial['marriage']['public']['stock_count'] == 117
        assert client.app.state.participation.is_playing('marriage-room', users[0]['user_id'])
        other = client.get(root, headers=headers[1]).json()['marriage']['private']['hand']
        assert not {c['card_id'] for c in hand} & {c['card_id'] for c in other}
        spectator = client.get(root, headers=headers[2]).json()
        assert spectator['marriage']['private'] is None
        assert 'hand' not in spectator['marriage']['public']['players'][0]
        assert client.post(root + '/leave', headers=headers[0], json={'match_id': mid}).status_code == 409
        body = {'match_id': mid, 'command_id': 'draw1', 'expected_revision': 1,
                'command': 'DRAW_CARD', 'payload': {'source': 'stock'}}
        assert client.post(root + '/action', headers=headers[2], json=body).status_code == 403
        drawn = client.post(root + '/action', headers=headers[0], json=body)
        assert drawn.status_code == 200, drawn.text
        assert drawn.json()['action_ack']['status'] == 'accepted'
        assert len(drawn.json()['marriage']['private']['hand']) == 22
        moves = drawn.json()['marriage']['moves']
        assert len(moves) == 1 and moves[0]['kind'] == 'CARD_DRAWN'
        assert moves[0]['source'] == 'stock' and moves[0]['card'] is None
        assert client.get(root, headers=headers[2]).json()['marriage']['moves'] == moves
        repeated = client.post(root + '/action', headers=headers[0], json=body).json()
        assert repeated['action_ack'] == drawn.json()['action_ack'] and repeated['game']['revision'] == 2
        assert repeated['marriage']['moves'] == moves  # receipt retry cannot replay animation
        card_id = repeated['marriage']['private']['hand'][-1]['card_id']
        discarded = client.post(root + '/action', headers=headers[0], json={**body, 'command_id': 'throw1',
            'expected_revision': 2, 'command': 'DISCARD_CARD', 'payload': {'card_id': card_id}})
        assert discarded.json()['game']['turn']['player_id'] == 2
        assert discarded.json()['marriage']['public']['top_discard']['card_id'] == card_id
        assert discarded.json()['marriage']['moves'][-1]['card']['card_id'] == card_id
        assert discarded.json()['marriage']['moves'][-1]['kind'] == 'CARD_DISCARDED'
        assert client.post(root + '/end', headers=headers[1], json={'match_id': mid}).status_code == 403
        ended = client.post(root + '/end', headers=headers[0], json={'match_id': mid})
        assert ended.json()['status'] == 'ended'
        assert not client.app.state.participation.is_playing('marriage-room', users[0]['user_id'])
        assert client.post(root, headers=headers[0], json={'player_count': 4}).status_code == 201
        assert client.post(root + '/action', headers=headers[0], json=body).status_code == 409
