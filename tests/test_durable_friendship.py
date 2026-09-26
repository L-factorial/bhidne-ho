import asyncio
from uuid import UUID, uuid4

import pytest

from app.durable_games.delivery_store import PostgresDeliveryStore
from app.durable_games.inbox import PostgresInboxStore, LaneTarget
from app.durable_games.queries import QueryAccessDenied
from app.durable_games.social import SocialIngress, SocialLaneExecutor, NotificationProducer, conversation
from app.durable_games.store import DurableGameConflict
from test_checkpoint_store import database
from test_delivery import sql


def request(command, command_id=None, **extra):
    return dict(command=command, command_id=command_id or uuid4().hex, payload={}, **extra)


async def setup(database):
    pool, _, _, users = database
    inbox = PostgresInboxStore(pool)
    return inbox, SocialIngress(inbox), SocialLaneExecutor(inbox), conversation(users[0], users[1]), users


async def run(ingress, executor, actor, target, command):
    receipt = await ingress.submit(actor, target, command)
    result = await executor.execute_one(UUID(receipt['lane_id']))
    return result.outcome, UUID(receipt['lane_id'])


async def materialize(inbox, executor, users):
    for actor in users[:2]:
        lane = await inbox.ensure_lane(LaneTarget(kind='recipient', recipient_id=UUID(actor[5:])))
        while await executor.execute_one(lane) is not None:
            pass


async def test_request_accept_remove_retries_notifications_and_actor_receipts(database):
    pool = database[0]
    inbox, ingress, executor, target, users = await setup(database)
    for actor, cmd, state in [(users[0], 'request-friend', 'pending'),
                              (users[1], 'accept-friend', 'accepted'),
                              (users[0], 'remove-friend', 'none')]:
        body = request(cmd)
        result, lane = await run(ingress, executor, actor, target, body)
        assert result['status'] == 'accepted'
        rows = await sql(pool, 'SELECT status FROM friendships')
        assert rows == ([] if state == 'none' else [(state,)])
        assert (await ingress.submit(actor, target, body))['status'] == 'accepted'
        assert await executor.execute_one(lane) is None
        assert (await ingress.status(actor, lane, body['command_id']))['outcome'] == result
    assert await sql(pool, 'SELECT count(*) FROM friendships') == [(0,)]
    assert await sql(pool, "SELECT count(*) FROM command_inbox WHERE actor_id='system:notification'") == [(6,)]
    await materialize(inbox, executor, users)
    assert await sql(pool, 'SELECT count(*) FROM friend_notifications WHERE lane_id IS NOT NULL AND sequence IS NOT NULL') == [(6,)]
    # Former friends recover only their own receipts, not the other actor's ACKs.
    for actor in users[:2]:
        page = await PostgresDeliveryStore(pool).page(actor, lane)
        expected = 2 if actor == users[0] else 1
        assert len(page.events) == expected
        assert all(e['payload']['type'] == 'SOCIAL_COMMAND_ACK' for e in page.events)


@pytest.mark.parametrize('cancel_by_requester,kind', [(True, 'friend_cancelled'), (False, 'friend_rejected')])
async def test_cancel_and_reject_have_distinct_notifications(database, cancel_by_requester, kind):
    inbox, ingress, executor, target, users = await setup(database)
    await run(ingress, executor, users[0], target, request('request-friend'))
    actor = users[0] if cancel_by_requester else users[1]
    result, _ = await run(ingress, executor, actor, target, request('remove-friend'))
    assert result['status'] == 'accepted'
    await materialize(inbox, executor, users)
    assert await sql(database[0], 'SELECT count(*) FROM friend_notifications WHERE kind=%s', (kind,)) == [(1,)]
    assert await sql(database[0], 'SELECT count(*) FROM friendships') == [(0,)]


async def test_invalid_transitions_reject_without_notification_intents(database):
    inbox, ingress, executor, target, users = await setup(database)
    for command in ('accept-friend', 'remove-friend'):
        result, _ = await run(ingress, executor, users[0], target, request(command))
        assert result['status'] == 'rejected'
    await run(ingress, executor, users[0], target, request('request-friend'))
    for actor, command in [(users[0], 'accept-friend'), (users[0], 'request-friend'), (users[1], 'request-friend')]:
        result, _ = await run(ingress, executor, actor, target, request(command))
        assert result['status'] == 'rejected'
    assert await sql(database[0], "SELECT count(*) FROM command_inbox WHERE actor_id='system:notification'") == [(2,)]


