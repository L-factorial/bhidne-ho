"""Durable physical seating uses real PostgreSQL SQL and recovered checkpoints."""
import asyncio
from uuid import UUID, uuid4
import pytest
from app.durable_games.inbox import LaneTarget
from app.durable_games.table_executor import TableLaneExecutor
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.executor import _DetachedHost
from app.durable_games.view_generation import projected_view
from test_checkpoint_store import database
from test_creation_executor import creation, create, request


async def table(context, kind='flush', capacity=4):
    _, _, _, users, inbox, _, _ = context
    outcome = await create(context, users[0], request(game_type=kind, capacity=capacity))
    assert outcome['status'] == 'accepted'
    lane = await inbox.ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(outcome['table_id'])))
    return outcome, lane


async def command(context, target, lane, actor, name, revision, payload=None, identity=None):
    _, _, fence, _, inbox, _, _ = context
    body = dict(command_id=identity or uuid4().hex,command=name,match_id=target['match_id'],expected_revision=revision,payload=payload or {})
    enqueued = await inbox.enqueue(lane,actor,body)
    if enqueued.duplicate and enqueued.outcome:
        return enqueued.outcome
    return (await TableLaneExecutor(inbox).execute_one(lane,fence)).outcome


async def recovered(context,target):
    saved = await context[1].load(UUID(target['table_id']))
    return saved, rebuild_hosted_game(_DetachedHost(8),saved.checkpoint,receipt_snapshot=saved.receipt_snapshot).game


@pytest.mark.parametrize('kind',['callbreak','marriage','flush'])
async def test_soft_reservation_preserves_spares_then_yields_last_seat_and_recovers(creation,kind):
    target,lane = await table(creation,kind)
    users=creation[3]
    assert (await command(creation,target,lane,users[0],'invite-position',0,dict(position_id=2,recipient=users[4])))['status']=='accepted'
    # Two stale joins are independent intents and allocate different free positions.
    for user in users[1:4]:
        assert (await command(creation,target,lane,user,'join-seat',0))['status']=='accepted'
    saved,game=await recovered(creation,target)
    assert game.table.seat_positions[users[1]]==3
    assert game.table.seat_positions[users[2]]==4
    assert game.table.seat_positions[users[3]]==2
    assert len(set(game.table.seat_positions.values()))==4
    assert saved.checkpoint['data']['invitations'][0]['reserved_position'] is None
    assert (await command(creation,target,lane,users[4],'join-seat',0))['status']=='rejected'
    # Retry identity cannot assign another seat or increment the revision.
    identity=uuid4().hex
    before=saved.checkpoint['data']['table_revision']
    result=await command(creation,target,lane,users[3],'join-seat',before,identity=identity)
    assert result==await command(creation,target,lane,users[3],'join-seat',before,identity=identity)


@pytest.mark.parametrize('kind',['callbreak','marriage','flush'])
async def test_invitee_claims_reserved_position_and_atomic_swap_preserves_identity(creation,kind):
    target,lane=await table(creation,kind)
    users=creation[3]
    await command(creation,target,lane,users[0],'invite-position',0,dict(position_id=4,recipient=users[1]))
    assert (await command(creation,target,lane,users[1],'join-seat',0))['status']=='accepted'
    payload=dict(user_id=users[0],position_id=4,source_position=1,target_user=users[1])
    identity=uuid4().hex
    assert (await command(creation,target,lane,users[0],'move-player',2,payload,identity))['status']=='accepted'
    saved,game=await recovered(creation,target)
    assert game.users==users[:2]
    assert game.table.seat_positions=={users[0]:4,users[1]:1}
    assert (await command(creation,target,lane,users[0],'move-player',2,payload,identity))['status']=='accepted'
    assert (await command(creation,target,lane,users[0],'move-player',3,payload))['status']=='rejected'
    # Engine identity and hand access remain separate from physical position.
    view=projected_view(saved.checkpoint,users[2],{})
    assert view['your_player_id'] is None
    assert {p['position_id'] for p in view['table']['seated_players']}=={1,4}


