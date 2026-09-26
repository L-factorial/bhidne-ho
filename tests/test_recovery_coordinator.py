"""Recovery orchestration bounds, failure classification, and exact-owner cleanup."""
import asyncio
from dataclasses import replace
from types import SimpleNamespace

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import CheckpointError
from app.durable_games.coordination import RoomLeaseCoordinator
from app.durable_games.recovery_coordinator import RoomRecoveryCoordinator
from app.durable_games.room_recovery import RecoveryLimitExceeded, UnsupportedRecoveryWork
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from test_room_coordination import Store


class Loader:
    def __init__(self, errors=()):
        self.errors = iter(errors)
        self.calls = 0

    async def load(self, fence, host):
        self.calls += 1
        error = next(self.errors, None)
        if error:
            raise error
        return SimpleNamespace(fence=fence, private_state='never in result repr')


@pytest.fixture
async def context():
    store = Store()
    leases = RoomLeaseCoordinator(store, 'one')
    await leases.start()
    try:
        yield store, leases
    finally:
        await leases.stop()


async def test_transient_retry_preserves_acquisition_and_success_stays_recovering(context):
    store, leases = context
    loader = Loader([OperationalError('private SQL parameters')])
    runner = RoomRecoveryCoordinator(leases, loader, retry_base=.001)
    result = await runner.prepare('room', expected_epoch=0, host=None)
    assert result.status == 'prepared' and result.attempts == 2 and loader.calls == 2
    assert len(store.intents) == 1
    assert leases.confirms(result.fence, status='recovering') and not leases.admits(result.fence)
    assert 'private_state' not in repr(result)
    assert runner.discard(result) and not leases.confirms(result.fence, status='recovering')


@pytest.mark.parametrize(('error', 'status'), [
    (UnsupportedRecoveryWork('unsupported codec'), 'unsupported'),
    (RecoveryLimitExceeded('limit'), 'budget_exceeded'),
    (CheckpointError('private cards'), 'invalid'),
    (StaleGameOwner('lost'), 'ownership_lost'),
    (DurableGameConflict('changed'), 'conflict'),
    (ValueError('programming error'), 'failed'),
])
async def test_permanent_failures_do_not_retry_or_quarantine(context, error, status):
    store, leases = context
    loader = Loader([error])
    result = await RoomRecoveryCoordinator(leases, loader).prepare('room', expected_epoch=0, host=None)
    assert result.status == status and result.attempts == loader.calls == 1
    assert result.error_type == type(error).__name__ and result.inventory is None
    assert not leases.confirms(result.fence, status='recovering')
    assert store.leases['room'].status == 'recovering'  # No speculative quarantine/activation.
    assert 'private cards' not in repr(result)


async def test_transient_exhaustion_abandons_known_lease(context):
    _, leases = context
    loader = Loader([OperationalError('offline')] * 3)
    result = await RoomRecoveryCoordinator(leases, loader, max_attempts=2, retry_base=.001).prepare(
        'room', expected_epoch=0, host=None)
    assert result.status == 'retryable' and result.attempts == loader.calls == 2
    assert not result.retry_same_intent and not leases.confirms(result.fence, status='recovering')


async def test_unknown_acquisition_retains_intent_across_separate_preparations(context):
    store, leases = context
    loader = Loader()
    runner = RoomRecoveryCoordinator(leases, loader, max_attempts=1)
    store.acquire_error = OperationalError('commit response lost')
    result = await runner.prepare('room', expected_epoch=0, host=None)
    assert result.status == 'retryable' and result.retry_same_intent and result.fence is None
    assert loader.calls == 0
    store.acquire_error = None
    result = await runner.prepare('room', expected_epoch=0, host=None)
    assert result.status == 'prepared' and store.intents[0] == store.intents[1]


