"""Room-lane lobby creation against production PostgreSQL SQL in WASM."""
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError
from pydantic import ValidationError

from app.durable_games.creation_executor import RoomCreationExecutor, creation_ids
from app.durable_games.inbox import InboxOutcome, LaneTarget, PostgresInboxStore
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database


@pytest.fixture
async def creation(database):
    pool, checkpoints, fence, users = database
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
    return pool, checkpoints, fence, users, inbox, lane, RoomCreationExecutor(inbox)


def request(name='Table', game_type='marriage', capacity=2, command_id=None):
    return {'command_id': command_id or uuid4().hex, 'command': 'create-table',
            'payload': {'name': name, 'game_type': game_type, 'capacity': capacity}}


async def create(context, actor, body):
    _, _, fence, _, inbox, lane, executor = context
    await inbox.enqueue(lane, actor, body)
    return (await executor.execute_one(lane, fence)).outcome


@pytest.mark.parametrize(('kind', 'capacity'), [('callbreak', 4), ('marriage', 5), ('flush', 10)])
async def test_creates_recoverable_lobby_and_lane_with_stable_receipt(creation, kind, capacity):
    pool, checkpoints, fence, users, inbox, lane, executor = creation
    body = request('  Game   Night  ', kind, capacity)
    outcome = await create(creation, users[0], body)
    assert outcome['status'] == 'accepted' and outcome['revision'] == 0
    ids = creation_ids(lane, users[0], body['command_id'])
    assert (outcome['table_id'], outcome['match_id']) == tuple(i.hex for i in ids)
    saved = await checkpoints.load(outcome['table_id'])
    assert saved.checkpoint['data']['name'] == 'Game Night'
    assert saved.checkpoint['data']['host']['users'] == [users[0]]
    assert saved.checkpoint['data']['engine'] is None and saved.receipt_snapshot['receipt_count'] == 0
    rebuilt = rebuild_hosted_game(None, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot)
    assert rebuilt.game.match_id == outcome['match_id']
    if kind == 'flush': assert rebuilt.game.flush_seats == {users[0]: 1}
    assert (await pool.execute('SELECT count(*) FROM games')).rows == [(0,)]
    assert (await pool.execute("SELECT count(*) FROM command_lanes WHERE kind='table'")).rows == [(1,)]
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
    prior = await inbox.enqueue(lane, users[0], body)
    assert prior.duplicate and prior.outcome == outcome
    assert (await inbox.lookup(lane, users[0], body['command_id'])).outcome == outcome
    assert await executor.execute_one(lane, fence) is None
    rows = (await pool.execute('SELECT event_type,audience_user_id FROM notification_outbox WHERE lane_id=%s ORDER BY sequence', (lane,))).rows
    assert rows == [('TABLE_CREATED', None), ('TABLE_CREATION_ACK', UUID(users[0][5:]))]


async def test_room_limit_rejection_is_stable_after_space_becomes_available(creation):
    pool, _, fence, users, inbox, lane, executor = creation
    results = [await create(creation, user, request(f'Table {i}')) for i, user in enumerate(users[:5])]
    assert all(r['status'] == 'accepted' for r in results)
    full_request = request('Sixth')
    rejected = await create(creation, users[5], full_request)
    assert rejected['status'] == 'rejected' and 'limit' in rejected['detail']
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(5,)]
    table_lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(results[0]['table_id'])))
    await inbox.enqueue(table_lane, users[0], {'command_id': 'leave', 'command': 'leave-seat',
        'match_id': results[0]['match_id'], 'expected_revision': 0, 'payload': {}})
    assert (await TableLaneExecutor(inbox).execute_one(table_lane, fence)).outcome['status'] == 'accepted'
    assert (await inbox.enqueue(lane, users[5], full_request)).outcome == rejected
    assert await executor.execute_one(lane, fence) is None
    # Closed table names may be reused by a new, explicit request.
    assert (await create(creation, users[5], request('Table 0')))['status'] == 'accepted'


