import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.multiplayer.room_catalog import MemoryRoomCatalog
from app.multiplayer.room_service import RoomService
from tests.test_players import account


def room_ids(client, headers):
    return [room["room_id"] for room in client.get("/rooms", headers=headers).json()]


def test_private_rooms_exclude_friends_and_public_rooms_include_everyone():
    with TestClient(create_app()) as client:
        owner, owner_headers = account(client, "room-owner", "Owner")
        friend, friend_headers = account(client, "room-friend", "Friend")
        _, stranger_headers = account(client, "room-stranger", "Stranger")

        public = client.post("/rooms", headers=owner_headers, json={
            "name": "Open table", "visibility": "public",
        })
        private = client.post("/rooms", headers=owner_headers, json={
            "name": "Friends table", "visibility": "friends",
        })
        assert public.status_code == private.status_code == 201
        public_room, private_room = public.json(), private.json()
        assert private_room["creator_id"] == owner["user_id"]
        assert private_room["visibility"] == "private"

        # Knowing a private room's code does not bypass its audience.
        assert private_room["room_id"] not in room_ids(client, stranger_headers)
        assert client.post(f"/rooms/{private_room['room_id']}/enter", headers=stranger_headers).status_code == 403
        assert client.get(f"/rooms/{private_room['room_id']}", headers=stranger_headers).status_code == 403
        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect(
                f"/ws/rooms/{private_room['room_id']}?token={stranger_headers['Authorization'].removeprefix('Bearer ')}"
            ):
                pass
        assert closed.value.code == 1008
        assert public_room["room_id"] in room_ids(client, stranger_headers)
        assert client.post(f"/rooms/{public_room['room_id']}/enter", headers=stranger_headers).status_code == 200
        public_item = next(room for room in client.get("/rooms", headers=stranger_headers).json()
                           if room["room_id"] == public_room["room_id"])
        assert public_item["feed_source"] == "joined"

        client.post(f"/friends/requests/{friend['user_id']}", headers=owner_headers)
        assert private_room["room_id"] not in room_ids(client, friend_headers)
        client.post(f"/friends/requests/{owner['user_id']}/accept", headers=friend_headers)

        assert private_room["room_id"] not in room_ids(client, friend_headers)
        assert client.post(f"/rooms/{private_room['room_id']}/enter", headers=friend_headers).status_code == 403
        assert client.post(f"/rooms/{private_room['room_id']}/invitations", headers=owner_headers, json={"invitees": [friend["user_id"]]}).status_code == 200
        assert client.post(f"/rooms/{private_room['room_id']}/enter", headers=friend_headers).status_code == 200
        joined_item = next(room for room in client.get("/rooms", headers=friend_headers).json()
                           if room["room_id"] == private_room["room_id"])
        assert joined_item["feed_source"] == "joined"

        # Every room member—not only its owner—may create a game table.
        table = client.post(f"/test-games/{private_room['room_id']}", headers=friend_headers, json={
            "name": "Friend's table", "player_count": 4, "game_type": "callbreak",
        })
        assert table.status_code == 201

        owner_feed = client.get("/rooms", headers=owner_headers).json()
        assert [room["feed_source"] for room in owner_feed[:2]] == ["you", "you"]

        assert client.delete(f"/rooms/{private_room['room_id']}", headers=friend_headers).status_code == 403
        assert client.delete(f"/rooms/{private_room['room_id']}", headers=owner_headers).status_code == 409
        assert client.post(f"/test-games/{private_room['room_id']}/end", headers=friend_headers,
                           json={"match_id": table.json()["match_id"]}).status_code == 200
        assert client.delete(f"/rooms/{private_room['room_id']}", headers=owner_headers).status_code == 204
        assert private_room["room_id"] not in room_ids(client, owner_headers)
        assert private_room["room_id"] not in room_ids(client, friend_headers)
        assert client.post(f"/rooms/{private_room['room_id']}/enter", headers=friend_headers).status_code == 403
        assert client.delete(f"/rooms/{private_room['room_id']}", headers=owner_headers).status_code == 404


def test_room_visibility_is_validated_and_defaults_to_private():
    with TestClient(create_app()) as client:
        _, headers = account(client, "room-validation", "Creator")
        created = client.post("/rooms", headers=headers, json={"name": "Default audience"})
        assert created.status_code == 201
        assert created.json()["visibility"] == "private"
        assert client.post("/rooms", headers=headers, json={
            "name": "Invalid audience", "visibility": "unknown",
        }).status_code == 422


