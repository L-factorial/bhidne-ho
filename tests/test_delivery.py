import asyncio
from dataclasses import replace
from uuid import UUID, uuid4

import pytest

from app.durable_games.delivery import GatewayDelivery, OutboxPublisher, DeliveryWakeup
from app.durable_games.delivery_store import PostgresDeliveryStore, DeliveryResetRequired, UnsupportedDeliveryLane
from app.durable_games.inbox import PostgresInboxStore, LaneTarget
from app.durable_games.outbox import append_lane_events
from app.durable_games.queries import QueryAccessDenied
from app.durable_games.redis_presence import PresenceObservation, ConnectionPresence
from app.runtime.command_runtime import OutgoingEvent
from test_checkpoint_store import database
from test_game_lane_executor import setup_game, command
from test_redis_signals import eventually, Broker, transport


async def events(database):
    pool, _, fence, users = database
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
    body = dict(command_id=uuid4().hex, command='example', payload={})
    await inbox.enqueue(lane, users[0], body)
    async with inbox.claim(lane, fence=fence) as claim:
        outcome = dict(command_id=body['command_id'], status='accepted', revision=1)
        await append_lane_events(claim, [OutgoingEvent(dict(type='ROOM_STATE_CHANGED', room_id='room')),
            OutgoingEvent(dict(type='ROOM_COMMAND_ACK', **outcome), users[0]),
            OutgoingEvent(dict(type='ROOM_COMMAND_ACK', **outcome), users[1])])
        await claim.complete(outcome)
    return PostgresDeliveryStore(pool), lane


async def sql(pool, statement, args=()):
    async with pool.connection() as connection:
        return await (await connection.execute(statement, args)).fetchall()


async def test_claim_expiry_takeover_retry_renew_and_stale_completion(database):
    pool, _, _, _ = database
    store, lane = await events(database)
    first = (await store.claim(limit=1))[0]
    others = await store.claim()
    assert len(others) == 2 and all(c.event_id != first.event_id for c in others)
    assert await store.claim() == ()
    assert await store.renew(first)
    await sql(pool, "UPDATE notification_outbox SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE event_id=%s", (first.event_id,))
    assert not await store.renew(first)
    second = (await store.claim(limit=1))[0]
    assert second.event_id == first.event_id and second.token != first.token and second.attempts == 2
    assert not await store.finish(first, published=True)
    assert await store.finish(second, published=False)
    assert await store.claim() == ()
    await sql(pool, "UPDATE notification_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE event_id=%s", (first.event_id,))
    third = (await store.claim(limit=1))[0]
    assert await store.finish(third, published=True)
    assert not await store.finish(third, published=True)
    assert (await sql(pool, 'SELECT count(*) FROM delivery_cursors')) == [(0,)]


async def test_ordered_pages_skip_other_audiences_and_keep_device_cursors_independent(database):
    pool, _, _, users = database
    store, lane = await events(database)
    first = await store.page(users[0], lane, limit=2)
    assert [e['sequence'] for e in first.events] == [1, 2]
    assert first.scanned_sequence == 2 and first.has_more
    tail = await store.page(users[0], lane, after=2)
    assert tail.events == () and tail.scanned_sequence == 3 and not tail.has_more
    # Published rows remain available to catch-up.
    for claim in await store.claim():
        assert await store.finish(claim, published=True)
    assert len((await store.page(users[0], lane)).events) == 2
    assert await store.acknowledge(users[0], 'phone', lane, 3) == 3
    assert await store.acknowledge(users[0], 'phone', lane, 1) == 3
    assert await store.cursor(users[0], 'phone', lane) == 3
    assert await store.cursor(users[0], 'laptop', lane) == 0
    assert await store.cursor(users[1], 'phone', lane) == 0
    with pytest.raises(ValueError): await store.acknowledge(users[0], 'phone', lane, 4)
    with pytest.raises(DeliveryResetRequired): await store.page(users[0], lane, after=4)


