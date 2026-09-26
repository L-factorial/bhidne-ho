"""Explicit bounded outbox publication and gateway catch-up adapters.

No socket/application startup wiring. Signals carry IDs only. Each gateway stream
has its own send progress; only authenticated client acknowledgements persist.
"""
import asyncio
from dataclasses import dataclass, field
import math
from uuid import UUID, uuid4

from .delivery_store import bound, client_identity, sequence
from .redis_presence import identity


async def _join_cleanup(task):
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    task.result()
    if cancelled:
        raise asyncio.CancelledError


@dataclass(frozen=True)
class DeliveryWakeup:
    instance_id: str
    lane_id: UUID
    event_id: UUID
    sequence: int

    def __post_init__(self):
        identity(self.instance_id)
        if not isinstance(self.lane_id, UUID) or not isinstance(self.event_id, UUID):
            raise ValueError('Invalid delivery identity.')
        sequence(self.sequence)
        if self.sequence == 0:
            raise ValueError('Delivery notification sequence must be positive.')


class OutboxPublisher:
    def __init__(self, store, presence, send, *, workers=4, fanout_workers=4,
                 max_destinations=128, interval=.5, timeout=3.0, lease_seconds=10):
        bound(workers, 32)
        bound(fanout_workers, 16)
        bound(max_destinations, 512)
        bound(lease_seconds, 120)
        if (not callable(send) or any(not math.isfinite(v) or v <= 0 for v in (interval, timeout))
                or lease_seconds <= timeout * 2):
            raise ValueError('Invalid publication bounds.')
        self.store, self.presence, self.send = store, presence, send
        self.workers, self.fanout_workers, self.max_destinations = workers, fanout_workers, max_destinations
        self.interval, self.timeout, self.lease_seconds = interval, timeout, lease_seconds
        self._task, self._closed, self._sweeping = None, False, asyncio.Lock()
        self._stop_task = None
        self.failures = 0

    async def _publish(self, claim):
        published = False
        try:
            async with asyncio.timeout(self.timeout):
                if claim.audience_user_id is not None:
                    audiences = [('user', f'user-{claim.audience_user_id}')]
                elif claim.kind == 'conversation':
                    audiences = [('user', f'user-{u}') for u in (claim.user_low,claim.user_high)]
                elif claim.kind == 'recipient':
                    audiences = [('user', f'user-{claim.recipient_id}')]
                elif claim.room_id is not None:
                    audiences = [('room', claim.room_id)]
                else:
                    return
                destinations = set()
                for kind, key in audiences:
                    observed = await self.presence.observe(kind, key)
                    if observed.status != 'observed':
                        return
                    destinations.update(p.instance_id for p in observed.connections)
                if len(destinations) > self.max_destinations:
                    return
                pending, results = iter(sorted(destinations)), []
                async def worker():
                    for destination in pending:
                        notice = DeliveryWakeup(destination, claim.lane_id, claim.event_id, claim.sequence)
                        try:
                            results.append(await self.send(destination, notice) is True)
                        except Exception:
                            results.append(False)
                await asyncio.gather(*(worker() for _ in range(self.fanout_workers)))
                # Empty/partial presence is not proof of offline users. Publication
                # records only this advisory attempt; every gateway safety-polls.
                published = all(results)
        except Exception:
            self.failures += 1
        finally:
            # Cancellation leaves the claim to expire. Late completions cannot
            # acknowledge a new publisher's claim after takeover.
            if not asyncio.current_task().cancelling():
                try:
                    async with asyncio.timeout(self.timeout):
                        await self.store.finish(claim, published=published,
                            retry_seconds=min(60, 2 ** min(claim.attempts - 1, 6)))
                except Exception:
                    self.failures += 1

    async def sweep_once(self):
        async with self._sweeping:
            if self._closed:
                return
            async with asyncio.timeout(self.timeout):
                claims = await self.store.claim(limit=self.workers, lease_seconds=self.lease_seconds)
            await asyncio.gather(*(self._publish(claim) for claim in claims))

    async def start(self):
        if self._task is not None or self._closed:
            raise RuntimeError('Publisher requires a fresh lifecycle.')
        self._task = asyncio.create_task(self._run(), name='outbox-publisher')

    async def _run(self):
        while not self._closed:
            try:
                await self.sweep_once()
            except Exception:
                self.failures += 1
            await asyncio.sleep(self.interval)

    async def stop(self):
        self._closed = True
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._stop(), name='outbox-stop')
        await _join_cleanup(self._stop_task)

    async def _stop(self):
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)


