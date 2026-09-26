"""Demand-driven placement uses real recovery and never steals live ownership."""
import asyncio
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.inbox import LaneTarget
from app.durable_games.placement import RoomOwnerCoordinator
from app.durable_games.room_runtime import RoomExecutionRuntime
from test_checkpoint_store import database
from test_room_runtime import rows, outcome


async def runtime_for(database, **kwargs):
    pool, _, _, _ = database
    runtime = RoomExecutionRuntime(pool, 'http://placement', scan_interval=.02, **kwargs)
    await runtime.start()
    return runtime


async def expire(pool):
    await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")


@pytest.mark.parametrize('unowned', [False, True])
async def test_select_recover_activate_and_resume_pending_command(database, unowned):
    pool, _, _, users = database
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime, cooldown=.001)
    try:
        await expire(pool)
        if unowned:
            await rows(pool, 'DELETE FROM room_ownership')
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type': 'marriage', 'capacity': 2})
        await runtime.inbox.enqueue(lane, users[0], body)
        result = await coordinator.ensure_owner('room')
        assert result.status == 'serving' and result.epoch == (1 if unowned else 2)
        assert (await outcome(runtime.inbox, lane, users[0], body))['status'] == 'accepted'
        assert (await coordinator.ensure_owner('room')).epoch == result.epoch
        assert (await coordinator.ensure_owner('missing')).status == 'not_found'
    finally:
        await runtime.stop()


@pytest.mark.parametrize('status', ['serving', 'recovering', 'draining', 'quarantined'])
async def test_live_owner_or_quarantine_never_stolen(database, status):
    pool, _, _, _ = database
    runtime = await runtime_for(database)
    try:
        await rows(pool, 'UPDATE room_ownership SET runtime_status=%s', (status,))
        if status == 'quarantined': await expire(pool)
        result = await RoomOwnerCoordinator(runtime).ensure_owner('room')
        assert result.status == ('quarantined' if status == 'quarantined' else 'owned')
        assert (await runtime.ownership.inspect('room')).epoch == 1
    finally:
        await runtime.stop()


async def test_two_servers_select_same_owner_then_winner_activates(database):
    pool, _, _, _ = database
    first, second = await runtime_for(database), await runtime_for(database)
    try:
        await expire(pool)
        # Request on the non-selected server first, so selection cannot be hidden
        # by an already live owner. Both use the same deterministic ranking.
        import hashlib
        runtimes = [first, second]
        runtimes.sort(key=lambda r: hashlib.sha256(('room\0'+r.leases.registration.instance_id).encode()).digest())
        winner, other = runtimes
        result = await RoomOwnerCoordinator(other).ensure_owner('room')
        assert result.status == 'selected_remote' and result.instance_id == winner.leases.registration.instance_id
        assert (await RoomOwnerCoordinator(winner).ensure_owner('room')).status == 'serving'
        assert (await RoomOwnerCoordinator(other).ensure_owner('room')).status == 'owned'
    finally:
        await first.stop()
        await second.stop()


async def test_capacity_is_enforced_by_acquisition_not_only_selection(database):
    pool, _, _, _ = database
    runtime = await runtime_for(database, max_rooms=1, maintenance_workers=1)
    try:
        await expire(pool)
        await rows(pool, "INSERT INTO rooms(id,creator_id,name,visibility) SELECT 'other',creator_id,'Other','private' FROM rooms WHERE id='room'")
        coordinator = RoomOwnerCoordinator(runtime)
        assert (await coordinator.ensure_owner('room')).status == 'serving'
        assert (await coordinator.ensure_owner('other')).status == 'no_capacity'
        from app.durable_games.store import DurableGameConflict
        with pytest.raises(DurableGameConflict, match='capacity'):
            await runtime.ownership.acquire('other', runtime.leases.registration, expected_epoch=0, token='x'*32)
    finally:
        await runtime.stop()


