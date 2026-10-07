from uuid import UUID, uuid4
import time

import pytest

from app.durable_games.checkpoint_store import PostgresCheckpointStore
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.delivery import GatewayDelivery
from app.durable_games.delivery_store import PostgresDeliveryStore
from app.durable_games.ephemeral import EphemeralService, EphemeralLimits, EphemeralNotice
from app.durable_games.inbox import PostgresInboxStore, LaneTarget, InboxRequest
from app.durable_games.queries import QueryAccessDenied
from test_checkpoint_store import database, host_game
from test_view_generation import Presence
from test_redis_live_transport import redis_server


class Signals:
    def __init__(self): self.notices = []
    async def send_ephemeral(self, destination, notice): self.notices.append(notice); return True


class Limits:
    async def consume(self, actor, request, **options): return False


async def setup(database):
    pool,store,fence,users=database
    host,game=await host_game(users)
    await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
    target=LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id))
    lane=await PostgresInboxStore(pool).ensure_lane(target)
    gateway=GatewayDelivery(PostgresDeliveryStore(pool),'one')
    frames={}
    for user in users[:3]:
        frames[user]=[]
        async def send(value,user=user):frames[user].append(value)
        await gateway.subscribe(user,user,lane,send,deltas=True)
    signals=Signals()
    service=EphemeralService(pool,Presence(users),signals,gateway,Limits())
    return host,game,target,service,frames,signals


async def test_live_chat_and_pokes_persist_only_notification_intents_without_game_changes(database):
    pool,_,_,users=database
    host,game,target,service,frames,signals=await setup(database)
    original=pool.execute
    statements=[]
    async def record(sql,*args,**kwargs):statements.append(sql);return await original(sql,*args,**kwargs)
    pool.execute=record
    try:
        request=dict(command_id=uuid4().hex,command='send-chat',match_id=game.match_id,payload={'text':'Hello table'})
        result=await service.submit(users[0],target,request)
        assert result['ephemeral'] and result['message']['text']=='Hello table'
        await service.receive(signals.notices[-1])
        assert len(frames[users[0]])==len(frames[users[1]])==1
        assert frames[users[2]]==[]  # Spectator gets no game chat.
        request.update(command_id=uuid4().hex,command='send-poke',expected_revision=0,
            payload={'text':'Hi','recipient_player_id':2})
        await service.submit(users[0],target,request)
        await service.receive(signals.notices[-1])
        assert len(frames[users[0]])==1 and len(frames[users[1]])==2
        request.update(command_id=uuid4().hex,command='send-reaction',
            payload={'reaction':'love','recipient_player_id':2})
        await service.submit(users[0],target,request)
        await service.receive(signals.notices[-1])
        # A public visual retains its target metadata for the client renderer.
        assert [len(frames[u]) for u in users[:3]]==[2,3,1]
        reaction=frames[users[2]][-1]['payload']
        assert reaction['type']=='TABLE_REACTION' and reaction['recipient_id']==users[1]
        notices=(await pool.execute("SELECT payload FROM command_inbox WHERE command='create-notification'")).rows
        assert len(notices)==3
        assert [notice[0]['kind'] for notice in notices].count('chat')==1
        assert [notice[0]['kind'] for notice in notices].count('poke')==2
        assert all('text' not in notice[0]['payload'] for notice in notices)
        for table in ('notification_outbox','room_chat_messages','social_abuse_limits'):
            assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows==[(0,)]
        assert (await service.checkpoints.load(game.table.table_id)).checkpoint['data']['table_revision']==0
    finally:
        pool.execute=original
        await host.close()


async def test_expiry_block_and_departure_drop_live_delivery(database):
    pool,_,_,users=database
    host,game,target,service,frames,signals=await setup(database)
    try:
        request=dict(command_id=uuid4().hex,command='send-chat',match_id=game.match_id,payload={'text':'Hello table'})
        await service.submit(users[0],target,request)
        notice=signals.notices[-1]
        notice.content['payload']['expires_at']=0
        await service.receive(notice)
        assert not any(frames.values())
        notice.content['payload']['expires_at']=int(time.time()*1000)+5000
        from app.player_blocks.service import BlockService
        await BlockService(pool).set(users[1],users[0],True)
        await service.receive(notice)
        assert len(frames[users[0]])==1 and frames[users[1]]==[]
        await pool.execute('DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s',('room',UUID(users[0][5:])))
        await service.receive(notice)
        assert len(frames[users[0]])==1
        with pytest.raises(QueryAccessDenied):await service.submit(users[0],target,request)
    finally:
        await host.close()


class Redis:
    def __init__(self,result=1):self.result=result;self.calls=[]
    async def eval(self,*args):self.calls.append(args);return self.result


async def test_rate_limit_rejects_and_durable_fallback_is_independent(database):
    pool,_,_,users=database
    request=InboxRequest(command_id='message',command='send-chat',payload={'text':'Hello'})
    redis=Redis(-1);limits=EphemeralLimits(redis,pool)
    with pytest.raises(QueryAccessDenied,match='Too many'):await limits.consume(users[0],request)
    redis.result=2
    assert await limits.consume(users[0],request) is True
    assert redis.calls[-1][1]==2
    async def offline(*args):raise ConnectionError('offline')
    redis.eval=offline
    with pytest.raises(QueryAccessDenied,match='unavailable'):await limits.consume(users[0],request)
    assert await limits.consume(users[0],request,durable=True) is None


async def test_real_redis_limits_share_budget_and_expire_without_sql_writes(redis_server, database):
    from redis.asyncio import Redis as LiveRedis
    pool,_,_,users=database
    redis=LiveRedis.from_url(redis_server.url)
    limits=EphemeralLimits(redis,pool,namespace='isolated-live-test')
    def request(n,text=None):
        return InboxRequest(command_id=str(n),command='send-chat',payload={'text':text or f'Message {n}'})
    try:
        first=request(0)
        assert not await limits.consume(users[0],first)
        assert await limits.consume(users[0],first)  # Exact ID retry cannot consume twice.
        with pytest.raises(QueryAccessDenied,match='another message'):
            await limits.consume(users[0],request(0,'Changed'))
        with pytest.raises(QueryAccessDenied,match='repeating'):
            await limits.consume(users[0],request(1,'Message 0'))
        for n in range(1,20):
            assert not await limits.consume(users[0],request(n),durable=n%2==0)
        with pytest.raises(QueryAccessDenied,match='Too many'):
            await limits.consume(users[0],request(20))
        assert not await limits.consume(users[1],request(1),poke=True)
        with pytest.raises(QueryAccessDenied,match='poke'):
            await limits.consume(users[1],request(2),poke=True)
        for key in await redis.keys('isolated-live-test:*'):
            assert 0 < await redis.pttl(key) <= 120000
        assert (await pool.execute('SELECT count(*) FROM social_abuse_limits')).rows==[(0,)]
    finally:
        await redis.aclose()
