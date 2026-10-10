from uuid import UUID, uuid4
import pytest
from test_checkpoint_store import database
from test_delivery import sql
from test_moderation import configured
from app.moderation.actions import ModerationActions, ParticipationConflict
from app.moderation.policy import require_posting, accept_rules, RULES_VERSION
from app.moderation.visibility import redact_messages, redact_event
from app.moderation.service import ReviewConflict
from app.moderation.content import validate_content
from app.durable_games.queries import QueryAccessDenied

@pytest.mark.parametrize('text',['ＦＵＣＫ YOU','f\u200buck you','MUJI','मुजी','kill yourself'])
def test_prohibited_text(text):
    with pytest.raises(ValueError):validate_content(text)

@pytest.mark.parametrize('text',['class','Good luck!','नमस्ते','music'])
def test_normal_text(text):assert validate_content(text)==text

async def accepted(pool,users,scope='player',mid=None):
    svc=configured(pool,users[5])
    r=await svc.submit(users[0],users[1],scope,mid,'harassment','context')
    rid=UUID(r['id']);await svc.decide(users[5],rid,'accepted','Confirmed')
    return ModerationActions(svc),rid

async def post(pool,user,text='Hello',category='message'):
    async with pool.connection() as c:
        await require_posting(c,user,text=text,category=category,consume=True)

async def test_consent_mute_expiry_restore_and_idempotency(database):
    pool,_,_,users=database;user=users[1]
    await sql(pool,'DELETE FROM community_acceptance WHERE user_id=%s',(UUID(user[5:]),))
    with pytest.raises(QueryAccessDenied,match='accept the community rules'):await post(pool,user)
    await accept_rules(pool,user,RULES_VERSION)
    await post(pool,user)
    with pytest.raises(QueryAccessDenied,match='repeating'):await post(pool,user)
    actions,rid=await accepted(pool,users);request=uuid4()
    result=await actions.apply(users[5],rid,'mute','Stop harassment',request,1)
    assert await actions.apply(users[5],rid,'mute','Stop harassment',request,1)==result
    with pytest.raises(ReviewConflict):await actions.apply(users[5],rid,'mute','Stop harassment',request,24)
    with pytest.raises(QueryAccessDenied,match='muted'):await post(pool,user,'Another')
    with pytest.raises(QueryAccessDenied,match='muted'):await post(pool,user,None,'invitation')
    await actions.apply(users[5],rid,'unmute','Appeal accepted',uuid4())
    await post(pool,user,'Another')
    await actions.apply(users[5],rid,'mute','Review',uuid4(),1)
    await sql(pool,"UPDATE users SET muted_until=clock_timestamp()-interval '1 second' WHERE id=%s",(UUID(user[5:]),))
    await post(pool,user,'After expiry')
    assert len((await actions.history(users[5],user))['items'])==3
    with pytest.raises(QueryAccessDenied):await actions.history(users[0],user)

async def test_account_wide_limit(database):
    pool,_,_,users=database
    for i in range(20):await post(pool,users[0],f'Message {i}')
    with pytest.raises(QueryAccessDenied,match='Too many'):await post(pool,users[0],'One more')
    await post(pool,users[1],'Separate account')

async def test_removal_history_replay_and_report_expiry(database):
    from test_durable_chat import room,request
    pool,_,fence,users=database
    inbox,ingress,executor,target=await room(database)
    receipt=await ingress.submit(users[1],target,request(users[1]))
    await executor.execute_one(UUID(receipt['lane_id']),fence)
    mid=(await sql(pool,'SELECT id FROM room_chat_messages'))[0][0]
    actions,rid=await accepted(pool,users,'chat',mid)
    await actions.apply(users[5],rid,'remove_message','Abusive',uuid4())
    async with pool.connection() as c:
        message=dict(id=str(mid),type='CHAT_MESSAGE',text='secret')
        assert (await redact_event(c,message))['removed']
        assert (await redact_messages(c,'chat',[message]))[0]['text']!='secret'
    await sql(pool,"UPDATE moderation_reports SET expires_at=clock_timestamp()-interval '1 second'")
    await actions.moderation.purge()
    async with pool.connection() as c:assert (await redact_event(c,message))['removed']

