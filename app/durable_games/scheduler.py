"""Bounded, explicit-start game-lane scheduler. Not installed in application startup.

Wakeups are hints. Queue capacity is backpressure, not permission to discard DB
commands. A future Redis/polling owner feeds offer(); one turn handles one head,
then puts a busy lane at the tail so other lanes can progress.
"""
import asyncio
from collections import deque
from dataclasses import dataclass
from uuid import UUID

from psycopg import OperationalError, InterfaceError
from psycopg.errors import DeadlockDetected, SerializationFailure

from .store import StaleGameOwner


@dataclass
class _Work:
    fence: object
    dirty: bool = False
    failures: int = 0
    timer: object = None


@dataclass(frozen=True)
class LaneFailure:
    lane_id: UUID
    error_type: str  # Never include raw commands, private cards, or DB parameters.
    retrying: bool
    transient: bool = False


class GameLaneScheduler:
    def __init__(self, executor, *, workers=4, max_lanes=256, retry_base=0.1,
                 retry_max=5.0, max_retries=5, command_timeout=10.0, on_failure=None):
        if (type(workers) is not int or workers <= 0 or type(max_lanes) is not int or max_lanes < workers or
                retry_base <= 0 or retry_max < retry_base or type(max_retries) is not int or max_retries < 0 or
                command_timeout <= 0):
            raise ValueError('Invalid scheduler bounds.')
        self.executor = executor
        if on_failure is not None and not callable(on_failure):
            raise ValueError('Failure callback must be callable.')
        self.on_failure = on_failure
        self.workers, self.max_lanes = workers, max_lanes
        self.retry_base, self.retry_max, self.max_retries = retry_base, retry_max, max_retries
        self.command_timeout = command_timeout
        self.failures = deque(maxlen=max_lanes)
        self._work = {}
        self._queue = asyncio.Queue(maxsize=max_lanes)
        self._tasks = []
        self._running = False
        self._idle = asyncio.Event()
        self._idle.set()

    @property
    def healthy(self):
        return self._running and len(self._tasks) == self.workers and all(not task.done() for task in self._tasks)

    def start(self):
        if self._running or self._tasks:
            raise RuntimeError('Scheduler is already running or stopping.')
        self._running = True
        self._tasks = [asyncio.create_task(self._worker(), name=f'game-lane-{i}') for i in range(self.workers)]

    def offer(self, lane_id, fence):
        """False means stopped/full: leave DB work pending for the next scan."""
        if not self._running:
            return False
        lane_id = UUID(str(lane_id))
        work = self._work.get(lane_id)
        if work:
            work.fence, work.dirty = fence, True
            return True
        if len(self._work) >= self.max_lanes:
            return False
        self._work[lane_id] = _Work(fence)
        self._idle.clear()
        self._queue.put_nowait(lane_id)
        return True

    async def wait_idle(self):
        """Includes delayed retries; callers should use their own wait timeout."""
        await self._idle.wait()

    async def stop(self):
        """Cancel in-flight attempts; database transactions determine commit state.

        No detached engine is reused. Restart/wake-up consults durable inbox state,
        including commits that completed just before cancellation/disconnection.
        """
        self._running = False
        for work in self._work.values():
            if work.timer:
                work.timer.cancel()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        self._work.clear()
        self._queue = asyncio.Queue(maxsize=self.max_lanes)
        self._idle.set()

    def _remove(self, lane_id):
        self._work.pop(lane_id, None)
        if not self._work:
            self._idle.set()

    def _retry(self, lane_id, work):
        work.timer = None
        if self._running and self._work.get(lane_id) is work:
            self._queue.put_nowait(lane_id)

    async def _worker(self):
        while True:
            lane_id = await self._queue.get()
            work = self._work[lane_id]
            fence = work.fence
            work.dirty = False
            try:
                async with asyncio.timeout(self.command_timeout):
                    result = await self.executor.execute_one(lane_id, fence)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                transient = isinstance(error, (OperationalError, InterfaceError, TimeoutError,
                                                DeadlockDetected, SerializationFailure))
                work.failures += 1
                retry = transient and work.failures <= self.max_retries
                failure = LaneFailure(lane_id, type(error).__name__, retry, transient)
                self.failures.append(failure)
                if self.on_failure is not None:
                    self.on_failure(failure, fence)
                if work.fence != fence:
                    # Ownership changed while the old attempt was in flight. The
                    # next transaction must validate the replacement fence itself.
                    work.failures = 0
                    self._queue.put_nowait(lane_id)
                elif retry and not isinstance(error, StaleGameOwner):
                    delay = min(self.retry_max, self.retry_base * 2 ** min(work.failures - 1, 20))
                    work.timer = asyncio.get_running_loop().call_later(delay, self._retry, lane_id, work)
                else:
                    self._remove(lane_id)
            else:
                work.failures = 0
                if result is not None or work.dirty:
                    self._queue.put_nowait(lane_id)
                else:
                    self._remove(lane_id)
            finally:
                self._queue.task_done()
            # Also yield when a fast executor/driver completes without suspending.
            # A hot lane must not prevent timers, cancellation, or other workers.
            await asyncio.sleep(0)
