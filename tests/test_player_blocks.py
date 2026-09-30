"""Blocking isolates social contact while preserving shared gameplay and cursors."""
from uuid import UUID, uuid4

import pytest

from app.player_blocks.service import BlockService, blocked
from app.durable_games.queries import QueryAccessDenied, PostgresHostedQueries
from app.durable_games.delivery_store import PostgresDeliveryStore
from app.durable_games.social_history import SocialHistory
from app.durable_games.chat import ChatHistory
from app.durable_games.inbox import LaneTarget
from test_checkpoint_store import database, host_game
from test_durable_social import setup, request, notify
from test_durable_chat import room, request as chat_request
from test_delivery import sql
from test_distributed_platform import application, signup
from test_creation_executor import creation, create, request as create_request


async def test_block_direction_pagination_and_no_friendship_restoration(database):
    pool, _, _, users = database
    await setup(database)
    blocks = BlockService(pool)
    with pytest.raises(ValueError): await blocks.set(users[0], users[0], True)
    with pytest.raises(QueryAccessDenied): await blocks.set(users[0], 'user-'+str(uuid4()), True)
    for target in users[1:4]: await blocks.set(users[0], target, True)
    page = await blocks.list(users[0], limit=2)
    assert [p['user_id'] for p in page['items']] == users[1:3]
    assert [p['user_id'] for p in (await blocks.list(users[0], page['next_id']))['items']] == [users[3]]
    assert (await blocks.list(users[1]))['items'] == []
    assert await sql(pool, 'SELECT count(*) FROM friendships') == [(0,)]
    await blocks.set(users[1], users[0], True)
    await blocks.set(users[0], users[1], False)
    async with pool.connection() as c: assert await blocked(c, users[0], users[1])
    await blocks.set(users[1], users[0], False)
    async with pool.connection() as c: assert not await blocked(c, users[0], users[1])
    assert await sql(pool, 'SELECT count(*) FROM friendships') == [(0,)]
    assert await sql(pool, 'SELECT count(*) FROM room_memberships') == [(6,)]


async def test_queued_contact_never_revives_after_unblock(database):
    pool, _, _, users = database
    inbox, ingress, executor, target = await setup(database)
    pending = await ingress.submit(users[0], target, request())
    lane = UUID(pending['lane_id'])
    blocks = BlockService(pool)
    await blocks.set(users[1], users[0], True)
    for sender in users[:2]:
        with pytest.raises(QueryAccessDenied): await ingress.submit(sender, target, request())
        with pytest.raises(QueryAccessDenied): await ingress.submit(sender, target, dict(command_id=uuid4().hex,command='request-friend',payload={}))
        with pytest.raises(QueryAccessDenied): await SocialHistory(pool).page(sender, lane)
    await blocks.set(users[1], users[0], False)
    # Even if users establish a new friendship before the old worker runs,
    # its pre-block message must not be sent.
    await sql(pool,"INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'accepted')",
        (UUID(users[0][5:]), UUID(users[1][5:]), UUID(users[0][5:])))
    assert (await executor.execute_one(lane)).outcome['status'] == 'rejected'
    assert await sql(pool, 'SELECT count(*) FROM direct_messages') == [(0,)]
    fresh = await ingress.submit(users[0], target, request())
    assert (await executor.execute_one(UUID(fresh['lane_id']))).outcome['status'] == 'accepted'


async def test_chat_history_and_replay_filter_pair_but_advance_every_sequence(database):
    pool, _, fence, users = database
    inbox, ingress, executor, target = await room(database)
    lane = None
    for sender in users[:3]:
        queued = await ingress.submit(sender, target, chat_request(sender))
        lane = UUID(queued['lane_id'])
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
    await BlockService(pool).set(users[0], users[1], True)
    for viewer, hidden in ((users[0], users[1]), (users[1], users[0])):
        history = (await ChatHistory(pool).page(viewer, lane))['items']
        assert len(history) == 2 and all(m['sender_id'] != hidden for m in history)
        page = await PostgresDeliveryStore(pool).page(viewer, lane)
        assert page.scanned_sequence == 6
        assert len([e for e in page.events if e['event_type'] == 'CHAT_MESSAGE']) == 2
        assert any(e['event_type'] == 'CHAT_COMMAND_ACK' for e in page.events)
    assert len((await ChatHistory(pool).page(users[2], lane))['items']) == 3
    assert len((await PostgresHostedQueries(pool).room('room', users[1]))['tables']) == 0


