"""Bounded two-level cache of versioned, already-authorized read projections.

Keys include the actor and committed dependency versions. Callers MUST authorize
and read versions in the same database snapshot as a miss loader. Old fills can
never replace a newer version. This cache grants no mutation/ownership authority.
"""
import asyncio
from collections import OrderedDict
from hashlib import sha256
import json
from time import monotonic

from .redis_presence import namespace_key
from .telemetry import CACHE


class ReadCache:
    def __init__(self, redis, *, namespace='bhidne-ho:runtime:v1', ttl=30,
                 max_entries=256, max_bytes=16 * 1024 * 1024, max_value_bytes=512 * 1024,
                 timeout=.15):
        if min(ttl, max_entries, max_bytes, max_value_bytes, timeout) <= 0:
            raise ValueError('Cache bounds must be positive.')
        self.redis, self.namespace = redis, namespace_key(namespace)
        self.ttl, self.max_entries, self.max_bytes = ttl, max_entries, max_bytes
        self.max_value_bytes, self.timeout = max_value_bytes, timeout
        self._local, self._bytes = OrderedDict(), 0

    def prune_expired(self):
        """Physically release expired local payloads even when their keys go idle."""
        now = monotonic()
        for key, (expires, raw) in list(self._local.items()):
            if expires <= now:
                self._local.pop(key, None)
                self._bytes -= len(raw)

    def key(self, family, identity, version):
        raw = json.dumps([family, identity, version], sort_keys=True, default=str, separators=(',', ':'))
        return f'{self.namespace}:reads:v1:{sha256(raw.encode()).hexdigest()}'

    def _remember(self, key, raw):
        if len(raw) > min(self.max_value_bytes, self.max_bytes):
            return
        previous = self._local.pop(key, None)
        if previous:
            self._bytes -= len(previous[1])
        self._local[key] = (monotonic() + self.ttl, raw)
        self._bytes += len(raw)
        while len(self._local) > self.max_entries or self._bytes > self.max_bytes:
            _, (_, removed) = self._local.popitem(last=False)
            self._bytes -= len(removed)

    async def get(self, key):
        item = self._local.pop(key, None)
        if item:
            expires, raw = item
            if expires > monotonic():
                self._local[key] = item
                CACHE.labels('memory_hit').inc()
                return json.loads(raw)
            self._bytes -= len(raw)
        try:
            async with asyncio.timeout(self.timeout):
                raw = await self.redis.get(key)
            if raw is not None and len(raw) <= self.max_value_bytes:
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError('Invalid projection cache value.')
                self._remember(key, raw)
                CACHE.labels('redis_hit').inc()
                return value
        except Exception:
            CACHE.labels('redis_error').inc()
        CACHE.labels('miss').inc()
        return None

    async def put(self, key, value):
        raw = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
        if len(raw) > self.max_value_bytes:
            CACHE.labels('oversize').inc()
            return
        self._remember(key, raw)
        try:
            async with asyncio.timeout(self.timeout):
                await self.redis.set(key, raw, px=max(1, int(self.ttl * 1000)))
        except Exception:
            CACHE.labels('redis_error').inc()
