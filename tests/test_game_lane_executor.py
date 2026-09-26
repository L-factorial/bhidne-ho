"""End-to-end game command execution on production SQL in PostgreSQL/WASM."""
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.executor import GameLaneExecutor
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.models.action import ReliableActionCommand
from test_checkpoint_store import database, host_game, advance
from test_hosted_checkpoints import engine_state


async def setup_game(database, kind='marriage', *, receipt_limit=10000):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, kind)
    await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None,
                           fence=fence, receipt_limit=receipt_limit)
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room', table_id=UUID(game.table.table_id),
                                             game_id=game.durable_game_id))
    return host, game, inbox, lane, GameLaneExecutor(inbox)


def command(game, kind=None, *, expected=None, command_id=None, payload=None):
    state = engine_state(game)
    name = kind or {'marriage': 'DRAW_CARD', 'flush': 'DEAL_CARDS', 'callbreak': 'SHUFFLE_DECK'}[game.game_type]
    actor = (game.users[state.current_player - 1] if game.game_type == 'callbreak'
             else next(u for u in game.users if str(game.flush_seats[u]) == state.config.player_ids[state.current_seat])
             if game.game_type == 'flush' else game.users[state.current_seat])
    request = ReliableActionCommand(match_id=game.match_id, command_id=command_id or uuid4().hex,
        expected_revision=state.revision if expected is None else expected, command=name,
        payload=payload if payload is not None else {'source': 'stock'} if name == 'DRAW_CARD' else {})
    return actor, request.model_dump(mode='json')


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_executes_ordered_commands_and_persists_authorized_events(database, kind):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, kind)
    try:
        original = capture_checkpoint(game, table_revision=0)
        actor, request = command(game)
        first = await inbox.enqueue(lane, actor, request)
        _, stale = command(game)  # Same expected revision: runs AFTER the first.
        await inbox.enqueue(lane, actor, stale)
        result = await executor.execute_one(lane, fence)
        assert result.sequence == first.sequence and result.outcome['status'] == 'accepted'
        loaded = await checkpoints.load(game.table.table_id)
        assert loaded.checkpoint['data']['engine']['revision'] > original['data']['engine']['revision']
        assert capture_checkpoint(game, table_revision=0) == original  # No live host was touched.
        assert len(host.tables['room']) == 1 and host._offer_tasks == {}
        second = await executor.execute_one(lane, fence)
        assert second.sequence == 2 and second.outcome['status'] == 'rejected'
        assert second.outcome['revision'] == result.outcome['revision']
        assert await executor.execute_one(lane, fence) is None
        assert (await inbox.enqueue(lane, actor, request)).outcome == result.outcome
        rows = (await pool.execute('SELECT sequence,event_type,audience_user_id,payload FROM notification_outbox ORDER BY sequence')).rows
        assert [r[0] for r in rows] == list(range(1, len(rows) + 1))
        acknowledgments = [r for r in rows if r[1] == 'ACTION_ACK']
        assert len(acknowledgments) == 2
        assert all(r[2] == UUID(actor[5:]) for r in acknowledgments)
        assert any(r[1] == 'GAME_STATE_CHANGED' and r[2] is None for r in rows)
        assert (await checkpoints.load(game.table.table_id)).receipt_snapshot['receipt_count'] == 2
        if kind == 'marriage':
            private = [r for r in rows if r[2] is not None and r[1] != 'ACTION_ACK']
            assert private
            for row in private:
                seat = int(row[3]['payload']['player_id'])
                assert row[2] == UUID(game.users[seat - 1][5:])
            assert all(r[2] is not None for r in rows if r[1] == 'PLAYER_STATE')
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['spectator', 'membership', 'invalid', 'revision', 'system'])
async def test_execution_reauthorizes_and_rejects_without_engine_effects(database, case):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        before = await checkpoints.load(game.table.table_id)
        actor, request = command(game)
        if case in ('spectator', 'membership'): actor = users[-1]
        if case == 'system': actor = 'system:timer'
        if case == 'revision': request['expected_revision'] = 0
        if case == 'invalid': request['payload'] = {'source': 'invalid'}
        await inbox.enqueue(lane, actor, request)
        if case == 'membership':
            await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
        result = await executor.execute_one(lane, fence)
        assert result.outcome['status'] == 'rejected'
        assert (await checkpoints.load(game.table.table_id)).checkpoint == before.checkpoint
        assert (await pool.execute('SELECT count(*) FROM game_events')).rows == [(0,)]
        assert (await pool.execute("SELECT count(*) FROM notification_outbox WHERE event_type<>'ACTION_ACK'")).rows == [(0,)]
        assert (await inbox.lookup(lane, actor, request['command_id'])).outcome == result.outcome
    finally:
        await host.close()


async def test_rollback_and_unknown_commit_reload_instead_of_replaying(database, monkeypatch):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, 'callbreak')
    try:
        actor, request = command(game)
        await inbox.enqueue(lane, actor, request)
        initial = await checkpoints.load(game.table.table_id)
        outbox = executor._outbox
        async def fail_after_writes(claim, events):
            await outbox(claim, events)
            raise OperationalError('connection lost before commit')
        monkeypatch.setattr(executor, '_outbox', fail_after_writes)
        with pytest.raises(OperationalError): await executor.execute_one(lane, fence)
        assert (await checkpoints.load(game.table.table_id)).checkpoint == initial.checkpoint
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
        assert (await inbox.lookup(lane, actor, request['command_id'])).status == 'pending'
        monkeypatch.setattr(executor, '_outbox', outbox)
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit_response():
            async with transaction(): yield pool
            raise OperationalError('commit succeeded but response lost')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit_response)
            with pytest.raises(OperationalError): await executor.execute_one(lane, fence)
        committed = await checkpoints.load(game.table.table_id)
        event_count = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert await executor.execute_one(lane, fence) is None
        assert (await checkpoints.load(game.table.table_id)).checkpoint == committed.checkpoint
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == event_count
        assert (await pool.execute('SELECT count(*) FROM game_events')).rows == [(1,)]
    finally:
        await host.close()


