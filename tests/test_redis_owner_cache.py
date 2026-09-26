import asyncio
from dataclasses import replace
import json

import pytest

from app.durable_games.redis_owner_cache import OwnerHint, RedisOwnerCache
from app.durable_games.ownership import RoomOwnership


class Client:
    def __init__(self):
        self.value = None
        self.reads = 0
        self.gate = None
        self.entered = asyncio.Event()

    async def get(self, key):
        self.reads += 1
        self.entered.set()
        if self.gate:
            await self.gate.wait()
        return self.value


@pytest.mark.parametrize('options', [dict(ttl=0), dict(ttl=6), dict(timeout=float('nan')), dict(namespace='bad namespace')])
def test_invalid_cache_bounds(options):
    with pytest.raises(ValueError): RedisOwnerCache(Client(), **options)


@pytest.mark.parametrize('value', [b'not-json', b'{}', b'[]', b'x'*4097,
    json.dumps(dict(room_id='other', instance_id='boot', epoch=1, internal_address='address')).encode(),
    json.dumps(dict(room_id='room', instance_id='boot', epoch=True, internal_address='address')).encode()])
async def test_malformed_or_misdirected_hint_is_cache_miss(value, monkeypatch):
    client = Client()
    cache = RedisOwnerCache(client)
    cache.observe_health(True)
    monkeypatch.setattr(cache, '_reads_after', 0)
    client.value = value
    assert await cache.get('room') is None


async def test_disabled_and_reconnecting_cache_avoids_reads():
    client = Client()
    cache = RedisOwnerCache(client)
    assert await cache.get('room') is None
    cache.observe_health(True)
    assert await cache.get('room') is None
    assert client.reads == 0
    state = RoomOwnership('room', 'boot', 1, 'serving', None, True, 'address', True, False)
    for invalid in (replace(state, live=False), replace(state, instance_fresh=False),
                    replace(state, instance_draining=True), replace(state, status='quarantined')):
        assert not await cache.put(invalid)


async def test_read_crossing_reconnect_is_discarded(monkeypatch):
    client = Client()
    client.value = OwnerHint('room', 'boot', 1, 'address').encoded()
    client.gate = asyncio.Event()
    cache = RedisOwnerCache(client)
    cache.observe_health(True)
    monkeypatch.setattr(cache, '_reads_after', 0)
    pending = asyncio.create_task(cache.get('room'))
    await client.entered.wait()
    cache.observe_health(False)
    cache.observe_health(True)
    client.gate.set()
    assert await pending is None
