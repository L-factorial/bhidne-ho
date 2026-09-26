"""Opt-in Lua/expiry tests against the isolated Redis fixture, never app services."""
import asyncio
from dataclasses import replace
import time
from uuid import uuid4

import pytest

from app.durable_games.redis_presence import ConnectionPresence, ConnectionPresenceRegistry, RedisPresenceStore
from app.durable_games.redis_owner_cache import OwnerHint, RedisOwnerCache
from app.durable_games.ownership import RoomOwnership
from app.durable_games.routing import RoomCommandRouter, RoomWakeupReceiver
from app.durable_games.room_runtime import RoomExecutionRuntime
from app.durable_games.inbox import LaneTarget
from test_redis_live_transport import redis_server, bus
from test_redis_signals import eventually
from test_checkpoint_store import database
from test_room_runtime import start, outcome, rows


@pytest.fixture
async def client(redis_server):
    from redis.asyncio import Redis
    from redis.asyncio.retry import Retry
    from redis.backoff import NoBackoff
    instance = Redis.from_url(redis_server.url, protocol=2, socket_connect_timeout=.2,
        socket_timeout=.2, retry=Retry(NoBackoff(), 0))
    try:
        yield instance
    finally:
        await instance.aclose()


async def test_presence_two_boots_stale_disconnect_expiry_and_indices(client):
    store = RedisPresenceStore(client, ttl=.15)
    old = ConnectionPresence('old-boot', 'old-socket', 'user', 'room')
    new = ConnectionPresence('new-boot', 'new-socket', 'user', 'room')
    assert await store.refresh(old) and await store.refresh(new)
    await store.remove(old)
    await store.remove(old)
    assert (await store.observe('user', 'user')).connections == (new,)
    assert (await store.observe('room', 'room')).connections == (new,)
    # A different socket keeps the index alive while the first record expires.
    await asyncio.sleep(.1)
    other = ConnectionPresence('new-boot', 'other', 'other-user', 'room')
    await store.refresh(other)
    await asyncio.sleep(.07)
    assert (await store.observe('room', 'room')).connections == (other,)
    assert (await store.observe('user', 'user')).connections == ()
    await asyncio.sleep(.16)
    assert not await client.exists(store.key('room', 'room'))


async def test_presence_capacity_overflow_corruption_and_namespace_isolation(client):
    store = RedisPresenceStore(client, max_index=2, read_limit=1)
    first = ConnectionPresence('boot', 'first', 'user', 'room')
    second = replace(first, connection_id='second')
    third = replace(first, connection_id='third')
    assert await store.refresh(first) and await store.refresh(second)
    assert not await store.refresh(third)
    assert await client.zcard(store.key('room', 'room')) == 2
    assert (await store.observe('room', 'room')).status == 'overflow'
    isolated = RedisPresenceStore(client, namespace='other')
    assert (await isolated.observe('room', 'room')).connections == ()
    await store.remove(first)
    await store.remove(second)
    await client.zadd(store.key('room', 'room'), {'bad-json': 10**15})
    assert (await store.observe('room', 'room')).status == 'unknown'


async def test_presence_restart_rebuild_and_periodic_repair_after_key_loss(client, redis_server):
    store = RedisPresenceStore(client, ttl=.6, timeout=.2)
    registry = ConnectionPresenceRegistry(store, 'boot', refresh_interval=.08)
    cache = RedisOwnerCache(client, ttl=.05)
    def health(available):
        registry.observe_health(available)
        cache.observe_health(available)
    transport = bus(redis_server, 'boot', on_health=health)
    await registry.start()
    await transport.start()
    try:
        old, live = registry.attach('user', room_id='room'), registry.attach('user', room_id='room')
        await eventually(lambda: transport.healthy)
        async def wait_count(count):
            async with asyncio.timeout(3):
                while len((await registry.observe('room', 'room')).connections) != count:
                    await asyncio.sleep(.02)
        await wait_count(2)
        await redis_server.stop()
        await eventually(lambda: not registry.available)
        assert (await registry.observe('room', 'room')).status == 'unknown'
        assert await cache.get('room') is None
        await registry.detach(old)
        await redis_server.start()
        await eventually(lambda: registry.available)
        await wait_count(1)
        assert (await registry.observe('user', 'user')).connections == (live,)
        # Key eviction/loss without a subscriber health transition is repaired too.
        await client.delete(*store.keys(live))
        await wait_count(1)
    finally:
        await transport.stop()
        await registry.stop()
    assert (await store.observe('room', 'room')).connections == ()


