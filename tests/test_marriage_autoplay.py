from random import Random

from marriage import MarriageGameEngine
from app.adapters.marriage import MarriageAdapter, PlayerCommand, AdapterResult
from app.test_games.marriage_autoplay import choose_move, suggestions


def test_autoplay_moves_are_accepted_through_adapter_and_preserve_private_views():
    for seed in range(4):
        adapter = MarriageAdapter(MarriageGameEngine(('1', '2'), rng=Random(seed)), match_id='auto', owner_player_id='1')
        assert isinstance(adapter.dispatch_player(PlayerCommand(match_id='auto', command_id='start', expected_revision=0, command='START_GAME'), player_id='1'), AdapterResult)
        for i in range(120):
            public = adapter.snapshot()['view']
            if public['status'] == 'finished':
                break
            seat = public['current_player_id']
            view = adapter.snapshot(seat)['view']
            move = choose_move(view)
            assert move is not None
            command, payload = move
            result = adapter.dispatch_player(PlayerCommand(match_id='auto', command_id=f'move{i}', expected_revision=adapter.revision,
                                                            command=command, payload=payload), player_id=seat)
            assert isinstance(result, AdapterResult), result
            assert all('hand' not in p for p in adapter.snapshot()['view']['players'])


def test_suggestions_use_distinct_cards_and_find_mixed_normal_groups():
    def card(rank, suit, copy=0):
        return dict(card_id=f'D{copy}:{rank}{suit}', rank=rank, suit=suit, card_type='standard')
    hand = [card(14, 'S'), card(2, 'S'), card(3, 'S'), *[card(7, 'H', i) for i in range(3)],
            card(8, 'C'), card(9, 'C'), card(10, 'C')]
    pairs, normal = suggestions(hand)
    assert not pairs
    assert len(normal) == 3
    assert len({i for g in normal for i in g['card_ids']}) == 9


def test_autoplay_prefers_finish_over_other_moves():
    assert choose_move({'hand': [], 'actions': {'kinds': ['finish']}}) == ('FINISH', {})


def test_default_autoplay_advances_without_clients_and_stops_on_end():
    import time
    from contextlib import ExitStack
    from fastapi.testclient import TestClient
    from app.main import create_app
    with TestClient(create_app()) as client, ExitStack() as stack:
        client.app.state.test_games.timeout_seconds = 0.1
        users = [client.post('/auth/guest').json() for _ in range(2)]
        headers = [{'Authorization': f"Bearer {user['token']}"} for user in users]
        for user in users:
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/auto-room?token={user['token']}"))
            socket.receive_json()
        root = '/test-games/auto-room'
        mid = client.post(root, headers=headers[0], json={'game_type': 'marriage', 'player_count': 2}).json()['match_id']
        client.post(root + '/join', headers=headers[1], json={'match_id': mid})
        started = client.post(root + '/start', headers=headers[0], json={'match_id': mid}).json()
        assert started['play_mode'] == 'auto'
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            snapshot = client.get(root, headers=headers[0]).json()
            if snapshot['game']['revision'] >= 4:
                break
            time.sleep(0.1)
        assert snapshot['game']['revision'] >= 4
        assert snapshot['error'] is None
        ended = client.post(root + '/end', headers=headers[0], json={'match_id': mid}).json()
        time.sleep(0.2)
        assert client.get(root, headers=headers[0]).json()['game']['revision'] == ended['game']['revision']


def test_autoplay_survives_a_disconnected_seat_and_reconnect():
    import time
    from fastapi.testclient import TestClient
    from app.main import create_app
    with TestClient(create_app()) as client:
        client.app.state.test_games.timeout_seconds = 0.1
        users = [client.post('/auth/guest').json() for _ in range(2)]
        headers = [{'Authorization': f"Bearer {user['token']}"} for user in users]
        url = '/ws/rooms/auto-reconnect?token='
        root = '/test-games/auto-reconnect'
        with client.websocket_connect(url + users[0]['token']) as owner:
            owner.receive_json()
            with client.websocket_connect(url + users[1]['token']) as guest:
                guest.receive_json()
                mid = client.post(root, headers=headers[0], json={'game_type': 'marriage', 'player_count': 2}).json()['match_id']
                client.post(root + '/join', headers=headers[1], json={'match_id': mid})
                client.post(root + '/start', headers=headers[0], json={'match_id': mid})
            # Seat 2 remains in the game roster but loses transport membership.
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                state = client.get(root, headers=headers[0]).json()
                if state['game']['revision'] >= 6 or state['error']:
                    break
                time.sleep(0.1)
            assert state['error'] is None
            assert state['game']['revision'] >= 6
            # The fix must not weaken the external HTTP membership check.
            response = client.post(root + '/action', headers=headers[1], json={
                'match_id': mid, 'command_id': 'offline', 'expected_revision': state['game']['revision'],
                'command': 'GET_STATE', 'payload': {}})
            assert response.status_code == 403
            with client.websocket_connect(url + users[1]['token']) as returned:
                returned.receive_json()
                restored = client.get(root, headers=headers[1]).json()
                assert restored['your_player_id'] == 2
                assert len(restored['marriage']['private']['hand']) in (21, 22)
                assert restored['error'] is None
            client.post(root + '/end', headers=headers[0], json={'match_id': mid})
