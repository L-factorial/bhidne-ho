"""Durable quarantine is exact-fenced and requires an explicit repair retry."""
import asyncio
from dataclasses import replace
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.failure_policy import RoomFailurePolicy
from app.durable_games.finalization import MatchFinalizationWorker
from app.durable_games.inbox import LaneTarget
from app.durable_games.ownership import InstanceRegistration, RoomWriteFence
from app.durable_games.room_runtime import RoomExecutionRuntime
from app.durable_games.room_recovery import UnsupportedRecoveryWork
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from test_checkpoint_store import database
from test_room_ownership import ownership, acquire
from test_room_runtime import start, rows, until


async def test_unknown_quarantine_commit_confirmed_after_expiry(ownership, monkeypatch):
    pool, store, a, b = ownership
    lease = await acquire(store, a)
    original = store.quarantine
    async def lost(*args):
        await original(*args)
        raise OperationalError('lost quarantine response')
    policy = RoomFailurePolicy(store, a, retry_base=.001, retry_max=.001)
    assert policy.schedule(lease.fence, 'CheckpointError')
    with monkeypatch.context() as patch:
        patch.setattr(store, 'quarantine', lost)
        await policy.sweep_once()
    assert policy.results[-1].status == 'retrying'
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    await asyncio.sleep(.002)
    await policy.sweep_once()
    assert policy.results[-1].status == 'quarantined'
    with pytest.raises(DurableGameConflict, match='Quarantined'): await acquire(store, b, 1)
    assert await store.routing_hint('room') is None
    with pytest.raises(StaleGameOwner):
        await store.quarantine(a, replace(lease.fence, token='wrong-secret'))


async def test_repair_retry_is_epoch_guarded_and_never_skips_recovery(ownership):
    pool, store, a, b = ownership
    old = await acquire(store, a)
    with pytest.raises(DurableGameConflict): await store.retry_quarantined('room', expected_epoch=1)
    await store.quarantine(a, old.fence)
    assert await store.retry_quarantined('room', expected_epoch=1)
    assert not await store.retry_quarantined('room', expected_epoch=1)
    current = await acquire(store, b, 1)
    assert current.status == 'recovering' and current.fence.epoch == 2
    with pytest.raises(DurableGameConflict): await store.retry_quarantined('room', expected_epoch=1)
    with pytest.raises(StaleGameOwner): await store.quarantine(a, old.fence)
    await store.quarantine(b, current.fence)
    with pytest.raises(DurableGameConflict): await store.retry_quarantined('room', expected_epoch=1)
    assert (await store.inspect('room')).status == 'quarantined'


@pytest.mark.parametrize('replace_owner', [False, True])
async def test_delayed_failure_cannot_quarantine_expired_or_replaced_owner(ownership, replace_owner):
    pool, store, a, b = ownership
    old = await acquire(store, a)
    policy = RoomFailurePolicy(store, a)
    policy.schedule(old.fence, 'UnsupportedRecoveryWork')
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    if replace_owner: await acquire(store, b, 1)
    before = await store.inspect('room')
    await policy.sweep_once()
    assert policy.results[-1].status == 'ownership_lost'
    assert await store.inspect('room') == before


async def test_transition_retry_exhaustion_retains_uncertainty(ownership, monkeypatch):
    _, store, a, _ = ownership
    lease = await acquire(store, a)
    calls = 0
    async def down(*args):
        nonlocal calls
        calls += 1
        raise OperationalError('private database details')
    monkeypatch.setattr(store, 'quarantine', down)
    policy = RoomFailurePolicy(store, a, max_attempts=2, retry_base=.001, retry_max=.001)
    policy.schedule(lease.fence, 'CheckpointError')
    await policy.sweep_once()
    await asyncio.sleep(.002)
    await policy.sweep_once()
    await policy.sweep_once()
    assert calls == 2 and policy.results[-1].status == 'uncertain'
    assert 'private' not in repr(policy.results)
    assert (await store.inspect('room')).status == 'recovering'


