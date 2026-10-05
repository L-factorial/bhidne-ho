from copy import deepcopy
from datetime import datetime,timezone
import hashlib
from uuid import UUID,uuid4
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.push.http import Device,Preferences,Activity
from app.push.service import PushService,quiet,DEFAULTS
from app.push.worker import PushWorker
from app.push.events import action
from app.push.providers import SendResult
from app.durable_games.checkpoints import capture_checkpoint
from test_checkpoint_store import database,host_game

class Providers:
    available=['apns','fcm']
    def __init__(self):self.sent=[];self.result=SendResult('sent')
    async def send(self,device,payload,**options):
        self.sent.append((device,payload,options));return self.result
    async def start(self):pass
    async def close(self):pass

async def devices(pool,users,providers=None):
    providers=providers or Providers();service=PushService(pool,providers);ids=[]
    for index,user in enumerate(users):
        device=uuid4();token='session-'+user
        await pool.execute("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (%s,%s,now()+interval '1 day')",(hashlib.sha256(token.encode()).digest(),UUID(user[5:])))
        body=Device(provider='apns',token=f'{index+1:064x}')
        await service.register(user,token,device,body);ids.append(device)
    return service,providers,ids

def test_action_identity_ignores_revision_and_private_suggestions():
    view=dict(match_id='m',status='playing',your_player_id=1,game_type='callbreak',game=dict(phase='BIDDING',turn={'player_id':1},revision=1),deal={'deal_number':1})
    assert action(view)[0]=='bid'
    copied=deepcopy(view);copied['remaining_ms']=2;copied['game']['revision']=999
    assert action(view)==action(copied)
    copied['your_player_id']=None;assert action(copied) is None
    copied['your_player_id']=1;copied['status']='ended';assert action(copied) is None
    marriage=dict(match_id='m',status='playing',your_player_id=1,game_type='marriage',marriage={'public':{'current_player_id':'2'},'private':{'actions':{'kinds':['show_initial_melds']},'hand':[]}})
    assert action(marriage) is None
    marriage['marriage']['private']['actions']['kinds']=['declare_tunnelas']
    assert action(marriage)[0]=='declare'

def test_quiet_hours_cross_midnight_and_device_timezones():
    prefs=dict(DEFAULTS,quiet_start=22*60,quiet_end=8*60)
    assert quiet(prefs,0,datetime(2026,1,1,23,tzinfo=timezone.utc))
    assert quiet(prefs,0,datetime(2026,1,1,7,tzinfo=timezone.utc))
    assert not quiet(prefs,0,datetime(2026,1,1,8,tzinfo=timezone.utc))
    assert quiet(prefs,-330,datetime(2026,1,1,18,tzinfo=timezone.utc))
    assert not quiet(DEFAULTS,0)
    with pytest.raises(ValidationError):Preferences(quiet_start=1)
    with pytest.raises(ValidationError):Preferences(quiet_start=1,quiet_end=1)
    with pytest.raises(ValidationError):Device(provider='apns',token='not-a-token'*8)

@pytest.mark.parametrize('kind',['callbreak','marriage','flush'])
async def test_committed_game_jobs_generate_only_authorized_actions_and_deduplicate(database,kind):
    pool,store,fence,users=database
    service,provider,ids=await devices(pool,users)
    host,game=await host_game(users,kind)
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        worker=PushWorker(pool,provider)
        assert await worker.generate_one()
        first=(await pool.execute('SELECT kind,event_key FROM push_deliveries')).rows
        assert first and all(row[0] in ('bid','review','draw','discard','bet','shuffle','cut','deal') for row in first)
        await pool.execute('UPDATE push_game_jobs SET processed_revision=-1')
        await worker.generate_one()
        assert (await pool.execute('SELECT kind,event_key FROM push_deliveries')).rows==first
        while await worker.send_one():pass
        assert len(provider.sent)==len(first)
        for device,payload,options in provider.sent:
            assert set(payload['data'])=={'type','notification_id','user_id','room_id','kind','match_id'}
            assert 'card_ids' not in str(payload)
    finally:await host.close()

