"""Durable between-round Flush roster changes preserve completed engine history."""
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.room_recovery import PostgresRoomRecoveryStore
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database, host_game
from test_flush_restart import finished, table_action, current_lane
from test_game_departure import restore, run
from test_game_lane_executor import command


async def test_fifo_replacements_keep_history_and_restart_with_stable_seats(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        _, before = await restore(store, game)
        jobs = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        for name, actor in [('join-queue', users[2]), ('join-queue', users[3]),
                            ('leave-seat', users[0]), ('leave-seat', users[1])]:
            assert (await table_action(database, game, inbox, lane, name, actor=actor))[0]['status'] == 'accepted'
        detached, saved = await restore(store, game)
        assert detached.users == users[2:4] and detached.table.queue == []
        assert detached.flush_seats == {users[i]: i + 1 for i in range(4)}
        assert saved.checkpoint['data']['engine'] == before.checkpoint['data']['engine']
        assert saved.receipt_snapshot == before.receipt_snapshot
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == jobs
        assert (await pool.execute('SELECT seat FROM active_table_players ORDER BY seat')).rows == [(3,), (4,)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
        # The complete room can recover a finished engine with a wholly new roster.
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        loader = PostgresRoomRecoveryStore(pool, finalization_validators={('hosted_settlement', 1): lambda job: None})
        assert (await loader.load(fence, _DetachedHost(8))).tables[0].stored == saved
        await pool.execute("UPDATE room_ownership SET runtime_status='serving'")
        assert (await table_action(database, game, inbox, lane, 'lock', actor=users[2]))[0]['status'] == 'accepted'
        assert (await table_action(database, game, inbox, lane, 'start', actor=users[2]))[0]['status'] == 'accepted'
        detached, _ = await restore(store, game)
        state = detached.flush_target.adapter.checkpoint().get_state()
        assert state.config.player_ids == ('3', '4') and state.config.dealer_id == '3'
        new_lane = await current_lane(inbox, detached)
        actor, body = command(detached, 'DEAL_CARDS')
        assert (await run(inbox, new_lane, fence, actor, body))['status'] == 'accepted'
        archive = (await pool.execute('SELECT checkpoint FROM hosted_match_archives')).rows[0][0]
        assert archive['data']['engine'] == before.checkpoint['data']['engine']
        assert archive['data']['host']['flush_seats'] == saved.checkpoint['data']['host']['flush_seats']
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
    finally:
        await host.close()


async def test_returning_player_reuses_seat_id_and_join_leaves_queue(database):
    _, store, _, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        for name in ('leave-seat', 'join-queue', 'leave-queue', 'join-queue', 'join-seat'):
            assert (await table_action(database, game, inbox, lane, name, actor=users[0]))[0]['status'] == 'accepted'
        restored, saved = await restore(store, game)
        assert restored.users == [users[1], users[0]]
        assert restored.flush_seats[users[0]] == 1 and restored.table.queue == []
        assert [p['seat'] for p in saved.checkpoint['data']['positions']] == [1, 2]
    finally:
        await host.close()


async def test_empty_roster_closes_table_cancels_work_and_preserves_settlement(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        detached, saved = await restore(store, game)
        revision = saved.checkpoint['data']['table_revision']
        invitation = dict(room_id='room', match_id=game.match_id, status='pending', recipient_id=users[-1])
        await store.save(capture_checkpoint(detached, table_revision=revision + 1, invitations=[invitation]),
                         expected_revision=revision, fence=fence)
        await pool.execute('''INSERT INTO scheduled_actions
            (action_id,lane_id,action_type,generation,due_at,command_id,command,payload)
            VALUES (%s,%s,'test',0,clock_timestamp(),'timer','test','{}')''', (uuid4(), lane))
        jobs = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        for user in users[:2]:
            assert (await table_action(database, game, inbox, lane, 'leave-seat', actor=user))[0]['status'] == 'accepted'
        _, closed = await restore(store, game)
        assert closed.checkpoint['data']['host']['ended'] and closed.checkpoint['data']['phase'] == 'ENDED'
        assert closed.checkpoint['data']['positions'] == []
        assert closed.checkpoint['data']['engine'] == saved.checkpoint['data']['engine']
        assert closed.checkpoint['data']['invitations'][0]['status'] == 'cancelled'
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('cancelled',)]
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == jobs
        assert (await pool.execute('SELECT status FROM games')).rows == [('completed',)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows == [(0,)]
        assert (await table_action(database, game, inbox, lane, 'join-seat', actor=users[2]))[0]['status'] == 'rejected'
    finally:
        await host.close()


@pytest.mark.parametrize('action', ['join-seat', 'leave-seat'])
async def test_locked_finished_round_cannot_change_seats_but_queue_can_change(database, action):
    _, store, _, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        await table_action(database, game, inbox, lane, 'lock')
        saved = await store.load(game.table.table_id)
        actor = users[2] if action == 'join-seat' else users[0]
        assert (await table_action(database, game, inbox, lane, action, actor=actor))[0]['status'] == 'rejected'
        assert await store.load(game.table.table_id) == saved
        for name in ('join-queue', 'leave-queue'):
            assert (await table_action(database, game, inbox, lane, name, actor=users[2]))[0]['status'] == 'accepted'
        assert (await store.load(game.table.table_id)).checkpoint['data']['phase'] == 'LOCKED'
    finally:
        await host.close()


async def test_fifo_conflict_rejects_departure_then_queue_can_be_left(database):
    _, store, fence, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    other_host = None
    try:
        for user in users[2:4]:
            await table_action(database, game, inbox, lane, 'join-queue', actor=user)
        other_host, other = await host_game(users[2:4], started=False)
        await store.save(capture_checkpoint(other, table_revision=0), expected_revision=None, fence=fence)
        before = await store.load(game.table.table_id)
        assert (await table_action(database, game, inbox, lane, 'leave-seat'))[0]['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        # A queued user seated elsewhere can explicitly leave this queue.
        assert (await table_action(database, game, inbox, lane, 'leave-queue', actor=users[2]))[0]['status'] == 'accepted'
        assert (await table_action(database, game, inbox, lane, 'join-seat', actor=users[2]))[0]['status'] == 'rejected'
    finally:
        await host.close()
        if other_host: await other_host.close()


async def test_promotion_rollback_and_lost_commit_preserve_one_seat_allocation(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        await table_action(database, game, inbox, lane, 'join-queue', actor=users[2])
        before = await store.load(game.table.table_id)
        body = dict(command_id=uuid4().hex, command='leave-seat', match_id=game.match_id,
                    expected_revision=before.checkpoint['data']['table_revision'], payload={})
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('response lost after commit')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await TableLaneExecutor(inbox).execute_one(lane, fence)
        restored, saved = await restore(store, game)
        assert restored.users == [users[1], users[2]] and restored.flush_seats[users[2]] == 3
        events = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await inbox.enqueue(lane, users[0], body)).outcome['status'] == 'accepted'
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == saved
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == events
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['nonmember', 'stale', 'payload', 'full', 'missing_intent', 'expired'])
async def test_invalid_or_unsafe_roster_change_cannot_mutate_finished_round(database, case):
    pool, store, fence, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        saved = await store.load(game.table.table_id)
        actor = users[2] if case in ('nonmember', 'full') else users[0]
        body = dict(command_id=uuid4().hex, command='join-seat' if case == 'full' else 'leave-seat',
            match_id=game.match_id, expected_revision=saved.checkpoint['data']['table_revision'], payload={})
        if case == 'nonmember': await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
        if case == 'stale': body['expected_revision'] -= 1
        if case == 'payload': body['payload'] = {'force': True}
        if case == 'missing_intent': await pool.execute('DELETE FROM game_finalization_jobs')
        if case == 'expired':
            await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        await inbox.enqueue(lane, actor, body)
        if case in ('missing_intent', 'expired'):
            with pytest.raises(StaleGameOwner if case == 'expired' else DurableGameConflict):
                await TableLaneExecutor(inbox).execute_one(lane, fence)
            assert (await inbox.lookup(lane, actor, body['command_id'])).status == 'pending'
        else:
            assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert await store.load(game.table.table_id) == saved
    finally:
        await host.close()
