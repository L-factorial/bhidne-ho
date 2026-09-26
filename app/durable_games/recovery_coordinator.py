"""Bounded recovery preparation, deliberately without activation or host install.

The lease coordinator must already be started and maintain leases independently.
A successful result is an inventory requiring reconciliation, not permission to
serve. Failures never mark commands complete or erase timers, receipts, or state.
"""
import asyncio
from dataclasses import dataclass, field
import math
from typing import Literal

from psycopg import OperationalError, InterfaceError
from psycopg.errors import DeadlockDetected, SerializationFailure, QueryCanceled, LockNotAvailable

from .checkpoints import CheckpointError
from .ownership import RoomWriteFence, StaleInstance
from .room_recovery import RoomRecoveryInventory, RecoveryLimitExceeded, UnsupportedRecoveryWork
from .store import DurableGameConflict, StaleGameOwner


RecoveryStatus = Literal['prepared', 'busy', 'retryable', 'unsupported', 'budget_exceeded',
                         'invalid', 'ownership_lost', 'conflict', 'failed']
_TRANSIENT = (OperationalError, InterfaceError, TimeoutError, DeadlockDetected,
              SerializationFailure, QueryCanceled, LockNotAvailable)


@dataclass(frozen=True)
class RecoveryPreparation:
    room_id: str
    status: RecoveryStatus
    attempts: int
    fence: RoomWriteFence | None = None
    inventory: RoomRecoveryInventory | None = field(default=None, repr=False)
    error_type: str | None = None
    # Only uncertain acquisition failures preserve an intent for a same-input retry.
    retry_same_intent: bool = False


class RoomRecoveryCoordinator:
    def __init__(self, leases, recovery, *, max_inflight=4, max_attempts=3,
                 attempt_timeout=10.0, retry_base=0.1, retry_max=1.0):
        if (type(max_inflight) is not int or max_inflight < 1
                or type(max_attempts) is not int or not 1 <= max_attempts <= 10
                or any(not math.isfinite(v) or v <= 0 for v in (attempt_timeout, retry_base, retry_max))
                or retry_max < retry_base):
            raise ValueError('Invalid recovery coordination bounds.')
        self.leases, self.recovery = leases, recovery
        self.max_inflight, self.max_attempts = max_inflight, max_attempts
        self.attempt_timeout, self.retry_base, self.retry_max = attempt_timeout, retry_base, retry_max
        self._active = set()

    async def prepare(self, room_id, *, expected_epoch, host):
        """Acquire and load, retrying only bounded transient failures.

        There is no queue: busy callers leave work in SQL and retry placement later.
        Known failed acquisitions are abandoned locally and expire in SQL. A failed
        acquisition with an unknown commit retains its original intent in leases.
        Cancellation propagates after exact-fence cleanup. Successful ownership
        remains recovering until the caller reconciles or explicitly discards it.
        """
        if not isinstance(room_id, str) or not room_id.strip():
            raise ValueError('Room identity must be a nonempty string.')
        if type(expected_epoch) is not int or expected_epoch < 0:
            raise ValueError('Expected epoch must be a nonnegative integer.')
        if room_id in self._active or len(self._active) >= self.max_inflight:
            return RecoveryPreparation(room_id, 'busy', 0)
        self._active.add(room_id)
        fence = None
        prepared = False
        try:
            for attempt in range(1, self.max_attempts + 1):
                try:
                    async with asyncio.timeout(self.attempt_timeout):
                        if fence is None:
                            lease = await self.leases.acquire(room_id, expected_epoch=expected_epoch)
                            if lease.status != 'recovering':
                                # A misplaced recovery request must not abandon a
                                # room this process is already serving/draining.
                                return RecoveryPreparation(room_id, 'conflict', attempt, lease.fence,
                                                           error_type='DurableGameConflict')
                            fence = lease.fence
                        if not self.leases.confirms(fence, status='recovering'):
                            raise StaleGameOwner('Local recovering ownership was lost.')
                        inventory = await self.recovery.load(fence, host)
                        if inventory.fence != fence or not self.leases.confirms(fence, status='recovering'):
                            raise StaleGameOwner('Ownership changed during recovery.')
                    prepared = True
                    return RecoveryPreparation(room_id, 'prepared', attempt, fence, inventory)
                except _TRANSIENT as error:
                    if fence is not None and not self.leases.confirms(fence, status='recovering'):
                        return RecoveryPreparation(room_id, 'ownership_lost', attempt, fence,
                                                   error_type=type(error).__name__)
                    if attempt == self.max_attempts:
                        return RecoveryPreparation(room_id, 'retryable', attempt, fence,
                            error_type=type(error).__name__, retry_same_intent=fence is None)
                    await asyncio.sleep(min(self.retry_max, self.retry_base * 2 ** (attempt - 1)))
                except Exception as error:
                    if isinstance(error, (StaleGameOwner, StaleInstance)):
                        status = 'ownership_lost'
                    elif isinstance(error, UnsupportedRecoveryWork):
                        status = 'unsupported'
                    elif isinstance(error, RecoveryLimitExceeded):
                        status = 'budget_exceeded'
                    elif isinstance(error, CheckpointError):
                        status = 'invalid'
                    elif isinstance(error, DurableGameConflict):
                        status = 'conflict'
                    else:
                        status = 'failed'
                    return RecoveryPreparation(room_id, status, attempt, fence, error_type=type(error).__name__)
        finally:
            self._active.remove(room_id)
            if fence is not None and not prepared:
                self.leases.abandon_fence(fence)

    def discard(self, preparation):
        """Stop retaining this prepared lease without touching any replacement."""
        if preparation.status != 'prepared' or preparation.fence is None:
            return False
        return self.leases.abandon_fence(preparation.fence)