async def test_notification_history_and_pending_notification_are_suppressed(database):
    pool, _, _, users = database
    inbox, _, executor, _ = await setup(database)
    old = await notify(inbox, users[0], key='old-contact', kind='friend_requested', actor=users[1])
    assert (await executor.execute_one(old.lane_id)).outcome['status'] == 'accepted'
    own = await notify(inbox, users[0], key='own-contact', kind='friendship_changed', actor=users[0], payload={'other_user_id':users[1]})
    assert (await executor.execute_one(own.lane_id)).outcome['status'] == 'accepted'
    await notify(inbox, users[0], key='queued-contact', kind='friend_requested', actor=users[1])
    await notify(inbox, users[0], key='queued-own-contact', kind='friendship_changed', actor=users[0], payload={'other_user_id':users[1]})
    await BlockService(pool).set(users[0], users[1], True)
    assert (await SocialHistory(pool).page(users[0], old.lane_id))['items'] == []
    assert not (await PostgresDeliveryStore(pool).page(users[0], old.lane_id)).events
    await BlockService(pool).set(users[0], users[1], False)
    assert (await executor.execute_one(old.lane_id)).outcome['status'] == 'rejected'
    assert (await executor.execute_one(old.lane_id)).outcome['status'] == 'rejected'
    assert (await SocialHistory(pool).page(users[0], old.lane_id))['items'] == []


async def test_hosted_and_room_invitations_cancel_without_removing_membership(creation):
    pool, store, fence, users, inbox, lane, executor = creation
    body = create_request(); body['payload']['invitees'] = [users[-1]]
    result = await create(creation, users[0], body)
    assert result['status'] == 'accepted'
    queries = PostgresHostedQueries(pool)
    item = (await queries.invitations(users[-1]))['items'][0]
    await BlockService(pool).set(users[-1], users[0], True)
    assert (await queries.invitations(users[-1]))['items'] == []
    assert not any(e['event_type'] == 'TABLE_INVITATION_CREATED' for e in (await PostgresDeliveryStore(pool).page(users[-1], lane)).events)
    await BlockService(pool).set(users[-1], users[0], False)
    assert (await queries.invitations(users[-1]))['items'] == []
    from app.durable_games.table_executor import TableLaneExecutor
    table_lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(result['table_id'])))
    await inbox.enqueue(table_lane, users[-1], dict(command_id=uuid4().hex,command='answer-table-invitation',
        match_id=result['match_id'],expected_revision=0,payload=dict(invitation_id=item['id'],accept=True)))
    assert (await TableLaneExecutor(inbox).execute_one(table_lane,fence)).outcome['status'] == 'rejected'
    assert await sql(pool,'SELECT count(*) FROM room_memberships') == [(6,)]
    assert (await store.load(result['table_id'])).checkpoint['data']['host']['users'] == [users[0]]


@pytest.mark.parametrize('before_block', [True, False])
async def test_preblock_queued_hosted_invitation_terminally_rejects(creation, before_block):
    pool, _, fence, users, inbox, lane, executor = creation
    body = create_request(); body['payload']['invitees'] = [users[-1]]
    if before_block: await inbox.enqueue(lane,users[0],body)
    await BlockService(pool).set(users[-1],users[0],True)
    if not before_block: await inbox.enqueue(lane,users[0],body)
    await BlockService(pool).set(users[-1],users[0],False)
    assert (await executor.execute_one(lane,fence)).outcome['status'] == 'rejected'
    assert await sql(pool,'SELECT count(*) FROM room_tables') == [(0,)]


