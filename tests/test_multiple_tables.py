import pytest
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


@pytest.mark.parametrize('kind,count', [('callbreak', 4), ('marriage', 2), ('flush', 2)])
def test_ended_tables_disappear_from_room_and_lobby_directories(kind, count):
    with TestClient(create_app()) as client:
        headers = [{'Authorization': 'Bearer ' + client.post('/auth/guest').json()['token']}
                   for _ in range(2)]
        for header in headers:
            client.post('/rooms/feed/enter', headers=header, json={})
        root = '/test-games/feed'
        first = client.post(root, headers=headers[0], json={
            'name': 'First', 'game_type': kind, 'player_count': count}).json()
        second = client.post(root, headers=headers[1], json={
            'name': 'Second', 'game_type': kind, 'player_count': count}).json()
        # Ending the newest table must not hide an older table that is still open.
        ended = client.post(root + '/end', headers=headers[1], json={'match_id': second['match_id']})
        assert ended.status_code == 200
        assert [table['match_id'] for table in ended.json()['tables']] == [first['match_id']]
        for header in headers:
            assert client.get(root, headers=header).json()['match_id'] == first['match_id']
            room = client.get('/rooms/feed', headers=header).json()
            feed = client.get('/memberships', headers=header).json()[0]
            for view in (room, feed):
                assert [table['match_id'] for table in view['tables']] == [first['match_id']]
                assert view['active_game']['game_id'] == first['match_id']
        client.post(root + '/end', headers=headers[0], json={'match_id': first['match_id']})
        for header in headers:
            assert client.get(root, headers=header).json() == {'room_id': 'feed', 'status': 'empty', 'tables': []}
            for view in (client.get('/rooms/feed', headers=header).json(),
                         client.get('/memberships', headers=header).json()[0]):
                assert view['tables'] == [] and view['active_game'] is None
            # History and idempotent commands retain the original match record.
            history = client.get(root, headers=header, params={'match_id': first['match_id']}).json()
            assert history['status'] == 'ended' and history['tables'] == []


@pytest.mark.parametrize('kind,count', [('callbreak', 4), ('marriage', 2), ('flush', 2)])
def test_stale_departure_after_host_ends_table_does_not_block_new_table(kind, count):
    with TestClient(create_app()) as client:
        headers = [{'Authorization': 'Bearer ' + client.post('/auth/guest').json()['token']}
                   for _ in range(count + 1)]
        root = '/test-games/shared'
        for header in headers:
            client.post('/rooms/shared/enter', headers=header, json={})
        old = client.post(root, headers=headers[0], json={
            'name': 'Old', 'game_type': kind, 'player_count': count}).json()
        body = {'match_id': old['match_id']}
        for header in headers[1:count]:
            assert client.post(root + '/join', headers=header, json=body).status_code == 200
        if kind != 'callbreak':
            assert client.post(root + '/table/lock', headers=headers[0], json=body).status_code == 200
        assert client.post(root + '/start', headers=headers[0], json={**body, 'rules_revision': 0}).status_code == 200
        new = client.post(root, headers=headers[-1], json={
            'name': 'New', 'game_type': kind, 'player_count': count}).json()
        conflict = client.post(root + '/join', headers=headers[1], json={'match_id': new['match_id']})
        assert conflict.status_code == 409
        assert client.post(root + '/end', headers=headers[0], json=body).status_code == 200
        # The prompt was opened before End; its action must still succeed afterwards.
        command = 'table/abandon' if conflict.json()['detail']['departure_command'] == 'abandon' else 'leave'
        for _ in range(2):
            response = client.post(root + '/' + command, headers=headers[1], json=body)
            assert response.status_code == 200, response.text
            assert not response.json()['table']['current_user']['is_seated']
        # Repeating End on an older table is harmless, even with a newer table present.
        assert client.post(root + '/end', headers=headers[0], json=body).status_code == 200
        assert client.post(root + '/join', headers=headers[1], json={
            'match_id': new['match_id']}).status_code == 200


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
        room = client.post('/rooms', headers=owner_header, json={'name': 'Friends Night', 'invitees': [invited['user_id']]}).json()
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