def test_room_creation_invitations_are_private_and_acceptance_only_adds_membership():
    with TestClient(create_app()) as client:
        owner, owner_headers = account(client, "invite-room-owner", "Owner")
        invited, invited_headers = account(client, "invite-room-player", "Invited")
        other, other_headers = account(client, "invite-room-other", "Other")
        created = client.post("/rooms", headers=owner_headers, json={
            "name": "Invited room", "visibility": "friends",
            "invitees": [invited["user_id"], invited["user_id"], other["user_id"]],
        })
        assert created.status_code == 201
        room = created.json()

        invited_items = client.get("/room-invitations", headers=invited_headers).json()
        other_items = client.get("/room-invitations", headers=other_headers).json()
        assert len(invited_items) == len(other_items) == 1
        assert invited_items[0]["room_name"] == "Invited room"
        assert invited_items[0]["inviter"]["username"] == "invite-room-owner"
        assert invited_items[0]["id"] != other_items[0]["id"]
        assert client.get(f"/rooms/{room['room_id']}", headers=invited_headers).json()["is_member"] is False

        accepted = client.post(f"/room-invitations/{invited_items[0]['id']}/accept",
                               headers=invited_headers, json={})
        assert accepted.status_code == 200
        state = client.get(f"/rooms/{room['room_id']}", headers=invited_headers)
        assert state.status_code == 200 and state.json()["is_member"] is True
        assert client.get(f"/test-games/{room['room_id']}", headers=invited_headers).json()["status"] == "empty"
        assert client.get("/room-invitations", headers=invited_headers).json() == []

        assert client.post(f"/room-invitations/{other_items[0]['id']}/decline",
                           headers=other_headers, json={}).status_code == 200
        assert client.get("/room-invitations", headers=other_headers).json() == []


@pytest.mark.asyncio
async def test_persisted_room_membership_survives_service_restart():
    catalog = MemoryRoomCatalog()
    first = RoomService(catalog)
    room = await first.create("Durable room", "user-owner")
    await first.invite(room.room_id, "user-owner", ["user-member"])
    await first.join(room.room_id, "user-member")

    restarted = RoomService(catalog)

    assert await restarted.members(room.room_id) == ["user-member", "user-owner"]
    assert await restarted.has_membership(room.room_id, "user-member")
    listed = await restarted.list_rooms("user-member")
    assert [(item.room_id, item.members, item.feed_source) for item in listed] == [
        (room.room_id, ["user-member", "user-owner"], "joined"),
    ]

    await restarted.leave(room.room_id, "user-member")
    assert await restarted.members(room.room_id) == ["user-owner"]
    assert not await restarted.has_membership(room.room_id, "user-member")


def test_failed_room_delete_keeps_tables_members_and_connections_intact(monkeypatch):
    from unittest.mock import AsyncMock
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        owner, headers = account(client, 'delete-retry-owner', 'Owner')
        room_id = client.post('/rooms', headers=headers, json={'name': 'Retained room'}).json()['room_id']
        game = client.post(f'/test-games/{room_id}', headers=headers,
                           json={'game_type': 'callbreak', 'player_count': 4}).json()
        client.post(f'/test-games/{room_id}/end', headers=headers, json={'match_id': game['match_id']})
        catalog = client.app.state.rooms._catalog
        original = catalog.delete
        disconnected = AsyncMock()
        monkeypatch.setattr(client.app.state.connections, 'delete_room', disconnected)
        monkeypatch.setattr(catalog, 'delete', AsyncMock(side_effect=RuntimeError('Database unavailable')))
        assert client.delete(f'/rooms/{room_id}', headers=headers).status_code == 500
        disconnected.assert_not_awaited()
        assert game['match_id'] in client.app.state.test_games.tables[room_id]
        assert room_id in room_ids(client, headers)
        assert client.get(f'/rooms/{room_id}', headers=headers).json()['is_member'] is True
        monkeypatch.setattr(catalog, 'delete', original)
        assert client.delete(f'/rooms/{room_id}', headers=headers).status_code == 204
        disconnected.assert_awaited_once_with(room_id)
        assert room_id not in client.app.state.test_games.tables
        assert room_id not in room_ids(client, headers)


def test_room_members_return_current_names_for_offline_accounts_and_named_guests():
    with TestClient(create_app()) as client:
        owner, headers = account(client, 'member-owner', 'Owner')
        friend, friend_headers = account(client, 'member-friend', 'Sita Rai')
        _, outsider_headers = account(client, 'member-outsider', 'Outside')
        guest = client.post('/auth/guest', json={'display_name': 'Ram'}).json()
        guest_headers = {'Authorization': f"Bearer {guest['token']}"}
        room_id = client.post('/rooms', headers=headers, json={'name': 'Names', 'visibility': 'public'}).json()['room_id']
        path = f'/rooms/{room_id}/members'
        assert client.get(path).status_code == 401
        assert client.get(path, headers=outsider_headers).status_code == 403
        for member_headers in (friend_headers, guest_headers):
            assert client.post(f'/rooms/{room_id}/enter', headers=member_headers).status_code == 200
        response = client.get(path, headers=headers)
        assert response.headers['cache-control'] == 'no-store'
        members = {row['user_id']: row for row in response.json()}
        assert members[friend['user_id']]['display_name'] == 'Sita Rai'
        assert members[guest['user_id']]['display_name'] == 'Ram'
        assert members[owner['user_id']]['display_name'] == 'Owner'
        assert all(set(row) == {'user_id', 'display_name', 'username'} for row in members.values())
        client.patch('/me/profile', headers=friend_headers, json={'display_name': 'Sita Updated'})
        updated = {row['user_id']: row for row in client.get(path, headers=headers).json()}
        assert updated[friend['user_id']]['display_name'] == 'Sita Updated'
        client.patch('/me/profile', headers=friend_headers, json={'display_name': ''})
        updated = {row['user_id']: row for row in client.get(path, headers=headers).json()}
        assert updated[friend['user_id']]['username'] == 'member-friend'
        client.post(f'/rooms/{room_id}/leave', headers=friend_headers)
        assert friend['user_id'] not in {row['user_id'] for row in client.get(path, headers=headers).json()}
        assert client.get(path, headers=friend_headers).status_code == 403


