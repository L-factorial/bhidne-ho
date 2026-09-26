"""Explicit room execution/maintenance assembly; never installed in live startup.

The local scan is a correctness mechanism for this runtime. Optional Redis health
policy changes inbox scan cadence without changing ownership or timer cadence.
"""
import asyncio
from collections import deque
from dataclasses import dataclass, field
import math
import time
from uuid import UUID

from .activation import ACTIVATION_CAPABILITIES, PostgresRoomActivationStore, RoomActivationCoordinator
from .coordination import RoomLeaseCoordinator
from .creation_executor import RoomCreationExecutor
from .executor import GameLaneExecutor, _DetachedHost
from .finalization import MatchFinalizationWorker, FlushFinalizationWorker
from .failure_policy import RoomFailurePolicy
from .inbox import PostgresInboxStore, InboxCapacityExceeded
from .offer_expiry import OfferExpiryDispatcher
from .ownership import PostgresRoomOwnershipStore
from .recovery_coordinator import RoomRecoveryCoordinator, _TRANSIENT
from .room_recovery import UnsupportedRecoveryWork
from .scheduler import GameLaneScheduler
from .shutdown import DrainReport, ReleaseResult, shutdown_attempt
from .store import DurableGameConflict, StaleGameOwner
from .table_executor import TableLaneExecutor

ZERO = UUID(int=0)


@dataclass
class _RoomWork:
    fence: object
    cursors: dict = field(default_factory=lambda: dict(inbox=ZERO, offers=ZERO, match=ZERO, flush=ZERO))
    failures: int = 0
    retry_at: float = 0
    next_inbox_at: float = 0
    next_maintenance_at: float = 0


@dataclass(frozen=True)
class RuntimeFailure:
    room_id: str | None
    source: str
    error_type: str
    retrying: bool


