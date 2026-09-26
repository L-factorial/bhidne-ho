"""Explicit ephemeral socket registrations; never membership or seat authority.

Each registration has its own immutable ID. Index writes are advisory and may be
partial during failure; empty observations are never evidence of disconnection.
Redis TIME drives expiry. No worker starts on import or construction.
"""
import asyncio
from dataclasses import asdict, dataclass, field
import hashlib
import json
import math
import re
from uuid import uuid4


# Each script accesses one index, so user/room indices also work on separate slots.
# Bounded pruning keeps both script work and retained members bounded.
_REFRESH = '''
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 128)
if #expired > 0 then redis.call('ZREM', KEYS[1], unpack(expired)) end
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) and
    redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
'''
_READ = '''
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
return redis.call('ZRANGEBYSCORE', KEYS[1], '(' .. now, '+inf', 'LIMIT', 0, ARGV[1])
'''


def identity(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError('Expected an identity of 1 to 128 characters.')
    return value


def namespace_key(namespace):
    if not isinstance(namespace, str) or re.fullmatch(r'[A-Za-z0-9:_-]{1,80}', namespace) is None:
        raise ValueError('Invalid Redis namespace.')
    return namespace


@dataclass(frozen=True)
class ConnectionPresence:
    instance_id: str
    connection_id: str
    user_id: str
    room_id: str | None = None

    def __post_init__(self):
        for value in (self.instance_id, self.connection_id, self.user_id):
            identity(value)
        if self.room_id is not None:
            identity(self.room_id)

    def encoded(self):
        return json.dumps(asdict(self), sort_keys=True, separators=(',', ':'))


@dataclass(frozen=True)
class PresenceObservation:
    status: str  # observed, unknown, overflow; never an authoritative offline list.
    connections: tuple[ConnectionPresence, ...] = ()


class RedisPresenceStore:
    def __init__(self, client, *, namespace='bhidne-ho:runtime:v1', ttl=30.0,
                 max_index=4096, read_limit=512, timeout=1.0):
        if (any(not math.isfinite(v) or v <= 0 for v in (ttl, timeout)) or ttl < .01
                or type(max_index) is not int or not 1 <= max_index <= 10000
                or type(read_limit) is not int or not 1 <= read_limit <= max_index):
            raise ValueError('Invalid presence bounds.')
        self.client, self.namespace = client, namespace_key(namespace)
        self.ttl, self.max_index, self.read_limit, self.timeout = ttl, max_index, read_limit, timeout

    def key(self, kind, value):
        if kind not in ('user', 'room'):
            raise ValueError('Invalid presence index.')
        digest = hashlib.sha256(identity(value).encode()).hexdigest()
        return f'{self.namespace}:presence:{kind}:{digest}'

    def keys(self, presence):
        keys = [self.key('user', presence.user_id)]
        if presence.room_id is not None:
            keys.append(self.key('room', presence.room_id))
        return keys

    async def refresh(self, presence):
        async with asyncio.timeout(self.timeout):
            results = []
            for key in self.keys(presence):
                results.append(await self.client.eval(_REFRESH, 1, key, presence.encoded(),
                    math.ceil(self.ttl * 1000), self.max_index))
            return all(value == 1 for value in results)

    async def remove(self, presence):
        async with asyncio.timeout(self.timeout):
            for key in self.keys(presence):
                await self.client.zrem(key, presence.encoded())

    async def observe(self, kind, value):
        key = self.key(kind, value)
        try:
            async with asyncio.timeout(self.timeout):
                rows = await self.client.eval(_READ, 1, key, self.read_limit + 1)
            if len(rows) > self.read_limit:
                return PresenceObservation('overflow')
            connections = []
            for raw in rows:
                if not isinstance(raw, (bytes, str)) or len(raw) > 4096:
                    raise ValueError('Invalid presence record.')
                presence = ConnectionPresence(**json.loads(raw))
                if getattr(presence, kind + '_id') != value:
                    raise ValueError('Wrong presence index.')
                connections.append(presence)
            return PresenceObservation('observed', tuple(connections))
        except Exception:
            return PresenceObservation('unknown')


@dataclass
class _Tracked:
    presence: ConnectionPresence
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class ConnectionPresenceRegistry:
    """Gateway-owned local socket inventory with bounded Redis refresh workers.

    Call attach only after authentication/room authorization. Disconnect and room
    changes never mutate database membership. Callers retain the returned handle.
    """
    def __init__(self, store, instance_id, *, refresh_interval=10.0,
                 max_connections=2048, workers=8):
        if (not math.isfinite(refresh_interval) or not 0 < refresh_interval < store.ttl / 2
                or type(max_connections) is not int or max_connections < 1
                or type(workers) is not int or not 1 <= workers <= max_connections):
            raise ValueError('Invalid presence refresh bounds.')
        self.store, self.instance_id = store, identity(instance_id)
        self.refresh_interval, self.max_connections, self.workers = refresh_interval, max_connections, workers
        self.available = False
        self._generation = 0
        self._entries = {}
        self._wake, self._sweeping = asyncio.Event(), asyncio.Lock()
        self._task, self._stop_task = None, None
        self._closed = False
        self.refresh_failures = 0

    def observe_health(self, available):
        if type(available) is not bool:
            raise ValueError('Transport health must be boolean.')
        if available != self.available:
            self._generation += 1
            self.available = available
            self._wake.set()  # Rebuild every surviving socket after reconnection.

    async def start(self):
        if self._task is not None or self._closed:
            raise RuntimeError('Presence registry requires a fresh lifecycle.')
        self._task = asyncio.create_task(self._run(), name='redis-presence-refresh')

    def attach(self, user_id, *, room_id=None):
        if self._closed or self._task is None or self._task.done():
            raise RuntimeError('Presence registry is not running.')
        if len(self._entries) >= self.max_connections:
            raise RuntimeError('Local presence capacity reached.')
        presence = ConnectionPresence(self.instance_id, uuid4().hex, user_id, room_id)
        self._entries[presence.connection_id] = _Tracked(presence)
        self._wake.set()
        return presence

    async def detach(self, presence):
        entry = self._entries.get(presence.connection_id)
        if entry is None or entry.presence != presence:
            return
        del self._entries[presence.connection_id]
        # Serialize known in-flight refreshes before removal. An uncertain Redis
        # completion can still leave a stale observation until its TTL expires.
        async with entry.lock:
            try:
                await self.store.remove(presence)
            except Exception:
                pass  # Unknown removal expires by TTL; never release a seat.

    async def observe(self, kind, value):
        if not self.available or self._closed:
            return PresenceObservation('unknown')
        generation = self._generation
        result = await self.store.observe(kind, value)
        if not self.available or self._closed or generation != self._generation:
            return PresenceObservation('unknown')
        return result

    async def refresh_once(self):
        async with self._sweeping:
            entries = iter(tuple(self._entries.values()))
            async def worker():
                for entry in entries:
                    async with entry.lock:
                        if (self._closed or not self.available or
                                self._entries.get(entry.presence.connection_id) is not entry):
                            continue
                        try:
                            if not await self.store.refresh(entry.presence):
                                self.refresh_failures += 1
                        except Exception:
                            self.refresh_failures += 1
            await asyncio.gather(*(worker() for _ in range(self.workers)))

    async def _run(self):
        while not self._closed:
            self._wake.clear()
            await self.refresh_once()
            try:
                await asyncio.wait_for(self._wake.wait(), self.refresh_interval)
            except TimeoutError:
                pass

    async def stop(self):
        self._closed, self.available = True, False
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._stop(), name='redis-presence-stop')
        cancelled = False
        while not self._stop_task.done():
            try:
                await asyncio.shield(self._stop_task)
            except asyncio.CancelledError:
                cancelled = True
        self._stop_task.result()
        if cancelled:
            raise asyncio.CancelledError

    async def _stop(self):
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        entries = iter(tuple(self._entries.values()))
        async def worker():
            for entry in entries:
                await self.detach(entry.presence)
        await asyncio.gather(*(worker() for _ in range(self.workers)))
