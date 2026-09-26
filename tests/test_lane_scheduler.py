"""Deterministic scheduler orchestration tests; engine/store correctness is SQL-tested."""
import asyncio
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.scheduler import GameLaneScheduler
from app.durable_games.store import StaleGameOwner


async def idle(scheduler):
    await asyncio.wait_for(scheduler.wait_idle(), 2)


async def test_round_robin_coalesces_hints_and_bounds_admission():
    a, b, c = uuid4(), uuid4(), uuid4()
    calls, remaining = [], {a: 2, b: 2}
    class Executor:
        async def execute_one(self, lane, fence):
            calls.append(lane)
            if remaining[lane]:
                remaining[lane] -= 1
                return True
    scheduler = GameLaneScheduler(Executor(), workers=1, max_lanes=2)
    assert not scheduler.offer(a, 'owner')
    scheduler.start()
    try:
        assert scheduler.offer(a, 'owner') and scheduler.offer(b, 'owner')
        for _ in range(100): assert scheduler.offer(a, 'owner')
        assert not scheduler.offer(c, 'owner')
        await idle(scheduler)
        assert calls == [a, b, a, b, a, b]
    finally:
        await scheduler.stop()


async def test_independent_lanes_overlap_but_same_lane_never_does():
    a, b = uuid4(), uuid4()
    both_started, release = asyncio.Event(), asyncio.Event()
    running, seen = set(), set()
    class Executor:
        async def execute_one(self, lane, fence):
            assert lane not in running
            if lane in seen: return None
            running.add(lane)
            seen.add(lane)
            if len(running) == 2: both_started.set()
            await release.wait()
            running.remove(lane)
            return True
    scheduler = GameLaneScheduler(Executor(), workers=2, max_lanes=2)
    scheduler.start()
    try:
        scheduler.offer(a, 'owner')
        scheduler.offer(b, 'owner')
        await asyncio.wait_for(both_started.wait(), 1)
        for _ in range(30): scheduler.offer(a, 'owner')
        release.set()
        await idle(scheduler)
        assert seen == {a, b} and not running
    finally:
        await scheduler.stop()


async def test_delayed_retry_does_not_occupy_worker_or_starve_other_lane():
    a, b = uuid4(), uuid4()
    calls = []
    class Executor:
        async def execute_one(self, lane, fence):
            calls.append(lane)
            if lane == a and calls.count(a) == 1: raise OperationalError('lost commit response')
    scheduler = GameLaneScheduler(Executor(), workers=1, retry_base=.01)
    scheduler.start()
    try:
        scheduler.offer(a, 'owner')
        scheduler.offer(b, 'owner')
        await idle(scheduler)
        assert calls == [a, b, a]
        assert scheduler.failures[0].retrying
    finally:
        await scheduler.stop()


@pytest.mark.parametrize('error', [StaleGameOwner('fenced'), ValueError('private data must not be reported')])
async def test_permanent_failure_does_not_hot_loop_or_block_other_lanes(error):
    a, b = uuid4(), uuid4()
    calls = []
    class Executor:
        async def execute_one(self, lane, fence):
            calls.append(lane)
            if lane == a: raise error
    scheduler = GameLaneScheduler(Executor(), workers=1)
    scheduler.start()
    try:
        scheduler.offer(a, 'owner')
        scheduler.offer(b, 'owner')
        await idle(scheduler)
        assert calls == [a, b]
        assert scheduler.failures[0].error_type == type(error).__name__
        assert not scheduler.failures[0].retrying
        assert 'private' not in repr(scheduler.failures)
    finally:
        await scheduler.stop()


async def test_timeout_retries_are_bounded_and_cleanup_cancels_inflight_work():
    attempts, cancellations = [], []
    started = asyncio.Event()
    class Executor:
        async def execute_one(self, lane, fence):
            attempts.append(lane)
            started.set()
            try: await asyncio.Event().wait()
            finally: cancellations.append(lane)
    scheduler = GameLaneScheduler(Executor(), workers=1, command_timeout=.01, retry_base=.01, max_retries=1)
    scheduler.start()
    lane = uuid4()
    try:
        scheduler.offer(lane, 'owner')
        await idle(scheduler)
        assert attempts == cancellations == [lane, lane]
        assert [f.retrying for f in scheduler.failures] == [True, False]
        started.clear()
        scheduler.offer(lane, 'owner')
        await asyncio.wait_for(started.wait(), 1)
    finally:
        await scheduler.stop()
    assert len(attempts) == len(cancellations) == 3
    assert not scheduler.offer(lane, 'owner')
    await idle(scheduler)


async def test_replacement_fence_and_wakeup_during_idle_result_are_not_lost():
    entered, finish = asyncio.Event(), asyncio.Event()
    calls = []
    class Executor:
        async def execute_one(self, lane, fence):
            calls.append(fence)
            if len(calls) == 1:
                entered.set()
                await finish.wait()
                raise StaleGameOwner('old fence')
    scheduler = GameLaneScheduler(Executor(), workers=1)
    scheduler.start()
    lane = uuid4()
    try:
        scheduler.offer(lane, 'old')
        await asyncio.wait_for(entered.wait(), 1)
        scheduler.offer(lane, 'new')
        finish.set()
        await idle(scheduler)
        assert calls == ['old', 'new']
    finally:
        await scheduler.stop()


def test_scheduler_rejects_invalid_bounds():
    for args in ({'workers': 0}, {'workers': 2, 'max_lanes': 1}, {'retry_base': 0}, {'max_retries': -1}, {'command_timeout': 0}):
        with pytest.raises(ValueError): GameLaneScheduler(None, **args)
