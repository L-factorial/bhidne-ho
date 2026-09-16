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
