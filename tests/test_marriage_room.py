from contextlib import ExitStack

from fastapi.testclient import TestClient

from app.main import create_app


def test_normal_win_http_privacy_reconnect_finish_and_receipt_retry(monkeypatch):
    from marriage import create_deck
    deck = {c.card_id: c for c in create_deck()}
    groups = [{'meld_type': 'pure_sequence', 'card_ids': [f'D0:{r}{s}' for r in range(2, 9)]} for s in 'CDH']
    hand = tuple(deck[i] for g in groups for i in g['card_ids'])
    tiplu, last = deck['D2:8H'], deck['MAN:0']
    rest = tuple(c for c in deck.values() if c not in hand + (tiplu, last))
    monkeypatch.setattr('marriage.engine.deal_cards', lambda *_: ((hand, rest[:21]), rest[22:] + (tiplu, last, rest[21])))
    with TestClient(create_app()) as client, ExitStack() as sockets:
        users = [client.post('/auth/guest').json() for _ in range(3)]
        headers = [{'Authorization': f"Bearer {u['token']}"} for u in users]
        room = 'normal-win'
        for user in users:
            sockets.enter_context(client.websocket_connect(f"/ws/rooms/{room}?token={user['token']}")).receive_json()
        root = f'/test-games/{room}'
        waiting = client.post(root, headers=headers[0], json={'game_type': 'marriage', 'player_count': 2}).json()
        mid = {'match_id': waiting['match_id']}
        client.post(root + '/join', headers=headers[1], json=mid)
        client.post(root + '/table/lock', headers=headers[0], json=mid)
        started = client.post(root + '/start', headers=headers[0], json=mid).json()

        def action(command, revision, payload=None, actor=0):
            body = {**mid, 'command_id': f'{command}-{revision}', 'expected_revision': revision,
                    'command': command, 'payload': payload or {}}
            response = client.post(root + '/action', headers=headers[actor], json=body)
            assert response.status_code == 200, response.text
            return response.json(), body

        drawn, _ = action('DRAW_CARD', started['game']['revision'], {'source': 'stock'})
        shown, _ = action('SHOW_INITIAL_MELDS', drawn['game']['revision'], {'melds': groups})
        witness = shown['marriage']['private']['actions']['normal_finish']
        assert witness['discard_card_id'] == 'MAN:0'
        spectator = client.get(root, headers=headers[2]).json()
        assert spectator['marriage']['private'] is None
        assert spectator['marriage']['public']['normal_finish'] is None
        assert client.get(root, headers=headers[1]).json()['marriage']['private']['actions']['normal_finish'] is None
        # A fresh connection gets the same authoritative private preview.
        with client.websocket_connect(f"/ws/rooms/{room}?token={users[0]['token']}") as reconnect:
            reconnect.receive_json()
            assert client.get(root, headers=headers[0]).json()['marriage']['private']['actions']['normal_finish'] == witness
        finished, request = action('FINISH', shown['game']['revision'])
        assert finished['action_ack']['status'] == 'accepted' and finished['status'] == 'finished'
        assert finished['table']['phase'] == 'COMPLETED'
        assert len(finished['marriage']['private']['hand']) == 21
        assert finished['marriage']['public']['normal_finish'] == witness
        assert finished['marriage']['public']['top_discard']['card_id'] == 'MAN:0'
        assert sum(p['net_points'] for p in finished['marriage']['public']['scores']['players']) == 0
        repeated = client.post(root + '/action', headers=headers[0], json=request).json()
        assert repeated['action_ack'] == finished['action_ack']
        assert repeated['game']['revision'] == finished['game']['revision']
        assert repeated['marriage']['moves'] == finished['marriage']['moves']
        spectator = client.get(root, headers=headers[2]).json()
        assert spectator['marriage']['private'] is None
        assert spectator['marriage']['public']['normal_finish'] == witness


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
        assert client.post(root + '/table/lock', headers=headers[0], json={'match_id': mid}).status_code == 200
        started = client.post(root + '/start', headers=headers[0], json={'match_id': mid, 'play_mode': 'manual'})
        assert started.status_code == 200, started.text
        initial = started.json()
        assert initial['marriage']['public']['scoring_rules'] == custom
        assert initial['marriage']['public']['scores'] is None
        assert client.post(root + '/marriage-settings', headers=headers[0], json=settings).status_code == 409
        hand = initial['marriage']['private']['hand']
        assert len(hand) == 21 and initial['game']['revision'] == 1
        assert initial['marriage']['public']['stock_count'] == 116
        assert client.app.state.participation.is_playing('marriage-room', users[0]['user_id'])
        other = client.get(root, headers=headers[1]).json()['marriage']['private']['hand']
        assert not {c['card_id'] for c in hand} & {c['card_id'] for c in other}
        spectator = client.get(root, headers=headers[2]).json()
        assert spectator['marriage']['private'] is None
        assert 'hand' not in spectator['marriage']['public']['players'][0]
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
