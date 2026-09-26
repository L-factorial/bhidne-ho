import asyncio
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.durable_games.polling import RedisPollingPolicy
from app.durable_games.inbox import LaneTarget
from app.durable_games.discovery import PlacementDemand, PlacementDemandReceiver
from app.durable_games.placement import RoomOwnerCoordinator
from test_checkpoint_store import database
from test_redis_signals import Broker, transport, eventually
from test_room_runtime import start, outcome, rows
from test_room_placement import runtime_for, expire


@pytest.mark.parametrize('options', [dict(healthy_interval=0), dict(failed_interval=6), dict(jitter=-1), dict(jitter=float('nan'))])
def test_invalid_intervals(options):
    with pytest.raises(ValueError): RedisPollingPolicy(**options)


def test_health_changes_and_jitter_remain_bounded():
    policy, events = RedisPollingPolicy(), []
    policy.bind(lambda: events.append(policy.available))
    assert .315 <= policy.delay() <= .385
    policy.observe(True)
    assert 4.5 <= policy.delay() <= 5.5
    policy.observe(True)
    policy.observe(False)
    assert events == [True, False]
    with pytest.raises(ValueError): policy.bind(lambda: None)
    with pytest.raises(ValueError): policy.observe(1)


async def test_healthy_safety_poll_recovers_missed_signal(database):
    _, _, _, users = database
    policy = RedisPollingPolicy(healthy_interval=.1, failed_interval=.01, jitter=0)
    runtime, fence = await start(database, inbox_polling=policy)
    try:
        policy.observe(True)
        await eventually(lambda: runtime._rooms['room'].next_inbox_at > time.monotonic())
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type':'marriage','capacity':2})
        await runtime.inbox.enqueue(lane, users[0], body)
        assert (await outcome(runtime.inbox, lane, users[0], body))['status'] == 'accepted'
        assert policy.available and runtime.admits(fence)
    finally:
        await runtime.stop()


async def test_reconnect_rescan_does_not_wait_for_next_interval(database):
    _, _, _, users = database
    policy = RedisPollingPolicy(healthy_interval=90, failed_interval=60, jitter=0)
    runtime, fence = await start(database, inbox_polling=policy)
    try:
        await eventually(lambda: runtime._rooms['room'].next_inbox_at > time.monotonic()+30)
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type':'marriage','capacity':2})
        await runtime.inbox.enqueue(lane, users[0], body)
        assert (await runtime.inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
        policy.observe(True)
        assert (await outcome(runtime.inbox, lane, users[0], body))['status'] == 'accepted'
    finally:
        await runtime.stop()


async def test_inbox_health_does_not_change_timer_or_settlement_poll_cadence(database, monkeypatch):
    policy = RedisPollingPolicy(healthy_interval=60, failed_interval=.01, jitter=0)
    runtime, fence = await start(database, inbox_polling=policy)
    counts = dict(inbox=0, offers=0, match=0, flush=0)
    # Isolate scheduling from query duration without mocking engine writes.
    def fake(key):
        async def query(*args, **kwargs):
            counts[key] += 1
            return ()
        return query
    try:
        runtime.scan_interval = .08
        monkeypatch.setattr(runtime.inbox, 'pending_lanes', fake('inbox'))
        monkeypatch.setattr(runtime.offers, 'due_lanes', fake('offers'))
        for kind, worker in runtime.finalizers.items():
            monkeypatch.setattr(worker, 'pending', fake(kind))
        policy.observe(True)
        await eventually(lambda: counts['inbox'] >= 1 and counts['offers'] >= 2)
        assert counts['inbox'] == 1
        before = dict(counts)
        policy.observe(False)
        await eventually(lambda: counts['inbox'] >= before['inbox'] + 4)
        assert counts['offers'] - before['offers'] < counts['inbox'] - before['inbox']
        assert counts['offers'] == counts['match'] == counts['flush']
    finally:
        await runtime.stop()


async def test_placement_signal_uses_real_recovery_receiver(database):
    pool, _, _, users = database
    runtime = await runtime_for(database)
    broker = Broker()
    instance = runtime.leases.registration.instance_id
    bus = transport(broker, instance, placement_receiver=PlacementDemandReceiver(RoomOwnerCoordinator(runtime)))
    try:
        await expire(pool)
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type':'marriage','capacity':2})
        await runtime.inbox.enqueue(lane, users[0], body)
        await bus.start()
        await eventually(lambda: bus.healthy)
        assert await bus.send_placement(SimpleNamespace(instance_id=instance), PlacementDemand('room',instance))
        assert (await outcome(runtime.inbox, lane, users[0], body))['status'] == 'accepted'
        assert runtime.admitted_fence('room').epoch == 2
    finally:
        await bus.stop()
        await runtime.stop()


async def test_inbox_sql_failure_retries_before_healthy_safety_interval(database, monkeypatch):
    policy = RedisPollingPolicy(healthy_interval=60, failed_interval=.01, jitter=0)
    runtime, fence = await start(database, inbox_polling=policy)
    attempts = 0
    original = runtime.inbox.pending_lanes
    async def flaky(*args, **kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise TimeoutError('Transient database timeout')
        return await original(*args, **kwargs)
    try:
        monkeypatch.setattr(runtime.inbox, 'pending_lanes', flaky)
        policy.observe(True)
        await eventually(lambda: attempts >= 2)
        assert runtime.admits(fence)
        assert policy.available
    finally:
        await runtime.stop()
