"""Discovery reconstructs placement demand from durable work, without new ingress."""
import asyncio
import hashlib
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.discovery import (
    PlacementDemand, PlacementDemandReceiver, PostgresPlacementDemandStore, RoomPlacementDiscovery,
)
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.placement import PlacementResult, RoomOwnerCoordinator
from test_checkpoint_store import database
from test_room_placement import runtime_for, expire
from test_room_runtime import rows, until, outcome


async def enqueue(pool, users, room_id='room', kind='room'):
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind=kind, room_id=room_id))
    body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type': 'marriage', 'capacity': 2})
    await inbox.enqueue(lane, users[0], body)
    return inbox, lane, body


async def test_background_discovery_recovers_pending_command_without_new_ingress(database):
    pool, _, _, users = database
    inbox, lane, body = await enqueue(pool, users)
    runtime = await runtime_for(database)
    scanner = RoomPlacementDiscovery(RoomOwnerCoordinator(runtime), interval=.01)
    try:
        await expire(pool)
        await scanner.start()
        assert (await outcome(inbox, lane, users[0], body))['status'] == 'accepted'
        assert runtime.admitted_fence('room').epoch == 2
        await scanner.stop()
        assert scanner._task.done()
        with pytest.raises(RuntimeError): await scanner.start()
    finally:
        await scanner.stop()
        await runtime.stop()


@pytest.mark.parametrize('status,expired', [('serving', False), ('recovering', False), ('draining', False), ('quarantined', True)])
async def test_live_owner_and_quarantine_excluded(database, status, expired):
    pool, _, _, users = database
    await enqueue(pool, users)
    await rows(pool, 'UPDATE room_ownership SET runtime_status=%s', (status,))
    if expired: await expire(pool)
    assert await PostgresPlacementDemandStore(pool).page(instance_id='different') == [('room', False)]


async def test_room_pages_advance_past_idle_rooms_and_failed_placement(database, monkeypatch):
    pool, _, _, users = database
    for name in ('a', 'b', 'c'):
        await rows(pool, "INSERT INTO rooms(id,creator_id,name,visibility) SELECT %s,creator_id,%s,'private' FROM rooms WHERE id='room'", (name, name))
    await enqueue(pool, users, 'a')
    await enqueue(pool, users, 'c')
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime)
    calls = []
    async def unavailable(room):
        calls.append(room)
        return PlacementResult(room, 'no_capacity')
    monkeypatch.setattr(coordinator, 'ensure_owner', unavailable)
    scanner = RoomPlacementDiscovery(coordinator, batch_size=1)
    try:
        for _ in range(6): await scanner.sweep_once()
        assert calls == ['a', 'c', 'a']
        assert scanner.cursor == 'a'
    finally:
        await scanner.stop()
        await runtime.stop()


@pytest.mark.parametrize('due', [False, True])
async def test_offer_timer_discovers_room_only_when_due(database, due):
    from test_offer_expiry import prepare
    pool, _, _, _ = database
    host, *_ = await prepare(database, due=due)
    try:
        await expire(pool)
        # Isolate timer demand from the completed game's settlement demand.
        await rows(pool, "UPDATE game_finalization_jobs SET next_attempt_at=clock_timestamp()+interval '1 day'")
        assert await PostgresPlacementDemandStore(pool).page(instance_id='new') == [('room', due)]
    finally:
        await host.close()


async def test_settlement_alone_is_discovered_and_completed(database):
    from test_flush_restart import finished
    pool, _, _, _ = database
    host, *_ = await finished(database)
    runtime = await runtime_for(database)
    scanner = RoomPlacementDiscovery(RoomOwnerCoordinator(runtime))
    try:
        await expire(pool)
        assert await scanner.store.page(instance_id='new') == [('room', True)]
        assert (await scanner.sweep_once())[0].placement.status == 'serving'
        async def settled():
            return (await rows(pool, 'SELECT completed_at IS NOT NULL FROM game_finalization_jobs')) == [(True,)]
        await until(settled)
    finally:
        await scanner.stop()
        await runtime.stop()
        await host.close()


