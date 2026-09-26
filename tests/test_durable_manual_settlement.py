from uuid import UUID, uuid4

import pytest
from app.durable_games.creation_executor import RoomCreationExecutor
from app.durable_games.inbox import PostgresInboxStore, LaneTarget
from app.durable_games.ingress import HostedCommandIngress
from app.durable_games.store import DurableGameConflict
from test_checkpoint_store import database
from test_delivery import sql


async def setup(database):
    pool, _, fence, users = database
    table, game = uuid4(), uuid4()
    await sql(pool,"INSERT INTO ledger_games(game_id,room_id,table_id,game_type) VALUES (%s,'room',%s,'marriage')",(game,table))
    for user, amount in zip(users[:2], [-100,100]):
        await sql(pool,'INSERT INTO game_ledger_entries(game_id,player_id,amount) VALUES (%s,%s,%s)',(game,UUID(user[5:]),amount))
    inbox = PostgresInboxStore(pool)
    return inbox, HostedCommandIngress(inbox), RoomCreationExecutor(inbox), fence, users, table, game


async def submit(ingress, executor, fence, actor, command, payload, key=None):
    body=dict(command_id=key or uuid4().hex,command=command,payload=payload)
    receipt=await ingress.submit(actor,LaneTarget(kind='room',room_id='room'),body)
    lane=UUID(receipt['lane_id'])
    result=await executor.execute_one(lane,fence)
    return body,lane,result


async def test_creation_actions_permissions_retry_and_projection(database):
    inbox,ingress,executor,fence,users,table,game=await setup(database)
    body,lane,result=await submit(ingress,executor,fence,users[0],'create-settlement',dict(scope='table',table_id=str(table)))
    assert result.outcome['status']=='accepted'
    rows=await sql(database[0],'SELECT batch_id,transfer_id FROM settlement_transfers')
    batch,transfer=rows[0]
    assert (await ingress.submit(users[0],LaneTarget(kind='room',room_id='room'),body))['status']=='accepted'
    assert await executor.execute_one(lane,fence) is None
    payload=dict(batch_id=str(batch),transfer_id=str(transfer),action='mark-paid')
    assert (await submit(ingress,executor,fence,users[1],'settlement-action',payload))[2].outcome['status']=='rejected'
    assert (await submit(ingress,executor,fence,users[0],'settlement-action',payload))[2].outcome['status']=='accepted'
    payload['action']='confirm'
    confirm,_,result=await submit(ingress,executor,fence,users[1],'settlement-action',payload)
    assert result.outcome['status']=='accepted'
    assert await sql(database[0],'SELECT status FROM settlement_batches')==[('RESOLVED',)]
    assert (await ingress.submit(users[1],LaneTarget(kind='room',room_id='room'),confirm))['status']=='accepted'
    assert (await submit(ingress,executor,fence,users[0],'create-settlement',dict(scope='game',table_id=str(table),game_id=str(game))))[2].outcome['status']=='rejected'
    with pytest.raises(DurableGameConflict):
        await ingress.submit(users[0],LaneTarget(kind='room',room_id='room'),dict(body,payload=dict(scope='table',table_id=str(uuid4()))))
    assert await sql(database[0],'SELECT count(*) FROM settlement_actions')==[(2,)]


async def test_settlement_receipt_failure_rolls_back_all_effects(database,monkeypatch):
    inbox,ingress,executor,fence,users,table,game=await setup(database)
    original=inbox._complete
    async def fail(*args): raise RuntimeError('receipt failure')
    monkeypatch.setattr(inbox,'_complete',fail)
    body=dict(command_id='retry',command='create-settlement',payload=dict(scope='table',table_id=str(table)))
    pending=await ingress.submit(users[0],LaneTarget(kind='room',room_id='room'),body)
    lane=UUID(pending['lane_id'])
    with pytest.raises(RuntimeError): await executor.execute_one(lane,fence)
    for table_name in ('settlement_batches','settlement_games','settlement_transfers','notification_outbox'):
        assert await sql(database[0],f'SELECT count(*) FROM {table_name}')==[(0,)]
    monkeypatch.setattr(inbox,'_complete',original)
    assert (await executor.execute_one(lane,fence)).outcome['status']=='accepted'
