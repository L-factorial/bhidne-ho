from uuid import UUID, uuid4

import pytest

from app.durable_games.creation_executor import RoomCreationExecutor
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.ingress import HostedCommandIngress
from app.durable_games.queries import PostgresHostedQueries
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database
from test_creation_executor import creation, create, request


async def test_create_invite_private_recipient_accept_and_no_seat_reservation(creation):
    pool, store, fence, users, inbox, lane, executor = creation
    recipient = users[-1]
    await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(recipient[5:]),))
    body = request()
    body['payload']['invitees'] = [recipient, recipient]
    outcome = await create(creation, users[0], body)
    assert outcome['status'] == 'accepted'
    assert (await inbox.enqueue(lane, users[0], body)).outcome == outcome
    queries = PostgresHostedQueries(pool)
    items = (await queries.invitations(recipient))['items']
    assert len(items) == 1 and items[0]['table_revision'] == 0
    assert (await queries.invitations(users[1]))['items'] == []
    assert (await pool.execute('SELECT cardinality(attempts) FROM hosted_invitation_limits')).rows == [(1,)]
    answer = dict(command_id=uuid4().hex, command='answer-table-invitation', match_id=outcome['match_id'],
        expected_revision=0, payload=dict(invitation_id=items[0]['id'], accept=True))
    target = LaneTarget(kind='table', room_id='room', table_id=UUID(outcome['table_id']))
    ingress = HostedCommandIngress(inbox)
    pending = await ingress.submit(recipient, target, answer)
    assert pending['status'] == 'pending'
    assert (await TableLaneExecutor(inbox).execute_one(UUID(pending['lane_id']), fence)).outcome['status'] == 'accepted'
    assert (await ingress.submit(recipient, target, answer))['status'] == 'accepted'
    assert (await queries.invitations(recipient))['items'] == []
    assert (await pool.execute('SELECT 1 FROM room_memberships WHERE user_id=%s', (UUID(recipient[5:]),))).rows == [(1,)]
    assert (await pool.execute('SELECT 1 FROM active_table_players WHERE user_id=%s', (UUID(recipient[5:]),))).rows == []


async def test_invalid_invitee_and_rate_limit_leave_no_table(creation):
    pool, store, fence, users, inbox, lane, executor = creation
    body = request()
    body['payload']['invitees'] = [users[0]]
    assert (await create(creation, users[0], body))['status'] == 'rejected'
    await pool.execute('''INSERT INTO hosted_invitation_limits(user_id,attempts)
        VALUES (%s,array_fill(extract(epoch FROM clock_timestamp())::double precision, ARRAY[30]))''', (UUID(users[0][5:]),))
    body = request()
    body['payload']['invitees'] = [users[-1]]
    assert (await create(creation, users[0], body))['status'] == 'rejected'
    assert (await pool.execute('SELECT count(*) FROM room_tables')).rows == [(0,)]


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_completed_table_replaced_atomically_at_capacity(database, kind):
    pool, store, fence, users = database
    if kind == 'flush':
        from test_flush_restart import finished
        host, game, inbox, *_ = await finished(database)
    else:
        from test_rematch import completed
        host, game, inbox, *_ = await completed(database, kind)
    try:
        old = await store.load(game.table.table_id)
        actor = next(p['user_id'] for p in old.checkpoint['data']['positions'] if p['seat'] is not None)
        lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        await pool.execute("UPDATE rooms SET max_open_tables=1 WHERE id='room'")
        body = request('Replacement')
        body['payload'].update(replace_table_id=game.table.table_id, replace_revision=old.checkpoint['data']['table_revision'])
        await inbox.enqueue(lane, actor, body)
        result = await RoomCreationExecutor(inbox).execute_one(lane, fence)
        assert result.outcome['status'] == 'accepted'
        assert (await inbox.enqueue(lane, actor, body)).outcome == result.outcome
        retired = await store.load(game.table.table_id)
        assert retired.checkpoint['data']['host']['ended']
        assert retired.checkpoint['data']['engine'] == old.checkpoint['data']['engine']
        assert (await store.load(result.outcome['table_id'])).checkpoint['data']['host']['users'] == [actor]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
    finally:
        await host.close()


async def test_replacement_outbox_failure_rolls_back_every_effect(database, monkeypatch):
    pool, store, fence, users = database
    from test_rematch import completed
    from app.durable_games import creation_executor
    host, game, inbox, *_ = await completed(database)
    try:
        saved = await store.load(game.table.table_id)
        lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = request('New')
        body['payload'].update(replace_table_id=game.table.table_id,
            replace_revision=saved.checkpoint['data']['table_revision'], invitees=[users[-1]])
        await inbox.enqueue(lane, users[0], body)
        original = creation_executor.append_lane_events
        async def fail(*args, **kwargs):
            raise OSError('commit path failed')
        monkeypatch.setattr(creation_executor, 'append_lane_events', fail)
        with pytest.raises(OSError):
            await RoomCreationExecutor(inbox).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == saved
        assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
        assert (await pool.execute('SELECT count(*) FROM room_tables')).rows == [(1,)]
        assert (await pool.execute('SELECT count(*) FROM hosted_invitation_limits')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM room_invitations')).rows == [(0,)]
        monkeypatch.setattr(creation_executor, 'append_lane_events', original)
        assert (await RoomCreationExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    finally:
        await host.close()
