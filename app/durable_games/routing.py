"""Explicit durable ingress and owner wakeups; no endpoint or network transport.

Callers authenticate actors and authorize lane ingress before submit(). Executors
still reauthorize commands. Wakeups contain neither commands nor credentials and
are advisory: only the receiving runtime can admit execution. Explicit authenticated
Redis transport binds send_remote(destination, wakeup); owner caching is optional.
"""
import asyncio
from dataclasses import dataclass, field
import math
from uuid import UUID

from .inbox import InboxEntry, LaneTarget
from .redis_owner_cache import OwnerHint


@dataclass(frozen=True)
class RoomWakeup:
    room_id: str
    lane_id: UUID
    instance_id: str
    epoch: int

    def __post_init__(self):
        if (not isinstance(self.room_id, str) or not self.room_id.strip()
                or not isinstance(self.lane_id, UUID)
                or not isinstance(self.instance_id, str) or not self.instance_id.strip()
                or type(self.epoch) is not int or self.epoch < 1):
            raise ValueError('Invalid room wakeup identity.')


@dataclass(frozen=True)
class RoutedCommand:
    entry: InboxEntry = field(repr=False)
    wakeup: str  # terminal, signalled, or a deferred reason; never execution success.


def _bounds(max_inflight, timeout):
    if (type(max_inflight) is not int or max_inflight < 1
            or not math.isfinite(timeout) or timeout <= 0):
        raise ValueError('Routing bounds must be positive and finite.')


class RoomWakeupReceiver:
    """Trusted internal adapter. Reject stale hints without revoking a newer owner."""
    def __init__(self, runtime, *, max_inflight=32, timeout=3.0):
        _bounds(max_inflight, timeout)
        self.runtime, self.max_inflight, self.timeout = runtime, max_inflight, timeout
        self._inflight = 0

    async def receive(self, wakeup):
        if not isinstance(wakeup, RoomWakeup):
            raise ValueError('Expected a validated room wakeup.')
        if self._inflight >= self.max_inflight:
            return False
        self._inflight += 1
        try:
            async with asyncio.timeout(self.timeout):
                fence = self.runtime.admitted_fence(wakeup.room_id)
                if (fence is None or fence.instance_id != wakeup.instance_id
                        or fence.epoch != wakeup.epoch):
                    return False
                # Validate before scheduler.offer: a mismatched hint must not
                # poison a healthy room's execution queue or failure policy.
                async with self.runtime.pool.connection() as connection:
                    target, _, _ = await self.runtime.inbox._lane(connection, wakeup.lane_id)
                if target.room_id != wakeup.room_id or target.kind not in ('room', 'table', 'game', 'room_chat', 'table_chat', 'game_chat'):
                    return False
                return self.runtime.offer(wakeup.lane_id, fence)
        except Exception:
            # No payload/error text escapes this internal advisory boundary.
            return False
        finally:
            self._inflight -= 1


class RoomCommandRouter:
    def __init__(self, inbox, ownership, *, local_receiver=None, send_remote=None,
                 max_inflight=32, timeout=3.0, owner_cache=None):
        _bounds(max_inflight, timeout)
        if send_remote is not None and not callable(send_remote):
            raise ValueError('Remote wakeup sender must be callable.')
        self.inbox, self.ownership = inbox, ownership
        self.local_receiver, self.send_remote = local_receiver, send_remote
        self.owner_cache = owner_cache
        self.max_inflight, self.timeout = max_inflight, timeout
        self._inflight = 0

    async def submit(self, target, actor_id, request):
        """Persist first. Caller retries uncertain DB writes with the same command ID.

        A successful return confirms durable ingress, not command acceptance.
        Notification failures never undo or reject an already committed command.
        """
        target = LaneTarget.model_validate(target)
        if target.kind not in ('room', 'table', 'game', 'room_chat', 'table_chat', 'game_chat'):
            raise ValueError('This router supports only room/table/game commands.')
        lane = await self.inbox.ensure_lane(target)
        entry = await self.inbox.enqueue(lane, actor_id, request)
        # Inbox dedup can return the original round's lane after a rollover.
        status = 'terminal' if entry.status != 'pending' else await self.wake(entry.lane_id)
        return RoutedCommand(entry, status)

    @staticmethod
    def _unavailable(state):
        if state is None or state.status == 'unowned':
            return 'unowned'
        if state.status == 'quarantined':
            return 'quarantined'
        if not state.live:
            return 'expired'
        if state.status != 'serving':
            return state.status
        if state.instance_draining:
            return 'draining'
        if not state.instance_fresh or not state.internal_address:
            return 'owner_unavailable'
        return None

    async def _signal(self, state, lane_id):
        wakeup = RoomWakeup(state.room_id, lane_id, state.instance_id, state.epoch)
        if (self.local_receiver is not None and state.instance_id ==
                self.local_receiver.runtime.leases.registration.instance_id):
            return await self.local_receiver.receive(wakeup)
        if self.send_remote is None:
            return False
        return await self.send_remote(state, wakeup) is True

    async def wake(self, lane_id):
        """At most two destinations and one route refresh; no queued routing tasks.

        Refusal, saturation, or failure leaves durable work for scans/retries. This
        adapter never acquires or releases ownership, even for an expired hint.
        """
        if self._inflight >= self.max_inflight:
            return 'routing_busy'
        self._inflight += 1
        try:
            async with asyncio.timeout(self.timeout):
                async with self.inbox.pool.connection() as connection:
                    target, _, _ = await self.inbox._lane(connection, lane_id)
                if target.kind not in ('room', 'table', 'game', 'room_chat', 'table_chat', 'game_chat'):
                    return 'unsupported_lane'
                previous = None
                cached = await self.owner_cache.get(target.room_id) if self.owner_cache else None
                for attempt in range(2):
                    if attempt == 0 and cached is not None:
                        state = cached
                    else:
                        state = await self.ownership.inspect(target.room_id)
                        reason = self._unavailable(state)
                        if reason is not None:
                            return reason
                        if self.owner_cache is not None:
                            await self.owner_cache.put(state)
                    identity = (state.instance_id, state.epoch, state.internal_address)
                    if identity == previous:
                        return 'owner_unavailable'
                    previous = identity
                    try:
                        if await self._signal(state, lane_id):
                            return 'signalled'
                    except Exception:
                        pass  # Refresh once after a transport error or refusal.
                    if self.owner_cache is not None:
                        await self.owner_cache.invalidate(OwnerHint(state.room_id, state.instance_id,
                            state.epoch, state.internal_address))
                return 'owner_unavailable'
        except TimeoutError:
            return 'routing_timeout'
        except Exception:
            return 'routing_unavailable'
        finally:
            self._inflight -= 1
