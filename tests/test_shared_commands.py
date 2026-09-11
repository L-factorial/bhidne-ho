import asyncio
from contextlib import ExitStack
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.adapters.callbreak.host import CallBreakCommandTarget
from app.games.echo import EchoCommandTarget, EchoGameEngine
from app.main import create_app
from app.models.action import ActionCommand
from app.runtime.command_runtime import CommandAccessError, CommandRuntime, CommandSession, OutgoingEvent
from app.runtime.game_registry import GameRegistry
from app.runtime.game_runtime import GameRuntime
from app.models.game import GameCommand
from test_test_games import manual_host, next_action


@pytest.fixture(params=["callbreak", "echo"])
async def subject(request):
    if request.param == "callbreak":
        service, _, game = await manual_host()
        target, session = CallBreakCommandTarget(service, game), game.commands
        make = lambda: next_action(service, game)
    else:
        service = None
        target, session = EchoCommandTarget(EchoGameEngine()), CommandSession()

        def make():
            return "u0", ActionCommand(match_id=session.match_id, command_id=uuid4().hex,
                expected_revision=target.revision, command="PING", payload={"message": "hello"})

    delivered = []

    async def deliver(events):
        delivered.extend(events)

    yield CommandRuntime(), session, target, make, deliver, delivered
    if service:
        await service.close()


async def test_shared_duplicate_submission_and_fresh_snapshot(subject):
    runtime, session, target, make, deliver, delivered = subject
    user, command = make()
    results = await asyncio.gather(*(runtime.execute(session, target, user, command, deliver) for _ in range(3)))
    assert results[0] == results[1] == results[2]
    assert results[0]["action_ack"]["status"] == "accepted"
    assert len(session.receipts) == 1
    count, revision = len(delivered), target.revision
    assert count > 0
    await runtime.execute(session, target, user, command, deliver)
    assert len(delivered) == count and target.revision == revision
    next_user, next_command = make()
    await runtime.execute(session, target, next_user, next_command, deliver)
    retried = await runtime.execute(session, target, user, command, deliver)
    assert retried["action_ack"] == results[0]["action_ack"]
    assert retried["game"]["revision"] > retried["action_ack"]["revision"]
    fresh = await runtime.snapshot(session, target, user)
    assert {k: v for k, v in retried.items() if k != "action_ack"} == fresh
    fresh["game"]["revision"] = -999
    assert (await runtime.snapshot(session, target, user))["game"]["revision"] == target.revision


async def test_shared_disconnect_after_commit_and_retry(subject):
    runtime, session, target, make, deliver, delivered = subject
    user, command = make()
    entered = asyncio.Event()

    async def disconnect(events):
        entered.set()
        await asyncio.Event().wait()

    task = asyncio.create_task(runtime.execute(session, target, user, command, disconnect))
    await asyncio.wait_for(entered.wait(), 2)
    revision = target.revision
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    response = await runtime.execute(session, target, user, command, deliver)
    assert response["action_ack"]["status"] == "accepted"
    assert target.revision == revision and delivered == []


async def test_shared_rejections_conflicts_and_receipt_capacity(subject):
    runtime, session, target, make, deliver, delivered = subject
    user, command = make()
    stale = command.model_copy(update={"expected_revision": target.revision + 1})
    result = await runtime.execute(session, target, user, stale, deliver)
    assert result["action_ack"]["status"] == "rejected"
    assert await runtime.execute(session, target, user, stale, deliver) == result
    with pytest.raises(CommandAccessError) as error:
        await runtime.execute(session, target, user, command, deliver)
    assert error.value.status == 409
    invalid = ActionCommand(match_id=session.match_id, command_id="invalid", expected_revision=target.revision,
                            command="UNKNOWN")
    assert (await runtime.execute(session, target, user, invalid, deliver))["action_ack"]["status"] == "rejected"
    assert delivered == []
    session.receipt_limit = len(session.receipts)
    user, new = make()
    with pytest.raises(CommandAccessError):
        await runtime.execute(session, target, user, new, deliver)
    assert await runtime.execute(session, target, user, stale, deliver) == result
    with pytest.raises(CommandAccessError):
        await runtime.execute(CommandSession(), target, user, command, deliver)


async def test_shared_unexpected_mutation_failure_restores_checkpoint(subject):
    runtime, session, target, make, deliver, delivered = subject
    user, command = make()
    before = await runtime.snapshot(session, target, user)
    original = target.apply

    def fail(user_id, body):
        original(user_id, body)
        raise RuntimeError("Failure after mutation")

    target.apply = fail
    with pytest.raises(RuntimeError):
        await runtime.execute(session, target, user, command, deliver)
    assert session.receipts == {} and delivered == []
    assert await runtime.snapshot(session, target, user) == before
    target.apply = original
    assert (await runtime.execute(session, target, user, command, deliver))["action_ack"]["status"] == "accepted"