def test_room_feed_batches_real_member_previews_and_excludes_ended_tables(monkeypatch):
    from unittest.mock import AsyncMock
    with TestClient(create_app()) as client:
        owner, headers = account(client, 'preview-owner', 'Prajwal')
        friend, friend_headers = account(client, 'preview-friend', 'Sita Rai')
        rooms = [client.post('/rooms', headers=headers, json={'name': name, 'visibility': 'public'}).json()['room_id']
                 for name in ['Friday cards', 'Family games']]
        client.post(f'/rooms/{rooms[0]}/enter', headers=friend_headers)
        table = client.post(f'/test-games/{rooms[0]}', headers=headers,
                            json={'name': 'Call Break', 'player_count': 4}).json()
        store = client.app.state.players.store
        lookup = AsyncMock(wraps=store.get_players)
        monkeypatch.setattr(store, 'get_players', lookup)
        feed = {room['room_id']: room for room in client.get('/rooms', headers=headers).json()}
        lookup.assert_awaited_once()
        assert set(lookup.call_args.args[0]) == {owner['user_id'], friend['user_id']}
        assert {player['display_name'] for player in feed[rooms[0]]['member_previews']} == {'Prajwal', 'Sita Rai'}
        assert feed[rooms[0]]['table_count'] == 1
        assert feed[rooms[1]]['table_count'] == 0
        client.post(f'/test-games/{rooms[0]}/end', headers=headers, json={'match_id': table['match_id']})
        feed = {room['room_id']: room for room in client.get('/rooms', headers=headers).json()}
        assert feed[rooms[0]]['table_count'] == 0


def test_privacy_changes_preserve_members_and_leaving_requires_new_invitation():
    with TestClient(create_app()) as client:
        owner, host = account(client, "privacy-host", "Owner")
        member, guest = account(client, "privacy-member", "Member")
        _, outsider = account(client, "privacy-outsider", "Outsider")
        room = client.post('/rooms', headers=host, json={'name':'Private room'}).json()
        path = '/rooms/' + room['room_id']
        assert client.patch(path, headers=guest, json={'visibility':'public'}).status_code == 403
        assert client.post(path+'/invitations', headers=guest, json={'invitees':[owner['user_id']]}).status_code == 403
        assert client.patch(path, headers=host, json={'visibility':'public'}).status_code == 200
        assert room['room_id'] in room_ids(client, outsider)
        assert client.post(path+'/enter', headers=guest).status_code == 200
        assert client.patch(path, headers=host, json={'visibility':'private'}).status_code == 200
        assert room['room_id'] not in room_ids(client, outsider)
        assert room['room_id'] in room_ids(client, guest)
        assert client.get('/test-games/'+room['room_id'], headers=outsider).status_code == 403
        assert client.post(path+'/leave', headers=guest).status_code == 200
        assert client.post(path+'/enter', headers=guest).status_code == 403
        assert client.post(path+'/invitations', headers=host, json={'invitees':[member['user_id']]}).status_code == 200
        assert client.post(path+'/enter', headers=guest).status_code == 200
        assert client.get('/room-invitations', headers=guest).json() == []
        assert client.post(path+'/leave', headers=guest).status_code == 200
        assert client.post(path+'/enter', headers=guest).status_code == 403


@pytest.mark.asyncio
async def test_pending_invitation_survives_restart_and_does_not_grant_reentry_after_leaving():
    catalog = MemoryRoomCatalog()
    first = RoomService(catalog)
    room = await first.create("Private", "owner")
    await first.invite(room.room_id, "owner", ["invited"])
    restarted = RoomService(catalog)
    invitations = await restarted.invitations_for("invited")
    assert len(invitations) == 1
    assert await restarted.can_enter(room.room_id, "invited", None)
    await restarted.answer_invitation("invited", invitations[0]["id"], True)
    await restarted.invite(room.room_id, "owner", ["invited"])
    await restarted.leave(room.room_id, "invited")
    assert not await restarted.can_enter(room.room_id, "invited", None)