async def test_active_durable_game_without_pending_commands_is_discovered(database):
    from test_game_lane_executor import setup_game
    pool, _, _, _ = database
    host, *_ = await setup_game(database)
    try:
        await expire(pool)
        assert await PostgresPlacementDemandStore(pool).page(instance_id='new') == [('room', True)]
    finally:
        await host.close()


async def test_idle_room_needs_no_owner_but_pending_chat_triggers_placement(database):
    pool, _, _, users = database
    await expire(pool)
    store = PostgresPlacementDemandStore(pool)
    assert await store.page(instance_id='new') == [('room', False)]
    await enqueue(pool, users, kind='room_chat')
    assert await store.page(instance_id='new') == [('room', True)]


async def test_remote_dispatch_revalidates_selected_boot_and_activates(database):
    pool, _, _, users = database
    inbox, lane, body = await enqueue(pool, users)
    first, second = await runtime_for(database), await runtime_for(database)
    ordered = sorted((first, second), key=lambda r: hashlib.sha256(('room\0'+r.leases.registration.instance_id).encode()).digest())
    winner, source = ordered
    receiver = PlacementDemandReceiver(RoomOwnerCoordinator(winner))
    received = []
    async def send(destination, demand):
        received.append(demand)
        assert set(vars(demand)) == {'room_id', 'instance_id'}
        return (await receiver.receive(demand)).status == 'serving'
    scanner = RoomPlacementDiscovery(RoomOwnerCoordinator(source), send_remote=send)
    try:
        await expire(pool)
        assert (await receiver.receive(PlacementDemand('room', 'wrong'))).status == 'wrong_instance'
        result, = await scanner.sweep_once()
        assert result.dispatch == 'signalled' and len(received) == 1
        assert (await outcome(inbox, lane, users[0], body))['status'] == 'accepted'
    finally:
        await scanner.stop()
        await first.stop()
        await second.stop()


async def test_unknown_acquisition_is_rediscovered_under_same_live_intent(database, monkeypatch):
    pool, _, _, users = database
    await enqueue(pool, users)
    runtime = await runtime_for(database)
    runtime.recovery.max_attempts = 1
    scanner = RoomPlacementDiscovery(RoomOwnerCoordinator(runtime, cooldown=.001))
    original = runtime.ownership.acquire
    async def lost(*args, **kwargs):
        await original(*args, **kwargs)
        raise OperationalError('lost acquire response')
    try:
        await expire(pool)
        with monkeypatch.context() as patch:
            patch.setattr(runtime.ownership, 'acquire', lost)
            assert (await scanner.sweep_once())[0].placement.status == 'retryable'
        assert (await runtime.ownership.inspect('room')).live
        await scanner.sweep_once()  # End of page sequence wraps cursor.
        await asyncio.sleep(.002)
        result, = await scanner.sweep_once()
        assert result.placement.status == 'serving' and result.placement.epoch == 2
    finally:
        await scanner.stop()
        await runtime.stop()