@dataclass
class _Stream:
    actor: str
    client_id: str
    lane_id: UUID
    send: object
    sent: int
    acknowledged: int
    on_close: object = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class GatewayDelivery:
    """One subscription per authenticated socket/client/lane, bounded by max_streams.

    The socket adapter owns actor/client identity. Retain the opaque handle; never
    accept another socket's handle. No payload queue survives authorization changes.
    Send callbacks must finish within timeout; failed sends remove the subscription,
    requiring reconnect/replay from the durable client cursor.
    """
    def __init__(self, store, instance_id, *, max_streams=2048, workers=4,
                 page_size=100, max_unacknowledged=1000, timeout=3.0,
                 healthy_interval=5.0, failed_interval=.35):
        bound(max_streams, 10000)
        bound(workers, 32)
        bound(page_size)
        bound(max_unacknowledged, 10000)
        if (page_size > max_unacknowledged or
                any(not math.isfinite(v) or v <= 0 for v in (timeout, healthy_interval, failed_interval))
                or failed_interval > healthy_interval):
            raise ValueError('Invalid gateway delivery bounds.')
        self.store, self.instance_id = store, identity(instance_id)
        self.max_streams, self.workers, self.page_size = max_streams, workers, page_size
        self.max_unacknowledged, self.timeout = max_unacknowledged, timeout
        self.healthy_interval, self.failed_interval = healthy_interval, failed_interval
        self.available = False
        self._streams, self._dirty = {}, set()
        self._paused = set()
        self._wake, self._sweeping = asyncio.Event(), asyncio.Lock()
        self._task, self._closed, self._admitting = None, False, 0
        self._stop_task = None
        self.failures = 0

    def observe_health(self, available):
        if type(available) is not bool:
            raise ValueError('Delivery health must be boolean.')
        if self.available != available:
            self.available = available
            self._dirty.update(self._streams)
            self._wake.set()

    async def subscribe(self, actor, client_id, lane_id, send, *, on_close=None, paused=False):
        client_identity(client_id)
        lane_id = UUID(str(lane_id))
        if (self._closed or not callable(send) or on_close is not None and not callable(on_close)
                or len(self._streams) + self._admitting >= self.max_streams):
            raise RuntimeError('Delivery subscription unavailable.')
        self._admitting += 1
        try:
            async with asyncio.timeout(self.timeout):
                cursor = await self.store.cursor(actor, client_id, lane_id)
            if self._closed or any((s.actor, s.client_id, s.lane_id) == (actor, client_id, lane_id)
                                   for s in self._streams.values()):
                raise RuntimeError('This client stream is already subscribed or closed.')
            handle = uuid4()
            self._streams[handle] = _Stream(actor, client_id, lane_id, send, cursor, cursor, on_close)
            if paused:
                self._paused.add(handle)
            else:
                self._dirty.add(handle)
                self._wake.set()
            return handle
        finally:
            self._admitting -= 1

    def subscription_cursor(self, handle):
        """Trusted socket adapter only; expose before activating a paused stream."""
        if handle not in self._paused:
            raise ValueError('Subscription is not paused.')
        return self._streams[handle].acknowledged

    def activate(self, handle):
        if handle not in self._streams or handle not in self._paused:
            raise ValueError('Subscription is unavailable.')
        self._paused.remove(handle)
        self._dirty.add(handle)
        self._wake.set()

    def unsubscribe(self, handle):
        self._streams.pop(handle, None)
        self._dirty.discard(handle)
        self._paused.discard(handle)

    def active(self, handle):
        """Socket composition must reconnect/reconcile when this becomes false."""
        return handle in self._streams

    async def receive(self, notice):
        if not isinstance(notice, DeliveryWakeup) or notice.instance_id != self.instance_id or self._closed:
            return False
        for handle, stream in self._streams.items():
            if stream.lane_id == notice.lane_id:
                self._dirty.add(handle)
        self._wake.set()
        return True  # Advisory only: does not advance any cursor.

    async def pump(self, handle):
        stream = self._streams.get(handle)
        if stream is None or handle in self._paused:
            return
        async with stream.lock:
            if self._streams.get(handle) is not stream:
                return
            window = self.max_unacknowledged - (stream.sent - stream.acknowledged)
            if window <= 0:
                return
            try:
                async with asyncio.timeout(self.timeout):
                    page = await self.store.page(stream.actor, stream.lane_id, after=stream.sent,
                                                 limit=min(self.page_size, window))
                    if self._streams.get(handle) is not stream or page.scanned_sequence == stream.sent:
                        return
                    await stream.send(dict(type='DELIVERY_PAGE', lane_id=str(page.lane_id), after_sequence=stream.sent,
                        events=list(page.events), scanned_sequence=page.scanned_sequence, has_more=page.has_more))
                    stream.sent = page.scanned_sequence
                    if page.has_more:
                        self._dirty.add(handle)
                        self._wake.set()
            except Exception:
                self.failures += 1
                self.unsubscribe(handle)  # No retry behind a possibly wedged socket send.
                if stream.on_close is not None:
                    try:
                        async with asyncio.timeout(self.timeout):
                            await stream.on_close('delivery_reconciliation_required')
                    except Exception:
                        pass

    async def acknowledge(self, handle, scanned_sequence):
        sequence(scanned_sequence)
        stream = self._streams.get(handle)
        if stream is None:
            raise QueryError('Delivery subscription is closed.')
        async with stream.lock:
            if self._streams.get(handle) is not stream or scanned_sequence > stream.sent:
                raise ValueError('Acknowledgement exceeds this stream delivery.')
            async with asyncio.timeout(self.timeout):
                cursor = await self.store.acknowledge(stream.actor, stream.client_id, stream.lane_id, scanned_sequence)
            stream.acknowledged = max(stream.acknowledged, cursor)
            self._dirty.add(handle)
            self._wake.set()
            return cursor

    async def sweep_once(self, *, safety=True):
        async with self._sweeping:
            if self._closed:
                return
            handles = tuple(self._streams) if safety else tuple(self._dirty)
            self._dirty.difference_update(handles)
            pending = iter(handles)
            async def worker():
                for handle in pending:
                    await self.pump(handle)
            await asyncio.gather(*(worker() for _ in range(self.workers)))

    async def start(self):
        if self._task is not None or self._closed:
            raise RuntimeError('Gateway delivery requires a fresh lifecycle.')
        self._task = asyncio.create_task(self._run(), name='gateway-catchup')

    async def _run(self):
        import time
        next_safety = 0
        while not self._closed:
            self._wake.clear()
            safety = time.monotonic() >= next_safety
            if safety:
                interval = self.healthy_interval if self.available else self.failed_interval
                next_safety = time.monotonic() + interval
            await self.sweep_once(safety=safety)
            try:
                await asyncio.wait_for(self._wake.wait(), max(.001, next_safety - time.monotonic()))
            except TimeoutError:
                pass
            if not self.available:
                next_safety = min(next_safety, time.monotonic() + self.failed_interval)

    async def stop(self):
        self._closed = True
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._stop(), name='gateway-delivery-stop')
        await _join_cleanup(self._stop_task)

    async def _stop(self):
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        self._streams.clear()
        self._dirty.clear()
        self._paused.clear()


class QueryError(PermissionError):
    pass
