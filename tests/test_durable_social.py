from uuid import UUID,uuid4

import pytest

from app.durable_games.social import SocialIngress,SocialLaneExecutor,NotificationProducer,conversation
from app.durable_games.social_history import SocialHistory
from app.durable_games.social_runtime import SocialRuntime
from app.durable_games.inbox import PostgresInboxStore,LaneTarget
from app.durable_games.delivery_store import PostgresDeliveryStore
from app.durable_games.queries import QueryAccessDenied
from app.durable_games.store import DurableGameConflict
from test_checkpoint_store import database
from test_delivery import sql
from test_room_runtime import outcome


def request(command='send-message',payload=None,command_id=None):
    return dict(command_id=command_id or uuid4().hex,command=command,payload=payload or {'text':'Hello'})


async def setup(database):
    pool,_,_,users = database
    await sql(pool,"INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'accepted')",
        (UUID(users[0][5:]),UUID(users[1][5:]),UUID(users[0][5:])))
    inbox = PostgresInboxStore(pool)
    return inbox,SocialIngress(inbox),SocialLaneExecutor(inbox),conversation(users[0],users[1])


async def notify(inbox,user,**options):
    async with inbox.pool.connection() as connection:
        async with connection.transaction():
            return await NotificationProducer(inbox).enqueue_in_transaction(connection,user,**options)


async def test_direct_message_dedupe_rate_order_history_and_audiences(database):
    pool,_,_,users = database
    inbox,ingress,executor,target = await setup(database)
    body = request()
    pending = await ingress.submit(users[0],target,body)
    lane = UUID(pending['lane_id'])
    assert (await executor.execute_one(lane)).outcome['status']=='accepted'
    assert (await ingress.submit(users[0],target,body))['status']=='accepted'
    with pytest.raises(DurableGameConflict):
        await ingress.submit(users[0],target,request(payload={'text':'Changed'},command_id=body['command_id']))
    history = await SocialHistory(pool).page(users[1],lane)
    assert len(history['items'])==1 and history['items'][0]['text']=='Hello'
    delivery = PostgresDeliveryStore(pool)
    page = await delivery.page(users[1],lane)
    assert [e['event_type'] for e in page.events]==['DIRECT_MESSAGE']
    assert page.events[0]['payload']['id']==history['items'][0]['id']
    assert page.scanned_sequence==2
    with pytest.raises(QueryAccessDenied): await delivery.page(users[2],lane)
    with pytest.raises(QueryAccessDenied): await ingress.submit(users[2],target,request())
    await ingress.submit(users[0],target,request())
    assert (await executor.execute_one(lane)).outcome['status']=='rejected'
    await ingress.submit(users[1],target,request())
    assert (await executor.execute_one(lane)).outcome['status']=='accepted'
    assert await sql(pool,'SELECT count(*) FROM direct_messages')==[(2,)]


async def test_unfriend_after_admission_rejects_and_replay_retains_only_own_ack(database):
    pool,_,_,users = database
    inbox,ingress,executor,target = await setup(database)
    first,second = request(),request()
    pending = await ingress.submit(users[0],target,first)
    lane = UUID(pending['lane_id'])
    await executor.execute_one(lane)
    await ingress.submit(users[1],target,second)
    await sql(pool,'DELETE FROM friendships')
    assert (await executor.execute_one(lane)).outcome['status']=='rejected'
    assert (await ingress.submit(users[0],target,first))['status']=='accepted'
    with pytest.raises(QueryAccessDenied): await ingress.submit(users[0],target,request())
    with pytest.raises(QueryAccessDenied): await SocialHistory(pool).page(users[0],lane)
    for user in users[:2]:
        page = await PostgresDeliveryStore(pool).page(user,lane)
        assert page.events and all(e['event_type']=='SOCIAL_COMMAND_ACK' for e in page.events)


