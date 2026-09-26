"""Lease coordination failure boundaries; SQL ownership is tested separately."""
import asyncio
from dataclasses import replace
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.coordination import RoomLeaseCoordinator, OwnershipGuardedExecutor
from app.durable_games.ownership import RoomLease, RoomWriteFence
from app.durable_games.scheduler import GameLaneScheduler
from app.durable_games.store import StaleGameOwner


class Clock:
    now = 100.0

    def __call__(self):
        return self.now


class Store:
    heartbeat_ttl = 30

    def __init__(self):
        self.leases = {}
        self.intents = []
        self.renewals = []
        self.heartbeats = 0
        self.heartbeat_error = None
        self.renew_error = None
        self.acquire_error = None
        self.draining = False

    async def register(self, registration, address, *, capabilities):
        self.registration = registration

    async def heartbeat(self, registration):
        self.heartbeats += 1
        if self.heartbeat_error:
            raise self.heartbeat_error

    async def acquire(self, room, registration, *, expected_epoch, token, lease_seconds):
        self.intents.append((room, expected_epoch, token))
        if room not in self.leases:
            self.leases[room] = RoomLease(RoomWriteFence(room, registration.instance_id, expected_epoch + 1, token),
                                          datetime.now(timezone.utc), 'recovering')
        if self.acquire_error:
            raise self.acquire_error
        return self.leases[room]

    async def renew(self, registration, fence, *, lease_seconds):
        self.renewals.append(fence.room_id)
        if self.renew_error:
            raise self.renew_error
        return self.leases[fence.room_id]

    async def drain_instance(self, registration):
        self.draining = True


async def serving(coordinator, store, room='room'):
    lease = await coordinator.acquire(room, expected_epoch=0)
    assert not coordinator.admits(lease.fence)
    # Only the forthcoming recovery coordinator may make this DB transition.
    async def transition(registration, fence):
        store.leases[room] = replace(lease, status='serving')
        return store.leases[room]
    await coordinator.activate(lease.fence, transition)
    assert coordinator.admits(lease.fence)
    return lease.fence


async def test_recovery_gate_and_permanent_loss_after_uncertain_renewal():
    store, clock = Store(), Clock()
    coordinator = RoomLeaseCoordinator(store, 'one', clock=clock)
    await coordinator.start()
    try:
        fence = await serving(coordinator, store)
        assert not coordinator.admits(replace(fence, epoch=fence.epoch + 1))
        store.renew_error = OperationalError('private SQL parameters')
        await coordinator.renew_once()
        assert not coordinator.admits(fence)
        store.renew_error = None
        await coordinator.heartbeat_once()
        await coordinator.renew_once()
        assert not coordinator.admits(fence)
        assert coordinator.failures[-1].error_type == 'OperationalError'
        assert 'private' not in repr(coordinator.failures)
        with pytest.raises(StaleGameOwner):
            await coordinator.acquire('room', expected_epoch=0)
    finally:
        await coordinator.stop()


async def test_unknown_acquisition_response_retains_token_and_epoch():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one')
    await coordinator.start()
    try:
        store.acquire_error = OperationalError('response lost after commit')
        with pytest.raises(OperationalError):
            await coordinator.acquire('room', expected_epoch=0)
        assert not coordinator.admits(store.leases['room'].fence)
        with pytest.raises(ValueError):
            await coordinator.acquire('room', expected_epoch=1)
        store.acquire_error = None
        lease = await coordinator.acquire('room', expected_epoch=0)
        assert store.intents[0] == store.intents[1]
        assert lease.fence.epoch == 1
        assert store.renewals == ['room']  # Retry establishes fresh expiry confirmation.
    finally:
        await coordinator.stop()


@pytest.mark.parametrize('pause', [False, True])
async def test_heartbeat_failure_or_long_pause_revokes_every_room(pause):
    store, clock = Store(), Clock()
    coordinator = RoomLeaseCoordinator(store, 'one', clock=clock)
    await coordinator.start()
    try:
        fences = [await serving(coordinator, store, room) for room in ('a', 'b')]
        if pause:
            clock.now += 31
            await coordinator.heartbeat_once()
        else:
            store.heartbeat_error = OperationalError('offline')
            with pytest.raises(OperationalError): await coordinator.heartbeat_once()
            store.heartbeat_error = None
            await coordinator.heartbeat_once()
        await coordinator.renew_once()
        assert all(not coordinator.admits(fence) for fence in fences)
        # A fresh heartbeat permits new recovery, never resurrects cached ownership.
        new = await coordinator.acquire('new', expected_epoch=0)
        assert new.status == 'recovering'
    finally:
        await coordinator.stop()


