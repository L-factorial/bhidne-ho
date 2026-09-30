from types import SimpleNamespace
from uuid import UUID,uuid4

import pytest

from app.account_deletion.service import DeletionService,DeletionError
from app.account_deletion.erasure import erase,rewrite
from app.auth.postgres import PostgresAuthService
from app.auth.service import AuthenticationError
from app.auth.recovery_delivery import RecoveryRuntime
from test_account_recovery import recovery_database
from test_recovery_delivery import config


async def setup(pool):
    auth=PostgresAuthService(pool)
    a=await auth.sign_up('deletion_player','original-password',email='private@example.test')
    recovery=RecoveryRuntime(pool,auth,config())
    return auth,a,recovery,DeletionService(pool,recovery)


async def clean(pool,recovery,user):
    async with pool.connection() as c:
        async with c.transaction():
            row=await(await c.execute('SELECT id,user_id FROM account_deletion_jobs WHERE user_id=%s',(UUID(user[5:]),))).fetchone()
            await c.execute('UPDATE account_deletion_jobs SET worker_xid=txid_current() WHERE id=%s',(row[0],))
            await c.execute("SELECT set_config('bhidne.deletion_job',%s,true)",(str(row[0]),))
            await erase(c,row,recovery)
            await c.execute("UPDATE account_deletion_jobs SET status='completed',completed_at=clock_timestamp(),worker_xid=NULL WHERE id=%s",(row[0],))


async def test_password_proof_revokes_sessions_and_cleanup_preserves_other_accounts(recovery_database):
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool)
    b=await auth.sign_up('other_player','original-password')
    second=await auth.sign_in('deletion_player','original-password')
    with pytest.raises(DeletionError,match='invalid_proof'):
        await deletion.request(a.user_id,password='wrong')
    assert (await auth.authenticate(a.token)).user_id==a.user_id
    result=await deletion.request(a.user_id,password='original-password')
    for token in (a.token,second.token):
        with pytest.raises(AuthenticationError): await auth.authenticate(token)
    with pytest.raises(AuthenticationError): await auth.sign_in('deletion_player','original-password')
    assert (await deletion.status(result['status_token']))['status']=='pending'
    await clean(pool,recovery,a.user_id)
    assert (await deletion.status(result['status_token']))['status']=='completed'
    assert (await pool.execute('SELECT count(*) FROM users WHERE id=%s',(UUID(a.user_id[5:]),))).rows==[(0,)]
    assert (await pool.execute('SELECT count(*) FROM account_credentials WHERE username=%s',('deletion_player',))).rows==[(0,)]
    assert (await auth.authenticate(b.token)).user_id==b.user_id
    with pytest.raises(DeletionError): await deletion.request(a.user_id,password='original-password')


async def test_points_and_room_ownership_survive_erasure(recovery_database):
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool)
    b=await auth.sign_up('other_player','original-password')
    aid,bid=UUID(a.user_id[5:]),UUID(b.user_id[5:]);game,table=uuid4(),uuid4()
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('points-room',%s,'Friends','private')",(aid,))
    await pool.execute("INSERT INTO room_memberships(room_id,user_id) VALUES ('points-room',%s),('points-room',%s)",(aid,bid))
    await pool.execute("INSERT INTO ledger_games(game_id,room_id,table_id,game_type) VALUES (%s,'points-room',%s,'callbreak')",(game,table))
    await pool.execute('INSERT INTO game_ledger_entries(game_id,player_id,amount) VALUES (%s,%s,10),(%s,%s,-10)',(game,aid,game,bid))
    await deletion.request(a.user_id,password='original-password');await clean(pool,recovery,a.user_id)
    assert (await pool.execute("SELECT creator_id FROM rooms WHERE id='points-room'")).rows==[(bid,)]
    assert (await pool.execute('SELECT amount FROM game_ledger_entries WHERE player_id=%s',(bid,))).rows==[(-10,)]
    assert int((await pool.execute('SELECT sum(amount) FROM game_ledger_entries')).rows[0][0]) == 0
    assert (await pool.execute('SELECT count(*) FROM game_ledger_entries WHERE player_id=%s',(aid,))).rows==[(0,)]


async def test_active_table_rejection_keeps_account_functional(recovery_database):
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool);uid=UUID(a.user_id[5:])
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('live-room',%s,'Live','private')",(uid,))
    await pool.execute("INSERT INTO active_table_players(user_id,table_id,match_id,room_id,game_type,seat) VALUES (%s,%s,%s,'live-room','callbreak',1)",(uid,uuid4(),uuid4()))
    with pytest.raises(DeletionError,match='leave_games'):await deletion.request(a.user_id,password='original-password')
    assert (await auth.authenticate(a.token)).user_id==a.user_id
    assert (await pool.execute('SELECT count(*) FROM account_deletion_jobs')).rows==[(0,)]