async def test_notification_producer_deduplication_recipient_read_and_cursor_separation(database):
    pool,_,_,users = database
    inbox = PostgresInboxStore(pool)
    producer = dict(key='friend-operation-1',kind='friend_accepted',actor=users[1],payload={'source':'test'})
    queued = await notify(inbox,users[0],**producer)
    executor,ingress = SocialLaneExecutor(inbox),SocialIngress(inbox)
    assert (await executor.execute_one(queued.lane_id)).outcome['status']=='accepted'
    assert (await notify(inbox,users[0],**producer)).duplicate
    with pytest.raises(DurableGameConflict): await notify(inbox,users[0],**(producer|{'kind':'changed'}))
    history = SocialHistory(pool)
    items = (await history.page(users[0],queued.lane_id))['items']
    assert len(items)==1 and not items[0]['read'] and items[0]['actor_id']==users[1]
    with pytest.raises(QueryAccessDenied): await history.page(users[1],queued.lane_id)
    with pytest.raises(QueryAccessDenied): await PostgresDeliveryStore(pool).page(users[1],queued.lane_id)
    target = LaneTarget(kind='recipient',recipient_id=UUID(users[0][5:]))
    with pytest.raises(ValueError): await ingress.submit(users[0],target,request('create-notification',producer))
    read = request('read-notifications',{'ids':[items[0]['id']]})
    await ingress.submit(users[0],target,read)
    assert (await executor.execute_one(queued.lane_id)).outcome['status']=='accepted'
    assert (await history.page(users[0],queued.lane_id))['items'][0]['read']
    assert await sql(pool,'SELECT count(*) FROM delivery_cursors')==[(0,)]
    assert (await ingress.submit(users[0],target,read))['status']=='accepted'


async def test_read_notifications_cannot_mark_another_users_items(database):
    pool,_,_,users=database
    inbox=PostgresInboxStore(pool)
    executor=SocialLaneExecutor(inbox)
    first=await notify(inbox,users[0],key='a',kind='test')
    other=await notify(inbox,users[1],key='b',kind='test')
    await executor.execute_one(first.lane_id)
    await executor.execute_one(other.lane_id)
    other_id=(await SocialHistory(pool).page(users[1],other.lane_id))['items'][0]['id']
    ingress=SocialIngress(inbox)
    target=LaneTarget(kind='recipient',recipient_id=UUID(users[0][5:]))
    await ingress.submit(users[0],target,request('read-notifications',{'ids':[other_id]}))
    assert (await executor.execute_one(first.lane_id)).outcome['status']=='rejected'
    assert await sql(pool,'SELECT count(*) FROM friend_notifications WHERE read_at IS NOT NULL')==[(0,)]


async def test_message_effects_and_notification_enqueue_roll_back(database,monkeypatch):
    pool,_,_,users=database
    inbox,ingress,executor,target=await setup(database)
    pending=await ingress.submit(users[0],target,request())
    original=inbox._complete
    async def fail(*args): raise RuntimeError('before completion')
    monkeypatch.setattr(inbox,'_complete',fail)
    with pytest.raises(RuntimeError): await executor.execute_one(UUID(pending['lane_id']))
    assert await sql(pool,'SELECT count(*) FROM direct_messages')==[(0,)]
    assert await sql(pool,'SELECT count(*) FROM notification_outbox')==[(0,)]
    monkeypatch.setattr(inbox,'_complete',original)
    assert (await executor.execute_one(UUID(pending['lane_id']))).outcome['status']=='accepted'
    with pytest.raises(RuntimeError):
        async with pool.connection() as connection:
            async with connection.transaction():
                await NotificationProducer(inbox).enqueue_in_transaction(connection,users[0],key='rollback',kind='test')
                raise RuntimeError('business operation rolled back')
    assert await sql(pool,"SELECT count(*) FROM command_inbox WHERE actor_id='system:notification'")==[(0,)]


