"""Opt-in PostgreSQL race test using separate worker and HTTP connections."""
import asyncio
from uuid import UUID, uuid4

from app.auth.postgres import PostgresAuthService
from app.durable_games.inbox import PostgresInboxStore
from app.durable_games.social import SocialIngress, SocialLaneExecutor, conversation
from app.durable_games.delivery_store import PostgresDeliveryStore
from app.player_blocks.service import BlockService
from test_account_recovery_concurrency import postgres_pool


async def test_block_waits_for_inflight_send_then_suppresses_its_delivery(postgres_pool, monkeypatch):
    from app.player_blocks import service
    pool = postgres_pool
    auth = PostgresAuthService(pool)
    a = await auth.sign_up('sender_player', 'original-password')
    b = await auth.sign_up('blocking_player', 'original-password')
    ids = sorted([UUID(a.user_id[5:]), UUID(b.user_id[5:])])
    async with pool.connection() as c:
        await c.execute("INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'accepted')", (*ids, ids[0]))
    inbox = PostgresInboxStore(pool)
    pending = await SocialIngress(inbox).submit(a.user_id, conversation(a.user_id,b.user_id),
        dict(command_id=uuid4().hex,command='send-message',payload={'text':'In-flight message'}))
    lane = UUID(pending['lane_id'])
    entered, release = asyncio.Event(), asyncio.Event()
    original = service.policy_read_lock
    async def pause(c):
        await original(c)
        entered.set()
        await release.wait()
    monkeypatch.setattr(service,'policy_read_lock',pause)
    worker = asyncio.create_task(SocialLaneExecutor(inbox).execute_one(lane))
    block = None
    try:
        await asyncio.wait_for(entered.wait(),5)
        block = asyncio.create_task(BlockService(pool).set(b.user_id,a.user_id,True))
        async with asyncio.timeout(10):
            while True:
                async with pool.connection() as c:
                    waiting = await (await c.execute("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT revision FROM social_policy_revision FOR UPDATE%' ")).fetchone()
                if waiting: break
                await asyncio.sleep(.02)
        assert not block.done()
        release.set()
        assert (await asyncio.wait_for(worker,5)).outcome['status'] == 'accepted'
        assert await asyncio.wait_for(block,5) == {'blocked': True}
        # The sender retains only their receipt; the old message is never replayed.
        page = await PostgresDeliveryStore(pool).page(a.user_id,lane)
        assert [e['event_type'] for e in page.events] == ['SOCIAL_COMMAND_ACK']
        async with pool.connection() as c:
            assert (await (await c.execute('SELECT count(*) FROM friendships')).fetchone())[0] == 0
    finally:
        release.set()
        await asyncio.gather(worker, *([block] if block else []), return_exceptions=True)
