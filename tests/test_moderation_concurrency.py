import asyncio
from uuid import UUID
from app.auth.postgres import PostgresAuthService
from app.moderation.service import ModerationService, ModeratorConfig, ReviewConflict
from test_account_recovery_concurrency import postgres_pool

async def test_report_retry_and_review_race(postgres_pool):
    auth=PostgresAuthService(postgres_pool)
    users=[await auth.sign_up('moderation_'+str(i),'original-password') for i in range(4)]
    svc=ModerationService(postgres_pool,ModeratorConfig(frozenset(UUID(u.user_id[5:]) for u in users[2:])))
    results=await asyncio.gather(*(svc.submit(users[0].user_id,users[1].user_id,'player',None,'spam','same evidence') for _ in range(5)))
    assert len({r['id'] for r in results})==1
    decisions=await asyncio.gather(svc.decide(users[2].user_id,UUID(results[0]['id']),'accepted','Evidence'),
        svc.decide(users[3].user_id,UUID(results[0]['id']),'declined','Not supported'),return_exceptions=True)
    assert sum(isinstance(r,ReviewConflict) for r in decisions)==1
    async with postgres_pool.connection() as c:
        assert (await (await c.execute('SELECT count(*) FROM moderation_decisions')).fetchone())[0]==1
    # Two players reporting each other do not acquire account locks in opposite order.
    await asyncio.wait_for(asyncio.gather(svc.submit(users[0].user_id,users[1].user_id,'player',None,'other',''),
        svc.submit(users[1].user_id,users[0].user_id,'player',None,'other','')),5)

async def test_account_limits_and_action_retry_across_connections(postgres_pool):
    from uuid import uuid4
    from app.moderation.policy import accept_rules,require_posting,RULES_VERSION
    from app.moderation.actions import ModerationActions
    from app.durable_games.queries import QueryAccessDenied
    auth=PostgresAuthService(postgres_pool)
    users=[await auth.sign_up('safety_'+str(i),'original-password') for i in range(3)]
    actor=users[0].user_id
    await accept_rules(postgres_pool,actor,RULES_VERSION)
    async def send(i):
        try:
            async with postgres_pool.connection() as c:
                async with c.transaction():await require_posting(c,actor,text=f'unique message {i}',consume=True)
            return True
        except QueryAccessDenied:return False
    assert sum(await asyncio.gather(*(send(i) for i in range(21))))==20
    svc=ModerationService(postgres_pool,ModeratorConfig(frozenset([UUID(users[2].user_id[5:])])))
    report=await svc.submit(users[1].user_id,actor,'player',None,'spam','Spam')
    rid=UUID(report['id']);await svc.decide(users[2].user_id,rid,'accepted','Confirmed')
    action=ModerationActions(svc);key=uuid4()
    results=await asyncio.gather(*(action.apply(users[2].user_id,rid,'mute','Stop spam',key) for _ in range(5)))
    assert len({r['id'] for r in results})==1
    assert len((await action.history(users[2].user_id,actor))['items'])==1