async def test_revoked_membership_denies_payload_but_preserves_own_receipt(database):
    pool, _, _, users = database
    store, lane = await events(database)
    await sql(pool, 'DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s', ('room', UUID(users[0][5:])))
    page = await store.page(users[0], lane)
    assert [e['event_type'] for e in page.events] == ['ROOM_COMMAND_ACK']
    assert page.scanned_sequence == 3
    await sql(pool, 'DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s', ('room', UUID(users[-1][5:])))
    with pytest.raises(QueryAccessDenied): await store.page(users[-1], lane)
    with pytest.raises(QueryAccessDenied): await store.acknowledge(users[-1], 'device', lane, 1)


async def test_private_game_replay_requires_current_seat_and_match(database):
    pool, _, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        actor, body = command(game)
        await inbox.enqueue(lane, actor, body)
        await executor.execute_one(lane, fence)
        store = PostgresDeliveryStore(pool)
        page = await store.page(actor, lane)
        assert any(e['event_type'] == 'PLAYER_STATE' for e in page.events)
        outsider = await store.page(users[-1], lane)
        assert all(e['event_type'] != 'PLAYER_STATE' for e in outsider.events)
        await sql(pool, 'DELETE FROM table_positions WHERE table_id=%s AND user_id=%s',
                  (UUID(game.table.table_id), UUID(actor[5:])))
        changed = await store.page(actor, lane)
        assert all(e['event_type'] != 'PLAYER_STATE' for e in changed.events)
        assert any(e['event_type'] == 'ACTION_ACK' for e in changed.events)
    finally:
        await host.close()


async def test_gaps_versions_and_unimplemented_social_lanes_fail_closed(database):
    pool, _, _, users = database
    store, lane = await events(database)
    await sql(pool, 'DELETE FROM notification_outbox WHERE lane_id=%s AND sequence=2', (lane,))
    with pytest.raises(DeliveryResetRequired): await store.page(users[0], lane)
    social = await PostgresInboxStore(pool).ensure_lane(LaneTarget(kind='recipient', recipient_id=UUID(users[0][5:])))
    with pytest.raises(QueryAccessDenied): await store.page(users[1], social)
    assert (await store.page(users[0], social)).events == ()


class Presence:
    def __init__(self, status='observed'):
        self.status = status
    async def observe(self, kind, value):
        return PresenceObservation(self.status, tuple(ConnectionPresence('gateway', str(i), 'user') for i in range(2)))


async def test_publisher_signals_ids_once_per_server_and_retries_unknown_presence(database):
    pool, _, _, users = database
    store, lane = await events(database)
    notices = []
    async def send(destination, notice):
        notices.append(notice)
        assert destination == 'gateway'
        return True
    presence = Presence('unknown')
    publisher = OutboxPublisher(store, presence, send)
    await publisher.sweep_once()
    assert not notices
    assert (await sql(pool, 'SELECT count(*) FROM notification_outbox WHERE published_at IS NOT NULL')) == [(0,)]
    await sql(pool, "UPDATE notification_outbox SET next_attempt_at=clock_timestamp()-interval '1 second'")
    presence.status = 'observed'
    await publisher.sweep_once()
    assert len(notices) == 3
    assert all(set(vars(n)) == {'instance_id','lane_id','event_id','sequence'} for n in notices)
    assert (await sql(pool, 'SELECT count(*) FROM notification_outbox WHERE published_at IS NOT NULL')) == [(3,)]
    assert (await sql(pool, 'SELECT count(*) FROM delivery_cursors')) == [(0,)]
    assert len((await store.page(users[0], lane)).events) == 2


