from fastapi.testclient import TestClient

from app.main import create_app


def test_room_hosts_named_tables_and_seats_are_exclusive_until_release():
    with TestClient(create_app()) as client:
        users = [client.post('/auth/guest').json() for _ in range(5)]
        headers = [{'Authorization': 'Bearer ' + user['token']} for user in users]
        for header in headers:
            assert client.post('/rooms/shared/enter', headers=header, json={}).status_code == 200

        first = client.post('/test-games/shared', headers=headers[0], json={
            'name': 'Main Table', 'game_type': 'callbreak', 'player_count': 4}).json()
        second = client.post('/test-games/shared', headers=headers[1], json={
            'name': 'Side Table', 'game_type': 'callbreak', 'player_count': 4}).json()

        assert first['path'] == 'shared/Main Table'
        assert second['path'] == 'shared/Side Table'
        assert {table['name'] for table in second['tables']} == {'Main Table', 'Side Table'}
        assert client.get('/test-games/shared', headers=headers[4], params={
            'match_id': first['match_id']}).json()['table_name'] == 'Main Table'

        blocked = client.post('/test-games/shared/join', headers=headers[0], json={
            'match_id': second['match_id']})
        assert blocked.status_code == 409
        assert blocked.json()['detail']['code'] == 'PLAYER_ALREADY_AT_TABLE'

        assert client.post('/test-games/shared/leave', headers=headers[0], json={
            'match_id': first['match_id']}).status_code == 200
        joined = client.post('/test-games/shared/join', headers=headers[0], json={
            'match_id': second['match_id']})
        assert joined.status_code == 200
        assert joined.json()['table_name'] == 'Side Table'


def test_ending_table_releases_all_players_for_other_tables():
    with TestClient(create_app()) as client:
        users = [client.post('/auth/guest').json() for _ in range(3)]
        headers = [{'Authorization': 'Bearer ' + user['token']} for user in users]
        for header in headers:
            client.post('/rooms/shared/enter', headers=header, json={})
        first = client.post('/test-games/shared', headers=headers[0], json={
            'name': 'First', 'game_type': 'marriage', 'player_count': 2}).json()
        client.post('/test-games/shared/join', headers=headers[1], json={'match_id': first['match_id']})
        second = client.post('/test-games/shared', headers=headers[2], json={
            'name': 'Second', 'game_type': 'marriage', 'player_count': 2}).json()

        client.post('/test-games/shared/end', headers=headers[0], json={'match_id': first['match_id']})
        assert client.post('/test-games/shared/join', headers=headers[1], json={
            'match_id': second['match_id']}).status_code == 200


def test_table_seats_are_exclusive_across_rooms_but_room_entry_is_allowed():
    with TestClient(create_app()) as client:
        user = client.post('/auth/guest').json()
        other = client.post('/auth/guest').json()
        headers = {'Authorization': 'Bearer ' + user['token']}
        other_headers = {'Authorization': 'Bearer ' + other['token']}
        for room in ('first-room', 'second-room'):
            assert client.post(f'/rooms/{room}/enter', headers=headers, json={}).status_code == 200
            assert client.post(f'/rooms/{room}/enter', headers=other_headers, json={}).status_code == 200

        first = client.post('/test-games/first-room', headers=headers, json={
            'name': 'First', 'game_type': 'callbreak', 'player_count': 4}).json()
        second = client.post('/test-games/second-room', headers=other_headers, json={
            'name': 'Second', 'game_type': 'callbreak', 'player_count': 4}).json()

        blocked = client.post('/test-games/second-room/join', headers=headers, json={
            'match_id': second['match_id']})
        assert blocked.status_code == 409
        assert blocked.json()['detail'] == {
            'code': 'PLAYER_ALREADY_AT_TABLE',
            'detail': 'Leave first-room/First before joining another table.',
            'room_id': 'first-room', 'match_id': first['match_id'],
            'requires_leave_game': True, 'departure_command': 'leave',
        }

        assert client.post('/test-games/first-room/leave', headers=headers, json={
            'match_id': first['match_id']}).status_code == 200
        assert client.post('/test-games/second-room/join', headers=headers, json={
            'match_id': second['match_id']}).status_code == 200


def test_new_account_can_resolve_shared_room_and_exact_game_invitation():
    with TestClient(create_app()) as client:
        owner = client.post('/auth/signup', json={'username': 'invite-owner', 'password': 'password123'}).json()
        invited = client.post('/auth/signup', json={'username': 'new-phone-user', 'password': 'password123'}).json()
        owner_header = {'Authorization': 'Bearer ' + owner['token']}
        invited_header = {'Authorization': 'Bearer ' + invited['token']}
        room = client.post('/rooms', headers=owner_header, json={'name': 'Friends Night'}).json()
        client.post(f"/rooms/{room['room_id']}/enter", headers=owner_header, json={})
        game = client.post(f"/test-games/{room['room_id']}", headers=owner_header, json={
            'name': 'Main Table', 'game_type': 'callbreak', 'player_count': 4}).json()

        # A new account does not yet have the room in its personal feed.
        assert all(item['room_id'] != room['room_id'] for item in client.get('/rooms', headers=invited_header).json())
        # Invitation lookup resolves the room directly without joining it.
        preview = client.get(f"/rooms/{room['room_id']}", headers=invited_header).json()
        assert preview['name'] == 'Friends Night'
        assert not preview['is_member']
        assert preview['tables'] == [{
            'match_id': game['match_id'], 'name': 'Main Table', 'game_type': 'callbreak', 'status': 'waiting'}]
