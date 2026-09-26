"""Explicit drain withdraws admission and releases only after worker termination."""
import asyncio
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.inbox import LaneTarget
from app.durable_games.ownership import InstanceRegistration
from app.durable_games.room_runtime import RoomExecutionRuntime
from test_checkpoint_store import database
from test_room_runtime import start, rows, outcome


async def test_drain_releases_serving_and_prepared_rooms_and_is_repeatable(database):
    pool, _, _, _ = database
    runtime, fence = await start(database)
    try:
        await rows(pool, "INSERT INTO rooms(id,creator_id,name,visibility) SELECT 'other',creator_id,'Other','private' FROM rooms WHERE id='room'")
        prepared = await runtime.prepare('other', expected_epoch=0)
        assert prepared.status == 'prepared'
        report = await runtime.drain_and_stop()
        assert report.routing_status == 'confirmed'
        assert {r.room_id: r.status for r in report.releases} == {'room': 'released', 'other': 'released'}
        assert not runtime.admits(fence) and not runtime.scheduler.healthy
        assert (await runtime.ownership.inspect('room')).status == 'unowned'
        assert await runtime.drain_and_stop() == report
        with pytest.raises(RuntimeError): await runtime.start()
    finally:
        await runtime.stop()


async def test_release_waits_for_cancelled_executor_cleanup_and_takeover_resumes_work(database, monkeypatch):
    pool, _, _, users = database
    runtime, fence = await start(database)
    entered, cancelled, cleanup = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def blocked(*args):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
            await cleanup.wait()
    monkeypatch.setattr(runtime.executors['room'], 'execute_one', blocked)
    lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
    body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type': 'marriage', 'capacity': 2})
    await runtime.inbox.enqueue(lane, users[0], body)
    await asyncio.wait_for(entered.wait(), 3)
    task = asyncio.create_task(runtime.drain_and_stop())
    replacement = None
    try:
        await asyncio.wait_for(cancelled.wait(), 3)
        assert not runtime.admits(fence)
        assert await runtime.ownership.routing_hint('room') is None
        state = await runtime.ownership.inspect('room')
        assert state.live and state.instance_id == fence.instance_id and state.instance_draining
        assert not task.done()
        cleanup.set()
        assert (await task).releases[0].status == 'released'
        assert (await runtime.inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
        replacement = RoomExecutionRuntime(pool, 'http://replacement', scan_interval=.02)
        await replacement.start()
        lease = await replacement.activate(await replacement.prepare('room', expected_epoch=fence.epoch))
        assert lease.fence.epoch == fence.epoch + 1
        assert (await outcome(replacement.inbox, lane, users[0], body))['status'] == 'accepted'
    finally:
        cleanup.set()
        await asyncio.gather(task, return_exceptions=True)
        await runtime.stop()
        if replacement: await replacement.stop()


async def test_unknown_release_commit_retries_same_fence(database, monkeypatch):
    runtime, fence = await start(database)
    original = runtime.ownership.release
    calls = []
    async def lost(registration, current, **kwargs):
        calls.append(current)
        await original(registration, current, **kwargs)
        if len(calls) == 1: raise OperationalError('lost response')
    monkeypatch.setattr(runtime.ownership, 'release', lost)
    try:
        report = await runtime.drain_and_stop()
        assert report.releases[0].status == 'released'
        assert calls == [fence, fence]
        assert not runtime.admits(fence)
    finally:
        await runtime.stop()


async def test_exhausted_release_retries_cannot_release_replacement(database, monkeypatch):
    pool, _, _, _ = database
    runtime, fence = await start(database)
    async def down(*args, **kwargs): raise OperationalError('private failure')
    try:
        with monkeypatch.context() as patch:
            patch.setattr(runtime.ownership, 'release', down)
            report = await runtime.drain_and_stop()
        assert report.releases[0].status == 'uncertain'
        assert (await runtime.ownership.inspect('room')).live
        await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        registration = InstanceRegistration.new()
        await runtime.ownership.register(registration, 'http://replacement')
        replacement = await runtime.ownership.acquire('room', registration, expected_epoch=fence.epoch, token='r'*32)
        report = await runtime.drain_and_stop()
        assert report.releases[0].status == 'ownership_lost'
        assert (await runtime.ownership.inspect('room')).epoch == replacement.fence.epoch
    finally:
        await runtime.stop()


async def test_registry_withdrawal_failure_still_stops_workers_and_releases(database, monkeypatch):
    runtime, fence = await start(database)
    calls = 0
    async def down(*args):
        nonlocal calls
        calls += 1
        assert not runtime.admits(fence)
        raise OperationalError('registry unavailable')
    monkeypatch.setattr(runtime.ownership, 'drain_instance', down)
    try:
        report = await runtime.drain_and_stop()
        assert report.routing_status == 'uncertain' and calls == 3
        assert report.releases[0].status == 'released'
        assert not runtime.scheduler.healthy and not runtime.leases._tasks
    finally:
        await runtime.stop()


@pytest.mark.parametrize('phase', ['withdrawal', 'release'])
async def test_cancelled_drain_remains_closed_and_can_be_retried(database, monkeypatch, phase):
    runtime, fence = await start(database)
    entered = asyncio.Event()
    name = 'drain_instance' if phase == 'withdrawal' else 'release'
    original = getattr(runtime.ownership, name)
    async def blocked(*args, **kwargs):
        await original(*args, **kwargs)
        entered.set()
        await asyncio.Event().wait()
    try:
        with monkeypatch.context() as patch:
            patch.setattr(runtime.ownership, name, blocked)
            task = asyncio.create_task(runtime.drain_and_stop())
            await asyncio.wait_for(entered.wait(), 3)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        assert not runtime.admits(fence) and not runtime.leases._tasks
        assert (await runtime.drain_and_stop()).releases[0].status == 'released'
    finally:
        await runtime.stop()


async def test_drain_does_not_clear_quarantine_that_races_with_withdrawal(database, monkeypatch):
    runtime, fence = await start(database)
    original = runtime.ownership.drain_instance
    async def quarantine(registration):
        await runtime.ownership.quarantine(registration, fence)
        await original(registration)
    monkeypatch.setattr(runtime.ownership, 'drain_instance', quarantine)
    try:
        report = await runtime.drain_and_stop()
        assert report.releases[0].status == 'quarantined'
        assert (await runtime.ownership.inspect('room')).status == 'quarantined'
    finally:
        await runtime.stop()


async def test_failure_during_withdrawal_prevents_release_even_if_quarantine_write_fails(database, monkeypatch):
    runtime, fence = await start(database)
    original = runtime.ownership.drain_instance
    async def fail_room(registration):
        runtime._lose_room(fence, 'lane', 'CheckpointError', quarantine=True)
        await original(registration)
    async def down(*args): raise OperationalError('quarantine unavailable')
    monkeypatch.setattr(runtime.ownership, 'drain_instance', fail_room)
    monkeypatch.setattr(runtime.ownership, 'quarantine', down)
    try:
        report = await runtime.drain_and_stop()
        assert report.releases[0].status == 'repair_required'
        assert (await runtime.ownership.inspect('room')).status == 'serving'
        assert not runtime.admits(fence)
    finally:
        await runtime.stop()


async def test_cancellation_during_worker_cleanup_still_joins_workers(database, monkeypatch):
    runtime, fence = await start(database)
    entered, finish = asyncio.Event(), asyncio.Event()
    original = runtime.scheduler.stop
    async def blocked():
        entered.set()
        await finish.wait()
        await original()
    monkeypatch.setattr(runtime.scheduler, 'stop', blocked)
    task = asyncio.create_task(runtime.drain_and_stop())
    try:
        await asyncio.wait_for(entered.wait(), 3)
        task.cancel()
        await asyncio.sleep(0)
        assert not runtime.admits(fence)
        assert (await runtime.ownership.inspect('room')).live
        assert not task.done()
        finish.set()
        with pytest.raises(asyncio.CancelledError): await task
        assert not runtime.scheduler._tasks and not runtime.leases._tasks
        assert (await runtime.drain_and_stop()).releases[0].status == 'released'
    finally:
        finish.set()
        await asyncio.gather(task, return_exceptions=True)
        await runtime.stop()