async def test_nonparticipants_payload_forgery_self_and_gameplay_rejected(database):
    inbox, ingress, executor, target, users = await setup(database)
    with pytest.raises(QueryAccessDenied):
        await ingress.submit(users[2], target, request('request-friend'))
    with pytest.raises(ValueError): conversation(users[0], users[0])
    for body in [dict(request('request-friend'), payload={'actor_id': users[1]}),
                 request('request-friend', expected_revision=1), request('request-friend', match_id=str(uuid4()))]:
        with pytest.raises(ValueError): await ingress.submit(users[0], target, body)
    with pytest.raises(QueryAccessDenied):
        await ingress.submit(users[0], conversation(users[0], f'user-{uuid4()}'), request('request-friend'))
    assert await sql(database[0], 'SELECT count(*) FROM command_inbox') == [(0,)]


@pytest.mark.parametrize('error', [RuntimeError, ValueError])
async def test_second_notification_failure_rolls_back_all_effects_and_retries(database, monkeypatch, error):
    inbox, ingress, executor, target, users = await setup(database)
    body = request('request-friend')
    pending = await ingress.submit(users[0], target, body)
    lane = UUID(pending['lane_id'])
    original = NotificationProducer.enqueue_in_transaction
    calls = 0
    async def failing(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2: raise error('injected notification failure')
        return await original(self, *args, **kwargs)
    monkeypatch.setattr(NotificationProducer, 'enqueue_in_transaction', failing)
    with pytest.raises(error): await executor.execute_one(lane)
    assert await sql(database[0], 'SELECT count(*) FROM friendships') == [(0,)]
    assert await sql(database[0], "SELECT count(*) FROM command_inbox WHERE actor_id='system:notification'") == [(0,)]
    assert await sql(database[0], 'SELECT count(*) FROM notification_outbox') == [(0,)]
    assert (await ingress.status(users[0], lane, body['command_id']))['status'] == 'pending'
    monkeypatch.setattr(NotificationProducer, 'enqueue_in_transaction', original)
    assert (await executor.execute_one(lane)).outcome['status'] == 'accepted'
    await materialize(inbox, executor, users)
    assert await sql(database[0], 'SELECT count(*) FROM friend_notifications') == [(2,)]


async def test_old_request_retry_does_not_recreate_removed_relationship(database):
    inbox, ingress, executor, target, users = await setup(database)
    body = request('request-friend')
    _, lane = await run(ingress, executor, users[0], target, body)
    await run(ingress, executor, users[0], target, request('remove-friend'))
    assert (await ingress.submit(users[0], target, body))['status'] == 'accepted'
    with pytest.raises(DurableGameConflict):
        await ingress.submit(users[0], target, request('remove-friend', body['command_id']))
    assert await executor.execute_one(lane) is None
    assert await sql(database[0], 'SELECT count(*) FROM friendships') == [(0,)]


async def test_pair_orders_removal_before_already_admitted_message(database):
    inbox, ingress, executor, target, users = await setup(database)
    await run(ingress, executor, users[0], target, request('request-friend'))
    with pytest.raises(QueryAccessDenied):
        await ingress.submit(users[0], target, dict(request('send-message'), payload={'text': 'too early'}))
    await run(ingress, executor, users[1], target, request('accept-friend'))
    removal = await ingress.submit(users[0], target, request('remove-friend'))
    message = await ingress.submit(users[1], target, dict(request('send-message'), payload={'text': 'queued'}))
    assert removal['lane_id'] == message['lane_id'] and removal['sequence'] < message['sequence']
    lane = UUID(removal['lane_id'])
    assert (await executor.execute_one(lane)).outcome['status'] == 'accepted'
    assert (await executor.execute_one(lane)).outcome['status'] == 'rejected'
    assert await sql(database[0], 'SELECT count(*) FROM direct_messages') == [(0,)]


async def test_opposite_requests_order_to_one_pending_relationship(database):
    inbox, ingress, executor, target, users = await setup(database)
    results = await asyncio.gather(*(ingress.submit(u, target, request('request-friend')) for u in users[:2]))
    assert results[0]['lane_id'] == results[1]['lane_id']
    lane = UUID(results[0]['lane_id'])
    assert (await executor.execute_one(lane)).outcome['status'] == 'accepted'
    assert (await executor.execute_one(lane)).outcome['status'] == 'rejected'
    assert await sql(database[0], 'SELECT count(*) FROM friendships') == [(1,)]


async def test_notification_backpressure_preserves_pending_command(database):
    from app.durable_games.inbox import InboxCapacityExceeded
    pool, _, _, users = database
    inbox = PostgresInboxStore(pool, max_pending=1)
    ingress, executor = SocialIngress(inbox), SocialLaneExecutor(inbox)
    async with pool.connection() as connection:
        async with connection.transaction():
            full = await NotificationProducer(inbox).enqueue_in_transaction(connection, users[1], key='occupied', kind='test')
    target = conversation(users[0], users[1])
    body = request('request-friend')
    receipt = await ingress.submit(users[0], target, body)
    lane = UUID(receipt['lane_id'])
    with pytest.raises(InboxCapacityExceeded): await executor.execute_one(lane)
    assert await sql(pool, 'SELECT count(*) FROM friendships') == [(0,)]
    assert (await ingress.status(users[0], lane, body['command_id']))['status'] == 'pending'
    await executor.execute_one(full.lane_id)
    assert (await executor.execute_one(lane)).outcome['status'] == 'accepted'
    await materialize(inbox, executor, users)
    assert await sql(pool, 'SELECT count(*) FROM friend_notifications') == [(3,)]


async def test_lost_receipt_completion_rolls_back_mutation_and_notification_intents(database, monkeypatch):
    inbox, ingress, executor, target, users = await setup(database)
    pending = await ingress.submit(users[0], target, request('request-friend'))
    lane = UUID(pending['lane_id'])
    original = inbox._complete
    async def failure(*args): raise RuntimeError('injected receipt failure')
    monkeypatch.setattr(inbox, '_complete', failure)
    with pytest.raises(RuntimeError): await executor.execute_one(lane)
    assert await sql(database[0], 'SELECT count(*) FROM friendships') == [(0,)]
    assert await sql(database[0], 'SELECT count(*) FROM notification_outbox') == [(0,)]
    assert await sql(database[0], "SELECT count(*) FROM command_inbox WHERE actor_id='system:notification'") == [(0,)]
    monkeypatch.setattr(inbox, '_complete', original)
    assert (await executor.execute_one(lane)).outcome['status'] == 'accepted'


async def test_http_friendship_worker_notification_catchup_and_legacy_boundary(database):
    from test_distributed_platform import application, signup
    from test_room_runtime import until
    async with application(database[0]) as (client, app, server):
        first, first_headers = await signup(client, 'friend_one')
        second, second_headers = await signup(client, 'friend_two')
        target = conversation(first['user_id'], second['user_id']).model_dump(mode='json', exclude_none=True)
        for headers, command in [(first_headers, 'request-friend'), (second_headers, 'accept-friend')]:
            body = request(command)
            response = await client.post('/distributed/commands', headers=headers, json={'target': target, 'body': body})
            assert response.status_code == 200, response.text
            lane = response.json()['lane_id']
            async def done():
                reply = await client.get(f'/distributed/commands/{lane}/{body["command_id"]}', headers=headers)
                assert reply.status_code == 200, reply.text
                return reply.json() if reply.json()['status'] != 'pending' else None
            assert (await until(done))['status'] == 'accepted'
            assert (await client.post('/distributed/commands', headers=headers,
                json={'target': target, 'body': body})).json()['status'] == 'accepted'
        assert (await client.get('/friends', headers=first_headers)).json()['friends'][0]['user_id'] == second['user_id']
        opened = await client.post('/distributed/streams/recipient', headers=first_headers)
        recipient_lane = opened.json()['lane_id']
        async def notified():
            response = await client.get(f'/distributed/history/social/{recipient_lane}', headers=first_headers)
            assert response.status_code == 200, response.text
            return response.json()['items'] if len(response.json()['items']) == 2 else None
        items = await until(notified)
        assert {item['kind'] for item in items} == {'friendship_changed', 'friend_accepted'}
        assert (await client.post('/friends/requests/' + second['user_id'], headers=first_headers)).status_code == 409
        assert await sql(database[0], 'SELECT count(*) FROM friend_notifications WHERE lane_id IS NULL') == [(0,)]