async def test_platform_runtime_resumes_pending_work_without_room_owner(database):
    pool,_,_,users=database
    inbox,ingress,_,target=await setup(database)
    body=request()
    pending=await ingress.submit(users[0],target,body)
    note=await notify(inbox,users[0],key='runtime',kind='test')
    await sql(pool,'DELETE FROM room_ownership')
    runtime=SocialRuntime(inbox,interval=.01)
    await runtime.start()
    try:
        assert (await outcome(inbox,UUID(pending['lane_id']),users[0],body))['status']=='accepted'
        assert (await outcome(inbox,note.lane_id,'system:notification',note.request.model_dump(mode='json')))['status']=='accepted'
    finally:
        await runtime.stop()
    again=SocialRuntime(inbox,interval=.01)
    await again.sweep_once()
    assert await sql(pool,'SELECT count(*) FROM direct_messages')==[(1,)]
    assert await sql(pool,'SELECT count(*) FROM friend_notifications')==[(1,)]
    await again.stop()


async def test_legacy_history_stays_separate_and_keyset_pages_ties(database):
    pool,_,_,users=database
    inbox,ingress,executor,target=await setup(database)
    for i in range(4):
        await sql(pool,"INSERT INTO direct_messages(id,sender_id,recipient_id,text,sent_at) VALUES (%s,%s,%s,%s,'2020-01-01Z')",
            (UUID(int=100+i),UUID(users[i%2][5:]),UUID(users[1-i%2][5:]),str(i)))
    pending=await ingress.submit(users[0],target,request())
    lane=UUID(pending['lane_id'])
    await executor.execute_one(lane)
    history=SocialHistory(pool)
    first=await history.legacy_direct(users[0],users[1],limit=2)
    second=await history.legacy_direct(users[0],users[1],before=first['next_before'],limit=2)
    assert [r['text'] for r in first['items']]==['2','3']
    assert [r['text'] for r in second['items']]==['0','1'] and second['next_before'] is None
    assert all('sequence' not in item for item in first['items'])
    assert len((await history.page(users[0],lane))['items'])==1
    await sql(pool,'DELETE FROM friendships')
    with pytest.raises(QueryAccessDenied): await history.legacy_direct(users[0],users[1])


async def test_notification_origin_deletion_does_not_erase_native_history(database):
    pool,_,_,users=database
    inbox=PostgresInboxStore(pool)
    note=await notify(inbox,users[0],key='origin',kind='test',actor=users[-1])
    await SocialLaneExecutor(inbox).execute_one(note.lane_id)
    await sql(pool,'DELETE FROM users WHERE id=%s',(UUID(users[-1][5:]),))
    item=(await SocialHistory(pool).page(users[0],note.lane_id))['items'][0]
    assert item['actor_id']==users[-1]
    assert await sql(pool,'SELECT count(*) FROM friend_notifications')==[(1,)]


async def test_stream_bootstrap_discovery_excludes_other_users_and_revoked_friends(database):
    pool,_,_,users=database
    inbox,ingress,_,target=await setup(database)
    own=LaneTarget(kind='recipient',recipient_id=UUID(users[0][5:]))
    lane=await ingress.open_stream(users[0],own)
    dm=await ingress.open_stream(users[0],target)
    with pytest.raises(QueryAccessDenied): await ingress.open_stream(users[1],own)
    history=SocialHistory(pool)
    first=await history.streams(users[0],limit=1)
    second=await history.streams(users[0],after=first['next_lane_id'],limit=1)
    assert {r['lane_id'] for r in first['items']+second['items']}=={str(lane),str(dm)}
    assert (await history.streams(users[2]))['items']==[]
    await sql(pool,'DELETE FROM friendships')
    assert [r['lane_id'] for r in (await history.streams(users[0]))['items']]==[str(lane)]