async def test_query_failure_and_cancelled_dispatch_preserve_cursor_and_work(database, monkeypatch):
    pool, _, _, users = database
    await enqueue(pool, users)
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime)
    entered = asyncio.Event()
    async def remote(room): return PlacementResult(room, 'selected_remote', 'other', 'http://other')
    async def blocked(*args):
        entered.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(coordinator, 'ensure_owner', remote)
    scanner = RoomPlacementDiscovery(coordinator, send_remote=blocked)
    async def down(**kwargs): raise OperationalError('private details')
    task = None
    try:
        await expire(pool)
        with monkeypatch.context() as patch:
            patch.setattr(scanner.store, 'page', down)
            with pytest.raises(OperationalError): await scanner.sweep_once()
        assert scanner.cursor == ''
        task = asyncio.create_task(scanner.sweep_once())
        await asyncio.wait_for(entered.wait(), 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert scanner.cursor == ''
        assert (await rows(pool, "SELECT status FROM command_inbox")) == [('pending',)]
    finally:
        if task: await asyncio.gather(task, return_exceptions=True)
        await scanner.stop()
        await runtime.stop()


async def test_background_scan_pauses_for_unhealthy_runtime_and_recovers(database, monkeypatch):
    pool, _, _, users = database
    inbox, lane, body = await enqueue(pool, users)
    runtime = await runtime_for(database)
    scanner = RoomPlacementDiscovery(RoomOwnerCoordinator(runtime), interval=.01)
    reads = 0
    original = scanner.store.page
    async def counted(**kwargs):
        nonlocal reads
        reads += 1
        return await original(**kwargs)
    monkeypatch.setattr(scanner.store, 'page', counted)
    try:
        await expire(pool)
        # Start is synchronous up to task creation; the loop first runs while
        # runtime health is unavailable, and must stay alive without DB scans.
        await scanner.start()
        with monkeypatch.context() as patch:
            patch.setattr(runtime, '_healthy', lambda: False)
            await asyncio.sleep(.04)
            assert reads == 0 and not scanner._task.done()
        assert (await outcome(inbox, lane, users[0], body))['status'] == 'accepted'
    finally:
        await scanner.stop()
        await runtime.stop()


@pytest.mark.parametrize('failure', ['refused', 'failed', 'timeout'])
async def test_remote_dispatch_failure_is_revisited_after_cursor_wrap(database, monkeypatch, failure):
    pool, _, _, users = database
    await enqueue(pool, users)
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime)
    async def remote(room): return PlacementResult(room, 'selected_remote', 'other', 'http://other')
    monkeypatch.setattr(coordinator, 'ensure_owner', remote)
    calls = 0
    async def send(*args):
        nonlocal calls
        calls += 1
        if failure == 'failed': raise OperationalError('private message')
        if failure == 'timeout': await asyncio.Event().wait()
        return False
    scanner = RoomPlacementDiscovery(coordinator, send_remote=send, timeout=.05)
    try:
        await expire(pool)
        assert (await scanner.sweep_once())[0].dispatch == failure
        assert await scanner.sweep_once() == ()
        assert (await scanner.sweep_once())[0].dispatch == failure
        assert calls == 2
        assert (await rows(pool, 'SELECT status FROM command_inbox')) == [('pending',)]
    finally:
        await scanner.stop()
        await runtime.stop()


async def test_cancelled_stop_joins_an_outstanding_manual_sweep(database, monkeypatch):
    pool, _, _, users = database
    await enqueue(pool, users)
    runtime = await runtime_for(database)
    coordinator = RoomOwnerCoordinator(runtime)
    entered, finish = asyncio.Event(), asyncio.Event()
    async def remote(room): return PlacementResult(room, 'selected_remote', 'other', 'http://other')
    async def send(*args):
        entered.set()
        await finish.wait()
        return True
    monkeypatch.setattr(coordinator, 'ensure_owner', remote)
    scanner = RoomPlacementDiscovery(coordinator, send_remote=send)
    scan = stop = None
    try:
        await expire(pool)
        scan = asyncio.create_task(scanner.sweep_once())
        await asyncio.wait_for(entered.wait(), 3)
        stop = asyncio.create_task(scanner.stop())
        await asyncio.sleep(0)
        stop.cancel()
        await asyncio.sleep(0)
        assert not stop.done()
        finish.set()
        await scan
        with pytest.raises(asyncio.CancelledError): await stop
        assert await scanner.sweep_once() == ()
    finally:
        finish.set()
        await asyncio.gather(*(t for t in (scan, stop) if t is not None), return_exceptions=True)
        await scanner.stop()
        await runtime.stop()