async def test_email_challenge_is_verified_address_only_and_one_use(recovery_database):
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool)
    await recovery.request_deletion('deletion_player','private@example.test','local')
    await recovery.process_reset()
    assert (await pool.execute("SELECT count(*) FROM account_recovery_challenges WHERE purpose='delete_account'")).rows==[(0,)]
    proof=await recovery.service.enroll_email(a.user_id,'original-password','verified@example.test')
    await recovery.service.verify_email(proof.token)
    async with pool.connection() as c:
        await recovery.enqueue_deletion(c,{'username':'deletion_player','email':'verified@example.test'})
    envelope=(await pool.execute("SELECT envelope FROM recovery_mail_outbox WHERE purpose='delete_account'")).rows[0][0]
    payload=recovery.decrypt(envelope)
    assert (await auth.authenticate(a.token)).user_id==a.user_id
    await deletion.request(token=payload['token'])
    with pytest.raises(DeletionError):await deletion.request(token=payload['token'])


def test_rewrite_removes_identifiers_and_authored_text_but_keeps_scores():
    old=str(uuid4());new=str(uuid4())
    value={'actor_id':'user-'+old,'payload':{'text':'private words'},'score':12}
    assert rewrite(value,old,new)=={'actor_id':'user-'+new,'payload':{'text':'[removed]'},'score':12}

from test_checkpoint_store import database, host_game, advance
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.recovery import rebuild_hosted_game
from app.test_games.service import TestGameService as GameHost
from test_hosted_recovery import Delivery


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_erased_completed_checkpoint_and_receipts_still_rebuild(database, kind):
    pool,store,fence,users=database
    auth,a,recovery,deletion=await setup(pool)
    uid=UUID(a.user_id[5:])
    await pool.execute("INSERT INTO room_memberships(room_id,user_id) VALUES ('room',%s)",(uid,))
    host,game=await host_game([a.user_id,*users[1:]],kind)
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        receipt=await advance(host,game)
        await store.save(capture_checkpoint(game,table_revision=1),expected_revision=0,fence=fence,receipt=receipt)
        game.ended=True;game.table.phase='ENDED'
        await store.save(capture_checkpoint(game,table_revision=2),expected_revision=1,fence=fence)
        await deletion.request(a.user_id,password='original-password')
        await clean(pool,recovery,a.user_id)
        saved=await store.load(game.table.table_id)
        restored=GameHost(host.rooms,Delivery())
        try:
            rebuilt=rebuild_hosted_game(restored,saved.checkpoint,receipt_snapshot=saved.receipt_snapshot)
            assert a.user_id not in rebuilt.game.users
            assert users[1] in rebuilt.game.users
            assert saved.receipt_snapshot['receipt_count']==1
        finally:await restored.close()
        import json
        for table in ('table_recovery_state','games','game_commands','game_events','game_snapshots'):
            assert str(uid) not in json.dumps((await pool.execute(f'SELECT to_jsonb(t) FROM {table} t')).rows,default=str)
    finally:await host.close()


def test_rewrite_preserves_another_players_name_and_receipt_identity():
    import json
    old,new,other=str(uuid4()),str(uuid4()),str(uuid4())
    request={'command_id':'once','command':'chat','payload':{'text':'private'}}
    source={'actor_id':'user-'+old,'request':request,'fingerprint':json.dumps(request),
        'players':[{'user_id':'user-'+other,'display_name':'Keep this name'}]}
    result=rewrite(source,old,new)
    assert result['players']==source['players']
    assert result['request']['payload']['text']=='[removed]'
    assert json.loads(result['fingerprint'])=={k:v for k,v in result['request'].items() if k!='command_id'}


