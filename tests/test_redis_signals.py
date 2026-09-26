"""Transport fault injection plus PostgreSQL execution through the real receivers.

The broker double models Pub/Sub loss, subscription acknowledgements and outages;
it is not proof against a real Redis server or independent application processes.
"""
import asyncio
import json
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.durable_games.discovery import PlacementDemand
from app.durable_games.redis_transport import SignalCodec, RedisSignalTransport
from app.durable_games.polling import RedisPollingPolicy
from app.durable_games.routing import RoomWakeup, RoomWakeupReceiver, RoomCommandRouter
from app.durable_games.ingress import HostedCommandIngress
from app.durable_games.inbox import LaneTarget
from test_checkpoint_store import database
from test_room_runtime import start, outcome, until

SECRET = b'test-only-shared-transport-secret-32'


class Broker:
    def __init__(self):
        self.online, self.drop, self.closed = True, False, False
        self.subscribers = set()
        self.close_gate = None

    def pubsub(self):
        return Subscription(self)

    async def publish(self, channel, payload):
        if not self.online:
            raise ConnectionError('injected broker outage')
        subscribers = [s for s in self.subscribers if channel in s.channels]
        if not self.drop:
            for subscriber in subscribers:
                subscriber.messages.put_nowait(dict(type='message', channel=channel.encode(), data=payload))
        return len(subscribers)

    async def aclose(self):
        self.closed = True


class Subscription:
    def __init__(self, broker):
        self.broker, self.channels = broker, set()
        self.messages, self.closed = asyncio.Queue(), False

    async def subscribe(self, channel):
        if not self.broker.online:
            raise ConnectionError('injected subscription failure')
        self.channels.add(channel)
        self.broker.subscribers.add(self)
        self.messages.put_nowait(dict(type='subscribe', channel=channel.encode(), data=1))

    async def get_message(self, *, ignore_subscribe_messages=False, timeout=0):
        if not self.broker.online:
            raise ConnectionError('injected subscriber failure')
        try:
            return await asyncio.wait_for(self.messages.get(), timeout=timeout)
        except TimeoutError:
            return None

    async def aclose(self):
        if self.broker.close_gate is not None:
            await self.broker.close_gate.wait()
        self.closed = True
        self.broker.subscribers.discard(self)


class Receiver:
    def __init__(self):
        self.messages, self.gate = [], None

    async def receive(self, message):
        self.messages.append(message)
        if self.gate is not None:
            await self.gate.wait()
        return True


def transport(broker, instance='owner', **kwargs):
    return RedisSignalTransport(broker, instance, SECRET,
        wakeup_receiver=kwargs.pop('wakeup_receiver', Receiver()),
        placement_receiver=kwargs.pop('placement_receiver', Receiver()),
        probe_interval=.03, probe_timeout=.25, retry_base=.01, retry_max=.02, **kwargs)


async def eventually(predicate):
    async def check():
        return predicate()
    return await until(check)


@pytest.mark.parametrize('kind', ['wakeup', 'placement', 'probe'])
def test_signed_envelopes_roundtrip_and_reject_tamper_replay_cross_boot(kind, monkeypatch):
    codec = SignalCodec(SECRET)
    options = dict(room_id='room', lane_id=uuid4(), epoch=3)
    wire = codec.encode(kind, 'owner', **options)
    body = codec.decode(wire, 'owner')
    assert body['kind'] == kind and 'mac' not in body
    with pytest.raises(ValueError): codec.decode(wire, 'new-boot')
    with pytest.raises(ValueError): SignalCodec(b'wrong-secret-material-of-length-32').decode(wire, 'owner')
    changed = json.loads(wire)
    changed['destination'] = 'attacker'
    with pytest.raises(ValueError): codec.decode(json.dumps(changed), 'attacker')
    monkeypatch.setattr(time, 'time', lambda: body['at'] + 31)
    with pytest.raises(ValueError): codec.decode(wire, 'owner')


@pytest.mark.parametrize('value', [b'[]', b'{', b'{}', b'x'*5000, b'\xff', b'{"v":1,"v":1}'])
def test_invalid_wire_is_rejected(value):
    with pytest.raises((ValueError, UnicodeError)):
        SignalCodec(SECRET).decode(value, 'owner')


async def test_targeted_delivery_and_subscription_health_not_execution_ack():
    broker, health = Broker(), []
    owner = transport(broker, on_health=health.append)
    other = transport(broker, 'other')
    try:
        await owner.start()
        await other.start()
        await eventually(lambda: owner.healthy and other.healthy)
        wake = RoomWakeup('room', uuid4(), 'owner', 4)
        assert await other.send_wakeup(SimpleNamespace(instance_id='owner'), wake)
        await eventually(lambda: owner.wakeup_receiver.messages)
        assert owner.wakeup_receiver.messages == [wake]
        assert other.wakeup_receiver.messages == []
        demand = PlacementDemand('room', 'owner')
        assert await other.send_placement(SimpleNamespace(instance_id='owner'), demand)
        await eventually(lambda: owner.placement_receiver.messages)
        assert owner.placement_receiver.messages == [demand]
        assert not await other.send_placement(SimpleNamespace(instance_id='absent'), PlacementDemand('room','absent'))
        assert health[:2] == [False, True]
    finally:
        await owner.stop()
        await other.stop()
    assert health[-1] is False and not broker.closed and not broker.subscribers