async def test_bounded_admission_and_same_room_overlap_without_queue(context):
    _, leases = context
    entered, finish = asyncio.Event(), asyncio.Event()
    class Waiting:
        async def load(self, fence, host):
            entered.set()
            await finish.wait()
            return SimpleNamespace(fence=fence)
    runner = RoomRecoveryCoordinator(leases, Waiting(), max_inflight=1)
    task = asyncio.create_task(runner.prepare('room', expected_epoch=0, host=None))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        for room in ('room', 'other'):
            result = await runner.prepare(room, expected_epoch=0, host=None)
            assert result.status == 'busy' and result.attempts == 0
        finish.set()
        assert (await task).status == 'prepared'
        assert (await runner.prepare('other', expected_epoch=0, host=None)).status == 'prepared'
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_timeout_rolls_back_loader_then_releases_local_ownership(context):
    store, leases = context
    cancelled = []
    class Waiting:
        async def load(self, fence, host):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(fence)
    runner = RoomRecoveryCoordinator(leases, Waiting(), attempt_timeout=.01, max_attempts=2, retry_base=.001)
    result = await runner.prepare('room', expected_epoch=0, host=None)
    assert result.status == 'retryable' and result.error_type == 'TimeoutError'
    assert len(cancelled) == 2 and len(store.intents) == 1
    assert not leases.confirms(result.fence, status='recovering')


async def test_cancellation_cleans_up_and_frees_capacity(context):
    store, leases = context
    entered = asyncio.Event()
    class Waiting:
        async def load(self, fence, host):
            entered.set()
            await asyncio.Event().wait()
    runner = RoomRecoveryCoordinator(leases, Waiting(), max_inflight=1)
    task = asyncio.create_task(runner.prepare('room', expected_epoch=0, host=None))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert not leases.confirms(store.leases['room'].fence, status='recovering')
    runner.recovery = Loader()
    assert (await runner.prepare('other', expected_epoch=0, host=None)).status == 'prepared'


async def test_heartbeat_loss_during_load_discards_inventory(context):
    store, leases = context
    class Losing:
        async def load(self, fence, host):
            store.heartbeat_error = OperationalError('offline')
            with pytest.raises(OperationalError): await leases.heartbeat_once()
            store.heartbeat_error = None
            await leases.heartbeat_once()
            return SimpleNamespace(fence=fence)
    result = await RoomRecoveryCoordinator(leases, Losing()).prepare('room', expected_epoch=0, host=None)
    assert result.status == 'ownership_lost' and result.inventory is None


async def test_old_failure_cleanup_cannot_abandon_replacement(context):
    store, leases = context
    class Replacing:
        async def load(self, fence, host):
            leases.abandon('room')
            del store.leases['room']  # Fake an expired/released lease for replacement.
            replacement = await leases.acquire('room', expected_epoch=fence.epoch)
            assert replacement.fence != fence
            raise CheckpointError('Old recovery failed')
    result = await RoomRecoveryCoordinator(leases, Replacing()).prepare('room', expected_epoch=0, host=None)
    replacement = store.leases['room'].fence
    assert result.status == 'invalid' and leases.confirms(replacement, status='recovering')
    assert not leases.abandon_fence(result.fence)


async def test_lease_maintenance_progresses_during_slow_reconstruction():
    store = Store()
    leases = RoomLeaseCoordinator(store, 'one', interval=.005)
    await leases.start()
    class Slow:
        async def load(self, fence, host):
            before = len(store.renewals)
            async with asyncio.timeout(1):
                while len(store.renewals) <= before:
                    await asyncio.sleep(.005)
            return SimpleNamespace(fence=fence)
    try:
        result = await RoomRecoveryCoordinator(leases, Slow()).prepare('room', expected_epoch=0, host=None)
        assert result.status == 'prepared' and store.heartbeats > 1
    finally:
        await leases.stop()


def test_invalid_bounds():
    for args in ({'max_inflight': 0}, {'max_attempts': 0}, {'max_attempts': 11},
                 {'attempt_timeout': float('nan')}, {'retry_base': 0}, {'retry_max': .01}):
        with pytest.raises(ValueError): RoomRecoveryCoordinator(None, None, **args)


async def test_recovery_request_does_not_displace_an_already_serving_room(context):
    store, leases = context
    lease = await leases.acquire('room', expected_epoch=0)
    async def transition(registration, fence):
        store.leases['room'] = replace(lease, status='serving')
        return store.leases['room']
    await leases.activate(lease.fence, transition)
    loader = Loader()
    runner = RoomRecoveryCoordinator(leases, loader)
    result = await runner.prepare('room', expected_epoch=0, host=None)
    assert result.status == 'conflict' and loader.calls == 0
    assert not runner.discard(result)
    assert leases.admits(lease.fence)
