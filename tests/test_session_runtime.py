"""Real PostgreSQL timer, reservation, receipt, recovery and private-control checks."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from app.multiplayer import table_session as policy
from app.durable_games.session_timers import SessionDispatcher
from app.durable_games.session_connections import SessionConnections, evidence
from app.durable_games.table_executor import TableLaneExecutor
from app.durable_games.executor import GameLaneExecutor
from app.durable_games.inbox import PostgresInboxStore, LaneTarget
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.queries import PostgresHostedQueries
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.store import StaleGameOwner
from test_checkpoint_store import database, host_game
from test_hosted_checkpoints import action, engine_state


async def setup(database, kind='marriage', started=False):
    pool, store, fence, users=database
    host, game=await host_game(users,kind,started=started)
    clock=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
    policy.sync(game,clock)
    await store.save(capture_checkpoint(game,table_revision=0), expected_revision=None, fence=fence)
    inbox=PostgresInboxStore(pool)
    lane=await inbox.ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id)))
    return pool,store,fence,users,host,game,inbox,lane,TableLaneExecutor(inbox),SessionDispatcher(inbox)


async def due_checkpoint(env, *, idle=False, user=None):
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    stored=await store.load(game.table.table_id)
    rebuilt=rebuild_hosted_game(host,stored.checkpoint,receipt_snapshot=stored.receipt_snapshot).game
    if idle: rebuilt.session['idle_deadline']=1.0
    else:
        for t in rebuilt.session['turns'].values():t['deadline']=1.0
    if user:
        rebuilt.session['controls'][str(rebuilt.users.index(user)+1)]['disconnected_at']=1.0
    await store.save(capture_checkpoint(rebuilt,table_revision=stored.checkpoint['data']['table_revision']+1),
        expected_revision=stored.checkpoint['data']['table_revision'],fence=fence)
    return rebuilt


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_durable_idle_expiry_notifies_feed_and_releases_reservations(database,kind):
    env=await setup(database,kind)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        await due_checkpoint(env,idle=True)
        entry=await dispatch.dispatch_one(lane,fence)
        assert entry
        assert (await executor.execute_one(lane,fence)).outcome['status']=='accepted'
        saved=await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['ended']
        assert not saved.checkpoint['data']['positions']
        assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows==[(0,)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows==[(0,)]
        routes=(await pool.execute("SELECT l.kind,count(*) FROM notification_outbox o JOIN command_lanes l USING(lane_id) WHERE o.event_type='TABLE_EXPIRED' GROUP BY l.kind")).rows
        assert dict(routes)=={'lobby':1,'recipient':6,'table':1}
        assert await dispatch.dispatch_one(lane,fence) is None
        view=await PostgresHostedQueries(pool).game_view('room',users[0],match_id=UUID(game.match_id))
        assert view['session']['expired_at'] and view['status']=='ended'
    finally:await host.close()


async def test_new_activity_wins_before_already_enqueued_timer(database):
    env=await setup(database)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        await due_checkpoint(env,idle=True)
        await inbox.enqueue(lane,users[2],dict(command_id=uuid4().hex,command='join-queue',
            match_id=game.match_id,expected_revision=1,payload={}))
        entry=await dispatch.dispatch_one(lane,fence)
        assert entry
        assert (await executor.execute_one(lane,fence)).outcome['status']=='accepted'
        assert (await executor.execute_one(lane,fence)).outcome['status']=='accepted'
        saved=await store.load(game.table.table_id)
        assert not saved.checkpoint['data']['host']['ended']
        assert saved.checkpoint['data']['host']['session']['idle_deadline']>1700000000
        assert await executor.execute_one(lane,fence) is None
    finally:await host.close()


@pytest.mark.parametrize('kind',['marriage','flush'])
async def test_durable_required_timeout_folds_and_enqueues_settlement(database,kind):
    # Flush starts with dealer preparation, so establish a dealt hand first.
    pool,store,fence,users=database
    host,game=await host_game(users,kind,started=True)
    try:
        if kind=='flush':
            await action(host,game,'DEAL_CARDS')
            await action(host,game,'SKIP_CUT')
        now=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
        policy.sync(game,now)
        for t in game.session['turns'].values():t['deadline']=1.0
        actor=next(iter(game.session['turns'].values()))['user_id']
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        inbox=PostgresInboxStore(pool)
        lane=await inbox.ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id)))
        await SessionDispatcher(inbox).dispatch_one(lane,fence)
        result=await TableLaneExecutor(inbox).execute_one(lane,fence)
        assert result.outcome['status']=='accepted'
        saved=await store.load(game.table.table_id)
        assert actor not in [p['user_id'] for p in saved.checkpoint['data']['positions']]
        assert saved.checkpoint['data']['engine']['state']['status']=='finished'
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows==[(1,)]
        assert (await pool.execute('SELECT count(*) FROM game_events')).rows[0][0]>0
    finally:await host.close()


async def test_disconnect_leases_multiple_devices_unknown_and_reconnect(database):
    pool,_,_,users=database
    leases=SessionConnections(pool)
    first,second=uuid4(),uuid4()
    clock=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
    assert await evidence(pool,'room',now=clock)=={}
    await leases.register(first,users[0],'room')
    await leases.register(second,users[0],'room')
    await leases.close(first)
    clock=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
    assert (await evidence(pool,'room',now=clock))[users[0]] is True
    await leases.close(second)
    clock=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
    assert type((await evidence(pool,'room',now=clock))[users[0]]) is float
    await leases.refresh(first)  # A closed socket cannot resurrect its lease.
    assert (await evidence(pool,'room',now=clock))[users[0]] is not True
    await leases.register(uuid4(),users[0],'room')
    clock=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
    assert (await evidence(pool,'room',now=clock))[users[0]] is True


async def test_live_handover_commits_private_authority_and_reclaim(database):
    env=await setup(database,'callbreak',True)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        # Queue priority is established before the disconnect is detected.
        game.table.queue.append(users[4])
        game.session['controls']['1']['disconnected_at']=1.0
        await store.save(capture_checkpoint(game,table_revision=1),expected_revision=0,fence=fence)
        entry=await dispatch.dispatch_one(lane,fence)
        assert entry
        assert (await executor.execute_one(lane,fence)).outcome['status']=='accepted'
        saved=await store.load(game.table.table_id)
        revision=saved.checkpoint['data']['table_revision']
        assert saved.checkpoint['data']['host']['session']['controls']['1']['offer']['user_id']==users[4]
        async def command(actor,command,revision):
            await inbox.enqueue(lane,actor,dict(command_id=uuid4().hex,command=command,
                match_id=game.match_id,expected_revision=revision,payload={}))
            return await executor.execute_one(lane,fence)
        assert (await command(users[4],'accept-live-seat',revision)).outcome['status']=='accepted'
        queries=PostgresHostedQueries(pool)
        owner=await queries.game_view('room',users[0],match_id=UUID(game.match_id))
        replacement=await queries.game_view('room',users[4],match_id=UUID(game.match_id))
        assert owner['private'] is None and owner['your_player_id'] is None
        assert replacement['your_player_id']==1
        saved=await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['users']==game.users
        assert (await command(users[0],'reclaim-seat',saved.checkpoint['data']['table_revision'])).outcome['status']=='accepted'
        assert (await queries.game_view('room',users[4],match_id=UUID(game.match_id)))['private'] is None
        assert (await queries.game_view('room',users[0],match_id=UUID(game.match_id)))['your_player_id']==1
    finally:await host.close()


async def test_timer_work_survives_recovery_and_retries_do_not_reroll(database):
    from app.durable_games.room_recovery import PostgresRoomRecoveryStore
    from app.durable_games.executor import _DetachedHost
    env=await setup(database,'callbreak',True)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        await due_checkpoint(env)
        entry=await dispatch.dispatch_one(lane,fence)
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        inventory=await PostgresRoomRecoveryStore(pool,offer_expiry=True,callbreak_review=True,
            match_settlement=True,flush_settlement=True,table_sessions=True).load(fence,_DetachedHost(8))
        assert inventory.tables[0].stored.checkpoint['data']['host']['session']['turns']
        assert inventory.lanes[0].enqueued_sequence>inventory.lanes[0].processed_sequence
        await pool.execute("UPDATE room_ownership SET runtime_status='serving'")
        first=await executor.execute_one(lane,fence)
        committed=await store.load(game.table.table_id)
        assert first.outcome['status']=='accepted'
        receipt=committed.receipt_snapshot['receipts'][-1]
        assert receipt['actor_id']=='system:timer'
        assert receipt['request']['payload']['scheduled_request']['command_id']==entry.request.command_id
        assert receipt['request']['command']=='SESSION_TICK'
        assert await executor.execute_one(lane,fence) is None
        assert await store.load(game.table.table_id)==committed
    finally:await host.close()


async def test_stale_owner_and_forged_timer_cannot_change_authority(database):
    from dataclasses import replace
    env=await setup(database)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        await due_checkpoint(env,idle=True)
        committed=await store.load(game.table.table_id)
        with pytest.raises(StaleGameOwner):await dispatch.dispatch_one(lane,replace(fence,epoch=fence.epoch+1))
        assert await store.load(game.table.table_id)==committed
        await inbox.enqueue(lane,users[0],dict(command_id=uuid4().hex,command='session-tick',match_id=game.match_id,
            expected_revision=None,payload=dict(table_id=game.table.table_id,revision=1)))
        assert (await executor.execute_one(lane,fence)).outcome['status']=='rejected'
        assert await store.load(game.table.table_id)==committed
    finally:await host.close()


async def test_unsubscribed_views_are_not_watching_but_navigation_is_not_disconnect(database):
    from app.durable_games.session_connections import watchers
    pool,_,_,users=database
    leases=SessionConnections(pool)
    conn,table=uuid4(),uuid4()
    await leases.register(conn,users[0],'room',table,'view')
    await leases.register(conn,users[0],'room',table,'game')
    now=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
    assert await watchers(pool,'room',table,now=now)==[users[0]]
    await leases.unsubscribe(conn,'view')
    assert await watchers(pool,'room',table,now=now)==[users[0]]
    await leases.unsubscribe(conn,'game')
    assert await watchers(pool,'room',table,now=now)==[]
    assert (await evidence(pool,'room',now=now))[users[0]] is True


async def test_original_can_pause_and_reclaim_while_holding_same_active_reservation(database):
    env=await setup(database,'callbreak',True)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        for command,revision in [('pause-seat',0),('reclaim-seat',1)]:
            await inbox.enqueue(lane,users[0],dict(command_id=uuid4().hex,command=command,
                match_id=game.match_id,expected_revision=revision,payload={}))
            result=await executor.execute_one(lane,fence)
            assert result.outcome['status']=='accepted',result.outcome
        saved=await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['session']['controls']['1']['mode']=='manual'
        assert saved.checkpoint['data']['positions'][0]['user_id']==users[0]
    finally:await host.close()


async def test_deadline_scan_ignores_unknown_or_old_disconnect_and_finds_new_disconnect(database):
    env=await setup(database,'callbreak',True)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        assert await dispatch.due_lanes(fence)==()
        leases=SessionConnections(pool)
        conn=uuid4()
        await leases.register(conn,users[0],'room',UUID(game.table.table_id))
        await pool.execute("UPDATE game_connection_leases SET disconnected_at=to_timestamp(1),expires_at=to_timestamp(1)")
        assert await dispatch.due_lanes(fence)==()  # Old device record is not a new network failure.
        await leases.register(conn,users[0],'room',UUID(game.table.table_id))
        await leases.close(conn)
        assert await dispatch.due_lanes(fence)==(lane,)
        assert await dispatch.dispatch_one(lane,fence)
        await executor.execute_one(lane,fence)
        saved=await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['session']['controls']['1']['disconnected_at']
        assert await dispatch.due_lanes(fence)==()  # Grace has not elapsed.
        await due_checkpoint(env)
        assert await dispatch.due_lanes(fence)==(lane,)
    finally:await host.close()


async def test_noop_join_and_configuration_cannot_extend_game_or_idle_deadline(database):
    env=await setup(database)
    pool,store,fence,users,host,game,inbox,lane,executor,dispatch=env
    try:
        deadline=game.session['idle_deadline']
        await inbox.enqueue(lane,users[0],dict(command_id=uuid4().hex,command='join-seat',match_id=game.match_id,
            expected_revision=0,payload={}))
        assert (await executor.execute_one(lane,fence)).outcome['status']=='accepted'
        assert (await store.load(game.table.table_id)).checkpoint['data']['host']['session']['idle_deadline']==deadline
    finally:await host.close()


async def test_mid_round_flush_timeout_releases_only_folded_seat_and_remaining_players_can_finish(database):
    pool,store,fence,users=database
    host,game=await host_game(users,'flush',started=False)
    try:
        game.capacity=3
        await host.join('room',users[2],game.match_id)
        await host.table_command('room',users[0],game.match_id,'lock')
        await host.start('room',users[0],game.match_id,rules_revision=0)
        game.durable_game_id=UUID(game.match_id)
        await action(host,game,'DEAL_CARDS')
        await action(host,game,'SKIP_CUT')
        now=(await pool.execute('SELECT clock_timestamp()')).rows[0][0].timestamp()
        policy.sync(game,now)
        timed_out=next(iter(game.session['turns'].values()))['user_id']
        for t in game.session['turns'].values():t['deadline']=1.0
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        inbox=PostgresInboxStore(pool)
        lane=await inbox.ensure_lane(LaneTarget(kind='table',room_id='room',table_id=UUID(game.table.table_id)))
        await SessionDispatcher(inbox).dispatch_one(lane,fence)
        await TableLaneExecutor(inbox).execute_one(lane,fence)
        saved=await store.load(game.table.table_id)
        assert saved.checkpoint['data']['engine']['state']['status']=='in_progress'
        assert len(saved.checkpoint['data']['positions'])==2
        assert timed_out not in [p['user_id'] for p in saved.checkpoint['data']['positions']]
        rebuilt=rebuild_hosted_game(host,saved.checkpoint,receipt_snapshot=saved.receipt_snapshot).game
        target=next(iter(rebuilt.session['turns'].values()))['user_id']
        game_lane=await inbox.ensure_lane(LaneTarget(kind='game',room_id='room',table_id=UUID(game.table.table_id),game_id=game.durable_game_id))
        await inbox.enqueue(game_lane,target,dict(command_id=uuid4().hex,command='FOLD',match_id=game.match_id,
            expected_revision=saved.checkpoint['data']['engine']['revision'],payload={}))
        assert (await GameLaneExecutor(inbox).execute_one(game_lane,fence)).outcome['status']=='accepted'
        saved=await store.load(game.table.table_id)
        assert saved.checkpoint['data']['engine']['state']['status']=='finished'
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows==[(1,)]
    finally:await host.close()