async def test_private_conversation_and_chat_delivery_copies_are_cleaned(database):
    import json
    from app.durable_games.social import SocialIngress,SocialLaneExecutor,conversation
    from app.durable_games.chat import ChatIngress,ChatLaneExecutor
    from app.durable_games.inbox import PostgresInboxStore,LaneTarget
    from test_durable_social import request as message
    from test_durable_chat import request as chat
    pool,_,fence,users=database
    auth,a,recovery,deletion=await setup(pool);uid=UUID(a.user_id[5:]);other=UUID(users[1][5:])
    await pool.execute("INSERT INTO room_memberships(room_id,user_id) VALUES ('room',%s)",(uid,))
    low,high=sorted([uid,other])
    await pool.execute("INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'accepted')",(low,high,uid))
    inbox=PostgresInboxStore(pool);social=SocialIngress(inbox);executor=SocialLaneExecutor(inbox)
    pending=await social.submit(a.user_id,conversation(a.user_id,users[1]),message(payload={'text':'PRIVATE_DELETION_TEXT'}))
    lane=UUID(pending['lane_id']);await executor.execute_one(lane)
    public=ChatIngress(inbox);chat_executor=ChatLaneExecutor(inbox)
    target=LaneTarget(kind='room_chat',room_id='room')
    sent=await public.submit(a.user_id,target,chat('OWN_ROOM_TEXT'))
    await chat_executor.execute_one(UUID(sent['lane_id']),fence)
    sent=await public.submit(users[1],target,chat('OTHER_ROOM_TEXT'))
    await chat_executor.execute_one(UUID(sent['lane_id']),fence)
    await deletion.request(a.user_id,password='original-password');await clean(pool,recovery,a.user_id)
    for table in ('direct_messages','command_inbox','notification_outbox','friend_notifications','room_chat_messages'):
        serialized=json.dumps((await pool.execute(f'SELECT to_jsonb(t) FROM {table} t')).rows,default=str)
        assert str(uid) not in serialized
        assert 'PRIVATE_DELETION_TEXT' not in serialized
        assert 'OWN_ROOM_TEXT' not in serialized
    assert (await pool.execute('SELECT text FROM room_chat_messages')).rows==[('OTHER_ROOM_TEXT',)]
    assert (await pool.execute('SELECT count(*) FROM command_lanes WHERE lane_id=%s',(lane,))).rows==[(0,)]


async def test_old_social_handoff_cannot_recreate_erased_identity(recovery_database):
    from app.social_auth.store import PostgresSocialIdentityStore
    from app.social_auth.models import VerifiedIdentity
    from app.multiplayer.player_profiles import PostgresPlayerProfileService
    from fastapi import HTTPException
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool)
    identity=VerifiedIdentity(provider='google',subject='subject-before-deletion')
    store=PostgresSocialIdentityStore(pool,auth,PostgresPlayerProfileService(pool))
    await deletion.request(a.user_id,password='original-password');await clean(pool,recovery,a.user_id)
    with pytest.raises(HTTPException):await store.login(identity,expected_generation=0)
    assert (await pool.execute('SELECT count(*) FROM external_identities')).rows==[(0,)]
    session=await store.login(identity,expected_generation=1)
    assert (await auth.authenticate(session.token)).user_id==session.user_id


async def test_unfinished_point_transfers_cancel_without_changing_ledger(recovery_database):
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool)
    b=await auth.sign_up('other_player','original-password')
    uid,bid=UUID(a.user_id[5:]),UUID(b.user_id[5:]);table,batch,transfer=uuid4(),uuid4(),uuid4()
    await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('settle-room',%s,'Points','private')",(bid,))
    await pool.execute("INSERT INTO settlement_batches(batch_id,room_id,table_id,scope,status,created_by,idempotency_key) VALUES (%s,'settle-room',%s,'table','OPEN',%s,'once')",(batch,table,bid))
    await pool.execute("INSERT INTO settlement_transfers(transfer_id,batch_id,payer_id,payee_id,amount,status) VALUES (%s,%s,%s,%s,10,'OPEN')",(transfer,batch,uid,bid))
    await deletion.request(a.user_id,password='original-password');await clean(pool,recovery,a.user_id)
    assert (await pool.execute('SELECT payee_id,amount,status FROM settlement_transfers')).rows==[(bid,10,'CANCELLED')]
    assert (await pool.execute('SELECT status FROM settlement_batches')).rows==[('CANCELLED',)]


async def test_old_client_writes_fail_after_acceptance(recovery_database):
    from psycopg.errors import CheckViolation
    pool=recovery_database;auth,a,recovery,deletion=await setup(pool);uid=UUID(a.user_id[5:])
    await deletion.request(a.user_id,password='original-password')
    with pytest.raises(CheckViolation):
        await pool.execute("UPDATE user_profiles SET display_name='Restore private name' WHERE user_id=%s",(uid,))
    assert (await pool.execute('SELECT display_name FROM user_profiles WHERE user_id=%s',(uid,))).rows==[('',)]


