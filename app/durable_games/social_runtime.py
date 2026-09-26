"""Explicit bounded platform-lane executor; no room ownership or live startup hook."""
import asyncio
from collections import deque
import math
from uuid import UUID

from .delivery import _join_cleanup
from .delivery_store import bound
from .social import SOCIAL_KINDS, SocialLaneExecutor


class SocialRuntime:
    def __init__(self, inbox, *, workers=4, batch_size=32, commands_per_lane=8, interval=.5, timeout=3):
        bound(workers, 32)
        bound(batch_size, 1000)
        bound(commands_per_lane, 100)
        if any(not math.isfinite(v) or v <= 0 for v in (interval,timeout)):
            raise ValueError('Invalid social runtime bounds.')
        self.inbox, self.executor = inbox, SocialLaneExecutor(inbox)
        self.workers, self.batch_size, self.interval, self.timeout = workers,batch_size,interval,timeout
        self.commands_per_lane = commands_per_lane
        self.cursors = {kind: UUID(int=0) for kind in SOCIAL_KINDS}
        self._wake, self._sweeping = asyncio.Event(), asyncio.Lock()
        self._task, self._stop_task, self._closed = None,None,False
        self.failures = deque(maxlen=batch_size)

    async def wake(self, lane_id):
        # Coalesced local hint, never an authority or an unbounded task queue.
        self._wake.set()

    async def sweep_once(self):
        async with self._sweeping:
            if self._closed:
                return
            for kind in SOCIAL_KINDS:
                async with asyncio.timeout(self.timeout):
                    lanes = await self.inbox.pending_lanes(kind=kind,limit=self.batch_size,after_lane_id=self.cursors[kind])
                self.cursors[kind] = lanes[-1] if lanes else UUID(int=0)
                pending = iter(lanes)
                async def worker():
                    for lane in pending:
                        try:
                            async with asyncio.timeout(self.timeout):
                                for _ in range(self.commands_per_lane):
                                    if await self.executor.execute_one(lane) is None:
                                        break
                        except Exception as error:
                            self.failures.append((lane,type(error).__name__))
                            # Preserve the head. Other lanes and subsequent passes
                            # progress; never skip a poison command's sequence.
                await asyncio.gather(*(worker() for _ in range(self.workers)))

    async def start(self):
        if self._task is not None or self._closed:
            raise RuntimeError('Social runtime requires a fresh lifecycle.')
        self._task = asyncio.create_task(self._run(),name='social-runtime')

    async def _run(self):
        while not self._closed:
            self._wake.clear()
            try:
                await self.sweep_once()
            except Exception as error:
                self.failures.append((None,type(error).__name__))
            try:
                await asyncio.wait_for(self._wake.wait(),self.interval)
            except TimeoutError:
                pass

    async def stop(self):
        self._closed = True
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._stop(),name='social-runtime-stop')
        await _join_cleanup(self._stop_task)

    async def _stop(self):
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task,return_exceptions=True)