async def test_name_conflict_and_existing_seat_do_not_replace_tables(creation):
    pool, _, _, users, _, _, _ = creation
    first = await create(creation, users[0], request('Straße'))
    assert first['status'] == 'accepted'
    duplicate_name = await create(creation, users[1], request('STRASSE'))
    assert duplicate_name['status'] == 'rejected' and 'name' in duplicate_name['detail']
    occupied = await create(creation, users[0], request('Other'))
    assert occupied['status'] == 'rejected' and 'seat' in occupied['detail']
    assert (await pool.execute('SELECT count(*) FROM room_tables')).rows == [(1,)]
    assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows == [(1,)]


@pytest.mark.parametrize('change', [
    {'capacity': True}, {'capacity': 6, 'game_type': 'marriage'},
    {'capacity': 3, 'game_type': 'callbreak'}, {'name': '   '}, {'game_type': 'unknown'}, {'extra': True},
])
async def test_invalid_payload_is_a_no_effect_rejection(creation, change):
    pool, _, _, users, _, _, _ = creation
    body = request()
    body['payload'].update(change)
    result = await create(creation, users[0], body)
    assert result['status'] == 'rejected' and 'table_id' not in result
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(0,)]


@pytest.mark.parametrize('actor', ['system:timer', 'nonmember'])
async def test_execution_rechecks_membership_and_user_identity(creation, actor):
    pool, _, _, users, _, _, _ = creation
    if actor == 'nonmember':
        actor = users[-1]
        await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
    result = await create(creation, actor, request())
    assert result['status'] == 'rejected'
    assert (await pool.execute('SELECT count(*) FROM room_tables')).rows == [(0,)]


async def test_unknown_account_is_rejected_before_creation_is_queued(creation):
    pool, _, fence, users, inbox, lane, executor = creation
    actor, body = f'user-{uuid4()}', request()
    # Account availability is checked at admission, before sequence allocation.
    with pytest.raises(DurableGameConflict, match=r'Account unavailable\.'):
        await inbox.enqueue(lane, actor, body)
    assert await inbox.lookup(lane, actor, body['command_id']) is None
    assert (await pool.execute('SELECT enqueued_sequence,processed_sequence FROM command_lanes WHERE lane_id=%s', (lane,))).rows == [(0, 0)]
    assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
    assert (await pool.execute('SELECT count(*) FROM room_tables')).rows == [(0,)]
    assert await executor.execute_one(lane, fence) is None
    # Rejection does not allocate a gap or prevent a real account from creating.
    queued = await inbox.enqueue(lane, users[0], request())
    assert queued.sequence == 1
    assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'


async def test_failure_after_creation_rolls_back_all_rows_and_preserves_retry_identity(creation):
    pool, _, fence, users, inbox, lane, executor = creation
    body = request()
    await inbox.enqueue(lane, users[0], body)
    with pytest.raises(DurableGameConflict, match='event batch'):
        await RoomCreationExecutor(inbox, max_events=1).execute_one(lane, fence)
    for table in ('room_tables', 'table_recovery_state', 'table_positions', 'active_table_players', 'notification_outbox'):
        assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows == [(0,)]
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(0,)]
    assert (await pool.execute('SELECT count(*) FROM command_lanes')).rows == [(1,)]
    assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
    result = (await executor.execute_one(lane, fence)).outcome
    assert result['table_id'] == creation_ids(lane, users[0], body['command_id'])[0].hex


async def test_unknown_commit_returns_original_ids_without_second_allocation(creation):
    pool, _, fence, users, inbox, lane, executor = creation
    body = request()
    await inbox.enqueue(lane, users[0], body)
    class LostCommit:
        @asynccontextmanager
        async def connection(self):
            class Connection:
                def __getattr__(self, name): return getattr(pool, name)
                @asynccontextmanager
                async def transaction(self):
                    async with pool.transaction(): yield
                    raise OperationalError('lost response after commit')
            yield Connection()
    with pytest.raises(OperationalError):
        await RoomCreationExecutor(PostgresInboxStore(LostCommit())).execute_one(lane, fence)
    result = await inbox.enqueue(lane, users[0], body)
    assert result.duplicate and result.outcome['status'] == 'accepted'
    assert result.outcome['table_id'] == creation_ids(lane, users[0], body['command_id'])[0].hex
    assert await executor.execute_one(lane, fence) is None
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
    assert (await pool.execute('SELECT count(*) FROM notification_outbox WHERE lane_id=%s', (lane,))).rows == [(2,)]
    # Public creation invalidates the global lobby in addition to member feeds.
    assert (await pool.execute("SELECT count(*) FROM notification_outbox WHERE event_type='LOBBY_CHANGED'")).rows == [(len(users) + 1,)]