async def test_lost_acquisition_response_retains_intent_and_epoch(database, monkeypatch):
    pool, _, _, _ = database
    runtime = await runtime_for(database, max_rooms=1, maintenance_workers=1)
    coordinator = RoomOwnerCoordinator(runtime, cooldown=.001)
    runtime.recovery.max_attempts = 1
    original = runtime.ownership.acquire
    async def lost(*args, **kwargs):
        await original(*args, **kwargs)
        raise OperationalError('lost response')
    try:
        await expire(pool)
        with monkeypatch.context() as patch:
            patch.setattr(runtime.ownership, 'acquire', lost)
            assert (await coordinator.ensure_owner('room')).status == 'retryable'
        assert runtime.leases.placement_intent('room') == (1, False)
        await asyncio.sleep(.002)
        result = await coordinator.ensure_owner('room')
        assert result.status == 'serving' and result.epoch == 2
    finally:
        await runtime.stop()


async def test_expired_failed_local_owner_can_be_reacquired(database):
    pool, _, _, _ = database
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime, cooldown=.001)
    try:
        await expire(pool)
        assert (await coordinator.ensure_owner('room')).epoch == 2
        fence = runtime.admitted_fence('room')
        runtime._lose_room(fence, 'test', 'OperationalError')
        await expire(pool)
        await asyncio.sleep(.002)
        result = await coordinator.ensure_owner('room')
        assert result.status == 'serving' and result.epoch == 3
    finally:
        await runtime.stop()


async def test_bounded_lookup_coalescing_and_drained_runtime(database, monkeypatch):
    pool, _, _, _ = database
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime, max_inflight=1)
    entered, finish = asyncio.Event(), asyncio.Event()
    original = runtime.ownership.inspect
    async def blocked(*args):
        entered.set()
        await finish.wait()
        return await original(*args)
    monkeypatch.setattr(runtime.ownership, 'inspect', blocked)
    task = asyncio.create_task(coordinator.ensure_owner('room'))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        assert (await coordinator.ensure_owner('room')).status == 'busy'
        assert (await coordinator.ensure_owner('other')).status == 'busy'
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert (await coordinator.ensure_owner('room')).status == 'backoff'
        await runtime.drain_and_stop()
        assert (await coordinator.ensure_owner('other')).status == 'unavailable'
    finally:
        finish.set()
        await asyncio.gather(task, return_exceptions=True)
        await runtime.stop()


async def test_registry_limit_and_incompatible_servers_fail_closed(database, monkeypatch):
    pool, _, _, _ = database
    runtime = await runtime_for(database)
    try:
        await expire(pool)
        assert (await RoomOwnerCoordinator(runtime, max_candidates=1).ensure_owner('room')).status == 'candidate_limit'
        async def incompatible(**kwargs): return [('old', 'http://old', {'room_capacity': 10}, 0)]
        monkeypatch.setattr(runtime.ownership, 'placement_candidates', incompatible)
        assert (await RoomOwnerCoordinator(runtime).ensure_owner('room')).status == 'no_capacity'
        assert (await runtime.ownership.inspect('room')).epoch == 1
    finally:
        await runtime.stop()


async def test_cancelled_unknown_acquisition_preserves_original_intent(database, monkeypatch):
    pool, _, _, _ = database
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime, cooldown=.001)
    original = runtime.ownership.acquire
    entered = asyncio.Event()
    async def blocked(*args, **kwargs):
        await original(*args, **kwargs)
        entered.set()
        await asyncio.Event().wait()
    task = None
    try:
        await expire(pool)
        with monkeypatch.context() as patch:
            patch.setattr(runtime.ownership, 'acquire', blocked)
            task = asyncio.create_task(coordinator.ensure_owner('room'))
            await asyncio.wait_for(entered.wait(), 3)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        assert runtime.leases.placement_intent('room') == (1, False)
        await asyncio.sleep(.002)
        assert (await coordinator.ensure_owner('room')).epoch == 2
    finally:
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await runtime.stop()


async def test_failed_recovery_is_quarantined_instead_of_served(database):
    from test_game_lane_executor import setup_game
    pool, _, _, _ = database
    host, *_ = await setup_game(database)
    runtime = await runtime_for(database)
    try:
        await rows(pool, "UPDATE table_recovery_state SET state=jsonb_set(state,'{digest}','\"broken\"')")
        await expire(pool)
        assert (await RoomOwnerCoordinator(runtime).ensure_owner('room')).status == 'invalid'
        assert (await RoomOwnerCoordinator(runtime).ensure_owner('room')).status == 'quarantined'
        assert runtime.admitted_fence('room') is None
    finally:
        await runtime.stop()
        await host.close()
