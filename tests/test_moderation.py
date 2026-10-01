"""Real PostgreSQL SQL contracts: authorization, evidence, grouped review and retention."""
from uuid import UUID, uuid4
import pytest
from app.moderation.service import ModerationService, ModeratorConfig, ReportLimit, ReviewConflict
from app.durable_games.queries import QueryAccessDenied
from test_checkpoint_store import database
from test_delivery import sql
from test_distributed_platform import application, signup
from test_durable_chat import room, request as chat_request
from test_durable_social import setup, request as direct_request


def configured(pool, admin):
    return ModerationService(pool, ModeratorConfig(frozenset([UUID(admin[5:])]),frozenset()))

async def test_moderator_config_and_verified_unique_email(database, monkeypatch):
    pool,_,_,users=database
    svc=ModerationService(pool,ModeratorConfig(emails=frozenset(['admin@example.test'])))
    for user in users[:2]:
        await sql(pool,"INSERT INTO account_credentials(user_id,username,password_salt,password_hash,unverified_email) VALUES (%s,%s,'a','b','admin@example.test')",(UUID(user[5:]),user))
    assert (await svc.capabilities(users[0]))['moderator'] is False
    await sql(pool,"INSERT INTO account_recovery_contacts(user_id,email) VALUES (%s,'admin@example.test')",(UUID(users[0][5:]),))
    assert (await svc.capabilities(users[0]))['moderator'] is True
    await sql(pool,"INSERT INTO account_recovery_contacts(user_id,email) VALUES (%s,'admin@example.test')",(UUID(users[1][5:]),))
    assert (await svc.capabilities(users[0]))['moderator'] is False
    assert (await configured(pool,users[0]).capabilities(users[0]))['moderator'] is True
    await sql(pool,'DELETE FROM account_recovery_contacts WHERE user_id=%s',(UUID(users[1][5:]),))
    await sql(pool,"UPDATE account_recovery_contacts SET email='changed@example.test' WHERE user_id=%s",(UUID(users[0][5:]),))
    assert (await svc.capabilities(users[0]))['moderator'] is False
    monkeypatch.setenv('BHIDNE_HO_MODERATOR_USER_IDS',users[0])
    assert UUID(users[0][5:]) in ModeratorConfig.from_environment().user_ids
    monkeypatch.setenv('BHIDNE_HO_MODERATOR_EMAILS','invalid')
    with pytest.raises(ValueError): ModeratorConfig.from_environment()

async def test_grouped_reports_private_evidence_and_immutable_decisions(database):
    pool,_,_,users=database;svc=configured(pool,users[5])
    ids=[]
    for reporter,target,reason in [(users[0],users[1],'harassment'),(users[2],users[1],'spam'),(users[0],users[3],'other')]:
        report=await svc.submit(reporter,target,'player',None,reason,'Please review')
        ids.append(UUID(report['id']))
    duplicate=await svc.submit(users[0],users[1],'player',None,'harassment','Retry')
    assert duplicate['id']==str(ids[0])
    with pytest.raises(QueryAccessDenied):await svc.groups(users[0])
    with pytest.raises(QueryAccessDenied):await svc.reports(users[0],users[1])
    page=await svc.groups(users[5],limit=1)
    assert page['items'][0]['count']==2
    assert (await svc.groups(users[5],after=page['next_id']))['items'][0]['user_id']==users[3]
    details=await svc.reports(users[5],users[1],limit=1)
    assert len(details['items'])==1 and details['next_id']
    assert 'reporter_id' not in details['items'][0]
    with pytest.raises(QueryAccessDenied):await svc.decide(users[0],ids[0],'accepted','Evidence')
    await svc.decide(users[5],ids[0],'accepted','Evidence supports the report')
    await svc.decide(users[5],ids[0],'accepted','Evidence supports the report')
    with pytest.raises(ReviewConflict):await svc.decide(users[5],ids[0],'declined','Changed')
    await svc.decide(users[5],ids[1],'declined','Insufficient evidence')
    reviewed=await svc.reports(users[5],users[1],True)
    assert {r['decision'] for r in reviewed['items']}=={'accepted','declined'}
    assert all(r['moderator_id']==users[5] and r['decided_at'] for r in reviewed['items'])
    assert await sql(pool,'SELECT count(*) FROM moderation_decisions')==[(2,)]
    # Decisions are classifications, not hidden account/game enforcement.
    assert await sql(pool,'SELECT count(*) FROM users WHERE deletion_pending')==[(0,)]
    await sql(pool,"UPDATE moderation_reports SET expires_at=clock_timestamp()-interval '1 second'")
    assert (await svc.groups(users[5],True))['items']==[]
    await svc.purge()
    assert await sql(pool,'SELECT count(*) FROM moderation_decisions')==[(0,)]

