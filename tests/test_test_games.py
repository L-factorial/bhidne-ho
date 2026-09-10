import asyncio
import time
from contextlib import ExitStack

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import create_app
from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.room_service import RoomService
from app.test_games.http import GameAction
from app.test_games.service import TestGameService as GameHost
from callbreak import Phase
from callbreak.audit import audit_match


class Delivery:
    def __init__(self):
        self.private = {}
        self.public = []
        self.private_events = []

    async def send_to_room_user(self, room, user, data):
        self.private[room, user] = data
        if data.get("type") == "GAME_EVENT":
            self.private_events.append((room, user, data))

    async def broadcast(self, room, data):
        self.public.append((room, data))


async def host(n, timeout=3):
    rooms, delivery = RoomService(), Delivery()
    for i in range(n + 1):
        await rooms.join("room", f"u{i}")
    service = GameHost(rooms, delivery, timeout_seconds=timeout)
    return service, delivery


@pytest.mark.parametrize("n", [4, 5])
async def test_first_seats_auto_start_and_complete_all_five_deals(n):
    service, delivery = await host(n, timeout=0.001)
    try:
        waiting = await service.create("room", "u0", n)
        assert waiting["status"] == "waiting" and waiting["your_player_id"] == 1
        for i in range(1, n):
            snapshot = await service.join("room", f"u{i}", waiting["match_id"])
            assert snapshot["status"] == ("playing" if i == n - 1 else "waiting")
        game = service.games["room"]
        assert game.state.initial_dealer == 1 and game.state.phase == Phase.AWAITING_SHUFFLE
        assert game.users == [f"u{i}" for i in range(n)]
        assert snapshot["game"]["turn"]["player_id"] == 1
        with pytest.raises(HTTPException):
            await service.join("room", f"u{n}", waiting["match_id"])
        spectator = await service.snapshot("room", f"u{n}")
        assert spectator["private"] is None and spectator["your_player_id"] is None
        # Duplicate tabs/reconnects reuse the same seat.
        assert (await service.join("room", "u0", waiting["match_id"]))["your_player_id"] == 1
        await asyncio.wait_for(game.task, timeout=10)
        assert game.error is None and game.state.phase == Phase.MATCH_COMPLETE
        audit_match(game.state)
        assert len(game.state.completed_deals) == 5
        assert all(sum(d.result.tricks_won) == 52 // n for d in game.state.completed_deals)
        assert any(data.get("event") == "AutoAction" for _, data in delivery.public)
        assert all(data.get("event") not in ("CARD_DEALT", "HAND_REVIEW_REQUESTED", "REDEAL_ELIGIBLE") for _, data in delivery.public)
        assert not any("card" in data.get("payload", {}) for _, data in delivery.public if data.get("event") == "CARD_DISTRIBUTED")
        events = [data for _, data in delivery.public if data.get("type") == "GAME_EVENT"]
        assert sum(e["event"] == "CARD_DISTRIBUTED" for e in events) == 5 * n * (52 // n)
        assert sum(e["event"] == "MATCH_COMPLETED" for e in events) == 1
        cards = [(room, user, e) for room, user, e in delivery.private_events if e["event"] == "CARD_DEALT"]
        assert len(cards) == 5 * n * (52 // n)
        assert all(room == "room" and user == f"u{e['payload']['player_id'] - 1}" for room, user, e in cards)
        assert all(e["protocol_version"] == 1 and e["match_id"] == game.match_id for e in events)
        snapshot = await service.snapshot("room", "u0")
        assert snapshot["status"] == "finished" and snapshot["remaining_ms"] is None
        replacement = await service.create("room", "u0", n)
        assert replacement["match_id"] != waiting["match_id"]
    finally:
        await service.close()


async def test_manual_actions_stale_commands_and_three_second_deadline():
    service, delivery = await host(4)
    try:
        waiting = await service.create("room", "u0", 4)
        for i in range(1, 4):
            await service.join("room", f"u{i}", waiting["match_id"])
        game = service.games["room"]
        initial_deadline = game.deadline
        assert 2.5 < game.deadline - time.monotonic() <= 3
        body = GameAction(match_id=game.match_id, expected_revision=game.state.revision, command="SHUFFLE_DECK")
        with pytest.raises(HTTPException):
            await service.action("room", "u1", body)
        assert game.deadline == initial_deadline
        result = await service.action("room", "u0", body)
        assert result["game"]["phase"] == "AWAITING_CUT" and game.state.current_player == 2
        with pytest.raises(HTTPException):
            await service.action("room", "u0", body)
        for user, command in [("u1", "SKIP_CUT"), ("u0", "START_DISTRIBUTION")]:
            await service.action("room", user, GameAction(match_id=game.match_id, expected_revision=game.state.revision, command=command))
        assert game.state.phase == Phase.HAND_REVIEW
        audit_match(game.state)
        for i in range(4):
            view = await service.snapshot("room", f"u{i}")
            assert view["private"]["hand"] == list(map(str, game.state.current_deal.players[i].hand))
        review_deadline = game.deadline
        await service.action("room", "u0", GameAction(match_id=game.match_id, expected_revision=game.state.revision, command="ACCEPT_HAND"))
        assert game.deadline == review_deadline
        with pytest.raises(HTTPException) as error:
            await service.action("room", "u4", GameAction(match_id=game.match_id, expected_revision=game.state.revision, command="ACCEPT_HAND"))
        assert error.value.status_code == 403
    finally:
        await service.close()
    assert game.task.done()


async def test_private_delivery_scoped_to_room_and_user():
    class Socket:
        def __init__(self): self.messages = []
        async def send_json(self, value): self.messages.append(value)
        async def close(self, code): pass
    rooms = RoomService()
    manager = ConnectionManager(rooms)
    one, other_room, other_user = Socket(), Socket(), Socket()
    await manager.connect("a", "alice", one)
    await manager.connect("b", "alice", other_room)
    await manager.connect("a", "bob", other_user)
    await manager.send_to_room_user("a", "alice", {"private": "QH"})
    assert one.messages == [{"private": "QH"}]
    assert other_room.messages == other_user.messages == []


def test_console_http_auth_lobby_and_validation():
    with TestClient(create_app()) as client, ExitStack() as stack:
        assert client.get('/test-games/room').status_code == 401
        users = [client.post('/auth/guest').json() for _ in range(4)]
        headers = [{"Authorization": f"Bearer {u['token']}"} for u in users]
        assert client.post('/test-games/room', headers=headers[0], json={"player_count": 4}).status_code == 403
        for u in users:
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/room?token={u['token']}"))
            socket.receive_json()
        assert client.get('/test-games/room', headers=headers[0]).json()['status'] == 'empty'
        response = client.post('/test-games/room', headers=headers[0], json={"player_count": 4})
        assert response.status_code == 201 and response.headers['cache-control'] == 'no-store'
        match_id = response.json()['match_id']
        for h in headers[1:]:
            assert client.post('/test-games/room/join', headers=h, json={"match_id": match_id}).status_code == 200
        state = client.get('/test-games/room', headers=headers[0]).json()
        assert state['game']['phase'] == 'AWAITING_SHUFFLE'
        assert client.post('/test-games/room/action', headers=headers[0], json={
            "match_id": match_id, "expected_revision": state['game']['revision'],
            "command": "SHUFFLE_DECK", "player_id": 1}).status_code == 422
        assert 'Call Break test game' in client.get('/').text
        assert client.get('/test-ui/test-games.js').status_code == 200