async def test_silent_subscription_loss_enters_fallback_and_reconnect_rechecks_health():
    broker, changes = Broker(), []
    bus = transport(broker, on_health=changes.append)
    try:
        await bus.start()
        await eventually(lambda: bus.healthy)
        broker.drop = True  # publish still succeeds; subscription round trip fails.
        await eventually(lambda: not bus.healthy)
        assert changes[-1] is False
        broker.drop = False
        await eventually(lambda: bus.healthy)
        assert changes == [False, True, False, True]
        broker.online = False
        await eventually(lambda: not bus.healthy)
        broker.online = True
        await eventually(lambda: bus.healthy)
    finally:
        await bus.stop()


async def test_bad_auth_and_saturation_do_not_block_probes_or_grow_dispatch_queue():
    broker, receiver = Broker(), Receiver()
    receiver.gate = asyncio.Event()
    bus = transport(broker, wakeup_receiver=receiver, workers=1, max_pending=1)
    try:
        await bus.start()
        await eventually(lambda: bus.healthy)
        await broker.publish(bus.channel('owner'), b'{"mac":"bad"}')
        for _ in range(20):
            await broker.publish(bus.channel('owner'), bus.codec.encode('wakeup','owner',room_id='room',lane_id=uuid4(),epoch=1))
        await eventually(lambda: bus.dropped_messages > 0)
        assert bus.queue.qsize() <= 1
        assert bus.invalid_messages == 1
        await asyncio.sleep(.35)
        assert bus.healthy
    finally:
        await bus.stop()
    assert bus.queue.empty() and all(t.done() for t in bus._workers)


async def test_cancelled_stop_joins_subscriber_cleanup_and_owned_client():
    broker = Broker()
    bus = transport(broker, owns_client=True)
    await bus.start()
    await eventually(lambda: bus.healthy)
    broker.close_gate = asyncio.Event()
    closing = asyncio.create_task(bus.stop())
    await eventually(lambda: bus._closed)
    closing.cancel()
    await asyncio.sleep(.01)
    assert not closing.done()
    broker.close_gate.set()
    with pytest.raises(asyncio.CancelledError): await closing
    assert broker.closed and not broker.subscribers and bus._task.done()
    with pytest.raises(RuntimeError): await bus.start()


async def test_actual_postgres_owner_executes_from_remote_wakeup_before_safety_poll(database):
    pool, _, _, users = database
    policy = RedisPollingPolicy(healthy_interval=60, failed_interval=.02, jitter=0)
    runtime, fence = await start(database, inbox_polling=policy)
    broker = Broker()
    owner = transport(broker, fence.instance_id, wakeup_receiver=RoomWakeupReceiver(runtime), on_health=policy.observe)
    gateway = transport(broker, 'gateway')
    try:
        await owner.start()
        await gateway.start()
        await eventually(lambda: owner.healthy and gateway.healthy and runtime._rooms['room'].next_inbox_at > time.monotonic()+10)
        router = RoomCommandRouter(runtime.inbox, runtime.ownership, send_remote=gateway.send_wakeup)
        async def wake(room, lane):
            return await router.wake(lane)
        ingress = HostedCommandIngress(runtime.inbox, wakeup=wake)
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type':'marriage', 'capacity':2})
        result = await ingress.submit(users[0], LaneTarget(kind='room',room_id='room'), body)
        assert result['status'] == 'pending'
        assert (await outcome(runtime.inbox, result['lane_id'], users[0], body))['status'] == 'accepted'
        assert runtime._rooms['room'].next_inbox_at > time.monotonic()+5
        assert runtime.admits(fence)
    finally:
        await gateway.stop()
        await owner.stop()
        await runtime.stop()


async def test_redis_outage_keeps_durable_commands_progressing_without_ownership_change(database):
    _, _, _, users = database
    policy = RedisPollingPolicy(healthy_interval=60, failed_interval=.02, jitter=0)
    runtime, fence = await start(database, inbox_polling=policy)
    broker = Broker()
    bus = transport(broker, fence.instance_id, on_health=policy.observe)
    try:
        await bus.start()
        await eventually(lambda: bus.healthy and runtime._rooms['room'].next_inbox_at > time.monotonic()+10)
        broker.online = False
        lane = await runtime.inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='create-table', payload={'game_type':'marriage','capacity':2})
        await runtime.inbox.enqueue(lane, users[0], body)
        assert (await outcome(runtime.inbox, lane, users[0], body))['status'] == 'accepted'
        assert not policy.available and runtime.admitted_fence('room') == fence
        broker.online = True
        await eventually(lambda: bus.healthy and policy.available)
    finally:
        await bus.stop()
        await runtime.stop()