def state(epoch=1, instance='boot'):
    return RoomOwnership('room', instance, epoch, 'serving', None, True, 'http://internal', True, False)


async def test_owner_cache_compare_delete_monotonic_epoch_expiry_and_health(client):
    cache = RedisOwnerCache(client, ttl=.05)
    assert not await cache.put(state())
    cache.observe_health(True)
    assert await cache.put(state())
    assert await cache.get('room') is None  # Reconnect bypasses pre-existing hints.
    await asyncio.sleep(.06)
    assert await cache.get('room') is None
    assert await cache.put(state())
    old = await cache.get('room')
    assert old.epoch == 1
    assert await cache.put(state(2, 'new'))
    assert not await cache.put(state())
    assert not await cache.put(state(2, 'conflicting-boot'))
    assert not await cache.invalidate(old)
    new = await cache.get('room')
    assert new.instance_id == 'new'
    assert await cache.invalidate(new)
    assert await cache.get('room') is None
    assert not await cache.put(replace(state(), instance_draining=True))
    assert not await cache.put(replace(state(), status='recovering'))
    assert await cache.put(state())
    cache.observe_health(False)
    assert await cache.get('room') is None
    cache.observe_health(True)
    assert await cache.get('room') is None
    await asyncio.sleep(.06)
    assert await cache.get('room') is None


async def test_owner_cache_malformed_wrong_room_and_timeout_fall_back(client, monkeypatch):
    cache = RedisOwnerCache(client, ttl=.01, timeout=.01)
    cache.observe_health(True)
    await asyncio.sleep(.02)
    for value in ('not-json', '{}', OwnerHint('other', 'boot', 1, 'address').encoded()):
        await client.set(cache.key('room'), value)
        assert await cache.get('room') is None
    assert await cache.put(state())
    async def blocked(*args):
        await asyncio.sleep(10)
    monkeypatch.setattr(client, 'get', blocked)
    assert await cache.get('room') is None


async def test_cached_owner_refusal_revalidates_postgres_after_takeover(client, database):
    pool, _, _, users = database
    old, fence = await start(database)
    cache = RedisOwnerCache(client, ttl=1)
    cache.observe_health(True)
    # Pass reconnect read quarantine, then populate with authoritative old owner.
    await asyncio.sleep(1.01)
    old_state = await old.ownership.inspect('room')
    assert await cache.put(old_state)
    await old.stop()
    await rows(pool, "UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    new = RoomExecutionRuntime(pool, 'http://new', scan_interval=.02)
    await new.start()
    calls = []
    try:
        lease = await new.activate(await new.prepare('room', expected_epoch=fence.epoch))
        async def signal(destination, wakeup):
            calls.append(destination.instance_id)
            runtime = old if destination.instance_id == fence.instance_id else new
            return await RoomWakeupReceiver(runtime).receive(wakeup)
        router = RoomCommandRouter(new.inbox, new.ownership, send_remote=signal, owner_cache=cache)
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type':'marriage','capacity':2})
        result = await router.submit(LaneTarget(kind='room',room_id='room'), users[0], body)
        assert result.wakeup == 'signalled'
        assert calls == [fence.instance_id, lease.fence.instance_id]
        assert (await outcome(new.inbox, result.entry.lane_id, users[0], body))['status'] == 'accepted'
        assert (await cache.get('room')).epoch == lease.fence.epoch
        # Valid cache hit avoids the SQL route lookup; receiver still checks its fence.
        async def forbidden(room):
            raise AssertionError('Unexpected route inspection on cache hit')
        new.ownership.inspect = forbidden
        assert await router.wake(result.entry.lane_id) == 'signalled'
    finally:
        await new.stop()