@pytest.mark.parametrize('kind',['marriage','callbreak'])
async def test_archived_game_remains_valid_after_deletion(database,kind):
    from test_rematch import completed,execute,request
    from app.durable_games.executor import GameLaneExecutor
    from app.durable_games.checkpoints import decode_checkpoint
    from app.durable_games.finalization import MatchFinalizationWorker
    from test_match_finalization import job_id
    from dataclasses import replace
    from app.durable_games.store import _token_hash
    pool,store,fence,users=database
    auth,a,recovery,deletion=await setup(pool);uid=UUID(a.user_id[5:])
    await pool.execute("INSERT INTO room_memberships(room_id,user_id) VALUES ('room',%s)",(uid,))
    host,game,inbox,lane,game_lane=await completed((pool,store,fence,[a.user_id,*users[1:]]),kind)
    try:
        # Drain the deliberately queued old game command, then archive via the
        # normal next-match command and close its waiting table normally.
        if kind=='marriage':await GameLaneExecutor(inbox).execute_one(game_lane,fence)
        assert (await execute(inbox,lane,fence,a.user_id,request(await store.load(game.table.table_id))))['status']=='accepted'
        saved=await store.load(game.table.table_id)
        assert (await execute(inbox,lane,fence,a.user_id,request(saved,'end')))['status']=='accepted'
        await deletion.request(a.user_id,password='original-password');await clean(pool,recovery,a.user_id)
        archive=(await pool.execute('SELECT checkpoint FROM hosted_match_archives')).rows[0][0]
        assert a.user_id not in decode_checkpoint(archive).record.data.host.users
        # Finalization can still derive shared point results from the archive.
        new_fence=replace(fence,epoch=fence.epoch+1)
        await pool.execute("UPDATE room_ownership SET owner_instance_id='one',fencing_token_hash=%s,lease_expires_at=clock_timestamp()+interval '1 hour',runtime_status='serving'",(_token_hash(fence.token),))
        assert await MatchFinalizationWorker(pool).execute(await job_id(pool),new_fence) in ('projected','no_payment')
    finally:await host.close()


async def test_migration_preserves_existing_accounts_and_sessions():
    from app.database import MIGRATIONS
    from pglite_support import PGlitePool
    pool=await PGlitePool.open()
    try:
        for version,statement in MIGRATIONS:
            if version<32:await pool.execute(statement,script=True)
        auth=PostgresAuthService(pool)
        before=await auth.sign_up('existing_before_deletion','original-password')
        uid=UUID(before.user_id[5:])
        await pool.execute("UPDATE user_profiles SET display_name='Existing Player' WHERE user_id=%s",(uid,))
        await pool.execute(MIGRATIONS[-1][1],script=True)
        assert (await auth.authenticate(before.token)).user_id==before.user_id
        assert (await auth.sign_in('existing_before_deletion','original-password')).user_id==before.user_id
        assert (await pool.execute('SELECT display_name FROM user_profiles WHERE user_id=%s',(uid,))).rows==[('Existing Player',)]
        assert (await pool.execute('SELECT deletion_pending,erased FROM users WHERE id=%s',(uid,))).rows==[(False,False)]
    finally:await pool.close()


async def test_distributed_gateways_share_deletion_revocation(database,monkeypatch):
    from app.auth.recovery_delivery import RecoveryConfig
    from test_distributed_platform import application,signup
    monkeypatch.setenv('BHIDNE_HO_ACCOUNT_DELETION_ENABLED','1')
    monkeypatch.setattr(RecoveryConfig,'from_environment',classmethod(lambda cls:config()))
    monkeypatch.setattr(RecoveryConfig,'send',lambda *args:None)
    async with application(database[0]) as (first,_,_):
        async with application(database[0]) as (second,_,_):
            user,headers=await signup(first,'cross_gateway_delete')
            assert (await second.get('/auth/deletion/capabilities')).json()['enabled']
            assert (await second.get('/auth/me',headers=headers)).status_code==200
            reply=await first.post('/auth/deletion/request',headers=headers,
                json={'confirmation':'DELETE','current_password':'long-password'})
            assert reply.status_code==202,reply.text
            assert (await second.get('/auth/me',headers=headers)).status_code==401
            assert (await second.get('/distributed/rooms',headers=headers)).status_code==401
            assert (await second.post('/auth/deletion/status',json={'token':reply.json()['status_token']})).status_code==200


async def test_guest_and_social_only_proofs_require_the_bound_session(recovery_database):
    from app.account_deletion.runtime import DeletionRuntime
    from app.social_auth.store import PostgresSocialIdentityStore
    from app.social_auth.models import VerifiedIdentity
    from app.multiplayer.player_profiles import PostgresPlayerProfileService
    pool=recovery_database;auth,_,recovery,deletion=await setup(pool)
    guest=await auth.issue_guest()
    with pytest.raises(DeletionError):await deletion.request(guest.user_id,session_token='invented')
    await deletion.request(guest.user_id,session_token=guest.token);await clean(pool,recovery,guest.user_id)
    social=await PostgresSocialIdentityStore(pool,auth,PostgresPlayerProfileService(pool)).login(VerifiedIdentity(provider='google',subject='fresh-social'))
    runtime=DeletionRuntime(pool,recovery,SimpleNamespace(providers={}),enabled=True)
    await runtime.save_grant(social.user_id,'google',recovery.encrypt({'token':'refresh-grant'}).decode())
    with pytest.raises(DeletionError):await deletion.request(social.user_id,session_token=guest.token)
    result=await deletion.request(social.user_id,session_token=social.token)
    assert result['status']=='pending'
