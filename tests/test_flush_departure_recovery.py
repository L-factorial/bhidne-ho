"""Completed Flush departures reconcile under fenced timer/table transactions."""
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.multiplayer import table_session as policy
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.inbox import LaneTarget
from app.durable_games.session_timers import SessionDispatcher
from app.durable_games.table_executor import TableLaneExecutor
from app.durable_games.store import DurableGameConflict
from test_checkpoint_store import database, host_game
from test_game_departure import setup, restore, run
from test_game_lane_executor import command


async def pending_departure(database):
    pool, store, fence, users = database
    host, game, inbox, game_lane = await setup(database, 'flush', 3)
    detached, _ = await restore(store, game)
    current, fold = command(detached, 'FOLD_AND_LEAVE')
    leaver = next(user for user in game.users if user != current)
    assert (await run(inbox, game_lane, fence, leaver, fold))['status'] == 'accepted'
    detached, saved = await restore(store, game)
    assert leaver in detached.pending_flush_departures
    assert not policy.reconcile_completed_flush_departures(detached)
    for turn in detached.session['turns'].values():
        turn['deadline'] = 1.0
    revision = saved.checkpoint['data']['table_revision']
    await store.save(capture_checkpoint(detached, table_revision=revision+1),
                     expected_revision=revision, fence=fence)
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
    timer = await SessionDispatcher(inbox).dispatch_one(lane, fence)
    assert timer
    return host, game, inbox, lane, leaver, timer


async def assert_released(database, game, leaver):
    pool, store, fence, users = database
    restored, saved = await restore(store, game)
    assert restored.flush_open
    assert not restored.pending_flush_departures
    assert leaver not in restored.users
    assert (await pool.execute('SELECT 1 FROM active_table_players WHERE user_id=%s', (UUID(leaver[5:]),))).rows == []
    assert (await pool.execute('SELECT 1 FROM active_game_players WHERE user_id=%s', (UUID(leaver[5:]),))).rows == []
    assert len([e for e in restored.table.events if e['event']=='SEAT_RELEASED'
                and e['payload'].get('user_id')==leaver]) == 1
    assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(1,)]
    # The completed engine retains all historical participants for settlement.
    assert len(restored.flush_target.adapter.checkpoint().get_state().players) == 3
    return saved


async def join_another_table(database, leaver):
    pool, store, fence, users = database
    host, game = await host_game(users[3:5], 'flush', started=False)
    try:
        game.capacity = 3
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        from app.durable_games.inbox import PostgresInboxStore
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        request = dict(command_id=uuid4().hex, command='join-seat', match_id=game.match_id,
                       expected_revision=0, payload={})
        await inbox.enqueue(lane, leaver, request)
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
        assert (await pool.execute('SELECT table_id FROM active_table_players WHERE user_id=%s',
                                  (UUID(leaver[5:]),))).rows == [(UUID(game.table.table_id),)]
    finally:
        await host.close()


async def test_timeout_finishing_round_releases_pending_departures_atomically(database, monkeypatch):
    import app.durable_games.session_timers as timers
    pool, store, fence, users = database
    host, game, inbox, lane, leaver, timer = await pending_departure(database)
    try:
        before = await store.load(game.table.table_id)
        async def fail(*args, **kwargs):
            raise OperationalError('injected outbox failure')
        with monkeypatch.context() as patch:
            patch.setattr(timers, 'append_lane_events', fail)
            with pytest.raises(OperationalError):
                await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert (await store.load(game.table.table_id)).checkpoint == before.checkpoint
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(0,)]
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status']=='accepted'
        saved = await assert_released(database, game, leaver)
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert (await store.load(game.table.table_id)).checkpoint == saved.checkpoint
        await join_another_table(database, leaver)
    finally:
        await host.close()


@pytest.mark.parametrize('missing_intent', [False, True])
async def test_old_finished_round_is_reconciled_by_original_leave_receipt(database, monkeypatch, missing_intent):
    import app.durable_games.table_executor as tables
    pool, store, fence, users = database
    host, game, inbox, lane, leaver, timer = await pending_departure(database)
    try:
        # Reproduce the deployed bug: timer finishes the round but omits cleanup.
        with monkeypatch.context() as patch:
            patch.setattr(policy, 'reconcile_completed_flush_departures', lambda game: False)
            await TableLaneExecutor(inbox).execute_one(lane, fence)
        restored, saved = await restore(store, game)
        assert restored.flush_open and leaver in restored.pending_flush_departures
        if missing_intent:
            await pool.execute('DELETE FROM game_finalization_jobs')
        request = dict(command_id=uuid4().hex, command='leave-seat', match_id=game.match_id,
                       expected_revision=saved.checkpoint['data']['table_revision'], payload={})
        await inbox.enqueue(lane, leaver, request)
        if missing_intent:
            with pytest.raises(DurableGameConflict, match='missing its finalization intent'):
                await TableLaneExecutor(inbox).execute_one(lane, fence)
            assert (await store.load(game.table.table_id)).checkpoint == saved.checkpoint
            return
        async def fail(*args, **kwargs):
            raise OperationalError('injected outbox failure')
        with monkeypatch.context() as patch:
            patch.setattr(tables, 'append_lane_events', fail)
            with pytest.raises(OperationalError):
                await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert (await store.load(game.table.table_id)).checkpoint == saved.checkpoint
        outcome = (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome
        assert outcome['status'] == 'accepted'
        repaired = await assert_released(database, game, leaver)
        assert repaired.checkpoint['data']['engine'] == saved.checkpoint['data']['engine']
        assert (await inbox.enqueue(lane, leaver, request)).outcome == outcome
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        await join_another_table(database, leaver)
    finally:
        await host.close()