async def test_legacy_notifications_preserve_read_status_and_separate_native_stream(database):
    pool,_,_,users=database
    inbox=PostgresInboxStore(pool)
    ids=[uuid4() for _ in range(3)]
    for identifier in ids:
        await sql(pool,"INSERT INTO friend_notifications(id,user_id,actor_id,kind,created_at) VALUES (%s,%s,%s,'friend_accepted','2020-01-01Z')",
            (identifier,UUID(users[0][5:]),UUID(users[1][5:])))
    note=await notify(inbox,users[0],key='native',kind='test')
    executor=SocialLaneExecutor(inbox)
    await executor.execute_one(note.lane_id)
    history=SocialHistory(pool)
    first=await history.legacy_notifications(users[0],limit=2)
    second=await history.legacy_notifications(users[0],before=first['next_before'],limit=2)
    assert {r['id'] for r in first['items']+second['items']}=={str(i) for i in ids}
    assert len((await history.page(users[0],note.lane_id))['items'])==1
    assert (await history.legacy_notifications(users[1]))['items']==[]
    await SocialIngress(inbox).submit(users[0],LaneTarget(kind='recipient',recipient_id=UUID(users[0][5:])),
        request('read-notifications',{'ids':[str(ids[0])]}))
    assert (await executor.execute_one(note.lane_id)).outcome['status']=='accepted'
    assert [r['read'] for r in (await history.legacy_notifications(users[0]))['items'] if r['id']==str(ids[0])]==[True]
    assert await sql(pool,'SELECT count(*) FROM delivery_cursors')==[(0,)]


async def test_publisher_signals_both_conversation_participants_and_deduplicates_boots(database):
    from app.durable_games.delivery import OutboxPublisher
    from app.durable_games.redis_presence import PresenceObservation,ConnectionPresence
    pool,_,_,users=database
    inbox,ingress,executor,target=await setup(database)
    pending=await ingress.submit(users[0],target,request())
    lane=UUID(pending['lane_id'])
    await executor.execute_one(lane)
    looked_up,notices=[],[]
    class Presence:
        async def observe(self,kind,value):
            assert kind=='user'
            looked_up.append(value)
            return PresenceObservation('observed',(ConnectionPresence('gateway','socket',value),))
    async def send(destination,notice):
        notices.append(notice)
        return True
    await OutboxPublisher(PostgresDeliveryStore(pool),Presence(),send).sweep_once()
    assert users[0] in looked_up and users[1] in looked_up
    assert len(notices)==2  # One conversation event and one sender-only ACK.
    assert len({n.event_id for n in notices})==2
    assert await sql(pool,'SELECT count(*) FROM delivery_cursors')==[(0,)]


async def test_notification_duplicate_finish_is_atomic_and_public_forgery_is_rejected(database,monkeypatch):
    pool,_,_,users=database
    inbox=PostgresInboxStore(pool)
    note=await notify(inbox,users[0],key='rollback-notification',kind='test')
    original=inbox._complete
    async def fail(*args): raise RuntimeError('before commit')
    monkeypatch.setattr(inbox,'_complete',fail)
    with pytest.raises(RuntimeError): await SocialLaneExecutor(inbox).execute_one(note.lane_id)
    assert await sql(pool,'SELECT count(*) FROM friend_notifications')==[(0,)]
    assert await sql(pool,'SELECT count(*) FROM notification_outbox')==[(0,)]
    monkeypatch.setattr(inbox,'_complete',original)
    assert (await SocialLaneExecutor(inbox).execute_one(note.lane_id)).outcome['status']=='accepted'
    # Defense in depth: even a malformed internal inbox entry cannot let an
    # authenticated user impersonate the trusted notification producer.
    await inbox.enqueue(note.lane_id,users[0],request('create-notification',{'key':'forged','kind':'test'}))
    assert (await SocialLaneExecutor(inbox).execute_one(note.lane_id)).outcome['status']=='rejected'
    assert await sql(pool,'SELECT count(*) FROM friend_notifications')==[(1,)]