async def test_gateway_duplicate_wakeup_ack_window_and_reconnect_replay(database):
    pool, _, _, users = database
    store, lane = await events(database)
    gateway = GatewayDelivery(store, 'gateway', page_size=2, max_unacknowledged=2)
    sent = []
    async def send(page): sent.append(page)
    handle = await gateway.subscribe(users[0], 'phone', lane, send)
    await gateway.pump(handle)
    assert sent[-1]['scanned_sequence'] == 2
    assert sent[-1]['after_sequence'] == 0
    notice = DeliveryWakeup('gateway', lane, uuid4(), 3)
    await gateway.receive(notice)
    await gateway.receive(notice)
    await gateway.pump(handle)
    assert len(sent) == 1  # Waiting for explicit acknowledgement/window capacity.
    assert await store.cursor(users[0], 'phone', lane) == 0
    with pytest.raises(ValueError): await gateway.acknowledge(handle, 3)
    gateway.unsubscribe(handle)
    new = await gateway.subscribe(users[0], 'phone', lane, send)
    await gateway.pump(new)
    assert sent[0] == sent[1]  # Lost acknowledgement replays stable IDs/sequences.
    await gateway.acknowledge(new, 2)
    await gateway.pump(new)
    assert sent[-1]['scanned_sequence'] == 3 and sent[-1]['events'] == []
    assert sent[-1]['after_sequence'] == 2
    await gateway.acknowledge(new, 3)
    assert await store.cursor(users[0], 'phone', lane) == 3
    assert await store.cursor(users[0], 'laptop', lane) == 0
    await gateway.stop()


