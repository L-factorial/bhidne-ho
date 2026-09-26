"""Durable ingress survives advisory routing failures without lease takeover."""
import asyncio
from dataclasses import replace
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.ownership import PostgresRoomOwnershipStore
from app.durable_games.room_runtime import RoomExecutionRuntime
from app.durable_games.routing import RoomCommandRouter, RoomWakeup, RoomWakeupReceiver
from test_checkpoint_store import database
from test_room_runtime import start, outcome, rows


def request():
    return dict(command_id=uuid4().hex, command='create-table',
                payload={'game_type': 'marriage', 'capacity': 2})


async def test_remote_gateway_persists_then_wakes_real_owner(database):
    pool, _, _, users = database
    owner, fence = await start(database)
    gateway = RoomExecutionRuntime(pool, 'http://gateway:8000')
    await gateway.start()
    received = []
    receiver = RoomWakeupReceiver(owner)
    async def send(destination, wakeup):
        # No command, user data, or acquisition secret is sent across servers.
        assert set(vars(wakeup)) == {'room_id', 'lane_id', 'instance_id', 'epoch'}
        assert destination.instance_id == fence.instance_id
        assert (await rows(pool, 'SELECT count(*) FROM command_inbox')) == [(1,)]
        received.append(wakeup)
        return await receiver.receive(wakeup)
    router = RoomCommandRouter(gateway.inbox, gateway.ownership,
        local_receiver=RoomWakeupReceiver(gateway), send_remote=send)
    body = request()
    try:
        result = await router.submit(LaneTarget(kind='room', room_id='room'), users[0], body)
        assert result.wakeup == 'signalled' and len(received) == 1
        assert (await outcome(gateway.inbox, result.entry.lane_id, users[0], body))['status'] == 'accepted'
        retry = await router.submit(LaneTarget(kind='room', room_id='room'), users[0], body)
        assert retry.entry.duplicate and retry.entry.status == 'accepted' and retry.wakeup == 'terminal'
        assert len(received) == 1
        assert (await rows(pool, 'SELECT count(*) FROM room_tables')) == [(1,)]
    finally:
        await gateway.stop()
        await owner.stop()


async def test_local_receiver_rejects_wrong_hints_without_losing_owner(database):
    pool, _, _, _ = database
    runtime, fence = await start(database)
    receiver = RoomWakeupReceiver(runtime)
    try:
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        notice = RoomWakeup('room', lane, fence.instance_id, fence.epoch)
        assert await receiver.receive(notice)
        for changed in (replace(notice, epoch=fence.epoch+1), replace(notice, instance_id='other'),
                        replace(notice, lane_id=uuid4()), replace(notice, room_id='missing')):
            assert not await receiver.receive(changed)
            assert runtime.admits(fence)
        chat = await runtime.inbox.ensure_lane(LaneTarget(kind='room_chat', room_id='room'))
        assert await receiver.receive(replace(notice, lane_id=chat))
        await rows(pool, "INSERT INTO rooms(id,creator_id,name,visibility) SELECT 'other',creator_id,'Other','private' FROM rooms WHERE id='room'")
        other = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='other'))
        assert not await receiver.receive(replace(notice, lane_id=other))
        assert runtime.admits(fence)
    finally:
        await runtime.stop()


async def test_stopped_local_owner_refuses_still_live_sql_hint(database):
    pool, _, _, users = database
    runtime, fence = await start(database)
    await runtime.stop()
    router = RoomCommandRouter(runtime.inbox, runtime.ownership, local_receiver=RoomWakeupReceiver(runtime))
    body = request()
    result = await router.submit(LaneTarget(kind='room', room_id='room'), users[0], body)
    assert result.wakeup == 'owner_unavailable' and result.entry.status == 'pending'
    state = await runtime.ownership.inspect('room')
    assert state.live and state.status == 'serving' and state.epoch == fence.epoch
    # Only expiry permits a new owner. Its recovery scan resumes the command,
    # while an old delayed notification must not revoke or address the new boot.
    await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    replacement = RoomExecutionRuntime(pool, 'http://replacement:8000', scan_interval=.02)
    await replacement.start()
    try:
        lease = await replacement.activate(await replacement.prepare('room', expected_epoch=fence.epoch))
        stale = RoomWakeup('room', result.entry.lane_id, fence.instance_id, fence.epoch)
        assert not await RoomWakeupReceiver(replacement).receive(stale)
        assert replacement.admits(lease.fence)
        assert (await outcome(replacement.inbox, result.entry.lane_id, users[0], body))['status'] == 'accepted'
        assert (await rows(pool, 'SELECT count(*) FROM room_tables')) == [(1,)]
    finally:
        await replacement.stop()


async def test_local_routing_uses_receiver_without_remote_transport(database):
    _, _, _, users = database
    runtime, fence = await start(database)
    router = RoomCommandRouter(runtime.inbox, runtime.ownership, local_receiver=RoomWakeupReceiver(runtime))
    body = request()
    try:
        result = await router.submit(LaneTarget(kind='room', room_id='room'), users[0], body)
        assert result.wakeup == 'signalled'
        assert (await outcome(runtime.inbox, result.entry.lane_id, users[0], body))['status'] == 'accepted'
    finally:
        await runtime.stop()


async def test_receiver_is_bounded_and_rechecks_admission_after_lane_lookup(database, monkeypatch):
    runtime, fence = await start(database)
    receiver = RoomWakeupReceiver(runtime, max_inflight=1)
    lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
    notice = RoomWakeup('room', lane, fence.instance_id, fence.epoch)
    entered, resume = asyncio.Event(), asyncio.Event()
    original = runtime.inbox._lane
    async def blocked(*args):
        result = await original(*args)
        entered.set()
        await resume.wait()
        return result
    monkeypatch.setattr(runtime.inbox, '_lane', blocked)
    task = asyncio.create_task(receiver.receive(notice))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        assert not await receiver.receive(notice)
        runtime.leases.abandon_fence(fence)
        resume.set()
        assert not await task
        assert receiver._inflight == 0
        assert runtime.scheduler._work == {}
    finally:
        resume.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await runtime.stop()