async def test_terminal_command_queues_finalization_and_following_request_rejects(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        actor, fold = command(game, 'FOLD')
        await inbox.enqueue(lane, actor, fold)
        _, later = command(game)
        await inbox.enqueue(lane, actor, later)
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
        loaded = await checkpoints.load(game.table.table_id)
        assert loaded.checkpoint['data']['phase'] == 'COMPLETED'
        assert loaded.receipt_snapshot['receipt_count'] == 2
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(1,)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
    finally:
        await host.close()


async def test_superseded_match_rejection_does_not_change_new_match(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    new_host, new_game = await host_game(users)
    try:
        actor, queued = command(game)
        await inbox.enqueue(lane, actor, queued)
        receipt = await advance(host, game, command='FOLD')
        await checkpoints.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence, receipt=receipt)
        new_game.table.table_id = game.table.table_id
        new_game.previous_match_id = game.match_id
        new_checkpoint = capture_checkpoint(new_game, table_revision=2)
        await checkpoints.save(new_checkpoint, expected_revision=1, fence=fence)
        rejected = await executor.execute_one(lane, fence)
        assert rejected.outcome['status'] == 'rejected'
        assert (await checkpoints.load(game.table.table_id)).checkpoint == new_checkpoint
        assert (await checkpoints.load(game.table.table_id)).receipt_snapshot['receipt_count'] == 0
    finally:
        await host.close()
        await new_host.close()


async def test_admission_reserves_receipt_capacity_and_fence_is_rechecked(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, receipt_limit=1)
    try:
        actor, first = command(game)
        await inbox.enqueue(lane, actor, first)
        _, second = command(game)
        with pytest.raises(DurableGameConflict, match='receipt admission'):
            await inbox.enqueue(lane, actor, second)
        with pytest.raises(StaleGameOwner): await executor.execute_one(lane, replace(fence, epoch=2))
        assert (await inbox.lookup(lane, actor, first['command_id'])).status == 'pending'
        await executor.execute_one(lane, fence)
        assert (await inbox.enqueue(lane, actor, first)).duplicate
    finally:
        await host.close()


async def test_scheduler_drains_independent_database_lanes_and_paged_discovery(database):
    import asyncio
    from app.durable_games.scheduler import GameLaneScheduler
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    second_host, second = await host_game(users[2:])
    scheduler = GameLaneScheduler(executor, workers=2)
    try:
        await checkpoints.save(capture_checkpoint(second, table_revision=0), expected_revision=None, fence=fence)
        other_lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(second.table.table_id), game_id=second.durable_game_id))
        for target_game, target_lane in ((game, lane), (game, lane), (second, other_lane)):
            actor, request = command(target_game)
            await inbox.enqueue(target_lane, actor, request)
        first_page = await inbox.pending_lanes(room_id='room', kind='game', limit=1)
        next_page = await inbox.pending_lanes(room_id='room', kind='game', limit=1, after_lane_id=first_page[0])
        assert set(first_page + next_page) == {lane, other_lane}
        scheduler.start()
        for lane_id in first_page + next_page: assert scheduler.offer(lane_id, fence)
        await asyncio.wait_for(scheduler.wait_idle(), 4)
        assert not scheduler.failures
        assert await inbox.pending_lanes(room_id='room', kind='game') == ()
        assert (await pool.execute("SELECT count(*) FROM game_commands WHERE status='accepted'")).rows == [(2,)]
        assert (await pool.execute("SELECT count(*) FROM game_commands WHERE status='rejected'")).rows == [(1,)]
    finally:
        await scheduler.stop()
        await host.close()
        await second_host.close()


async def test_cancelled_attempt_rolls_back_and_next_attempt_rebuilds(database, monkeypatch):
    import asyncio
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database)
    try:
        actor, request = command(game)
        await inbox.enqueue(lane, actor, request)
        initial = await checkpoints.load(game.table.table_id)
        entered = asyncio.Event()
        outbox = executor._outbox
        async def pause(claim, events):
            await outbox(claim, events)
            entered.set()
            await asyncio.Event().wait()
        monkeypatch.setattr(executor, '_outbox', pause)
        task = asyncio.create_task(executor.execute_one(lane, fence))
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert (await checkpoints.load(game.table.table_id)).checkpoint == initial.checkpoint
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
        monkeypatch.setattr(executor, '_outbox', outbox)
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
    finally:
        await host.close()


async def test_flush_executes_continuation_and_enqueues_one_round_settlement(database):
    from app.durable_games.recovery import rebuild_hosted_game
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, 'flush')
    try:
        for name in ('DEAL_CARDS', 'SKIP_CUT', 'FOLD'):
            stored = await checkpoints.load(game.table.table_id)
            detached = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot).game
            actor, request = command(detached, name)
            await inbox.enqueue(lane, actor, request)
            assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        stored = await checkpoints.load(game.table.table_id)
        assert stored.checkpoint['data']['phase'] == 'OPEN'
        assert stored.checkpoint['data']['engine']['state']['status'] == 'finished'
        assert stored.receipt_snapshot['receipt_count'] == 3
        assert (await pool.execute('SELECT round_number,job_type FROM game_finalization_jobs')).rows == [(1, 'hosted_settlement')]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
    finally:
        await host.close()
