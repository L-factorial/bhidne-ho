"""Explicit runtime resumes durable work and gates all executors on room readiness."""
import asyncio
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoint_store import user_uuid
from app.durable_games.executor import _DetachedHost
from app.durable_games.finalization import FlushFinalizationWorker
from app.durable_games.inbox import LaneTarget
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.room_runtime import RoomExecutionRuntime
from test_checkpoint_store import database
from test_game_lane_executor import setup_game, command
from test_offer_expiry import prepare as offer_room
from test_flush_restart import finished


async def rows(pool, sql, args=()):
    async with pool.connection() as connection:
        return (await connection.execute(sql, args)).rows


async def until(check):
    async with asyncio.timeout(8):
        while True:
            result = await check()
            if result: return result
            await asyncio.sleep(.01)


async def start(database, **options):
    pool, _, _, _ = database
    await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    runtime = RoomExecutionRuntime(pool, 'http://runtime:8000', scan_interval=.02,
        retry_base=.01, retry_max=.03, **options)
    await runtime.start()
    prepared = await runtime.prepare('room', expected_epoch=1)
    assert prepared.status == 'prepared', prepared
    lease = await runtime.activate(prepared)
    return runtime, lease.fence


async def outcome(inbox, lane, actor, body):
    async def check():
        entry = await inbox.lookup(lane, actor, body['command_id'])
        return entry.outcome if entry and entry.status != 'pending' else None
    return await until(check)


