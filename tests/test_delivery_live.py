"""Real Redis transport plus embedded SQL delivery; private temporary test services."""
from app.durable_games.delivery import GatewayDelivery, OutboxPublisher
from test_checkpoint_store import database
from test_delivery import events, Presence
from test_redis_live_transport import redis_server, bus
from test_redis_signals import eventually


async def test_real_redis_outbox_delivery_and_outage_catchup(redis_server, database):
    _, _, _, users = database
    store, lane = await events(database)
    gateway = GatewayDelivery(store, 'gateway', healthy_interval=60, failed_interval=.02)
    listener = bus(redis_server, 'gateway', delivery_receiver=gateway, on_health=gateway.observe_health)
    sender = bus(redis_server, 'publisher')
    pages = []
    async def send(page): pages.append(page)
    await listener.start()
    await sender.start()
    try:
        await eventually(lambda: listener.healthy and sender.healthy)
        handle = await gateway.subscribe(users[0], 'phone', lane, send)
        await gateway.start()
        await eventually(lambda: len(pages) == 1)
        await gateway.acknowledge(handle, 3)
        await events(database)
        publisher = OutboxPublisher(store, Presence(), sender.send_delivery)
        await publisher.sweep_once()
        await eventually(lambda: len(pages) == 2)
        assert pages[-1]['scanned_sequence'] == 6
        await gateway.acknowledge(handle, 6)
        await redis_server.stop()
        await eventually(lambda: not gateway.available)
        await events(database)
        await eventually(lambda: len(pages) == 3)
        assert pages[-1]['scanned_sequence'] == 9
        # Sending nine rows has only acknowledged six; disconnect replays the rest.
        assert await store.cursor(users[0], 'phone', lane) == 6
        gateway.unsubscribe(handle)
        again = await gateway.subscribe(users[0], 'phone', lane, send)
        await gateway.pump(again)
        assert pages[-1] == pages[-2]
    finally:
        await gateway.stop()
        await listener.stop()
        await sender.stop()