async def test_suspension_revokes_sessions_and_restores(database):
    pool,_,_,users=database;actions,rid=await accepted(pool,users)
    await actions.apply(users[5],rid,'suspend','Repeated abuse',uuid4(),1)
    with pytest.raises(QueryAccessDenied,match='suspended'):await post(pool,users[1])
    await actions.apply(users[5],rid,'unsuspend','Appeal accepted',uuid4())
    await post(pool,users[1])

async def test_active_table_cannot_be_suspended_but_can_be_muted(database):
    from test_game_lane_executor import setup_game
    pool,_,_,users=database
    host,game,_,_,_=await setup_game(database)
    try:
        actions,rid=await accepted(pool,users)
        with pytest.raises(ParticipationConflict):await actions.apply(users[5],rid,'suspend','Review',uuid4())
        await actions.apply(users[5],rid,'mute','Review',uuid4())
        assert (await sql(pool,'SELECT suspended_until FROM users WHERE id=%s',(UUID(users[1][5:]),)))[0][0] is None
    finally:await host.close()

async def test_real_auth_session_revocation(database):
    from app.auth.postgres import PostgresAuthService
    from app.auth.service import AuthenticationError
    pool,_,_,users=database;auth=PostgresAuthService(pool)
    token=await auth.issue_identity(UUID(users[1][5:]))
    await auth.authenticate(token.token)
    actions,rid=await accepted(pool,users)
    await actions.apply(users[5],rid,'suspend','Review',uuid4())
    with pytest.raises(AuthenticationError):await auth.authenticate(token.token)
    with pytest.raises(AuthenticationError):await auth.issue_identity(UUID(users[1][5:]))
    await actions.apply(users[5],rid,'unsuspend','Appeal',uuid4())
    fresh=await auth.issue_identity(UUID(users[1][5:]))
    await auth.authenticate(fresh.token)
    with pytest.raises(AuthenticationError):await auth.authenticate(token.token)

async def test_public_metadata_and_explicit_rule_acceptance(database,monkeypatch):
    from test_distributed_platform import application,signup
    monkeypatch.setenv('BHIDNE_HO_POLICY_OPERATOR','Test Operator')
    monkeypatch.setenv('BHIDNE_HO_SUPPORT_EMAIL','support@example.test')
    monkeypatch.setenv('BHIDNE_HO_MINIMUM_AGE','18')
    monkeypatch.setenv('BHIDNE_HO_BACKUP_DISCLOSURE','No database backups configured.')
    async with application(database[0]) as (client,app,server):
        public=await client.get('/public/policy')
        assert public.status_code==200 and public.json()['ready']
        assert set(public.json())=={'ready','operator','contact','minimum_age','backups'}
        user,headers=await signup(client,'rules_account')
        assert (await client.get('/me/community-rules',headers=headers)).json()['accepted']
        # Existing accounts without consent can still accept through Profile.
        await sql(database[0], 'DELETE FROM community_acceptance WHERE user_id=%s', (UUID(user['user_id'][5:]),))
        assert not (await client.get('/me/community-rules',headers=headers)).json()['accepted']
        assert (await client.post('/me/community-rules',headers=headers,json={'accepted':False,'version':RULES_VERSION})).status_code==422
        assert (await client.post('/me/community-rules',headers=headers,json={'accepted':True,'version':'old'})).status_code==422
        assert (await client.post('/me/community-rules',headers=headers,json={'accepted':True,'version':RULES_VERSION})).status_code==200
        assert (await client.get('/me/community-rules',headers=headers)).json()['accepted']
