import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.multiplayer.room_catalog import MemoryRoomCatalog
from app.multiplayer.room_service import RoomService
from tests.test_players import account


def room_ids(client, headers):
    return [room["room_id"] for room in client.get("/rooms", headers=headers).json()]


def test_social_room_feed_and_friends_only_access():
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
        assert private_room["visibility"] == "friends"

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
        assert public_room["room_id"] not in room_ids(client, stranger_headers)
        assert client.post(f"/rooms/{public_room['room_id']}/enter", headers=stranger_headers).status_code == 200
        public_item = next(room for room in client.get("/rooms", headers=stranger_headers).json()
                           if room["room_id"] == public_room["room_id"])
        assert public_item["feed_source"] == "joined"

        client.post(f"/friends/requests/{friend['user_id']}", headers=owner_headers)
        assert private_room["room_id"] not in room_ids(client, friend_headers)
        client.post(f"/friends/requests/{owner['user_id']}/accept", headers=friend_headers)

        friend_feed = client.get("/rooms", headers=friend_headers).json()
        friend_item = next(room for room in friend_feed if room["room_id"] == private_room["room_id"])
        assert friend_item["feed_source"] == "friend"
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


def test_room_visibility_is_validated_and_defaults_to_public():
    with TestClient(create_app()) as client:
        _, headers = account(client, "room-validation", "Creator")
        created = client.post("/rooms", headers=headers, json={"name": "Default audience"})
        assert created.status_code == 201
        assert created.json()["visibility"] == "public"
        assert client.post("/rooms", headers=headers, json={
            "name": "Invalid audience", "visibility": "private",
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
        assert client.get(f"/rooms/{room['room_id']}", headers=invited_headers).status_code == 403

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