class RoomExecutionRuntime:
    def __init__(self, pool, internal_address, *, workers=4, max_lanes=256, max_rooms=128,
                 batch_size=32, maintenance_workers=2, scan_interval=1.0, operation_timeout=10.0,
                 retry_base=0.1, retry_max=5.0, max_retries=5, round_summary_seconds=8,
                 inbox_polling=None):
        if (type(batch_size) is not int or not 1 <= batch_size <= 1000
                or type(maintenance_workers) is not int or not 1 <= maintenance_workers <= max_rooms
                or type(max_retries) is not int or max_retries < 0
                or any(not math.isfinite(v) or v <= 0 for v in
                       (scan_interval, operation_timeout, retry_base, retry_max)) or retry_max < retry_base):
            raise ValueError('Invalid runtime work bounds.')
        self.pool = pool
        self.batch_size, self.maintenance_workers = batch_size, maintenance_workers
        self.scan_interval, self.operation_timeout = scan_interval, operation_timeout
        self.retry_base, self.retry_max, self.max_retries = retry_base, retry_max, max_retries
        self.round_summary_seconds = round_summary_seconds
        self.inbox = PostgresInboxStore(pool)
        self.ownership = PostgresRoomOwnershipStore(pool)
        self.leases = RoomLeaseCoordinator(self.ownership, internal_address,
            capabilities={**ACTIVATION_CAPABILITIES, 'room_capacity': max_rooms}, max_rooms=max_rooms,
            renewal_workers=min(4, max_rooms))
        self.activation_store = PostgresRoomActivationStore(self.ownership, round_summary_seconds=round_summary_seconds)
        self.recovery = RoomRecoveryCoordinator(self.leases, self.activation_store.recovery)
        self.activation = RoomActivationCoordinator(self.leases, self.activation_store, runtime_ready=self.ready)
        self.failure_policy = RoomFailurePolicy(self.ownership, self.leases.registration,
            max_pending=max_rooms, workers=min(maintenance_workers, max_rooms),
            timeout=operation_timeout, retry_base=retry_base, retry_max=retry_max)
        self.executors = {'room': RoomCreationExecutor(self.inbox), 'table': TableLaneExecutor(self.inbox,
            round_summary_seconds=round_summary_seconds), 'game': GameLaneExecutor(self.inbox,
            round_summary_seconds=round_summary_seconds)}
        from .chat import ChatLaneExecutor, CHAT_KINDS
        self.executors.update({kind: ChatLaneExecutor(self.inbox) for kind in CHAT_KINDS})
        self.offers = OfferExpiryDispatcher(self.inbox)
        self.finalizers = {'match': MatchFinalizationWorker(pool), 'flush': FlushFinalizationWorker(pool)}
        self.scheduler = GameLaneScheduler(self, workers=workers, max_lanes=max_lanes,
            retry_base=retry_base, retry_max=retry_max, max_retries=max_retries,
            command_timeout=operation_timeout, on_failure=self._lane_failure)
        self._rooms = {}
        self._running = self._closed = False
        self._maintenance = None
        self._wake = asyncio.Event()
        self.inbox_polling = inbox_polling
        if inbox_polling is not None:
            inbox_polling.bind(self.request_inbox_scan)
        self._sweeping = asyncio.Lock()
        self._lifecycle = asyncio.Lock()
        self.failures = deque(maxlen=max_rooms * 4)
        self._drain_fences = None
        self._drain_results = {}

    def _healthy(self):
        return (self._running and self.scheduler.healthy and self._maintenance is not None
                and not self._maintenance.done())

    def ready(self, fence):
        room = self._rooms.get(fence.room_id)
        return bool(self._healthy() and room is not None and room.fence == fence)

    def admits(self, fence):
        return self.activation.admits(fence)

    def admitted_fence(self, room_id):
        """Local credential for trusted runtime adapters; never a routing payload."""
        room = self._rooms.get(room_id)
        return room.fence if room is not None and self.admits(room.fence) else None

    def retire_unavailable_room(self, room_id):
        """Placement may discard old local work only after losing admission."""
        room = self._rooms.get(room_id)
        if room is not None:
            if self.admits(room.fence) or self.leases.confirms(room.fence, status='recovering'):
                return False
            self._lose_room(room.fence, 'placement', 'StaleGameOwner')
        return True

    def _lose_room(self, fence, source, error_type, *, quarantine=False):
        room = self._rooms.get(fence.room_id)
        draining = self._drain_fences is not None and self._drain_fences.get(fence.room_id) == fence
        known = (room is not None and room.fence == fence) or draining
        if room is not None and room.fence == fence:
            del self._rooms[fence.room_id]
            self.leases.abandon_fence(fence)
            self.failures.append(RuntimeFailure(fence.room_id, source, error_type, False))
        if known and quarantine and self.failure_policy.is_permanent(error_type):
            if draining:
                self._drain_fences.pop(fence.room_id, None)
                self._drain_results[fence.room_id] = ReleaseResult(fence.room_id, fence.epoch, 'repair_required')
            self.failure_policy.schedule(fence, error_type)
            self._wake.set()

    def _lane_failure(self, failure, fence):
        if not failure.retrying:
            self._lose_room(fence, 'lane', failure.error_type, quarantine=not failure.transient)

    def _maintenance_done(self, task):
        if self._running:
            self._running = False
            error = 'CancelledError' if task.cancelled() else type(task.exception()).__name__
            for room in tuple(self._rooms.values()):
                self._lose_room(room.fence, 'maintenance', error)

    async def start(self):
        async with self._lifecycle:
            if self._running or self._closed or self._maintenance is not None:
                raise RuntimeError('Runtime has already been started or closed.')
            await self.leases.start()
            try:
                self.scheduler.start()
                self._running = True
                self._maintenance = asyncio.create_task(self._maintenance_loop(), name='room-work-maintenance')
                self._maintenance.add_done_callback(self._maintenance_done)
            except BaseException:
                self._running = False
                self._closed = True
                await self.scheduler.stop()
                await self.leases.stop()
                raise

    async def prepare(self, room_id, *, expected_epoch):
        if not self._healthy():
            raise StaleGameOwner('Execution runtime is not running.')
        result = await self.recovery.prepare(room_id, expected_epoch=expected_epoch,
            host=_DetachedHost(self.round_summary_seconds))
        if result.fence is not None and result.status in ('invalid', 'unsupported', 'budget_exceeded', 'failed'):
            # Recovery already abandoned local admission. Never quarantine an
            # acquisition conflict that could refer to an already serving room.
            self.failure_policy.schedule(result.fence, result.error_type)
            self._wake.set()
            await self.failure_policy.sweep_once()
        return result

    async def activate(self, preparation):
        if preparation.status != 'prepared' or preparation.fence is None or not self._healthy():
            raise DurableGameConflict('Runtime activation requires successful recovery and running workers.')
        fence = preparation.fence
        if fence.room_id in self._rooms:
            raise DurableGameConflict('This room already has a staged or active runtime.')
        self._rooms[fence.room_id] = _RoomWork(fence)
        try:
            lease = await self.activation.activate(preparation)
        except BaseException as error:
            self._lose_room(fence, 'activation', type(error).__name__,
                quarantine=isinstance(error, Exception) and not isinstance(error, _TRANSIENT))
            raise
        self._wake.set()  # Immediate fresh scan, including ingress since preparation.
        return lease

    def offer(self, lane_id, fence):
        """Explicit wake-up hook. False leaves work durable for the next scan."""
        return self.admits(fence) and self.scheduler.offer(lane_id, fence)

    def request_inbox_scan(self):
        """Health transition hint; never modifies leases or DB retry backoff."""
        for room in self._rooms.values():
            room.next_inbox_at = 0
        self._wake.set()

    async def execute_one(self, lane_id, fence):
        if not self.admits(fence):
            raise StaleGameOwner('Runtime admission is closed.')
        async with self.pool.connection() as connection:
            target, _, _ = await self.inbox._lane(connection, lane_id)
        if target.room_id != fence.room_id:
            raise StaleGameOwner('Lane belongs to a different room.')
        executor = self.executors.get(target.kind)
        if executor is None:
            raise UnsupportedRecoveryWork('No executor is installed for this lane.')
        if not self.admits(fence):
            raise StaleGameOwner('Runtime admission changed before execution.')
        return await executor.execute_one(lane_id, fence)

    async def _attempt(self, fence, method, *args, **kwargs):
        if not self.admits(fence):
            raise StaleGameOwner('Maintenance admission is closed.')
        async with asyncio.timeout(self.operation_timeout):
            return await method(*args, **kwargs)

    async def _sweep_room(self, room):
        fence = room.fence
        if not self.admits(fence):
            self._lose_room(fence, 'admission', 'StaleGameOwner')
            return
        if time.monotonic() < room.retry_at:
            return
        try:
            if self.inbox_polling is None or time.monotonic() >= room.next_inbox_at:
                # Set the next time before awaiting: a health transition during
                # SQL can then reset it without being overwritten on return.
                room.next_inbox_at = time.monotonic() + (self.inbox_polling.delay() if self.inbox_polling else 0)
                lanes = await self._attempt(fence, self.inbox.pending_lanes, room_id=fence.room_id,
                    limit=self.batch_size, after_lane_id=room.cursors['inbox'])
                if not lanes:
                    room.cursors['inbox'] = ZERO
                for lane in lanes:
                    if not self.offer(lane, fence):
                        room.next_inbox_at = 0  # Backpressure must not advance this cursor.
                        break
                    room.cursors['inbox'] = lane
                if len(lanes) == self.batch_size:
                    room.next_inbox_at = 0  # Continue bounded backlog pages promptly.
            if self.inbox_polling is None or time.monotonic() >= room.next_maintenance_at:
                room.next_maintenance_at = time.monotonic() + self.scan_interval
                await self._sweep_due(room)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            room.next_inbox_at = 0  # SQL retry backoff, not Redis cadence, controls retry.
            room.next_maintenance_at = 0
            room.failures += 1
            if isinstance(error, (*_TRANSIENT, InboxCapacityExceeded)) and room.failures <= self.max_retries:
                room.retry_at = time.monotonic() + min(self.retry_max, self.retry_base * 2 ** min(room.failures-1, 20))
                self.failures.append(RuntimeFailure(fence.room_id, 'maintenance', type(error).__name__, True))
            else:
                self._lose_room(fence, 'maintenance', type(error).__name__,
                    quarantine=not isinstance(error, (*_TRANSIENT, InboxCapacityExceeded)))
        else:
            room.failures = 0
            room.retry_at = 0

    async def _sweep_due(self, room):
        """Timer/settlement cadence does not depend on Redis inbox health."""
        fence = room.fence
        due = await self._attempt(fence, self.offers.due_lanes, fence,
            limit=self.batch_size, after_lane_id=room.cursors['offers'])
        if not due:
            room.cursors['offers'] = ZERO
        for lane in due:
            entry = await self._attempt(fence, self.offers.dispatch_one, lane, fence)
            room.cursors['offers'] = lane
            if entry is not None:
                self.offer(lane, fence)
        for kind, worker in self.finalizers.items():
            jobs = await self._attempt(fence, worker.pending, fence, limit=self.batch_size,
                after_job_id=room.cursors[kind])
            if not jobs:
                room.cursors[kind] = ZERO
            for identity in jobs:
                await self._attempt(fence, worker.execute, identity, fence)
                room.cursors[kind] = identity

    async def sweep_once(self):
        """Bounded rotating scans; one failure cannot prevent other rooms progressing."""
        async with self._sweeping:
            if not self._healthy():
                for room in tuple(self._rooms.values()):
                    self._lose_room(room.fence, 'runtime', 'RuntimeUnavailable')
                return
            rooms = iter(tuple(self._rooms.values()))
            async def worker():
                for room in rooms:
                    # Staged rooms must not be executed or discarded during activation.
                    if self.leases.confirms(room.fence, status='recovering'):
                        continue
                    await self._sweep_room(room)
                    await asyncio.sleep(0)
            await asyncio.gather(*(worker() for _ in range(self.maintenance_workers)))
            await self.failure_policy.sweep_once()

    async def _maintenance_loop(self):
        while self._running:
            self._wake.clear()
            await self.sweep_once()
            try:
                interval = self.scan_interval
                if self.inbox_polling is not None:
                    interval = min(interval, self.inbox_polling.sleep_limit())
                await asyncio.wait_for(self._wake.wait(), timeout=interval)
            except TimeoutError:
                pass

    async def stop(self):
        """Close admission first; cancel workers before stopping lease maintenance.

        SQL leases expire naturally. Use drain_and_stop for explicit routing
        withdrawal and release while retaining retryable shutdown identities.
        """
        async with self._lifecycle:
            await self._stop_locked()

    async def _stop_locked(self):
        # Caller cancellation must not leave renewal or execution tasks detached.
        self._running = False
        self._closed = True
        cleanup = asyncio.create_task(self._stop_workers(), name='room-runtime-stop')
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        cleanup.result()
        if cancelled:
            raise asyncio.CancelledError

    async def _stop_workers(self):
        self._running = False
        self._closed = True
        for room in tuple(self._rooms.values()):
            self._lose_room(room.fence, 'stop', 'RuntimeStopped')
        if self._maintenance is not None:
            self._maintenance.cancel()
            await asyncio.gather(self._maintenance, return_exceptions=True)
        await self.scheduler.stop()
        try:
            await self.failure_policy.sweep_once()
        finally:
            await self.leases.stop()

    async def drain_and_stop(self):
        """Withdraw routing, cancel/join workers, then release exact saved fences.

        Repeated calls retry unresolved transitions. Cancellation never reopens
        admission; leases not confirmed released expire or remain quarantined.
        No network endpoint or application shutdown hook installs this automatically.
        """
        async with self._lifecycle:
            if self._drain_fences is None:
                self._drain_fences = {f.room_id: f for f in self.leases.begin_drain()}
            self._running = False
            self._closed = True
            options = dict(timeout=self.operation_timeout, retry_base=self.retry_base, retry_max=self.retry_max)
            try:
                routing, _ = await shutdown_attempt(self.ownership.drain_instance,
                    self.leases.registration, **options)
            finally:
                # Also stop on cancellation or uncertain registry withdrawal.
                await self._stop_locked()
            pending = iter(tuple(self._drain_fences.values()))
            async def release_worker():
                for fence in pending:
                    status, error = await shutdown_attempt(self.ownership.release,
                        self.leases.registration, fence, preserve_quarantine=True, **options)
                    self._drain_results[fence.room_id] = ReleaseResult(fence.room_id, fence.epoch,
                        'released' if status == 'confirmed' else status, error)
                    if status in ('confirmed', 'quarantined', 'ownership_lost'):
                        self._drain_fences.pop(fence.room_id, None)
            await asyncio.gather(*(release_worker() for _ in range(self.maintenance_workers)))
            return DrainReport(routing, tuple(self._drain_results.values()))
