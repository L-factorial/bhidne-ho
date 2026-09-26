"""Short-lived advisory routes, populated only from PostgreSQL inspection.

A cached route grants no execution rights. Only addressed wakeups may use it;
receivers and durable executors still validate their PostgreSQL fences.
"""
import asyncio
from dataclasses import asdict, dataclass
import hashlib
import json
import math
import time

from .redis_presence import identity, namespace_key


_PUT = '''
local old = redis.call('GET', KEYS[1])
if old then
    local ok, parsed = pcall(cjson.decode, old)
    if ok and type(parsed) == 'table' and type(parsed.epoch) == 'number' then
        if parsed.epoch > tonumber(ARGV[2]) then return 0 end
        if parsed.epoch == tonumber(ARGV[2]) and parsed.instance_id ~= ARGV[3] then return 0 end
    end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[4])
return 1
'''
_DELETE = '''
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
'''


@dataclass(frozen=True)
class OwnerHint:
    room_id: str
    instance_id: str
    epoch: int
    internal_address: str

    def __post_init__(self):
        identity(self.room_id)
        identity(self.instance_id)
        if type(self.epoch) is not int or not 1 <= self.epoch <= 2 ** 53 - 1:
            raise ValueError('Invalid owner epoch.')
        if not isinstance(self.internal_address, str) or not 1 <= len(self.internal_address) <= 2048:
            raise ValueError('Invalid owner address.')

    def encoded(self):
        return json.dumps(asdict(self), sort_keys=True, separators=(',', ':'))


class RedisOwnerCache:
    def __init__(self, client, *, namespace='bhidne-ho:runtime:v1', ttl=2.0, timeout=.2):
        if (any(not math.isfinite(v) or v <= 0 for v in (ttl, timeout)) or not .01 <= ttl <= 5):
            raise ValueError('Invalid owner-cache bounds.')
        self.client, self.namespace, self.ttl, self.timeout = client, namespace_key(namespace), ttl, timeout
        self.available = False
        self._generation = 0
        self._reads_after = 0

    def observe_health(self, available):
        if type(available) is not bool:
            raise ValueError('Transport health must be boolean.')
        if self.available != available:
            self._generation += 1
            if available:
                # Let pre-disconnect values expire; rebuild from PostgreSQL.
                self._reads_after = time.monotonic() + self.ttl
        self.available = available

    def key(self, room_id):
        return f'{self.namespace}:owner:{hashlib.sha256(identity(room_id).encode()).hexdigest()}'

    async def get(self, room_id):
        key = self.key(room_id)
        if not self.available or time.monotonic() < self._reads_after:
            return None
        generation = self._generation
        try:
            async with asyncio.timeout(self.timeout):
                raw = await self.client.get(key)
            if raw is None or not self.available or generation != self._generation:
                return None
            if not isinstance(raw, (str, bytes)) or len(raw) > 4096:
                return None
            hint = OwnerHint(**json.loads(raw))
            return hint if hint.room_id == room_id else None
        except Exception:
            return None

    async def put(self, state):
        """Caller supplies a fresh authoritative ownership.inspect result."""
        if (not self.available or state is None or state.status != 'serving'
                or not state.live or not state.instance_fresh or state.instance_draining
                or not state.internal_address):
            return False
        try:
            hint = OwnerHint(state.room_id, state.instance_id, state.epoch, state.internal_address)
            async with asyncio.timeout(self.timeout):
                return await self.client.eval(_PUT, 1, self.key(hint.room_id), hint.encoded(),
                    hint.epoch, hint.instance_id, math.ceil(self.ttl * 1000)) == 1
        except Exception:
            return False

    async def invalidate(self, hint):
        """Compare/delete so a delayed refusal cannot remove a newer route."""
        if not self.available:
            return False
        try:
            async with asyncio.timeout(self.timeout):
                return await self.client.eval(_DELETE, 1, self.key(hint.room_id), hint.encoded()) == 1
        except Exception:
            return False