async def test_unsupported_options_and_old_owner_do_not_consume_head(creation):
    pool, _, fence, users, inbox, lane, executor = creation
    body = request()
    body['command'] = 'future-room-command'
    await inbox.enqueue(lane, users[0], body)
    with pytest.raises(DurableGameConflict): await executor.execute_one(lane, fence)
    assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    with pytest.raises(StaleGameOwner): await executor.execute_one(lane, fence)
    assert (await pool.execute('SELECT count(*) FROM room_tables')).rows == [(0,)]


async def test_creation_rejects_existing_match_or_revision(creation):
    _, _, _, users, _, _, _ = creation
    for field, value in [('match_id', uuid4().hex), ('expected_revision', 0)]:
        body = request()
        body[field] = value
        assert (await create(creation, users[0], body))['status'] == 'rejected'


def test_creation_receipt_identity_pair_validation():
    for data in ({'table_id': uuid4().hex}, {'table_id': 'bad', 'match_id': uuid4().hex},
                 {'table_id': uuid4().hex, 'match_id': uuid4().hex, 'status': 'rejected'}):
        fields = {'command_id': 'create', 'status': 'accepted', **data}
        with pytest.raises(ValidationError): InboxOutcome.model_validate(fields)


async def test_request_identity_is_actor_scoped_and_payload_cannot_change(creation):
    pool, _, _, users, inbox, lane, _ = creation
    first = await create(creation, users[0], request('First', command_id='same'))
    second = await create(creation, users[1], request('Second', command_id='same'))
    assert first['table_id'] != second['table_id'] and first['match_id'] != second['match_id']
    with pytest.raises(DurableGameConflict, match='different request'):
        await inbox.enqueue(lane, users[0], request('Changed', command_id='same'))
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(2,)]


async def test_configured_limit_is_read_from_the_room(creation):
    pool, _, _, users, _, _, _ = creation
    await pool.execute('UPDATE rooms SET max_open_tables=1')
    assert (await create(creation, users[0], request('One')))['status'] == 'accepted'
    assert (await create(creation, users[1], request('Two')))['status'] == 'rejected'
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]


async def test_identity_collision_is_not_adopted_or_overwritten(creation):
    pool, _, fence, users, inbox, lane, executor = creation
    body = request('New')
    table_id, _ = creation_ids(lane, users[0], body['command_id'])
    await pool.execute('''INSERT INTO room_tables(table_id,room_id,name,game_type)
        VALUES (%s,'room','Existing identity','flush')''', (table_id,))
    await inbox.enqueue(lane, users[0], body)
    with pytest.raises(DurableGameConflict, match='identities already exist'):
        await executor.execute_one(lane, fence)
    assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
    assert (await pool.execute('SELECT name,game_type FROM room_tables')).rows == [('Existing identity', 'flush')]
    assert (await pool.execute('SELECT count(*) FROM table_recovery_state')).rows == [(0,)]


def test_creation_identity_accepts_equivalent_lane_uuid_forms():
    lane = uuid4()
    ids = creation_ids(lane, 'actor', 'request')
    assert ids == creation_ids(lane.hex, 'actor', 'request') == creation_ids(str(lane), 'actor', 'request')
    assert ids[0] != ids[1]


