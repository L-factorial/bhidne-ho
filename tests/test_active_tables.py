from fastapi.testclient import TestClient
from app.main import create_app
from tests.test_players import account


def test_active_tables_follow_room_visibility_and_live_seating_permissions():
    with TestClient(create_app()) as client:
        owner, host = account(client, 'feed-owner', 'Owner')
        friend, viewer = account(client, 'feed-friend', 'Friend')
        _, outsider = account(client, 'feed-outsider', 'Outsider')
        room = client.post('/rooms', headers=host, json={'name': 'Family', 'visibility': 'friends'}).json()
        root = f"/test-games/{room['room_id']}"
        game = client.post(root, headers=host, json={'name': 'Evening Flush', 'game_type': 'flush', 'player_count': 2}).json()
        match = {'match_id': game['match_id']}
        assert client.get('/active-tables').status_code in (401, 403)
        assert client.get('/active-tables', headers=outsider).json() == []
        assert client.get('/active-tables', headers=viewer).json() == []
        client.post(f"/friends/requests/{friend['user_id']}", headers=host)
        client.post(f"/friends/requests/{owner['user_id']}/accept", headers=viewer)
        assert client.get('/active-tables', headers=viewer).json() == []
        assert client.patch(f"/rooms/{room['room_id']}", headers=host, json={'visibility':'public'}).status_code == 200
        assert len(client.get('/active-tables', headers=outsider).json()) == 1
        table = client.get('/active-tables', headers=viewer).json()[0]
        assert table['room_name'] == 'Family'
        assert table['name'] == 'Evening Flush'
        assert table['current_user']['can_join']
        assert table['current_user']['can_queue']
        assert not table['current_user']['is_seated']
        assert not {'private', 'flush', 'query_result', 'users'} & table.keys()
        assert friend['user_id'] not in client.get('/rooms', headers=viewer).json()[0]['members']
        assert client.post(f"/rooms/{room['room_id']}/enter", headers=viewer).status_code == 200
        assert client.post(root + '/join', headers=viewer, json=match).status_code == 200
        table = client.get('/active-tables', headers=viewer).json()[0]
        assert table['current_user']['is_seated']
        assert not table['current_user']['can_join']
        assert client.post(root + '/end', headers=host, json=match).status_code == 200
        assert client.get('/active-tables', headers=viewer).json() == []