@pytest.mark.parametrize('change,reason', [
    (None, 'unowned'),
    ({'status': 'unowned'}, 'unowned'), ({'status': 'recovering'}, 'recovering'),
    ({'status': 'draining'}, 'draining'), ({'instance_draining': True}, 'draining'),
    ({'instance_fresh': False}, 'owner_unavailable'), ({'live': False}, 'expired'),
    ({'status': 'quarantined', 'live': False}, 'quarantined'),
])
async def test_unavailable_owner_never_discards_or_takes_over(database, monkeypatch, change, reason):
    pool, _, fence, users = database
    inbox, ownership = PostgresInboxStore(pool), PostgresRoomOwnershipStore(pool)
    original = await ownership.inspect('room')
    async def inspect(room): return replace(original, **change) if change is not None else None
    monkeypatch.setattr(ownership, 'inspect', inspect)
    notifications = []
    async def forbidden(*args): notifications.append(args)
    router = RoomCommandRouter(inbox, ownership, send_remote=forbidden)
    result = await router.submit(LaneTarget(kind='room', room_id='room'), users[0], request())
    assert result.wakeup == reason and result.entry.status == 'pending'
    assert notifications == []
    actual = await PostgresRoomOwnershipStore(pool).inspect('room')
    assert actual.epoch == fence.epoch and actual.instance_id == fence.instance_id


@pytest.mark.parametrize('failure', ['database', 'transport', 'timeout'])
async def test_failure_after_enqueue_preserves_original_pending_entry(database, monkeypatch, failure):
    pool, _, _, users = database
    inbox, ownership = PostgresInboxStore(pool), PostgresRoomOwnershipStore(pool)
    async def fail(*args): raise OperationalError('private failure details')
    async def timeout(*args): await asyncio.Event().wait()
    if failure == 'database': monkeypatch.setattr(ownership, 'inspect', fail)
    router = RoomCommandRouter(inbox, ownership, timeout=.05,
        send_remote=timeout if failure == 'timeout' else fail)
    body = request()
    result = await router.submit(LaneTarget(kind='room', room_id='room'), users[0], body)
    expected = dict(database='routing_unavailable', transport='owner_unavailable', timeout='routing_timeout')
    assert result.wakeup == expected[failure]
    entry = await inbox.lookup(result.entry.lane_id, users[0], body['command_id'])
    assert entry.status == 'pending' and entry.sequence == result.entry.sequence
    assert router._inflight == 0


async def test_route_refresh_targets_new_epoch_once(database, monkeypatch):
    pool, _, _, users = database
    inbox, ownership = PostgresInboxStore(pool), PostgresRoomOwnershipStore(pool)
    old = await ownership.inspect('room')
    new = replace(old, instance_id='replacement', epoch=old.epoch+1, internal_address='http://replacement')
    inspections = iter((old, new))
    async def inspect(room): return next(inspections)
    monkeypatch.setattr(ownership, 'inspect', inspect)
    received = []
    async def send(destination, wakeup):
        received.append(wakeup)
        return destination == new
    router = RoomCommandRouter(inbox, ownership, send_remote=send)
    result = await router.submit(LaneTarget(kind='room', room_id='room'), users[0], request())
    assert result.wakeup == 'signalled'
    assert [w.epoch for w in received] == [old.epoch, new.epoch]
    assert result.entry.status == 'pending'  # Notification acknowledgement is not execution.


async def test_saturated_routing_and_cancelled_wakeup_leave_durable_work(database):
    pool, _, _, users = database
    inbox, ownership = PostgresInboxStore(pool), PostgresRoomOwnershipStore(pool)
    entered = asyncio.Event()
    async def blocked(*args):
        entered.set()
        await asyncio.Event().wait()
    router = RoomCommandRouter(inbox, ownership, send_remote=blocked, max_inflight=1)
    target, body = LaneTarget(kind='room', room_id='room'), request()
    task = asyncio.create_task(router.submit(target, users[0], body))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        duplicate = await router.submit(target, users[0], body)
        assert duplicate.wakeup == 'routing_busy' and duplicate.entry.duplicate
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert router._inflight == 0
        assert (await inbox.lookup(duplicate.entry.lane_id, users[0], body['command_id'])).status == 'pending'
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_unknown_enqueue_commit_retries_same_identity_before_notification(database, monkeypatch):
    pool, _, _, users = database
    inbox, ownership = PostgresInboxStore(pool), PostgresRoomOwnershipStore(pool)
    enqueue = inbox.enqueue
    async def lost(*args):
        await enqueue(*args)
        raise OperationalError('lost commit response')
    notices = []
    async def send(destination, wakeup):
        notices.append(wakeup)
        return True
    router = RoomCommandRouter(inbox, ownership, send_remote=send)
    target, body = LaneTarget(kind='room', room_id='room'), request()
    with monkeypatch.context() as patch:
        patch.setattr(inbox, 'enqueue', lost)
        with pytest.raises(OperationalError): await router.submit(target, users[0], body)
    assert notices == []
    retry = await router.submit(target, users[0], body)
    assert retry.entry.duplicate and retry.wakeup == 'signalled'
    assert len(notices) == 1
    assert (await rows(pool, 'SELECT count(*) FROM command_inbox')) == [(1,)]