async def test_play_creation_notifies_members_decline_hides_only_play_feed(creation):
    from app.durable_games.queries import PostgresHostedQueries
    pool, checkpoints, fence, users, inbox, _, _ = creation
    body = request(game_type='flush', capacity=10)
    body['payload']['notify_room'] = True
    result = await create(creation, users[0], body)
    assert result['status'] == 'accepted'
    invitations = (await checkpoints.load(result['table_id'])).checkpoint['data']['invitations']
    assert {i['recipient_id'] for i in invitations} == set(users[1:])
    assert all(i['room_notification'] and not i['auto_friend'] for i in invitations)
    item = next(i for i in invitations if i['recipient_id'] == users[1])
    queries = PostgresHostedQueries(pool)
    assert len((await queries.activity(users[1]))['items']) == 1
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(result['table_id'])))
    await inbox.enqueue(lane, users[1], dict(command_id=uuid4().hex, command='answer-table-invitation',
        match_id=result['match_id'], expected_revision=0, payload=dict(invitation_id=item['id'], accept=False)))
    assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    assert (await queries.activity(users[1]))['items'] == []
    assert len((await queries.activity(users[2]))['items']) == 1
    assert len((await queries.activity(users[1], memberships=True))['items'][0]['tables']) == 1


async def test_invited_nonmember_acceptance_orders_friendship_on_pair_lane(creation):
    from app.durable_games.social import SocialIngress, SocialLaneExecutor, conversation
    pool, checkpoints, fence, users, inbox, _, _ = creation
    await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[1][5:]),))
    body = request(game_type='flush', capacity=10)
    body['payload'].update(notify_room=True, invitees=[users[1]])
    result = await create(creation, users[0], body)
    assert result['status'] == 'accepted'
    item = next(i for i in (await checkpoints.load(result['table_id'])).checkpoint['data']['invitations'] if i['recipient_id'] == users[1])
    assert item['auto_friend'] and not item['room_notification']
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(result['table_id'])))
    answer = dict(command_id=uuid4().hex, command='answer-table-invitation', match_id=result['match_id'], expected_revision=0,
        payload=dict(invitation_id=item['id'], accept=True))
    await inbox.enqueue(lane, users[1], answer)
    assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    assert (await pool.execute('SELECT count(*) FROM room_memberships WHERE user_id=%s', (UUID(users[1][5:]),))).rows == [(1,)]
    pair = conversation(users[0], users[1])
    pair_lane = await inbox.ensure_lane(pair)
    executor = SocialLaneExecutor(inbox)
    # A later checkpoint may no longer contain the old invitations. The
    # committed acceptance receipt must still authorize the queued effect.
    from app.durable_games.checkpoints import capture_checkpoint
    saved = await checkpoints.load(result['table_id'])
    game = rebuild_hosted_game(None, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
    await checkpoints.save(capture_checkpoint(game, table_revision=2), expected_revision=1, fence=fence)
    assert (await executor.execute_one(pair_lane)).outcome['status'] == 'accepted'
    assert (await pool.execute('SELECT status FROM friendships')).rows == [('accepted',)]
    assert await executor.execute_one(pair_lane) is None
    assert (await inbox.enqueue(lane, users[1], answer)).duplicate
    # Public callers cannot forge the trusted invitation-to-friendship command.
    with pytest.raises(ValueError):
        await SocialIngress(inbox).submit(users[1], pair, dict(command_id=uuid4().hex,
            command='accept-invitation-friend',payload=dict(table_id=result['table_id'],invitation_id=item['id'])))


async def test_room_notification_skips_blocked_member_and_acceptance_does_not_add_friends(creation):
    from app.player_blocks.service import BlockService
    pool, checkpoints, fence, users, inbox, _, _ = creation
    await BlockService(pool).set(users[2], users[0], True)
    body = request(game_type='flush', capacity=10)
    body['payload']['notify_room'] = True
    result = await create(creation, users[0], body)
    assert result['status'] == 'accepted'
    invitations = (await checkpoints.load(result['table_id'])).checkpoint['data']['invitations']
    assert users[2] not in {i['recipient_id'] for i in invitations}
    item = next(i for i in invitations if i['recipient_id'] == users[1])
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(result['table_id'])))
    await inbox.enqueue(lane, users[1], dict(command_id=uuid4().hex, command='answer-table-invitation',
        match_id=result['match_id'], expected_revision=0, payload=dict(invitation_id=item['id'], accept=True)))
    assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    assert (await pool.execute("SELECT count(*) FROM command_inbox WHERE command='accept-invitation-friend'")).rows == [(0,)]
    assert (await pool.execute('SELECT count(*) FROM friendships')).rows == [(0,)]
