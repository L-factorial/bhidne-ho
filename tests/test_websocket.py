import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app


def guest(client):
    response = client.post("/auth/guest")
    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def url(identity, room="one"):
    return f"/ws/rooms/{room}?token={identity['token']}"


def test_authenticated_message_flow_and_cleanup():
    app = create_app()
    with TestClient(app) as client:
        alice, bob, carol = guest(client), guest(client), guest(client)
        with client.websocket_connect(url(bob)) as b, client.websocket_connect(url(carol, "two")) as c:
            assert b.receive_json()["type"] == "CONNECTED"
            c.receive_json()
            with client.websocket_connect(url(alice)) as a:
                assert a.receive_json()["user_id"] == alice["user_id"]
                a.send_json({"type": "MESSAGE", "sender_id": "forged",
                             "room_id": "two", "payload": {"text": "hello"}})
                assert b.receive_json() == {
                    "type": "MESSAGE", "sender_id": alice["user_id"],
                    "payload": {"text": "hello"},
                }
                # ERROR provides an ordered sentinel: no echoed/cross-room message precedes it.
                a.send_json({"type": "INVALID"})
                assert a.receive_json()["type"] == "ERROR"
                c.send_json({"type": "INVALID"})
                assert c.receive_json()["type"] == "ERROR"
            assert client.portal.call(app.state.rooms.members, "one") == [bob["user_id"]]
        assert client.portal.call(app.state.rooms.members, "one") == []
        assert client.portal.call(app.state.rooms.members, "two") == []


@pytest.mark.parametrize("token", ["", "made-up", "user-123"])
def test_invalid_auth_is_rejected(token):
    with TestClient(create_app()) as client:
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect(f"/ws/rooms/one?token={token}"):
                pass
        assert error.value.code == 1008


def test_invalid_frames_recover_and_tabs_keep_presence():
    app = create_app()
    with TestClient(app) as client:
        identity = guest(client)
        with client.websocket_connect(url(identity)) as first:
            first.receive_json()
            with client.websocket_connect(url(identity)) as second:
                second.receive_json()
                for raw in ("not json", "[]", '{"type":"MESSAGE","payload":1}'):
                    first.send_text(raw)
                    assert first.receive_json()["code"] == "INVALID_MESSAGE"
                first.send_bytes(b"binary")
                assert first.receive_json()["code"] == "INVALID_MESSAGE"
            assert client.portal.call(app.state.rooms.members, "one") == [identity["user_id"]]
        assert client.portal.call(app.state.rooms.members, "one") == []