async def test_game_job_and_invitation_queue_rollback_with_source_transaction(database):
    pool,store,fence,users=database
    await devices(pool,users[:2])
    host,game=await host_game(users,started=False)
    try:
        async with pool.connection() as c:
            with pytest.raises(RuntimeError):
                async with c.transaction():
                    await store.save_in_transaction(c,capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
                    await c.execute("INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id) VALUES ('i','room',%s,%s)",(users[0],users[1]))
                    raise RuntimeError('rollback')
        assert (await pool.execute('SELECT count(*) FROM push_game_jobs')).rows==[(0,)]
        assert (await pool.execute('SELECT count(*) FROM push_deliveries')).rows==[(0,)]
    finally:await host.close()

async def test_foreground_game_defers_then_falls_back_after_heartbeat_expiry(database):
    pool,store,fence,users=database
    service,provider,ids=await devices(pool,users[:2])
    host,game=await host_game(users,'marriage')
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        worker=PushWorker(pool,provider);await worker.generate_one()
        for user,device in zip(users,ids):await service.activity(user,device,Activity(foreground=True,viewed_match=game.match_id))
        assert await worker.send_one();assert not provider.sent
        assert (await pool.execute('SELECT status,attempts FROM push_deliveries')).rows==[('pending',0)]
        await pool.execute("UPDATE push_devices SET foreground_until=now()-interval '1 second'")
        await pool.execute('UPDATE push_deliveries SET next_attempt_at=now()')
        assert await worker.send_one();assert len(provider.sent)==1
    finally:await host.close()

async def test_stale_action_is_cancelled_before_network_send(database):
    pool,store,fence,users=database
    _,provider,_=await devices(pool,users[:2])
    host,game=await host_game(users,'marriage')
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        worker=PushWorker(pool,provider);await worker.generate_one()
        await pool.execute("UPDATE push_deliveries SET action_key='stale'")
        assert await worker.send_one();assert not provider.sent
        assert (await pool.execute('SELECT status FROM push_deliveries')).rows==[('expired',)]
    finally:await host.close()

async def test_preferences_revocation_logout_and_invalid_device_cleanup(database):
    pool,_,_,users=database
    service,provider,ids=await devices(pool,users[:2])
    await pool.execute("INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id) VALUES ('i','room',%s,%s)",(users[0],users[1]))
    await service.update_preferences(users[1],Preferences(invitations=False))
    worker=PushWorker(pool,provider);assert await worker.send_one();assert not provider.sent
    await service.update_preferences(users[1],Preferences())
    await pool.execute("INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id) VALUES ('j','room',%s,%s)",(users[0],users[1]))
    provider.result=SendResult('invalid');assert await worker.send_one()
    assert (await pool.execute('SELECT id FROM push_devices WHERE id=%s',(ids[1],))).rows==[]
    await pool.execute('DELETE FROM auth_sessions WHERE user_id=%s',(UUID(users[0][5:]),))
    assert (await pool.execute('SELECT count(*) FROM push_devices')).rows==[(0,)]

async def test_invitation_status_block_history_and_expiry_are_rechecked(database):
    pool,_,_,users=database
    _,provider,_=await devices(pool,users[:2])
    worker=PushWorker(pool,provider)
    for identity in ('answered','expired','blocked'):
        await pool.execute("INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id) VALUES (%s,'room',%s,%s)",(identity,users[0],users[1]))
        if identity=='answered':await pool.execute("UPDATE room_invitations SET status='accepted' WHERE id=%s",(identity,))
        if identity=='expired':
            await pool.execute("UPDATE push_deliveries SET expires_at=now()-interval '1 second' WHERE source_id=%s",(identity,))
            rows=(await pool.execute('SELECT source_id,expires_at,status FROM push_deliveries')).rows
            assert next(row for row in rows if row[0]=='expired')[1]<datetime.now(timezone.utc),rows
        if identity=='blocked':
            await pool.execute('INSERT INTO player_blocks(blocker_id,blocked_id,active) VALUES (%s,%s,true)',(UUID(users[0][5:]),UUID(users[1][5:])))
        assert await worker.send_one()
        assert not provider.sent, identity
    assert not provider.sent

async def test_multiple_workers_claim_once_and_retry_uses_same_delivery_identity(database):
    pool,_,_,users=database
    _,provider,_=await devices(pool,users[:2])
    await pool.execute("INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id) VALUES ('i','room',%s,%s)",(users[0],users[1]))
    first=PushWorker(pool,provider);second=PushWorker(pool,provider)
    claim=await first.claim();assert claim;assert await second.claim() is None
    await pool.execute("UPDATE push_deliveries SET claim_until=now()-interval '1 second'")
    provider.result=SendResult('retry',5);assert await second.send_one()
    identity=(await pool.execute('SELECT id,status FROM push_deliveries')).rows[0]
    assert identity[1]=='pending'
    await pool.execute('UPDATE push_deliveries SET next_attempt_at=now()')
    provider.result=SendResult('sent');assert await first.send_one()
    assert [sent[1]['data']['notification_id'] for sent in provider.sent]==[str(identity[0])]*2

async def test_registration_cannot_borrow_another_session_and_device_rotation(database):
    pool,_,_,users=database
    service,provider,ids=await devices(pool,users[:2])
    with pytest.raises(HTTPException):await service.register(users[0],'session-'+users[1],uuid4(),Device(provider='apns',token='a'*64))
    await service.register(users[0],'session-'+users[0],ids[0],Device(provider='apns',token='b'*64))
    assert (await pool.execute('SELECT token FROM push_devices WHERE id=%s',(ids[0],))).rows==[('b'*64,)]
    await service.unregister(users[1],ids[0]);assert (await pool.execute('SELECT count(*) FROM push_devices')).rows==[(2,)]

async def test_hosted_invitation_uses_committed_checkpoint_and_cancels_when_answered(database):
    pool,store,fence,users=database
    _,provider,_=await devices(pool,[users[4]])
    host,game=await host_game(users,started=False)
    invitation=dict(id=uuid4().hex,room_id='room',match_id=game.match_id,
        recipient_id=users[4],inviter_id=users[0],status='pending',
        created_at=datetime.now(timezone.utc).timestamp()*1000)
    try:
        await store.save(capture_checkpoint(game,table_revision=0,invitations=[invitation]),expected_revision=None,fence=fence)
        worker=PushWorker(pool,provider);assert await worker.generate_one()
        assert (await pool.execute('SELECT kind FROM push_deliveries')).rows==[('game_invitation',)]
        invitation['status']='accepted'
        await store.save(capture_checkpoint(game,table_revision=1,invitations=[invitation]),expected_revision=0,fence=fence)
        assert await worker.send_one();assert not provider.sent
    finally:await host.close()

async def test_push_http_authentication_preferences_and_capabilities(database):
    from test_distributed_platform import application,signup
    async with application(database[0]) as (client,app,server):
        capability=await client.get('/auth/push/capabilities')
        assert capability.json()=={'providers':[]}
        assert capability.headers['cache-control']=='no-store'
        assert (await client.get('/me/push/preferences')).status_code==401
        user,headers=await signup(client,'push_http')
        reply=await client.patch('/me/push/preferences',headers=headers,json={'sound':False})
        assert reply.status_code==200 and reply.json()['sound'] is False
        assert (await client.get('/me/push/preferences',headers=headers)).json()['sound'] is False
        assert (await client.patch('/me/push/preferences',headers=headers,json={'quiet_start':12})).status_code==422