async def test_runtime_routes_creation_table_and_game_commands(database):
    pool, store, _, users = database
    runtime, fence = await start(database, batch_size=1)
    try:
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type': 'marriage', 'capacity': 2})
        await runtime.inbox.enqueue(lane, users[0], body)
        created = await outcome(runtime.inbox, lane, users[0], body)
        assert created['status'] == 'accepted'
        table_id = UUID(created['table_id'])
        table_lane = await runtime.inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=table_id))
        for name, actor in [('join-seat', users[1]), ('lock', users[0]), ('start', users[0])]:
            saved = await store.load(table_id)
            body = dict(command_id=uuid4().hex, command=name, payload={}, match_id=created['match_id'],
                        expected_revision=saved.checkpoint['data']['table_revision'])
            await runtime.inbox.enqueue(table_lane, actor, body)
            assert (await outcome(runtime.inbox, table_lane, actor, body))['status'] == 'accepted'
        saved = await store.load(table_id)
        detached = _DetachedHost(8)
        game = detached.game = rebuild_hosted_game(detached, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
        game_lane = await runtime.inbox.ensure_lane(LaneTarget(kind='game', room_id='room', table_id=table_id, game_id=game.durable_game_id))
        actor, body = command(game, 'FOLD')
        await runtime.inbox.enqueue(game_lane, actor, body)
        assert (await outcome(runtime.inbox, game_lane, actor, body))['status'] == 'accepted'
        assert runtime.admits(fence)
    finally:
        await runtime.stop()


async def test_runtime_dispatches_expiry_and_settlement_without_test_validators(database):
    pool, store, _, users = database
    host, game, inbox, lane = await offer_room(database)
    runtime = None
    try:
        runtime, fence = await start(database, batch_size=1)
        async def settled():
            return (await rows(pool, 'SELECT count(*) FROM game_finalization_jobs WHERE completed_at IS NULL')) == [(0,)]
        await until(settled)
        async def expired():
            data = (await store.load(game.table.table_id)).checkpoint['data']
            offers = data['table']['offers']
            return len(offers) == 2 and all(o['status'] == 'EXPIRED' for o in offers)
        await until(expired)
        assert runtime.admits(fence)
        assert (await rows(pool, "SELECT count(*) FROM command_inbox WHERE command='expire-seat-offer' AND status='accepted'")) == [(2,)]
    finally:
        if runtime: await runtime.stop()
        await host.close()


async def test_runtime_resumes_flush_round_finalization(database):
    pool, _, _, _ = database
    host, game, inbox, lane, *_ = await finished(database)
    runtime = None
    try:
        runtime, fence = await start(database)
        async def settled():
            return (await rows(pool, 'SELECT count(*) FROM ledger_games')) == [(1,)]
        await until(settled)
        assert (await rows(pool, 'SELECT completed_at IS NOT NULL FROM game_finalization_jobs')) == [(True,)]
        assert runtime.admits(fence)
    finally:
        if runtime: await runtime.stop()
        await host.close()


async def test_transient_lane_failure_retries_original_work(database, monkeypatch):
    pool, store, _, users = database
    host, game, inbox, lane, _ = await setup_game(database)
    runtime, fence = await start(database)
    try:
        executor = runtime.executors['game']
        execute = executor.execute_one
        calls = 0
        async def flaky(*args):
            nonlocal calls
            calls += 1
            if calls == 1: raise OperationalError('temporary connection failure')
            return await execute(*args)
        monkeypatch.setattr(executor, 'execute_one', flaky)
        actor, body = command(game)
        await inbox.enqueue(lane, actor, body)
        assert (await outcome(inbox, lane, actor, body))['status'] == 'accepted'
        assert runtime.admits(fence)
        assert (await store.load(game.table.table_id)).receipt_snapshot['receipt_count'] == 1
    finally:
        await runtime.stop()
        await host.close()


@pytest.mark.parametrize('persistent', [False, True])
async def test_settlement_retry_and_exhaustion(database, monkeypatch, persistent):
    pool, _, _, _ = database
    host, game, *_ = await finished(database)
    original = FlushFinalizationWorker.execute
    calls = 0
    async def flaky(self, *args):
        nonlocal calls
        calls += 1
        if persistent or calls == 1:
            raise OperationalError('temporary settlement connection failure')
        return await original(self, *args)
    monkeypatch.setattr(FlushFinalizationWorker, 'execute', flaky)
    runtime = None
    try:
        runtime, fence = await start(database, batch_size=1, max_retries=1)
        async def completed():
            if persistent:
                return not runtime.admits(fence)
            return (await rows(pool, 'SELECT count(*) FROM ledger_games')) == [(1,)]
        await until(completed)
        assert calls == 2
        assert runtime.admits(fence) is not persistent
        assert (await rows(pool, 'SELECT completed_at IS NULL FROM game_finalization_jobs')) == [(persistent,)]
    finally:
        if runtime: await runtime.stop()
        await host.close()


async def test_stop_cancels_inflight_work_then_new_runtime_recovers_it(database, monkeypatch):
    pool, _, _, _ = database
    host, game, inbox, lane, _ = await setup_game(database)
    runtime, fence = await start(database)
    replacement = None
    entered = asyncio.Event()
    async def blocked(*args):
        entered.set()
        await asyncio.Event().wait()
    try:
        monkeypatch.setattr(runtime.executors['game'], 'execute_one', blocked)
        actor, body = command(game)
        await inbox.enqueue(lane, actor, body)
        await asyncio.wait_for(entered.wait(), 3)
        await runtime.stop()
        assert not runtime.admits(fence)
        assert (await inbox.lookup(lane, actor, body['command_id'])).status == 'pending'
        await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        replacement = RoomExecutionRuntime(pool, 'http://replacement:8000', scan_interval=.02)
        await replacement.start()
        prepared = await replacement.prepare('room', expected_epoch=fence.epoch)
        lease = await replacement.activate(prepared)
        assert lease.fence.epoch == fence.epoch + 1
        assert (await outcome(inbox, lane, actor, body))['status'] == 'accepted'
    finally:
        await runtime.stop()
        if replacement: await replacement.stop()
        await host.close()


async def test_permanent_failure_closes_only_affected_room(database):
    pool, _, _, users = database
    host, game, inbox, lane, _ = await setup_game(database)
    await rows(pool, "INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('other',%s,'Other','private')", (user_uuid(users[-1]),))
    await rows(pool, "INSERT INTO room_memberships(room_id,user_id) VALUES ('other',%s)", (user_uuid(users[-1]),))
    runtime, fence = await start(database)
    try:
        other = await runtime.activate(await runtime.prepare('other', expected_epoch=0))
        table_lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        bad = dict(command_id=uuid4().hex, command='future-command', payload={})
        await inbox.enqueue(table_lane, users[0], bad)
        async def closed(): return not runtime.admits(fence)
        await until(closed)
        assert (await inbox.lookup(table_lane, users[0], bad['command_id'])).status == 'pending'
        other_lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='other'))
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type': 'marriage', 'capacity': 2})
        await inbox.enqueue(other_lane, users[-1], body)
        assert (await outcome(inbox, other_lane, users[-1], body))['status'] == 'accepted'
        assert runtime.admits(other.fence)
    finally:
        await runtime.stop()
        await host.close()


@pytest.mark.parametrize('component', ['scheduler', 'maintenance'])
async def test_background_worker_loss_closes_admission(database, component, monkeypatch):
    runtime, fence = await start(database)
    try:
        if component == 'scheduler':
            runtime.scheduler._tasks[0].cancel()
            await asyncio.gather(runtime.scheduler._tasks[0], return_exceptions=True)
        else:
            runtime._maintenance.cancel()
            await asyncio.gather(runtime._maintenance, return_exceptions=True)
        assert not runtime.admits(fence)
        await runtime.leases.heartbeat_once()
        assert not runtime.admits(fence)
    finally:
        await runtime.stop()
