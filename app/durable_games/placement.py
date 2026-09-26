"""Explicit demand-driven owner selection; no fleet scanner or network endpoint."""
import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from fractions import Fraction
import hashlib
import math
import time

from .activation import ACTIVATION_CAPABILITIES
from .recovery_coordinator import _TRANSIENT


@dataclass(frozen=True)
class PlacementResult:
    room_id: str
    status: str
    instance_id: str | None = None
    internal_address: str | None = None
    epoch: int | None = None
    error_type: str | None = None


class RoomOwnerCoordinator:
    def __init__(self, runtime, *, max_inflight=4, max_candidates=256, cooldown=1.0, lookup_timeout=3.0):
        if (type(max_inflight) is not int or max_inflight < 1
                or type(max_candidates) is not int or not 1 <= max_candidates <= 1024
                or any(not math.isfinite(v) or v <= 0 for v in (cooldown, lookup_timeout))):
            raise ValueError('Invalid placement bounds.')
        self.runtime = runtime
        self.max_inflight, self.max_candidates = max_inflight, max_candidates
        self.cooldown, self.lookup_timeout = cooldown, lookup_timeout
        self._active = set()
        self._cooldowns = OrderedDict()

    async def ensure_owner(self, room_id):
        if not isinstance(room_id, str) or not room_id.strip():
            raise ValueError('Room identity must be nonempty.')
        runtime = self.runtime
        if not runtime._healthy() or not runtime.leases.accepts_placement():
            return PlacementResult(room_id, 'unavailable')
        local = runtime.admitted_fence(room_id)
        if local is not None:
            return PlacementResult(room_id, 'serving', local.instance_id, epoch=local.epoch)
        if room_id in self._active or len(self._active) >= self.max_inflight:
            return PlacementResult(room_id, 'busy')
        if time.monotonic() < self._cooldowns.get(room_id, 0):
            return PlacementResult(room_id, 'backoff')
        self._active.add(room_id)
        try:
            return await self._ensure(room_id)
        except _TRANSIENT as error:
            return PlacementResult(room_id, 'retryable', error_type=type(error).__name__)
        except Exception as error:
            return PlacementResult(room_id, 'failed', error_type=type(error).__name__)
        finally:
            self._active.remove(room_id)
            self._cooldowns[room_id] = time.monotonic() + self.cooldown
            self._cooldowns.move_to_end(room_id)
            while len(self._cooldowns) > self.runtime.leases.max_rooms:
                self._cooldowns.popitem(last=False)

    async def _ensure(self, room_id):
        runtime = self.runtime
        instance = runtime.leases.registration.instance_id
        async with asyncio.timeout(self.lookup_timeout):
            state = await runtime.ownership.inspect(room_id)
            # inspect(None) also means no ownership row; distinguish a missing room.
            if state is None:
                async with runtime.pool.connection() as connection:
                    exists = await (await connection.execute('SELECT 1 FROM rooms WHERE id=%s', (room_id,))).fetchone()
                if exists is None:
                    return PlacementResult(room_id, 'not_found')
        intent = runtime.leases.placement_intent(room_id)
        if state is not None and state.status == 'quarantined':
            return PlacementResult(room_id, 'quarantined', epoch=state.epoch)
        if state is not None and state.live:
            if not (state.instance_id == instance and state.status == 'recovering'
                    and intent is not None and not intent[1] and intent[0] + 1 == state.epoch):
                return PlacementResult(room_id, 'owned', state.instance_id, state.internal_address, state.epoch)
        epoch = state.epoch if state is not None else 0
        # Only discard lost/obsolete intents after SQL says no live owner. An
        # unknown same-epoch commit must keep its original token and input epoch.
        if intent is not None and (intent[1] or epoch > intent[0] and not (state and state.live)):
            if not runtime.leases.forget_placement_intent(room_id, intent[0]):
                return PlacementResult(room_id, 'busy')
            intent = None
        if intent is None:
            runtime.leases.prune_lost_placement_intents()
            if not runtime.retire_unavailable_room(room_id):
                return PlacementResult(room_id, 'busy')
            async with asyncio.timeout(self.lookup_timeout):
                candidates = await runtime.ownership.placement_candidates(limit=self.max_candidates)
            if len(candidates) > self.max_candidates:
                return PlacementResult(room_id, 'candidate_limit')
            eligible = []
            for identity, address, caps, count in candidates:
                capacity = caps.get('room_capacity')
                if (type(capacity) is not int or capacity < 1 or count >= capacity
                        or any(type(caps.get(k)) is not int or caps[k] != v for k, v in ACTIVATION_CAPABILITIES.items())):
                    continue
                rank = hashlib.sha256((room_id + '\0' + identity).encode()).digest()
                eligible.append((Fraction(count, capacity), rank, identity, address))
            if not eligible:
                return PlacementResult(room_id, 'no_capacity')
            _, _, selected, address = min(eligible)
            if selected != instance:
                return PlacementResult(room_id, 'selected_remote', selected, address, epoch)
        expected = intent[0] if intent is not None else epoch
        result = await runtime.prepare(room_id, expected_epoch=expected)
        if result.status != 'prepared':
            # Unknown acquisition responses retain the original lease intent.
            if result.fence is None and not result.retry_same_intent and result.status != 'busy':
                runtime.leases.forget_placement_intent(room_id, expected)
            return PlacementResult(room_id, result.status, epoch=epoch, error_type=result.error_type)
        lease = await runtime.activate(result)
        return PlacementResult(room_id, 'serving', instance, epoch=lease.fence.epoch)
