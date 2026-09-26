import asyncio
from dataclasses import replace

import pytest

from app.durable_games.redis_presence import ConnectionPresence, ConnectionPresenceRegistry, PresenceObservation
from test_redis_signals import eventually


class Store:
    ttl = 30
    def __init__(self):
        self.entries = {}
        self.gate = None
        self.entered = asyncio.Event()
        self.fail = False

    async def refresh(self, presence):
        self.entered.set()
        if self.gate:
            await self.gate.wait()
        if self.fail:
            raise TimeoutError()
        self.entries[presence.connection_id] = presence
        return True

    async def remove(self, presence):
        self.entries.pop(presence.connection_id, None)

    async def observe(self, kind, value):
        return PresenceObservation('observed', tuple(p for p in self.entries.values()
            if getattr(p, kind + '_id') == value))


async def test_old_disconnect_and_multiple_devices_are_independent():
    store = Store()
    registry = ConnectionPresenceRegistry(store, 'boot', refresh_interval=.01)
    await registry.start()
    registry.observe_health(True)
    try:
        old = registry.attach('user', room_id='room')
        new = registry.attach('user', room_id='room')
        other = registry.attach('user', room_id='other')
        await eventually(lambda: len(store.entries) == 3)
        await registry.detach(replace(new, instance_id='other-boot'))
        assert new.connection_id in store.entries
        await registry.detach(old)
        await registry.detach(old)
        assert (await registry.observe('room', 'room')).connections == (new,)
        assert set((await registry.observe('user', 'user')).connections) == {new, other}
    finally:
        await registry.stop()
    assert not store.entries


async def test_disconnect_waits_for_refresh_then_removes_without_resurrection():
    store = Store()
    store.gate = asyncio.Event()
    registry = ConnectionPresenceRegistry(store, 'boot', refresh_interval=.01)
    await registry.start()
    registry.observe_health(True)
    connection = registry.attach('user')
    await store.entered.wait()
    closing = asyncio.create_task(registry.detach(connection))
    await asyncio.sleep(.01)
    assert not closing.done()
    store.gate.set()
    await closing
    await registry.refresh_once()
    assert not store.entries
    await registry.stop()


async def test_reconnect_rebuilds_only_remaining_sockets_and_unknown_is_explicit():
    store = Store()
    registry = ConnectionPresenceRegistry(store, 'boot', refresh_interval=10)
    await registry.start()
    try:
        old, live = registry.attach('old'), registry.attach('live')
        assert (await registry.observe('user', 'old')).status == 'unknown'
        registry.observe_health(True)
        await eventually(lambda: len(store.entries) == 2)
        registry.observe_health(False)
        store.entries.clear()
        await registry.detach(old)
        assert (await registry.observe('user', 'live')).status == 'unknown'
        registry.observe_health(True)
        await eventually(lambda: list(store.entries.values()) == [live])
        assert (await registry.observe('user', 'absent')).status == 'observed'
        assert not (await registry.observe('user', 'absent')).connections
    finally:
        await registry.stop()


async def test_capacity_failure_retry_and_one_shot_lifecycle():
    store = Store()
    registry = ConnectionPresenceRegistry(store, 'boot', max_connections=1, workers=1, refresh_interval=.01)
    with pytest.raises(RuntimeError): registry.attach('user')
    await registry.start()
    registry.observe_health(True)
    store.fail = True
    connection = registry.attach('user')
    with pytest.raises(RuntimeError): registry.attach('other')
    await eventually(lambda: registry.refresh_failures > 0)
    store.fail = False
    await eventually(lambda: connection.connection_id in store.entries)
    await registry.stop()
    await registry.stop()
    with pytest.raises(RuntimeError): await registry.start()
    with pytest.raises(RuntimeError): registry.attach('user')


@pytest.mark.parametrize('options', [dict(instance_id=''), dict(connection_id=''), dict(user_id=''), dict(room_id=3)])
def test_invalid_presence_identity(options):
    with pytest.raises(ValueError):
        ConnectionPresence(**(dict(instance_id='boot', connection_id='socket', user_id='user') | options))


async def test_cancelled_stop_joins_all_refresh_workers():
    store = Store()
    registry = ConnectionPresenceRegistry(store, 'boot', refresh_interval=.01)
    await registry.start()
    registry.observe_health(True)
    connection = registry.attach('user')
    await eventually(lambda: connection.connection_id in store.entries)
    entered, release = asyncio.Event(), asyncio.Event()
    original = store.remove
    async def delayed(presence):
        entered.set()
        await release.wait()
        await original(presence)
    store.remove = delayed
    task = asyncio.create_task(registry.stop())
    await entered.wait()
    task.cancel()
    await asyncio.sleep(.01)
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError): await task
    assert not store.entries and registry._task.done()


async def test_observation_crossing_reconnect_is_unknown():
    store = Store()
    entered, release = asyncio.Event(), asyncio.Event()
    async def delayed(kind, value):
        entered.set()
        await release.wait()
        return PresenceObservation('observed')
    store.observe = delayed
    registry = ConnectionPresenceRegistry(store, 'boot')
    await registry.start()
    registry.observe_health(True)
    try:
        pending = asyncio.create_task(registry.observe('room', 'room'))
        await entered.wait()
        registry.observe_health(False)
        registry.observe_health(True)
        release.set()
        assert (await pending).status == 'unknown'
    finally:
        await registry.stop()


async def test_refresh_concurrency_is_bounded():
    store = Store()
    running, peak = 0, 0
    original = store.refresh
    async def measured(presence):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        try:
            await asyncio.sleep(.01)
            return await original(presence)
        finally:
            running -= 1
    store.refresh = measured
    registry = ConnectionPresenceRegistry(store, 'boot', workers=2)
    await registry.start()
    registry.observe_health(True)
    try:
        for i in range(12):
            registry.attach(str(i))
        await eventually(lambda: len(store.entries) == 12)
        assert peak == 2
    finally:
        await registry.stop()