async def test_pokes_reject_but_existing_game_is_unchanged(database):
    from app.durable_games.checkpoints import capture_checkpoint
    from app.durable_games.inbox import PostgresInboxStore
    from app.durable_games.table_executor import TableLaneExecutor
    pool, store, fence, users = database
    host, game = await host_game(users,'flush')
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        before = await store.load(game.table.table_id)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id)))
        await inbox.enqueue(lane,users[0],dict(command_id=uuid4().hex,command='send-reaction',payload={'reaction':'clap','recipient_player_id':2},match_id=game.match_id,expected_revision=0))
        assert (await TableLaneExecutor(inbox).execute_one(lane,fence)).outcome['status'] == 'accepted'
        await BlockService(pool).set(users[0],users[1],True)
        assert not any(e['event_type'] == 'TABLE_REACTION' for e in (await PostgresDeliveryStore(pool).page(users[1],lane)).events)
        assert any(e['event_type'] == 'TABLE_REACTION' for e in (await PostgresDeliveryStore(pool).page(users[2],lane)).events)
        for command, payload in [('send-poke', {'text':'Hello','recipient_player_id':2}), ('send-reaction', {'reaction':'clap','recipient_player_id':2})]:
            await inbox.enqueue(lane,users[0],dict(command_id=uuid4().hex,command=command,payload=payload,match_id=game.match_id,expected_revision=0))
            assert (await TableLaneExecutor(inbox).execute_one(lane,fence)).outcome['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        view = await PostgresHostedQueries(pool).room('room',users[1],table_id=game.table.table_id)
        assert view['snapshot'] is not None
    finally: await host.close()


async def test_manual_seat_invitation_does_not_revive_but_fifo_still_works(database):
    from test_seat_offers import vacancy,action,offers
    pool,_,_,users = database
    host,game,inbox,lane = await vacancy(database)
    try:
        assert (await action(database,game,inbox,lane,users[0],'invite-seat',{'seat_id':1,'recipient':users[4]}))['status'] == 'accepted'
        offer = (await offers(database,game))[0]
        await BlockService(pool).set(users[4],users[0],True)
        await BlockService(pool).set(users[4],users[0],False)
        assert (await action(database,game,inbox,lane,users[4],'accept-seat',{'offer_id':offer['offer_id']}))['status'] == 'rejected'
        assert (await action(database,game,inbox,lane,users[4],'decline-seat',{'offer_id':offer['offer_id']}))['status'] == 'accepted'
        await BlockService(pool).set(users[4],users[0],True)
        assert (await action(database,game,inbox,lane,users[4],'join-queue'))['status'] == 'accepted'
        automatic = next(o for o in await offers(database,game) if o['status'] == 'PENDING')
        assert (await action(database,game,inbox,lane,users[4],'accept-seat',{'offer_id':automatic['offer_id']}))['status'] == 'accepted'
    finally: await host.close()


async def test_http_actor_binding_and_cross_gateway_enforcement(database):
    from app.durable_games.catalog import PostgresRoomCreation
    async with application(database[0]) as (client, app, server):
        a, headers = await signup(client,'block_owner')
        b, other = await signup(client,'block_target')
        path = '/me/blocks/'+b['user_id']
        assert (await client.get('/auth/safety/capabilities')).json() == {'blocking':True}
        assert (await client.post(path,json={})).status_code == 401
        assert (await client.post(path,headers=headers,json={'user_id':b['user_id']})).status_code == 422
        assert (await client.post('/me/blocks/'+a['user_id'],headers=headers,json={})).status_code == 422
        reply = await client.post(path,headers=headers,json={})
        assert reply.status_code == 200, reply.text
        assert reply.headers['cache-control'] == 'no-store'
        assert (await client.get('/me/blocks',headers=other)).json()['items'] == []
        assert (await client.get('/me/blocks',headers=headers)).json()['items'][0]['user_id'] == b['user_id']
        # A separate service/gateway observes SQL state without cache invalidation.
        async with database[0].connection() as c: assert await blocked(c,a['user_id'],b['user_id'])
        with pytest.raises(QueryAccessDenied):
            await PostgresRoomCreation(database[0]).create(b['user_id'],dict(command_id='blocked-room',name='No bypass',invitees=[a['user_id']]))
        assert (await client.delete(path,headers=other)).status_code == 422  # self-target, cannot remove owner's row
        assert (await client.delete(path,headers=headers)).status_code == 200


async def test_account_erasure_removes_owned_and_reverse_block_data(database):
    from test_account_deletion import setup as deletion_setup, clean
    pool = database[0]
    auth,a,recovery,deletion = await deletion_setup(pool)
    b = await auth.sign_up('other_blocked_player','original-password')
    await BlockService(pool).set(a.user_id,b.user_id,True)
    await BlockService(pool).set(b.user_id,a.user_id,True)
    await deletion.request(a.user_id,password='original-password')
    await clean(pool,recovery,a.user_id)
    assert await sql(pool,'SELECT count(*) FROM player_blocks') == [(0,)]
    assert (await auth.authenticate(b.token)).user_id == b.user_id