async def test_local_lease_deadline_is_not_extended_by_late_renewal_response():
    store, clock = Store(), Clock()
    coordinator = RoomLeaseCoordinator(store, 'one', clock=clock)
    await coordinator.start()
    try:
        fence = await serving(coordinator, store)
        clock.now += 25
        await coordinator.heartbeat_once()
        original = store.renew
        async def late(*args, **kwargs):
            result = await original(*args, **kwargs)
            clock.now += 5
            return result
        store.renew = late
        await coordinator.renew_once()
        assert not coordinator.admits(fence)
    finally:
        await coordinator.stop()


async def test_renewals_are_bounded_and_one_slow_room_does_not_block_another():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one', renewal_workers=2, max_rooms=2, operation_timeout=.03)
    await coordinator.start()
    try:
        a, b = [await serving(coordinator, store, room) for room in ('a', 'b')]
        with pytest.raises(RuntimeError, match='capacity'):
            await coordinator.acquire('c', expected_epoch=0)
        original = store.renew
        entered, progressed = asyncio.Event(), asyncio.Event()
        async def blocked(registration, fence, **kwargs):
            if fence.room_id == 'a':
                entered.set()
                await asyncio.Event().wait()
            await entered.wait()
            progressed.set()
            return await original(registration, fence, **kwargs)
        store.renew = blocked
        await coordinator.renew_once()
        assert progressed.is_set()
        assert not coordinator.admits(a) and coordinator.admits(b)
        assert coordinator.failures[-1].error_type == 'TimeoutError'
    finally:
        await coordinator.stop()


async def test_drain_blocks_new_work_but_maintains_lease_until_stop():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one')
    await coordinator.start()
    fence = await serving(coordinator, store)
    await coordinator.drain()
    assert store.draining and not coordinator.admits(fence)
    with pytest.raises(StaleGameOwner): await coordinator.acquire('other', expected_epoch=0)
    before = len(store.renewals)
    await coordinator.renew_once()
    assert len(store.renewals) == before + 1
    await coordinator.stop()
    assert not coordinator.admits(fence) and not coordinator._tasks
    with pytest.raises(RuntimeError): await coordinator.start()


async def test_guard_rechecks_queued_work_after_ownership_becomes_uncertain():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one')
    await coordinator.start()
    fence = await serving(coordinator, store)
    entered, finish = asyncio.Event(), asyncio.Event()
    calls = []
    class Executor:
        async def execute_one(self, lane, fence):
            calls.append(lane)
            entered.set()
            await finish.wait()
            return True
    scheduler = GameLaneScheduler(OwnershipGuardedExecutor(coordinator, Executor()), workers=1)
    scheduler.start()
    try:
        first, second = uuid4(), uuid4()
        scheduler.offer(first, fence)
        scheduler.offer(second, fence)
        await asyncio.wait_for(entered.wait(), 1)
        store.heartbeat_error = OperationalError('offline')
        with pytest.raises(OperationalError): await coordinator.heartbeat_once()
        finish.set()
        await asyncio.wait_for(scheduler.wait_idle(), 1)
        assert calls == [first]
        assert all(f.error_type == 'StaleGameOwner' and not f.retrying for f in scheduler.failures)
    finally:
        await scheduler.stop()
        await coordinator.stop()


async def test_background_tasks_maintain_idle_rooms_and_stop_cleanly():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one', interval=.005)
    await coordinator.start()
    await coordinator.acquire('room', expected_epoch=0)
    try:
        async with asyncio.timeout(1):
            while store.heartbeats < 3 or len(store.renewals) < 3:
                await asyncio.sleep(.005)
    finally:
        await coordinator.stop()
    counts = store.heartbeats, len(store.renewals)
    await asyncio.sleep(.02)
    assert counts == (store.heartbeats, len(store.renewals))


def test_invalid_bounds():
    for args in ({'max_rooms': 0}, {'renewal_workers': 0}, {'lease_seconds': 3},
                 {'interval': float('nan')}, {'operation_timeout': 0}, {'safety_margin': 25}):
        with pytest.raises(ValueError): RoomLeaseCoordinator(Store(), 'one', **args)