async def test_shared_rechecks_authorization_before_returning_receipts(subject):
    runtime, session, target, make, deliver, _ = subject
    user, command = make()
    await runtime.execute(session, target, user, command, deliver)

    def revoke(user_id):
        raise CommandAccessError(403, "Access revoked")

    target.authorize = revoke
    with pytest.raises(CommandAccessError) as error:
        await runtime.execute(session, target, user, command, deliver)
    assert error.value.status == 403


async def test_registered_runtime_routes_private_events_and_serializes_legacy_commands():
    engine, registry, delivery = EchoGameEngine(), GameRegistry(), AsyncMock()
    target = EchoCommandTarget(engine)
    original = target.apply

    def private(user_id, command):
        return [*original(user_id, command), OutgoingEvent({"event": "PRIVATE"}, user_id)]

    target.apply = private
    registry.register("room", engine, command_target=target)
    runtime = GameRuntime(delivery, registry)
    snapshot = await runtime.snapshot("room", "u0")
    body = ActionCommand(match_id=snapshot["match_id"], command_id="first", expected_revision=0, command="PING")
    await runtime.action("room", "u0", body)
    delivery.send_to_room_user.assert_awaited_once_with("room", "u0", {"event": "PRIVATE"})
    # Existing WebSocket PINGs and reliable HTTP PINGs share the same engine/lock.
    await runtime.handle("room", "u0", GameCommand(command="PING"))
    result = await runtime.action("room", "u0", body)
    assert result["game"]["revision"] == 2 and result["action_ack"]["revision"] == 1
    assert delivery.send_to_room_user.await_count == 1
    stale = body.model_copy(update={"command_id": "second", "expected_revision": 1})
    assert (await runtime.action("room", "u0", stale))["action_ack"]["status"] == "rejected"


@pytest.mark.parametrize("prefix", ["/games", "/test-games"])
def test_shared_http_auth_reconnect_and_receipt_isolation(prefix):
    with TestClient(create_app()) as client, ExitStack() as stack:
        assert client.get(prefix + "/room").status_code == 401
        users = [client.post('/auth/guest').json() for _ in range(4)]
        headers = [{"Authorization": f"Bearer {user['token']}"} for user in users]
        assert client.get(prefix + "/room", headers=headers[0]).status_code == 403
        sockets = []
        for user in users:
            socket = stack.enter_context(client.websocket_connect(f"/ws/rooms/room?token={user['token']}"))
            socket.receive_json()
            sockets.append(socket)
        if prefix == "/test-games":
            mid = client.post(prefix + '/room', headers=headers[0], json={"player_count": 4}).json()['match_id']
            for header in headers[1:]:
                client.post(prefix + '/room/join', headers=header, json={"match_id": mid})
            client.post(prefix + '/room/start', headers=headers[0], json={"match_id": mid, "play_mode": "manual"})
        state = client.get(prefix + '/room', headers=headers[0]).json()
        actor = state['game']['turn']['player_id'] - 1 if prefix == '/test-games' else 0
        command = "SHUFFLE_DECK" if prefix == '/test-games' else "PING"
        body = {"command_id": "shared-id", "match_id": state['match_id'],
                "expected_revision": state['game']['revision'], "command": command}
        first = client.post(prefix + '/room/action', headers=headers[actor], json=body)
        assert first.status_code == 200 and first.json()['action_ack']['status'] == 'accepted'
        assert first.headers['cache-control'] == 'no-store'
        # A new socket using the same authenticated identity can resolve the receipt.
        sockets[actor].close()
        reconnect = stack.enter_context(client.websocket_connect(f"/ws/rooms/room?token={users[actor]['token']}"))
        reconnect.receive_json()
        retry = client.post(prefix + '/room/action', headers=headers[actor], json=body).json()
        assert retry['action_ack'] == first.json()['action_ack']
        other = (actor + 1) % 4
        rejected = client.post(prefix + '/room/action', headers=headers[other], json=body).json()
        assert rejected['action_ack']['status'] == 'rejected'
        assert client.get(prefix + '/room', headers=headers[actor]).json().get('action_ack') is None
        assert client.post(prefix + '/room/action', headers=headers[actor],
                           json={**body, 'user_id': users[other]['user_id']}).status_code == 422
        assert client.app.state.test_games.command_runtime is client.app.state.runtime.commands