async def test_cancelled_committed_transition_retries_same_fence(ownership, monkeypatch):
    _, store, a, _ = ownership
    lease = await acquire(store, a)
    original = store.quarantine
    entered = asyncio.Event()
    async def blocked(*args):
        await original(*args)
        entered.set()
        await asyncio.Event().wait()
    policy = RoomFailurePolicy(store, a, retry_base=.001, retry_max=.001)
    policy.schedule(lease.fence, 'CheckpointError')
    with monkeypatch.context() as patch:
        patch.setattr(store, 'quarantine', blocked)
        task = asyncio.create_task(policy.sweep_once())
        await asyncio.wait_for(entered.wait(), 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
    await asyncio.sleep(.002)
    await policy.sweep_once()
    assert policy.results[-1].status == 'quarantined' and policy.results[-1].attempts == 2


async def test_policy_bounds_and_retryable_failure_classification(ownership):
    _, store, a, _ = ownership
    lease = await acquire(store, a)
    policy = RoomFailurePolicy(store, a, max_pending=1, workers=1)
    for error in ('OperationalError', 'SerializationFailure', 'TimeoutError', 'StaleGameOwner',
                  'CancelledError', 'InboxCapacityExceeded'):
        assert not policy.schedule(lease.fence, error)
    assert policy.schedule(lease.fence, 'CheckpointError')
    assert policy.schedule(lease.fence, 'CheckpointError')
    assert not policy.schedule(replace(lease.fence, room_id='other'), 'CheckpointError')
    assert policy.results[-1].status == 'busy'
    await policy.sweep_once()
    assert policy.results[-1].status == 'quarantined'


async def test_runtime_quarantines_unsupported_command_without_consuming_it(database):
    pool, _, _, users = database
    runtime, fence = await start(database)
    try:
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='not-implemented', payload={})
        await runtime.inbox.enqueue(lane, users[0], body)
        async def quarantined(): return (await runtime.ownership.inspect('room')).status == 'quarantined'
        await until(quarantined)
        assert not runtime.admits(fence)
        assert (await runtime.inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
        assert await runtime.ownership.routing_hint('room') is None
    finally:
        await runtime.stop()


async def test_runtime_quarantines_failed_recovery_before_activation(database):
    pool, _, _, users = database
    from test_game_lane_executor import setup_game
    host, game, *_ = await setup_game(database)
    await rows(pool, "UPDATE table_recovery_state SET state=jsonb_set(state,'{digest}','\"broken\"')")
    await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    runtime = RoomExecutionRuntime(pool, 'http://recovery')
    await runtime.start()
    try:
        prepared = await runtime.prepare('room', expected_epoch=1)
        assert prepared.status == 'invalid'
        assert not runtime.admits(prepared.fence)
        assert (await runtime.ownership.inspect('room')).status == 'quarantined'
        assert (await rows(pool, "SELECT state->>'digest' FROM table_recovery_state")) == [('broken',)]
    finally:
        await runtime.stop()
        await host.close()


async def test_runtime_exhausted_transient_subclass_does_not_quarantine(database, monkeypatch):
    class ConnectionLost(OperationalError): pass
    _, _, _, users = database
    runtime, fence = await start(database, max_retries=0)
    async def down(*args): raise ConnectionLost('private details')
    monkeypatch.setattr(runtime.executors['room'], 'execute_one', down)
    try:
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        await runtime.inbox.enqueue(lane, users[0], dict(command_id=uuid4().hex, command='create-table', payload={}))
        async def closed(): return not runtime.admits(fence)
        await until(closed)
        await runtime.failure_policy.sweep_once()
        assert (await runtime.ownership.inspect('room')).status == 'serving'
        assert not runtime.failure_policy.results
    finally:
        await runtime.stop()


async def test_activation_failure_quarantines_pending_unsupported_work(database):
    pool, _, _, users = database
    await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    runtime = RoomExecutionRuntime(pool, 'http://activation', scan_interval=.02)
    await runtime.start()
    try:
        prepared = await runtime.prepare('room', expected_epoch=1)
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='future-command', payload={})
        await runtime.inbox.enqueue(lane, users[0], body)
        with pytest.raises(UnsupportedRecoveryWork): await runtime.activate(prepared)
        async def quarantined(): return (await runtime.ownership.inspect('room')).status == 'quarantined'
        await until(quarantined)
        assert not runtime.admits(prepared.fence)
        assert (await runtime.inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
    finally:
        await runtime.stop()


async def test_permanent_maintenance_failure_quarantines_room(database, monkeypatch):
    async def invalid(*args, **kwargs): raise ValueError('invalid settlement work')
    monkeypatch.setattr(MatchFinalizationWorker, 'pending', invalid)
    runtime, fence = await start(database)
    try:
        async def quarantined(): return (await runtime.ownership.inspect('room')).status == 'quarantined'
        await until(quarantined)
        assert not runtime.admits(fence)
    finally:
        await runtime.stop()


async def test_policy_worker_bound_and_overlapping_sweeps():
    registration = InstanceRegistration.new()
    entered, release = asyncio.Event(), asyncio.Event()
    active = peak = calls = 0
    class Store:
        async def quarantine(self, registration, fence):
            nonlocal active, peak, calls
            active += 1
            calls += 1
            peak = max(peak, active)
            if active == 2: entered.set()
            try:
                await release.wait()
            finally:
                active -= 1
    policy = RoomFailurePolicy(Store(), registration, max_pending=3, workers=2)
    for room in ('one', 'two', 'three'):
        policy.schedule(RoomWriteFence(room, registration.instance_id, 1, 'secret'), 'CheckpointError')
    first = asyncio.create_task(policy.sweep_once())
    second = asyncio.create_task(policy.sweep_once())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        assert active == peak == 2
        release.set()
        await asyncio.gather(first, second)
        assert calls == 3 and peak == 2
        assert all(result.status == 'quarantined' for result in policy.results)
    finally:
        release.set()
        await asyncio.gather(first, second, return_exceptions=True)


async def test_policy_timeout_is_uncertain_not_confirmed_quarantine():
    registration = InstanceRegistration.new()
    class Store:
        async def quarantine(self, *args): await asyncio.Event().wait()
    policy = RoomFailurePolicy(Store(), registration, max_attempts=1, timeout=.01)
    policy.schedule(RoomWriteFence('room', registration.instance_id, 1, 'secret'), 'CheckpointError')
    await policy.sweep_once()
    assert policy.results[-1].status == 'uncertain'
    assert policy.results[-1].error_type == 'TimeoutError'
