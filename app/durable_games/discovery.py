"""Explicit bounded durable placement discovery; never installed in live startup."""
import asyncio
from collections import deque
from dataclasses import dataclass
import math

from .placement import PlacementResult


class PostgresPlacementDemandStore:
    def __init__(self, pool):
        self.pool = pool

    async def page(self, *, instance_id, after_room_id='', limit=32):
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('Invalid discovery page size.')
        # Limit rooms BEFORE testing work. Empty/noneligible pages still advance
        # the cursor; historical rooms cannot make a single pass unbounded.
        async with self.pool.connection() as connection:
            return await (await connection.execute('''WITH page AS MATERIALIZED (
                SELECT id FROM rooms WHERE id>%s ORDER BY id LIMIT %s
            ) SELECT p.id,
                COALESCE(o.runtime_status<>'quarantined',true)
                AND (o.lease_expires_at IS NULL OR o.lease_expires_at<=clock_timestamp()
                    OR (o.owner_instance_id=%s AND o.runtime_status='recovering'))
                AND (
                    EXISTS (SELECT 1 FROM command_lanes l WHERE l.room_id=p.id
                        AND l.kind IN ('room','table','game','room_chat','table_chat','game_chat')
                        AND l.processed_sequence<l.enqueued_sequence)
                    OR EXISTS (SELECT 1 FROM scheduled_actions a JOIN command_lanes l USING(lane_id)
                        WHERE l.room_id=p.id AND l.kind IN ('room','table','game')
                        AND a.status='pending' AND a.due_at<=clock_timestamp())
                    OR EXISTS (SELECT 1 FROM game_finalization_jobs j JOIN games g ON g.id=j.game_id
                        WHERE g.room_id=p.id AND j.completed_at IS NULL AND j.next_attempt_at<=clock_timestamp())
                    OR EXISTS (SELECT 1 FROM games g WHERE g.room_id=p.id
                        AND g.table_id IS NOT NULL AND g.status='active')
                ) AS needed FROM page p LEFT JOIN room_ownership o ON o.room_id=p.id
                ORDER BY p.id''', (after_room_id, limit, instance_id))).fetchall()


@dataclass(frozen=True)
class PlacementDemand:
    room_id: str
    instance_id: str

    def __post_init__(self):
        if any(not isinstance(v, str) or not v.strip() for v in (self.room_id, self.instance_id)):
            raise ValueError('Invalid placement demand identity.')


class PlacementDemandReceiver:
    """Trusted internal adapter; transport authenticates callers before invoking."""
    def __init__(self, coordinator):
        self.coordinator = coordinator

    async def receive(self, demand):
        if not isinstance(demand, PlacementDemand):
            raise ValueError('Expected a validated placement demand.')
        if demand.instance_id != self.coordinator.runtime.leases.registration.instance_id:
            return PlacementResult(demand.room_id, 'wrong_instance')
        # Recompute placement; never forward recursively or trust an old selection.
        return await self.coordinator.ensure_owner(demand.room_id)


@dataclass(frozen=True)
class DiscoveryResult:
    placement: PlacementResult
    dispatch: str


class RoomPlacementDiscovery:
    def __init__(self, coordinator, *, batch_size=32, workers=2, interval=1.0,
                 timeout=3.0, send_remote=None):
        if (type(batch_size) is not int or not 1 <= batch_size <= 1000
                or type(workers) is not int or not 1 <= workers <= coordinator.max_inflight
                or any(not math.isfinite(v) or v <= 0 for v in (interval, timeout))
                or send_remote is not None and not callable(send_remote)):
            raise ValueError('Invalid discovery bounds.')
        self.coordinator, self.runtime = coordinator, coordinator.runtime
        self.store = PostgresPlacementDemandStore(self.runtime.pool)
        self.batch_size, self.workers, self.interval, self.timeout = batch_size, workers, interval, timeout
        self.send_remote = send_remote
        self.cursor = ''
        self.failures = deque(maxlen=batch_size)
        self._sweeping = asyncio.Lock()
        self._lifecycle = asyncio.Lock()
        self._task = None
        self._closed = False

    def _available(self):
        return not self._closed and self.runtime._healthy() and self.runtime.leases.accepts_placement()

    async def _process(self, room_id):
        if not self._available():
            return DiscoveryResult(PlacementResult(room_id, 'unavailable'), 'skipped')
        result = await self.coordinator.ensure_owner(room_id)
        if result.status != 'selected_remote':
            return DiscoveryResult(result, 'local')
        if self.send_remote is None or not self._available():
            return DiscoveryResult(result, 'deferred')
        try:
            async with asyncio.timeout(self.timeout):
                accepted = await self.send_remote(result, PlacementDemand(room_id, result.instance_id))
            return DiscoveryResult(result, 'signalled' if accepted is True else 'refused')
        except TimeoutError:
            return DiscoveryResult(result, 'timeout')
        except Exception:
            return DiscoveryResult(result, 'failed')

    async def sweep_once(self):
        async with self._sweeping:
            if not self._available():
                return ()
            async with asyncio.timeout(self.timeout):
                page = await self.store.page(instance_id=self.runtime.leases.registration.instance_id,
                    after_room_id=self.cursor, limit=self.batch_size)
            if not page:
                self.cursor = ''
                return ()
            results = {}
            pending = iter(room_id for room_id, needed in page if needed)
            async def worker():
                for room_id in pending:
                    try:
                        results[room_id] = await self._process(room_id)
                    except Exception as error:
                        results[room_id] = DiscoveryResult(
                            PlacementResult(room_id, 'failed', error_type=type(error).__name__), 'failed')
            tasks = [asyncio.create_task(worker()) for _ in range(self.workers)]
            try:
                await asyncio.gather(*tasks)
            finally:
                for task in tasks:
                    if not task.done(): task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
            # On cancellation leave the cursor unchanged so durable work is revisited.
            self.cursor = page[-1][0]
            return tuple(results[room_id] for room_id, _ in page if room_id in results)

    async def start(self):
        async with self._lifecycle:
            if self._task is not None or not self._available():
                raise RuntimeError('Discovery requires an available runtime and a fresh lifecycle.')
            self._task = asyncio.create_task(self._loop(), name='room-placement-discovery')

    async def _loop(self):
        while not self._closed:
            try:
                await self.sweep_once()
            except Exception as error:
                self.failures.append(type(error).__name__)
            await asyncio.sleep(self.interval)

    async def stop(self):
        async with self._lifecycle:
            self._closed = True
            cleanup = asyncio.create_task(self._join(), name='room-discovery-stop')
            cancelled = False
            while not cleanup.done():
                try:
                    await asyncio.shield(cleanup)
                except asyncio.CancelledError:
                    cancelled = True
            cleanup.result()
            if cancelled:
                raise asyncio.CancelledError

    async def _join(self):
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        async with self._sweeping:
            pass
