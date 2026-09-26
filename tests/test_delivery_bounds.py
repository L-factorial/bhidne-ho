import asyncio
from uuid import uuid4

import pytest

from app.durable_games.delivery import GatewayDelivery, DeliveryWakeup
from app.durable_games.delivery_store import DeliveryPage
from app.durable_games.redis_transport import SignalCodec
from test_redis_signals import SECRET, eventually


@pytest.mark.parametrize('seq', [0, -1, True, 2**63])
def test_delivery_hint_validates_sequence(seq):
    with pytest.raises(ValueError): DeliveryWakeup('boot', uuid4(), uuid4(), seq)


def test_delivery_hint_codec_carries_only_signed_ids():
    codec = SignalCodec(SECRET)
    lane, event = uuid4(), uuid4()
    raw = codec.encode('delivery', 'boot', lane_id=lane, event_id=event, sequence=5)
    decoded = codec.decode(raw, 'boot')
    assert set(decoded) == {'v','kind','destination','at','nonce','lane_id','event_id','sequence'}
    assert decoded['lane_id'] == str(lane) and decoded['event_id'] == str(event)
    with pytest.raises(ValueError): codec.decode(raw, 'different-boot')
    with pytest.raises(ValueError): codec.decode(raw.replace(b'"sequence":5', b'"sequence":6'), 'boot')


class Store:
    async def cursor(self, *args): return 0
    async def page(self, actor, lane, *, after, limit):
        return DeliveryPage(lane, (), 1, False)
    async def acknowledge(self, actor, client, lane, seq): return seq


async def test_slow_socket_does_not_block_other_clients_and_timeout_notifies():
    gateway = GatewayDelivery(Store(), 'boot', timeout=.05, max_streams=2, workers=2)
    completed, closed = [], []
    async def slow(page): await asyncio.sleep(10)
    async def fast(page): completed.append(page)
    async def closing(reason): closed.append(reason)
    first = await gateway.subscribe('actor', 'slow', uuid4(), slow, on_close=closing)
    second = await gateway.subscribe('actor', 'fast', uuid4(), fast)
    with pytest.raises(RuntimeError): await gateway.subscribe('actor', 'overflow', uuid4(), fast)
    await gateway.sweep_once()
    assert completed and closed and gateway.active(second) and not gateway.active(first)
    await gateway.stop()


async def test_cancelled_stop_joins_suspended_sender_cleanup():
    entered, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def send(page):
        entered.set()
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()
            await release.wait()
    gateway = GatewayDelivery(Store(), 'boot')
    await gateway.subscribe('actor', 'device', uuid4(), send)
    await gateway.start()
    await entered.wait()
    closing = asyncio.create_task(gateway.stop())
    await cancelled.wait()
    closing.cancel()
    await asyncio.sleep(.01)
    assert not closing.done()
    release.set()
    with pytest.raises(asyncio.CancelledError): await closing
    assert not gateway._streams and gateway._task.done()
    with pytest.raises(RuntimeError): await gateway.start()