def test_table_invitation_adds_room_access_but_never_assigns_a_seat():
    with TestClient(create_app()) as client:
        owner = client.post('/auth/signup', json={'username': 'table-owner', 'password': 'password123'}).json()
        invited = client.post('/auth/signup', json={'username': 'table-guest', 'password': 'password123'}).json()
        owner_headers = {'Authorization': 'Bearer ' + owner['token']}
        invited_headers = {'Authorization': 'Bearer ' + invited['token']}
        room = client.post('/rooms', headers=owner_headers, json={
            'name': 'Invite room', 'visibility': 'friends'}).json()
        client.post(f"/rooms/{room['room_id']}/enter", headers=owner_headers, json={})
        eligibility = client.post(f"/test-games/{room['room_id']}/invitations/eligibility",
                                  headers=owner_headers, json={'player_ids': [invited['user_id']]}).json()
        assert eligibility == [{'user_id': invited['user_id'], 'eligible': True, 'reason': None}]

        game = client.post(f"/test-games/{room['room_id']}", headers=owner_headers, json={
            'name': 'Invitation table', 'game_type': 'callbreak', 'player_count': 4,
            'invitees': [invited['user_id'], invited['user_id']],
        })
        assert game.status_code == 201
        invitation = client.get('/test-games/invitations', headers=invited_headers).json()
        assert len(invitation) == 1
        assert invitation[0]['match_id'] == game.json()['match_id']
        assert invitation[0]['room_name'] == 'Invite room'
        assert invitation[0]['inviter']['username'] == 'table-owner'
        assert client.get(f"/rooms/{room['room_id']}", headers=invited_headers).json()["is_member"] is False

        accepted = client.post(f"/test-games/invitations/{invitation[0]['id']}/accept",
                               headers=invited_headers, json={})
        assert accepted.status_code == 200
        snapshot = client.get(f"/test-games/{room['room_id']}", headers=invited_headers,
                              params={'match_id': game.json()['match_id']}).json()
        assert snapshot['your_player_id'] is None
        assert snapshot['table']['current_user']['is_seated'] is False
        assert snapshot['table']['current_user']['is_queued'] is False
        assert client.get('/test-games/invitations', headers=invited_headers).json() == []


def test_directory_actions_are_viewer_specific_and_do_not_expose_hands():
    with TestClient(create_app()) as client:
        headers = [{'Authorization': 'Bearer ' + client.post('/auth/guest', json={'display_name': 'Player 1'}).json()['token']} for _ in range(3)]
        for h in headers:
            client.post('/rooms/cards/enter', headers=h, json={})
        created = client.post('/test-games/cards', headers=headers[0], json={
            'name': 'Friends', 'game_type': 'marriage', 'player_count': 2}).json()
        mid = created['match_id']
        def card(index):
            return client.get('/test-games/cards', headers=headers[index]).json()['tables'][0]
        assert card(0)['current_user']['is_seated']
        assert card(1)['current_user']['can_join']
        assert card(1)['phase'] == 'OPEN'
        assert card(1)['seated_players'] == [{'seat_id': 1, 'display_name': 'Player 1'}]
        client.post('/test-games/cards/join', headers=headers[1], json={'match_id': mid})
        assert card(2)['players'] == 2
        assert not card(2)['current_user']['can_join']
        assert card(2)['current_user']['can_queue']
        client.post('/test-games/cards/table/join-queue', headers=headers[2], json={'match_id': mid})
        assert card(2)['current_user']['queue_position'] == 1
        assert card(0)['queue_size'] == 1
        client.post('/test-games/cards/table/lock', headers=headers[0], json={'match_id': mid})
        assert card(2)['phase'] == 'LOCKED'
        assert 'cards' not in str(card(2)['seated_players'])
