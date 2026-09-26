"""Explicit-start lease maintenance; not wired into application startup.

Only an explicit recovery activation transition can open local admission.
A confirmed serving lease permits the detached lane executor;
any uncertain maintenance result revokes local admission until a new acquisition.
PostgreSQL fencing remains mandatory even when the local guard admits work.
"""
import asyncio
from collections import deque
from dataclasses import dataclass, field
import math
from secrets import token_urlsafe
import time

from .ownership import InstanceRegistration, RoomLease, _duration
from .store import StaleGameOwner


@dataclass
class _Room:
    expected_epoch: int
    token: str = field(default_factory=lambda: token_urlsafe(32), repr=False)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    lease: RoomLease | None = None
    deadline: float = 0
    lost: bool = False
    activation_confirmed: bool = False


@dataclass(frozen=True)
class CoordinationFailure:
    room_id: str | None
    error_type: str


class RoomLeaseCoordinator:
    def __init__(self, store, internal_address, *, capabilities=None, lease_seconds=30,
                 interval=5.0, operation_timeout=3.0, safety_margin=1.0,
                 max_rooms=128, renewal_workers=4, clock=time.monotonic):
        _duration(lease_seconds)
        if (any(not math.isfinite(v) or v <= 0 for v in (interval, operation_timeout, safety_margin))
                or interval + operation_timeout + safety_margin >= min(lease_seconds, store.heartbeat_ttl)
                or type(max_rooms) is not int or max_rooms < 1
                or type(renewal_workers) is not int or not 1 <= renewal_workers <= max_rooms):
            raise ValueError('Invalid lease coordination bounds.')
        self.store, self.internal_address = store, internal_address
        self.capabilities = capabilities
        self.registration = InstanceRegistration.new()
        self.lease_seconds, self.interval = lease_seconds, interval
        self.operation_timeout, self.safety_margin = operation_timeout, safety_margin
        self.max_rooms, self.renewal_workers = max_rooms, renewal_workers
        self._clock = clock
        self._rooms = {}
        self._tasks = []
        self._running = self._closed = self._draining = False
        self._lifecycle = asyncio.Lock()
        self._renewal_lock = asyncio.Lock()
        self._heartbeat_lock = asyncio.Lock()
        self._heartbeat_deadline = 0
        self._generation = 0
        self.failures = deque(maxlen=max_rooms)

    def _revoke_all(self):
        self._generation += 1
        self._heartbeat_deadline = 0
        for room in self._rooms.values():
            room.lost = True

    def _healthy(self):
        if not self._running:
            return False
        if self._clock() >= self._heartbeat_deadline:
            self._revoke_all()
            return False
        return True

    async def start(self):
        """Retry an uncertain initial registration with this same coordinator.

        After stop, create a new coordinator/boot identity instead of restarting.
        """
        async with self._lifecycle:
            if self._running or self._closed:
                raise RuntimeError('Coordinator is running or has been stopped.')
            async with asyncio.timeout(self.operation_timeout):
                await self.store.register(self.registration, self.internal_address, capabilities=self.capabilities)
                started = self._clock()
                await self.store.heartbeat(self.registration)
            self._heartbeat_deadline = started + self.store.heartbeat_ttl - self.safety_margin
            self._running = True
            self._tasks = [asyncio.create_task(self._heartbeat_loop(), name='instance-heartbeat'),
                           asyncio.create_task(self._renewal_loop(), name='room-lease-renewal')]

    async def stop(self):
        """Close admission first, then cancel maintenance. Leases expire in SQL.

        This does not release ownership ahead of in-flight command transactions.
        The application must separately stop its scheduler before graceful release.
        """
        async with self._lifecycle:
            self._running = False
            self._closed = True
            self._revoke_all()
            for task in self._tasks:
                task.cancel()
            await asyncio.gather(*self._tasks, return_exceptions=True)
            self._tasks.clear()

    async def acquire(self, room_id, *, expected_epoch):
        """Retain acquisition intent across timeouts/cancellation/lost responses.

        Retry with the same observed epoch. Explicitly abandon a lost intent before
        inspecting ownership and trying a new one. This method never activates.
        """
        if not isinstance(room_id, str) or not room_id.strip():
            raise ValueError('Room identity must be a nonempty string.')
        if type(expected_epoch) is not int or expected_epoch < 0:
            raise ValueError('Expected epoch must be a nonnegative integer.')
        if not self._healthy() or self._draining:
            raise StaleGameOwner('Instance is not accepting room acquisitions.')
        room = self._rooms.get(room_id)
        if room is None:
            if len(self._rooms) >= self.max_rooms:
                raise RuntimeError('Room coordination capacity reached.')
            room = self._rooms[room_id] = _Room(expected_epoch)
        if room.expected_epoch != expected_epoch:
            raise ValueError('Retry must retain the original acquisition epoch.')
        async with room.lock:
            if room.lost or not self._healthy() or self._draining:
                raise StaleGameOwner('Acquisition intent is no longer eligible.')
            if room.lease is not None:
                if self._clock() >= room.deadline:
                    room.lost = True
                    raise StaleGameOwner('Local lease confirmation expired.')
                return room.lease
            generation, started = self._generation, self._clock()
            async with asyncio.timeout(self.operation_timeout):
                lease = await self.store.acquire(room_id, self.registration, expected_epoch=expected_epoch,
                                                 token=room.token, lease_seconds=self.lease_seconds)
                # acquire retry does not extend SQL expiry. Renew before deriving a
                # conservative local deadline from this request's start time.
                lease = await self.store.renew(self.registration, lease.fence, lease_seconds=self.lease_seconds)
            if (not self._healthy() or generation != self._generation or room.lost
                    or self._draining or self._rooms.get(room_id) is not room):
                room.lost = True
                raise StaleGameOwner('Instance changed while acquisition was in flight.')
            room.lease = lease
            room.deadline = started + self.lease_seconds - self.safety_margin
            return lease

    def abandon(self, room_id):
        """Discard local ownership/intent; never release or replace a SQL lease.

        Pending commands remain durable. A new intent must inspect SQL ownership;
        it cannot steal a still-live lease even when this process abandoned it.
        """
        room = self._rooms.pop(room_id, None)
        if room:
            room.lost = True

    def placement_intent(self, room_id):
        """Credential-free local intent metadata for the placement coordinator."""
        room = self._rooms.get(room_id)
        return (room.expected_epoch, room.lost) if room is not None else None

    def forget_placement_intent(self, room_id, expected_epoch):
        room = self._rooms.get(room_id)
        if room is not None and room.expected_epoch == expected_epoch and not room.lock.locked():
            self.abandon(room_id)
            return True
        return False

    def accepts_placement(self):
        return self._healthy() and not self._draining

    def prune_lost_placement_intents(self):
        for room_id, room in tuple(self._rooms.items()):
            if room.lost and not room.lock.locked():
                self.abandon(room_id)

    def admits(self, fence):
        """Check on every execution attempt, including queued/retried lane work."""
        return self.confirms(fence, status='serving')

    def confirms(self, fence, *, status):
        """Local confirmation only; callers must still validate PostgreSQL fencing."""
        if not self._healthy() or self._draining:
            return False
        room = self._rooms.get(fence.room_id)
        if room is None or room.lost or room.lease is None:
            return False
        if self._clock() >= room.deadline:
            room.lost = True
            return False
        return (room.lease.fence == fence and room.lease.status == status
                and (status != 'serving' or room.activation_confirmed))

    async def activate(self, fence, transition):
        """Trusted activation boundary; renewal alone cannot open admission.

        transition must validate recovery and commit the SQL transition. Any
        uncertainty loses this local acquisition; a heartbeat cannot rehabilitate it.
        """
        room = self._rooms.get(fence.room_id)
        if room is None:
            raise StaleGameOwner('No local acquisition is available for activation.')
        async with room.lock:
            if not self.confirms(fence, status='recovering'):
                raise StaleGameOwner('Activation requires confirmed recovering ownership.')
            generation = self._generation
            try:
                async with asyncio.timeout(self.operation_timeout):
                    lease = await transition(self.registration, fence)
                if (lease.fence != fence or lease.status != 'serving' or not self._healthy()
                        or self._draining or room.lost or generation != self._generation
                        or self._clock() >= room.deadline or self._rooms.get(fence.room_id) is not room):
                    raise StaleGameOwner('Ownership changed during activation.')
                room.lease = lease
                room.activation_confirmed = True
                return lease
            except BaseException:
                room.activation_confirmed = False
                room.lost = True
                raise

    def abandon_fence(self, fence):
        """Discard only this acquisition, never a replacement installed meanwhile."""
        room = self._rooms.get(fence.room_id)
        if room is None or room.lease is None or room.lease.fence != fence:
            return False
        self.abandon(fence.room_id)
        return True

    def begin_drain(self):
        """Close acquisition/admission synchronously and snapshot known live intents."""
        self._draining = True
        return tuple(room.lease.fence for room in self._rooms.values()
                     if room.lease is not None and not room.lost)

    async def drain(self):
        """Immediately stop local admission; retry an uncertain registry update.

        Renew existing leases while the caller quiesces workers. This does not
        perform room transitions, wait for workers, or release room ownership.
        """
        self.begin_drain()
        async with asyncio.timeout(self.operation_timeout):
            await self.store.drain_instance(self.registration)

    async def heartbeat_once(self):
        async with self._heartbeat_lock:
            await self._heartbeat()

    async def _heartbeat(self):
        if not self._running:
            return
        # Observe a local pause before a successful heartbeat can hide the gap.
        self._healthy()
        started = self._clock()
        try:
            async with asyncio.timeout(self.operation_timeout):
                await self.store.heartbeat(self.registration)
        except BaseException:
            self._revoke_all()
            raise
        if self._running:
            self._healthy()
            self._heartbeat_deadline = started + self.store.heartbeat_ttl - self.safety_margin

    async def renew_once(self):
        """A fixed number of workers maintain a bounded snapshot of owned rooms."""
        async with self._renewal_lock:
            await self._renew_owned()

    async def _renew_owned(self):
        if not self._healthy():
            return
        pending = iter(tuple(self._rooms.items()))

        async def worker():
            for room_id, room in pending:
                async with room.lock:
                    if room.lost or room.lease is None or not self._healthy():
                        continue
                    if self._clock() >= room.deadline:
                        room.lost = True
                        continue
                    started = self._clock()
                    try:
                        async with asyncio.timeout(self.operation_timeout):
                            lease = await self.store.renew(self.registration, room.lease.fence,
                                                           lease_seconds=self.lease_seconds)
                            if lease.status == 'serving' and not room.activation_confirmed:
                                raise StaleGameOwner('Serving state has no confirmed local activation.')
                    except asyncio.CancelledError:
                        room.lost = True
                        raise
                    except Exception as error:
                        room.lost = True
                        self.failures.append(CoordinationFailure(room_id, type(error).__name__))
                    else:
                        if self._clock() >= room.deadline:
                            room.lost = True
                        if not room.lost and self._healthy() and self._rooms.get(room_id) is room:
                            room.lease = lease
                            room.deadline = started + self.lease_seconds - self.safety_margin
                await asyncio.sleep(0)

        await asyncio.gather(*(worker() for _ in range(self.renewal_workers)))

    async def _heartbeat_loop(self):
        while True:
            await asyncio.sleep(self.interval)
            try:
                await self.heartbeat_once()
            except Exception as error:
                self.failures.append(CoordinationFailure(None, type(error).__name__))

    async def _renewal_loop(self):
        while True:
            await asyncio.sleep(self.interval)
            await self.renew_once()


class OwnershipGuardedExecutor:
    """Compose with GameLaneScheduler so queued work rechecks local admission.

    Integrated runtimes should pass RoomActivationCoordinator to include its
    runtime readiness gate, not only the underlying lease coordinator.
    """
    def __init__(self, coordinator, executor):
        self.coordinator, self.executor = coordinator, executor

    async def execute_one(self, lane_id, fence):
        if not self.coordinator.admits(fence):
            raise StaleGameOwner('Local ownership confirmation is unavailable.')
        return await self.executor.execute_one(lane_id, fence)