async def test_gateway_reauthorizes_after_hint_and_failed_socket_does_not_ack(database):
    pool, _, _, users = database
    store, lane = await events(database)
    gateway = GatewayDelivery(store, 'gateway')
    sent = []
    async def send(page): sent.append(page)
    handle = await gateway.subscribe(users[-1], 'device', lane, send)
    await gateway.receive(DeliveryWakeup('gateway', lane, uuid4(), 3))
    await sql(pool, 'DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
    await gateway.sweep_once()
    assert not sent and not gateway.active(handle)
    async def broken(page): raise ConnectionError('socket closed')
    other = await gateway.subscribe(users[0], 'phone', lane, broken)
    await gateway.pump(other)
    assert not gateway.active(other) and await store.cursor(users[0], 'phone', lane) == 0
    await gateway.stop()


async def test_redis_hint_transport_and_outage_polling_deliver_committed_rows(database):
    pool, _, _, users = database
    store, lane = await events(database)
    broker, sent = Broker(), []
    gateway = GatewayDelivery(store, 'gateway', healthy_interval=60, failed_interval=.02)
    owner = transport(broker, 'owner')
    receiver = transport(broker, 'gateway', delivery_receiver=gateway, on_health=gateway.observe_health)
    async def send(page): sent.append(page)
    await owner.start()
    await receiver.start()
    await eventually(lambda: owner.healthy and receiver.healthy)
    handle = await gateway.subscribe(users[0], 'phone', lane, send)
    gateway._dirty.clear()  # Prove Redis dispatch, not subscribe's initial scan.
    publisher = OutboxPublisher(store, Presence(), owner.send_delivery)
    try:
        await publisher.sweep_once()
        await eventually(lambda: handle in gateway._dirty)
        await gateway.sweep_once(safety=False)
        assert len(sent) == 1
        await gateway.acknowledge(handle, 3)
        await gateway.start()
        broker.online = False
        await eventually(lambda: not gateway.available)
        await events(database)  # More committed work without any Redis signal.
        await eventually(lambda: len(sent) == 2)
        assert sent[-1]['scanned_sequence'] == 6
    finally:
        await gateway.stop()
        await receiver.stop()
        await owner.stop()


async def test_publication_unknown_commit_repeats_stable_notice_and_empty_presence_is_not_ack(database, monkeypatch):
    pool, _, _, users = database
    store, lane = await events(database)
    sent = []
    async def send(destination, notice):
        sent.append(notice)
        return True
    original = store.finish
    async def lost_response(*args, **kwargs):
        raise TimeoutError('Unknown finish outcome')
    monkeypatch.setattr(store, 'finish', lost_response)
    publisher = OutboxPublisher(store, Presence(), send)
    await publisher.sweep_once()
    assert len(sent) == 3
    await sql(pool, "UPDATE notification_outbox SET claim_expires_at=clock_timestamp()-interval '1 second'")
    monkeypatch.setattr(store, 'finish', original)
    await publisher.sweep_once()
    assert {n.event_id for n in sent[:3]} == {n.event_id for n in sent[3:]}
    assert len(sent) == 6
    assert (await sql(pool, 'SELECT count(*) FROM delivery_cursors')) == [(0,)]
    assert len((await store.page(users[0], lane)).events) == 2


async def test_partial_fanout_failure_is_joined_and_retryable(database):
    pool, _, _, _ = database
    store, _ = await events(database)
    class Multiple:
        async def observe(self, kind, key):
            return PresenceObservation('observed', tuple(ConnectionPresence(s, s, 'user') for s in ('a', 'b')))
    completed = []
    async def send(destination, notice):
        if destination == 'a':
            raise ConnectionError('unavailable')
        await asyncio.sleep(.01)
        completed.append(notice)
        return True
    publisher = OutboxPublisher(store, Multiple(), send)
    await publisher.sweep_once()
    assert len(completed) == 3
    assert (await sql(pool, 'SELECT count(*) FROM notification_outbox WHERE published_at IS NOT NULL')) == [(0,)]
    assert (await sql(pool, 'SELECT count(*) FROM notification_outbox WHERE claim_token IS NOT NULL')) == [(0,)]


async def test_gateway_healthy_safety_scan_recovers_lost_signal(database):
    _, _, _, users = database
    store, lane = await events(database)
    pages = []
    async def send(page): pages.append(page)
    gateway = GatewayDelivery(store, 'gateway', healthy_interval=.05, failed_interval=.01)
    gateway.observe_health(True)
    handle = await gateway.subscribe(users[0], 'phone', lane, send)
    await gateway.start()
    try:
        await eventually(lambda: len(pages) == 1)
        await gateway.acknowledge(handle, 3)
        await events(database)
        await eventually(lambda: len(pages) == 2)
        assert pages[-1]['scanned_sequence'] == 6
    finally:
        await gateway.stop()


async def test_gateway_revocation_closes_and_notifies_without_exposing_payload(database):
    pool, _, _, users = database
    store, lane = await events(database)
    pages, closed = [], []
    async def send(page): pages.append(page)
    async def on_close(reason): closed.append(reason)
    gateway = GatewayDelivery(store, 'gateway')
    handle = await gateway.subscribe(users[-1], 'device', lane, send, on_close=on_close)
    await sql(pool, 'DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
    await gateway.pump(handle)
    assert not pages and closed == ['delivery_reconciliation_required']
    assert not gateway.active(handle)
    await gateway.stop()


async def test_private_history_is_not_replayed_into_a_new_match(database):
    pool, _, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        actor, body = command(game)
        await inbox.enqueue(lane, actor, body)
        await executor.execute_one(lane, fence)
        store = PostgresDeliveryStore(pool)
        assert any(e['event_type'] == 'PLAYER_STATE' for e in (await store.page(actor, lane)).events)
        # Isolate the delivery gate; engine reconstruction is exercised elsewhere.
        await sql(pool, 'UPDATE table_recovery_state SET match_id=%s WHERE table_id=%s', (uuid4(), UUID(game.table.table_id)))
        assert all(e['event_type'] != 'PLAYER_STATE' for e in (await store.page(actor, lane)).events)
    finally:
        await host.close()


async def test_paused_subscription_handshake_precedes_first_page(database):
    _, _, _, users = database
    store, lane = await events(database)
    gateway = GatewayDelivery(store, 'handshake')
    pages = []
    async def send(page): pages.append(page)
    handle = await gateway.subscribe(users[0], 'device', lane, send, paused=True)
    assert gateway.subscription_cursor(handle) == 0
    await gateway.sweep_once()
    assert pages == []
    gateway.activate(handle)
    await gateway.pump(handle)
    assert pages[0]['after_sequence'] == 0
    with pytest.raises(ValueError): gateway.subscription_cursor(handle)
    gateway.unsubscribe(handle)
    assert handle not in gateway._paused
    await gateway.stop()


async def test_presence_room_excludes_ack_only_former_members(database):
    pool, _, _, users = database
    store, lane = await events(database)
    assert await store.presence_room(users[0], lane) == 'room'
    await sql(pool, 'DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s', ('room', users[0][5:]))
    # Its own durable receipt remains readable without advertising room presence.
    assert await store.presence_room(users[0], lane) is None
    with pytest.raises(QueryAccessDenied):
        await store.presence_room(f'user-{UUID(int=99)}', lane)