async def test_last_seat_race_and_start_boundary(creation):
    target,lane=await table(creation,capacity=2)
    users,inbox,fence=creation[3],creation[4],creation[2]
    for user in users[1:3]:
        await inbox.enqueue(lane,user,dict(command_id=uuid4().hex,command='join-seat',match_id=target['match_id'],expected_revision=0,payload={}))
    results=await asyncio.gather(*(TableLaneExecutor(inbox).execute_one(lane,fence) for _ in range(2)))
    assert sorted(r.outcome['status'] for r in results)==['accepted','rejected']
    assert (await command(creation,target,lane,users[0],'lock',1))['status']=='accepted'
    assert (await command(creation,target,lane,users[0],'start',2,dict(rules_revision=0)))['status']=='accepted'
    assert (await command(creation,target,lane,users[0],'move-player',3,dict(user_id=users[0],position_id=2,source_position=1,target_user=users[1])))['status']=='rejected'
    assert (await command(creation,target,lane,users[0],'invite-position',3,dict(position_id=1,recipient=users[3])))['status']=='rejected'


@pytest.mark.parametrize('max_doubles',[0,1,2,3,4,5,99])
async def test_general_invitation_upgrades_without_duplicate_notification_and_config_saves(creation,max_doubles):
    target,lane=await table(creation)
    users=creation[3]
    await command(creation,target,lane,users[0],'invite-table',0,dict(recipients=[users[1]]))
    saved,_=await recovered(creation,target)
    identity=saved.checkpoint['data']['invitations'][0]['id']
    assert (await command(creation,target,lane,users[0],'invite-position',1,dict(position_id=3,recipient=users[1])))['status']=='accepted'
    saved,game=await recovered(creation,target)
    assert len(saved.checkpoint['data']['invitations'])==1
    assert saved.checkpoint['data']['invitations'][0]['id']==identity
    from dataclasses import asdict
    rules={**asdict(game.flush_rules),'initial_blind_bet':5,'max_raise':max_doubles,'allow_raise':False}
    assert (await command(creation,target,lane,users[0],'flush-settings',2,dict(rules_revision=0,rules=rules)))['status']=='accepted'
    _,game=await recovered(creation,target)
    assert game.flush_rules.boot_amount==game.flush_rules.initial_blind_bet==5
    assert game.flush_rules.allow_raise is True
    assert game.flush_rules.max_raise==(max_doubles if 1<=max_doubles<=5 else 1)
    assert game.rule_proposal['status']=='ACCEPTED'
    assert any(e['event']=='GAME_CONFIG_UPDATED' for e in game.table.events)


@pytest.mark.parametrize('kind',['callbreak','marriage','flush'])
async def test_start_uses_clockwise_physical_order_and_preserves_host(creation,kind):
    target,lane=await table(creation,kind)
    users=creation[3]
    for user in users[1:4]:
        await command(creation,target,lane,user,'join-seat',0)
    assert (await command(creation,target,lane,users[0],'move-player',3,dict(user_id=users[1],position_id=4,source_position=2,target_user=users[3])))['status']=='accepted'
    revision=4
    if kind!='callbreak':
        assert (await command(creation,target,lane,users[0],'lock',revision))['status']=='accepted'
        revision+=1
    assert (await command(creation,target,lane,users[0],'start',revision,dict(rules_revision=0) if kind=='flush' else {}))['status']=='accepted'
    saved,game=await recovered(creation,target)
    assert game.users==[users[0],users[3],users[2],users[1]]
    assert game.table.seat_positions[users[1]]==4
    assert game.table.seat_positions[users[3]]==2
    assert game.table.view(game,users[0])['current_user']['can_start'] is False


async def test_open_waitlist_preserves_fifo_positions_without_blocking_spare_seats(creation):
    target,lane=await table(creation)
    users=creation[3]
    await command(creation,target,lane,users[1],'join-queue',0)
    await command(creation,target,lane,users[2],'join-queue',1)
    assert (await command(creation,target,lane,users[3],'join-seat',0))['status']=='accepted'
    _,game=await recovered(creation,target)
    assert game.table.seat_positions[users[3]]==4
    assert not game.table.view(game,users[4])['current_user']['can_join']
    assert (await command(creation,target,lane,users[4],'join-seat',0))['status']=='rejected'
    assert (await command(creation,target,lane,users[2],'join-seat',0))['status']=='accepted'
    _,game=await recovered(creation,target)
    assert game.table.seat_positions[users[2]]==3
    assert game.table.queue==[users[1]]
    assert (await command(creation,target,lane,users[1],'join-seat',0))['status']=='accepted'
    _,game=await recovered(creation,target)
    assert game.table.seat_positions[users[1]]==2
    assert game.table.queue==[]