async def test_message_evidence_requires_access_and_server_record(database):
    pool,_,fence,users=database;svc=configured(pool,users[5])
    inbox,ingress,executor,target=await room(database)
    accepted=await ingress.submit(users[0],target,chat_request(users[0]))
    await executor.execute_one(UUID(accepted['lane_id']),fence)
    mid=(await sql(pool,'SELECT id FROM room_chat_messages'))[0][0]
    r=await svc.submit(users[1],users[0],'chat',mid,'harassment','context')
    stored=(await svc.reports(users[5],users[0]))['items'][0]
    assert stored['evidence']['text']==(await sql(pool,'SELECT text FROM room_chat_messages'))[0][0]
    with pytest.raises(QueryAccessDenied):await svc.submit(users[1],users[2],'chat',mid,'spam','')
    await sql(pool,'DELETE FROM room_memberships WHERE user_id=%s',(UUID(users[2][5:]),))
    with pytest.raises(QueryAccessDenied):await svc.submit(users[2],users[0],'chat',mid,'spam','')
    inbox,ingress,executor,target=await setup(database)
    accepted=await ingress.submit(users[0],target,direct_request())
    await executor.execute_one(UUID(accepted['lane_id']))
    mid=(await sql(pool,'SELECT id FROM direct_messages'))[0][0]
    await svc.submit(users[1],users[0],'direct',mid,'spam','')
    with pytest.raises(QueryAccessDenied):await svc.submit(users[3],users[0],'direct',mid,'spam','')

async def test_report_limits(database):
    pool,_,_,users=database;svc=configured(pool,users[5])
    for target in users[1:3]:
        for category in ['harassment','hate','sexual','spam','other']:
            await svc.submit(users[0],target,'player',None,category,'')
    with pytest.raises(ReportLimit):await svc.submit(users[0],users[3],'player',None,'spam','')
    with pytest.raises(ValueError):await svc.submit(users[0],users[0],'player',None,'spam','')

async def test_http_permissions_validation_and_capability(database,monkeypatch):
    monkeypatch.setenv('BHIDNE_HO_MODERATOR_USER_IDS',database[3][5])
    async with application(database[0]) as (client,app,server):
        user,headers=await signup(client,'reporter')
        other,_=await signup(client,'target')
        assert (await client.get('/moderation/users')).status_code==401
        assert (await client.get('/moderation/users',headers=headers)).status_code==403
        assert (await client.get('/auth/moderation/capabilities',headers=headers)).json()==dict(reporting=True,moderator=False)
        body=dict(reported_user_id=other['user_id'],category='harassment')
        response=await client.post('/me/reports',headers=headers,json=body)
        assert response.status_code==201,response.text
        assert response.headers['cache-control']=='no-store'
        assert (await client.post('/me/reports',headers=headers,json={**body,'evidence':'invented'})).status_code==422
        assert (await client.post('/me/reports',headers=headers,json={**body,'scope':'chat'})).status_code==422
        assert (await client.post('/moderation/reports/'+response.json()['id']+'/decision',headers=headers,json={'decision':'accepted','reason':'   '})).status_code==422

from test_account_recovery import recovery_database
from test_account_deletion import setup as deletion_setup, clean

@pytest.mark.parametrize('role',['reporter','target','moderator'])
async def test_account_erasure_clears_report_and_decision(recovery_database,role):
    pool=recovery_database;auth,owner,recovery,deletion=await deletion_setup(pool)
    second=await auth.sign_up('report_other','original-password')
    third=await auth.sign_up('report_third','original-password')
    actors={'reporter':second.user_id,'target':third.user_id,'moderator':owner.user_id}
    if role!='moderator':actors[role],actors['moderator']=actors['moderator'],actors[role]
    svc=configured(pool,actors['moderator'])
    report=await svc.submit(actors['reporter'],actors['target'],'player',None,'harassment','context')
    await svc.decide(actors['moderator'],UUID(report['id']),'accepted','reason')
    await deletion.request(owner.user_id,password='original-password')
    await clean(pool,recovery,owner.user_id)
    assert await sql(pool,'SELECT count(*) FROM moderation_reports')==[(0,)]
    assert await sql(pool,'SELECT count(*) FROM moderation_decisions')==[(0,)]


async def test_self_review_disabled_account_and_permission_revocation(database):
    pool,_,_,users=database;svc=configured(pool,users[0])
    report=await svc.submit(users[0],users[1],'player',None,'other','context')
    with pytest.raises(QueryAccessDenied):await svc.decide(users[0],UUID(report['id']),'accepted','own report')
    svc.config=ModeratorConfig()
    with pytest.raises(QueryAccessDenied):await svc.groups(users[0])
    svc.config=ModeratorConfig(frozenset([UUID(users[0][5:])]))
    await sql(pool,'UPDATE users SET deletion_pending=true WHERE id=%s',(UUID(users[0][5:]),))
    assert (await svc.capabilities(users[0]))['moderator'] is False
    with pytest.raises(QueryAccessDenied):await svc.reports(users[0],users[1])
