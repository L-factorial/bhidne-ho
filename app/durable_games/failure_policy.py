"""Bounded exact-fence quarantine transitions; no automatic repair or reacquisition."""
import asyncio
from collections import deque
from dataclasses import dataclass
import math
import time

from .ownership import StaleInstance
from .recovery_coordinator import _TRANSIENT
from .store import StaleGameOwner


_RETRYABLE_NAMES = {error.__name__ for error in _TRANSIENT} | {
    'InboxCapacityExceeded', 'CancelledError', 'StaleGameOwner', 'StaleInstance',
}


@dataclass
class _Pending:
    fence: object
    attempts: int = 0
    retry_at: float = 0


@dataclass(frozen=True)
class QuarantineResult:
    room_id: str
    epoch: int
    status: str
    attempts: int
    error_type: str | None = None


class RoomFailurePolicy:
    @staticmethod
    def is_permanent(error_type):
        return error_type not in _RETRYABLE_NAMES

    def __init__(self, ownership, registration, *, max_pending=128, workers=2,
                 max_attempts=3, timeout=3.0, retry_base=.1, retry_max=1.0):
        if (type(max_pending) is not int or max_pending < 1
                or type(workers) is not int or not 1 <= workers <= max_pending
                or type(max_attempts) is not int or not 1 <= max_attempts <= 10
                or any(not math.isfinite(v) or v <= 0 for v in (timeout, retry_base, retry_max))
                or retry_max < retry_base):
            raise ValueError('Invalid quarantine bounds.')
        self.ownership, self.registration = ownership, registration
        self.max_pending, self.workers, self.max_attempts = max_pending, workers, max_attempts
        self.timeout, self.retry_base, self.retry_max = timeout, retry_base, retry_max
        self._pending = {}
        self._sweeping = asyncio.Lock()
        self.results = deque(maxlen=max_pending * 2)

    def schedule(self, fence, error_type):
        """Call only after local admission is closed for a terminal work failure.

        Exhausted transient errors and ownership loss must not permanently mark
        room data as broken. Unknown execution errors conservatively require repair.
        """
        if not self.is_permanent(error_type):
            return False
        if fence.instance_id != self.registration.instance_id:
            return False
        if fence in self._pending:
            return True
        if len(self._pending) >= self.max_pending:
            self.results.append(QuarantineResult(fence.room_id, fence.epoch, 'busy', 0))
            return False
        self._pending[fence] = _Pending(fence)
        return True

    async def _apply(self, item):
        if time.monotonic() < item.retry_at:
            return
        item.attempts += 1
        try:
            async with asyncio.timeout(self.timeout):
                await self.ownership.quarantine(self.registration, item.fence)
        except asyncio.CancelledError:
            # Cancellation can hide a commit. Retain this exact fence for a later
            # explicit sweep; never claim persistence or open admission here.
            item.retry_at = time.monotonic() + self.retry_base
            if item.attempts >= self.max_attempts:
                self._pending.pop(item.fence, None)
                self.results.append(QuarantineResult(item.fence.room_id, item.fence.epoch,
                    'uncertain', item.attempts, 'CancelledError'))
            raise
        except _TRANSIENT as error:
            if item.attempts < self.max_attempts:
                item.retry_at = time.monotonic() + min(self.retry_max, self.retry_base * 2 ** (item.attempts - 1))
                self.results.append(QuarantineResult(item.fence.room_id, item.fence.epoch,
                    'retrying', item.attempts, type(error).__name__))
                return
            status, error_type = 'uncertain', type(error).__name__
        except (StaleGameOwner, StaleInstance) as error:
            status, error_type = 'ownership_lost', type(error).__name__
        except Exception as error:
            status, error_type = 'failed', type(error).__name__
        else:
            status, error_type = 'quarantined', None
        self._pending.pop(item.fence, None)
        self.results.append(QuarantineResult(item.fence.room_id, item.fence.epoch,
            status, item.attempts, error_type))

    async def sweep_once(self):
        """No background tasks of its own; bounded workers, backoff and attempts."""
        async with self._sweeping:
            items = iter(tuple(self._pending.values()))
            async def worker():
                for item in items:
                    await self._apply(item)
            await asyncio.gather(*(worker() for _ in range(self.workers)))
