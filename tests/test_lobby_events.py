from uuid import UUID, uuid4
import pytest
from app.durable_games.catalog import PostgresRoomCreation
from app.durable_games.delivery_store import PostgresDeliveryStore
from app.durable_games.inbox import LaneTarget
from app.durable_games.read_transport import DistributedReads
from app.durable_games.queries import QueryAccessDenied
from test_checkpoint_store import database
from test_durable_room_commands import run
from test_delivery import sql


async def test_private_creation_notifies_only_creator_and_invitee_and_retry_does_not_duplicate(database):
    pool,_,_,users=database
    creator=PostgresRoomCreation(pool)
    body=dict(command_id=uuid4().hex,name='Private',invitees=[users[1]])
    await creator.create(users[0],body)
    before=await sql(pool,"SELECT l.kind,l.recipient_id,o.payload FROM notification_outbox o JOIN command_lanes l USING(lane_id) WHERE event_type='LOBBY_CHANGED'")
    assert len(before)==2
    assert {r[1] for r in before}=={UUID(u[5:]) for u in users[:2]}
    assert all(r[0]=='recipient' and r[2]=={'type':'LOBBY_CHANGED'} for r in before)
    await creator.create(users[0],body)
    assert await sql(pool,"SELECT count(*) FROM notification_outbox")==[(2,)]


async def test_public_creation_signal_is_authorized_minimal_and_transactional(database,monkeypatch):
    pool,_,_,users=database
    creator=PostgresRoomCreation(pool)
    await creator.create(users[0],dict(command_id=uuid4().hex,name='Public',visibility='public'))
    opened=await DistributedReads(pool).open(users[-1],LaneTarget(kind='lobby'))
    delivery=PostgresDeliveryStore(pool)
    page=await delivery.page(users[-1],opened['lane_id'],after=0)
    assert page.events[0]['payload']=={'type':'LOBBY_CHANGED'}
    with pytest.raises(QueryAccessDenied):
        await DistributedReads(pool).open('user-'+str(uuid4()),LaneTarget(kind='lobby'))
    before=await sql(pool,'SELECT count(*) FROM rooms')
    import app.durable_games.lobby_events as events
    original=events.changed
    async def fail(*args,**kwargs):
        await original(*args,**kwargs)
        raise RuntimeError('rollback')
    monkeypatch.setattr(events,'changed',fail)
    with pytest.raises(RuntimeError):
        await creator.create(users[0],dict(command_id=uuid4().hex,name='Rollback',visibility='public'))
    assert await sql(pool,'SELECT count(*) FROM rooms')==before
    assert await sql(pool,"SELECT count(*) FROM notification_outbox WHERE lane_id=%s",(opened['lane_id'],))==[(1,)]


async def test_leave_and_delete_notify_former_members_on_personal_lanes(database):
    pool,_,fence,users=database
    assert (await run(pool,fence,users[1],'leave-room'))['status']=='accepted'
    assert (await run(pool,fence,users[0],'delete-room'))['status']=='accepted'
    rows=await sql(pool,"SELECT DISTINCT recipient_id FROM notification_outbox JOIN command_lanes USING(lane_id) WHERE event_type='LOBBY_CHANGED'")
    assert {r[0] for r in rows}=={UUID(u[5:]) for u in users}


async def test_explicit_upgrade_preserves_old_dataset_and_is_idempotent():
    from app.database import MIGRATIONS
    from app.durable_games.bootstrap import migrate_pool, verify_dataset, MARKER
    from pglite_support import PGlitePool
    pool=await PGlitePool.open()
    try:
        for version,script in MIGRATIONS:
            if version<26:await pool.execute(script,script=True)
        await pool.execute('CREATE TABLE schema_migrations(version integer PRIMARY KEY)')
        for version,_ in MIGRATIONS:
            if version<26:await pool.execute('INSERT INTO schema_migrations VALUES(%s)',(version,))
        await pool.execute('CREATE TABLE runtime_dataset(singleton boolean PRIMARY KEY,mode text)')
        await pool.execute('INSERT INTO runtime_dataset VALUES(true,%s)',(MARKER,))
        user=UUID(int=1)
        await pool.execute("INSERT INTO users(id,kind) VALUES(%s,'account')",(user,))
        await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES('existing',%s,'Existing','private')",(user,))
        # PGlite's prepared-statement bridge needs script mode for migration DDL.
        execute=pool.execute
        async def migration_execute(statement,args=(),**kwargs):
            return await execute(statement,args,script=statement==dict(MIGRATIONS)[26],**kwargs)
        pool.execute=migration_execute
        await migrate_pool(pool);await migrate_pool(pool);await verify_dataset(pool)
        assert await sql(pool,'SELECT name FROM rooms')==[('Existing',)]
        await pool.execute("UPDATE runtime_dataset SET mode='legacy'")
        with pytest.raises(ValueError):await migrate_pool(pool)
    finally:await pool.close()