async def test_cancelled_acquisition_retry_preserves_committed_intent():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one')
    await coordinator.start()
    committed = asyncio.Event()
    original = store.acquire
    async def lost(*args, **kwargs):
        await original(*args, **kwargs)
        committed.set()
        await asyncio.Event().wait()
    store.acquire = lost
    attempt = asyncio.create_task(coordinator.acquire('room', expected_epoch=0))
    try:
        await asyncio.wait_for(committed.wait(), 1)
        attempt.cancel()
        with pytest.raises(asyncio.CancelledError): await attempt
        store.acquire = original
        lease = await coordinator.acquire('room', expected_epoch=0)
        assert store.intents[0] == store.intents[1]
        assert lease.fence == store.leases['room'].fence
    finally:
        attempt.cancel()
        await coordinator.stop()


async def test_concurrent_acquisition_coalesces_and_abandon_blocks_late_result():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one')
    await coordinator.start()
    entered, finish = asyncio.Event(), asyncio.Event()
    original = store.acquire
    async def delayed(*args, **kwargs):
        entered.set()
        await finish.wait()
        return await original(*args, **kwargs)
    store.acquire = delayed
    a = asyncio.create_task(coordinator.acquire('room', expected_epoch=0))
    b = asyncio.create_task(coordinator.acquire('room', expected_epoch=0))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        finish.set()
        assert await a == await b
        assert len(store.intents) == 1
        entered.clear()
        finish.clear()
        c = asyncio.create_task(coordinator.acquire('other', expected_epoch=0))
        await asyncio.wait_for(entered.wait(), 1)
        coordinator.abandon('other')
        finish.set()
        with pytest.raises(StaleGameOwner): await c
        assert not coordinator.admits(store.leases['other'].fence)
    finally:
        finish.set()
        await coordinator.stop()


async def test_heartbeat_gap_during_successful_response_still_revokes_rooms():
    store, clock = Store(), Clock()
    coordinator = RoomLeaseCoordinator(store, 'one', clock=clock)
    await coordinator.start()
    try:
        fence = await serving(coordinator, store)
        clock.now += 27
        original = store.heartbeat
        async def paused(*args):
            await original(*args)
            clock.now += 3
        store.heartbeat = paused
        await coordinator.heartbeat_once()
        assert not coordinator.admits(fence)
    finally:
        await coordinator.stop()


async def test_stop_while_acquisition_is_in_flight_never_admits_late_result():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one')
    await coordinator.start()
    entered, finish = asyncio.Event(), asyncio.Event()
    original = store.acquire
    async def delayed(*args, **kwargs):
        lease = await original(*args, **kwargs)
        entered.set()
        await finish.wait()
        return lease
    store.acquire = delayed
    attempt = asyncio.create_task(coordinator.acquire('room', expected_epoch=0))
    await asyncio.wait_for(entered.wait(), 1)
    await coordinator.stop()
    finish.set()
    with pytest.raises(StaleGameOwner): await attempt
    assert not coordinator.admits(store.leases['room'].fence)


async def test_failed_drain_remains_locally_closed_and_retry_is_safe():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one')
    await coordinator.start()
    try:
        fence = await serving(coordinator, store)
        original = store.drain_instance
        async def lost(*args):
            await original(*args)
            raise OperationalError('response lost')
        store.drain_instance = lost
        with pytest.raises(OperationalError): await coordinator.drain()
        assert not coordinator.admits(fence)
        store.drain_instance = original
        await coordinator.drain()
        assert store.draining and not coordinator.admits(fence)
    finally:
        await coordinator.stop()


async def test_overlapping_maintenance_calls_share_the_worker_bound():
    store = Store()
    coordinator = RoomLeaseCoordinator(store, 'one', renewal_workers=1)
    await coordinator.start()
    try:
        await serving(coordinator, store, 'a')
        await serving(coordinator, store, 'b')
        original = store.renew
        active, peak = 0, 0
        async def concurrent(*args, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            try:
                await asyncio.sleep(.005)
                return await original(*args, **kwargs)
            finally:
                active -= 1
        store.renew = concurrent
        await asyncio.gather(coordinator.renew_once(), coordinator.renew_once())
        assert peak == 1
    finally:
        await coordinator.stop()
