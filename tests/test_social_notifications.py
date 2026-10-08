"""Committed social notices, provider submission and table dismissal integration."""
from uuid import UUID,uuid4
import pytest
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.inbox import PostgresInboxStore,LaneTarget
from app.durable_games.social import SocialIngress,SocialLaneExecutor
from app.durable_games.social_notices import notify
from app.durable_games.queries import PostgresHostedQueries
from app.push.worker import PushWorker
from test_checkpoint_store import database,host_game
from test_push import devices

@pytest.mark.parametrize('kind,scope',[('chat','room'),('chat','table'),('chat','direct'),('poke','table')])
async def test_notice_commit_push_dedup_and_block_recheck(database,kind,scope):
    pool,store,fence,users=database
    host,game=await host_game(users,started=False)
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        service,providers,ids=await devices(pool,users[:2])
        if scope=='direct':
            await pool.execute("INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES(%s,%s,%s,'accepted')",
                (UUID(users[0][5:]),UUID(users[1][5:]),UUID(users[0][5:])))
        inbox=PostgresInboxStore(pool)
        payload=dict(scope=scope)
        if scope!='direct':payload['room_id']='room'
        if scope=='table':payload.update(table_id=game.table.table_id,match_id=game.match_id)
        async def queue(key):
            async with pool.connection() as c,c.transaction():
                await notify(c,inbox,actor=users[0],recipients=[users[0],users[1]],key=key,kind=kind,payload=payload)
        await queue('one')
        assert (await pool.execute('SELECT count(*) FROM push_deliveries')).rows==[(0,)]
        lane=await inbox.ensure_lane(LaneTarget(kind='recipient',recipient_id=UUID(users[1][5:])))
        assert (await SocialLaneExecutor(inbox).execute_one(lane)).outcome['status']=='accepted'
        assert (await pool.execute('SELECT user_id,kind,payload FROM friend_notifications')).rows==[(UUID(users[1][5:]),kind,payload)]
        worker=PushWorker(pool,providers)
        assert await worker.send_one()
        assert len(providers.sent)==1
        assert providers.sent[0][1]['data']['kind']==kind
        assert 'text' not in providers.sent[0][1]['data']
        if scope=='direct':assert providers.sent[0][1]['data']['other_user_id']==users[0]
        await queue('one')
        assert await SocialLaneExecutor(inbox).execute_one(lane) is None
        assert (await pool.execute('SELECT count(*) FROM push_deliveries')).rows==[(1,)]
        await queue('two')
        await SocialLaneExecutor(inbox).execute_one(lane)
        from app.player_blocks.service import BlockService
        await BlockService(pool).set(users[1],users[0],True)
        assert await worker.send_one()
        assert len(providers.sent)==1
        assert (await pool.execute("SELECT count(*) FROM push_deliveries WHERE status='expired'")).rows==[(1,)]
    finally:await host.close()

async def test_discard_regular_table_is_personal_persistent_and_does_not_leave_seat(database):
    pool,store,fence,users=database
    viewer=users[-1]
    host,game=await host_game(users,started=False)
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        inbox=PostgresInboxStore(pool)
        query=PostgresHostedQueries(pool)
        assert len((await query.activity(viewer))['items'])==1
        body=dict(command_id=uuid4().hex,command='discard-table',payload=dict(table_id=game.table.table_id,match_id=game.match_id))
        target=LaneTarget(kind='recipient',recipient_id=UUID(viewer[5:]))
        accepted=await SocialIngress(inbox).submit(viewer,target,body)
        result=await SocialLaneExecutor(inbox).execute_one(accepted['lane_id'])
        assert result.outcome['status']=='accepted'
        assert (await query.activity(viewer))['items']==[]
        assert len((await query.activity(users[0]))['items'])==1
        assert len((await query.activity(viewer,memberships=True))['items'][0]['tables'])==1
        assert (await store.load(game.table.table_id)).checkpoint['data']['table_revision']==0
        assert (await SocialIngress(inbox).submit(viewer,target,body))['status']=='accepted'
        assert (await pool.execute('SELECT count(*) FROM table_dismissals')).rows==[(1,)]
    finally:await host.close()

async def test_previous_dismissal_cannot_hide_reserved_seat_and_stale_discard_is_rejected(database):
    pool,store,fence,users=database
    host,game=await host_game(users,started=False)
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        actor=users[1]
        await pool.execute('INSERT INTO table_dismissals(user_id,table_id,match_id) VALUES (%s,%s,%s)',
            (UUID(actor[5:]),UUID(game.table.table_id),game.match_id))
        query=PostgresHostedQueries(pool)
        assert (await query.activity(actor))['items'][0]['current_user']['is_seated'] is True
        before=await store.load(game.table.table_id)
        inbox=PostgresInboxStore(pool)
        target=LaneTarget(kind='recipient',recipient_id=UUID(actor[5:]))
        body=dict(command_id=uuid4().hex,command='discard-table',payload=dict(table_id=game.table.table_id,match_id=game.match_id))
        pending=await SocialIngress(inbox).submit(actor,target,body)
        outcome=(await SocialLaneExecutor(inbox).execute_one(pending['lane_id'])).outcome
        assert outcome['status']=='rejected'
        assert await store.load(game.table.table_id)==before
        assert len((await query.activity(actor))['items'])==1
    finally:await host.close()
