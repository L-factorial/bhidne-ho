from uuid import UUID, uuid4

import pytest

from app.durable_games.read_transport import DistributedReads
from app.durable_games.inbox import LaneTarget
from app.durable_games.queries import QueryAccessDenied
from test_checkpoint_store import database
from test_delivery import sql
from test_durable_social import setup


async def test_bootstrap_is_idempotent_and_recipient_is_actor_bound(database):
    pool,_,_,users=database
    reads=DistributedReads(pool)
    first=await reads.recipient(users[0])
    assert first==await reads.recipient(users[0])
    assert first['target']['recipient_id']==users[0][5:]
    with pytest.raises(QueryAccessDenied):
        await reads.open(users[1],LaneTarget(kind='recipient',recipient_id=UUID(users[0][5:])))
    catalog=await reads.social.streams(users[0])
    assert [r['lane_id'] for r in catalog['items']]==[first['lane_id']]
    assert (await sql(pool,'SELECT count(*) FROM command_inbox'))==[(0,)]


async def test_room_bootstrap_requires_membership_and_does_not_create_games(database):
    pool,_,_,users=database;reads=DistributedReads(pool)
    target=LaneTarget(kind='room',room_id='room')
    assert (await reads.open(users[0],target))['target']['kind']=='room'
    with pytest.raises(QueryAccessDenied):
        await reads.open(users[0],LaneTarget(kind='table',room_id='room',table_id=uuid4()))
    await sql(pool,'DELETE FROM room_memberships WHERE user_id=%s',(UUID(users[0][5:]),))
    with pytest.raises(QueryAccessDenied): await reads.open(users[0],target)
    assert (await sql(pool,'SELECT count(*) FROM games'))==[(0,)]


async def test_conversation_bootstrap_rechecks_friendship(database):
    pool,_,_,users=database;reads=DistributedReads(pool)
    _,_,_,target=await setup(database)
    opened=await reads.open(users[0],target)
    assert (await reads.social.page(users[1],opened['lane_id']))['items']==[]
    await sql(pool,'DELETE FROM friendships')
    with pytest.raises(QueryAccessDenied): await reads.open(users[0],target)
    with pytest.raises(QueryAccessDenied): await reads.social.page(users[0],opened['lane_id'])
