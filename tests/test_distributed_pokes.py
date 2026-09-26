from uuid import UUID,uuid4
import pytest
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.inbox import PostgresInboxStore,LaneTarget
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database,host_game
from test_delivery import sql


async def test_poke_private_audience_retry_cooldown_and_no_game_state_edit(database):
    pool,store,fence,users=database
    host,game=await host_game(users,'marriage')
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        before=await store.load(game.table.table_id)
        inbox=PostgresInboxStore(pool)
        lane=await inbox.ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id)))
        body=dict(command_id=uuid4().hex,command='send-poke',payload={'text':'Good game','recipient_player_id':2},match_id=game.match_id,expected_revision=0)
        await inbox.enqueue(lane,users[0],body)
        executor=TableLaneExecutor(inbox)
        assert (await executor.execute_one(lane,fence)).outcome['status']=='accepted'
        events=await sql(pool,"SELECT audience_user_id,payload FROM notification_outbox WHERE event_type='ROOM_POKE'")
        assert len(events)==1 and events[0][0]==UUID(users[1][5:])
        assert events[0][1]['recipient_id']==users[1] and events[0][1]['scope']=='private'
        assert await store.load(game.table.table_id)==before
        assert (await inbox.enqueue(lane,users[0],body)).status=='accepted'
        assert await executor.execute_one(lane,fence) is None
        await inbox.enqueue(lane,users[0],dict(body,command_id=uuid4().hex))
        assert (await executor.execute_one(lane,fence)).outcome['status']=='rejected'
        await inbox.enqueue(lane,users[-1],dict(body,command_id=uuid4().hex))
        assert (await executor.execute_one(lane,fence)).outcome['status']=='rejected'
        assert await sql(pool,"SELECT count(*) FROM notification_outbox WHERE event_type='ROOM_POKE'")==[(1,)]
    finally:await host.close()


async def test_poke_receipt_failure_rolls_back_event(database,monkeypatch):
    pool,store,fence,users=database
    host,game=await host_game(users,'flush')
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        inbox=PostgresInboxStore(pool);lane=await inbox.ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id)))
        await inbox.enqueue(lane,users[0],dict(command_id=uuid4().hex,command='send-poke',payload={'text':'Hello'},match_id=game.match_id,expected_revision=0))
        async def fail(*args):raise RuntimeError('receipt failed')
        monkeypatch.setattr(inbox,'_complete',fail)
        with pytest.raises(RuntimeError):await TableLaneExecutor(inbox).execute_one(lane,fence)
        assert await sql(pool,'SELECT count(*) FROM notification_outbox')==[(0,)]
    finally:await host.close()
