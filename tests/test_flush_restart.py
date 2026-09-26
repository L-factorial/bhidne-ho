"""Flush rollover keeps hosted identity and receipts while isolating round journals."""
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError
from psycopg.errors import CheckViolation

from app.durable_games.checkpoints import capture_checkpoint, decode_checkpoint
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.flush_restart import round_id
from app.durable_games.inbox import LaneTarget
from app.durable_games.room_recovery import PostgresRoomRecoveryStore, UnsupportedRecoveryWork
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database
from test_game_departure import setup, restore, run
from test_game_lane_executor import command


async def finished(database, *, count=2, leave=False, receipt_limit=10000, queue_followup=False):
    pool, store, fence, users = database
    host, game, inbox, old_lane = await setup(database, 'flush', count, receipt_limit=receipt_limit)
    detached, _ = await restore(store, game)
    actor, fold = command(detached, 'FOLD_AND_LEAVE' if leave else 'FOLD')
    if queue_followup:
        await inbox.enqueue(old_lane, actor, fold)
        await inbox.enqueue(old_lane, actor, {**fold, 'command_id': uuid4().hex,
            'expected_revision': fold['expected_revision'] + 1})
        assert (await GameLaneExecutor(inbox).execute_one(old_lane, fence)).outcome['status'] == 'accepted'
    else:
        assert (await run(inbox, old_lane, fence, actor, fold))['status'] == 'accepted'
    if count == 3:
        detached, _ = await restore(store, game)
        actor, fold = command(detached, 'FOLD')
        assert (await run(inbox, old_lane, fence, actor, fold))['status'] == 'accepted'
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
    return host, game, inbox, lane, old_lane, actor, fold


async def table_action(database, game, inbox, lane, name, *, actor=None, payload=None):
    _, store, fence, users = database
    saved = await store.load(game.table.table_id)
    body = dict(command_id=uuid4().hex, command=name, match_id=game.match_id,
        expected_revision=saved.checkpoint['data']['table_revision'],
        payload=payload if payload is not None else {'rules_revision': 0} if name == 'start' else {})
    await inbox.enqueue(lane, actor or users[0], body)
    result = await TableLaneExecutor(inbox).execute_one(lane, fence)
    return result.outcome, body


async def current_lane(inbox, game):
    return await inbox.ensure_lane(LaneTarget(kind='game', room_id=game.room_id,
        table_id=UUID(game.table.table_id), game_id=game.durable_game_id))


async def test_two_restarts_preserve_match_history_receipts_and_distinct_archives(database):
    pool, store, fence, users = database
    host, game, inbox, lane, old_lane, actor, original_fold = await finished(database)
    try:
        ids = {game.durable_game_id}
        for round_number in (2, 3):
            _, complete = await restore(store, game)
            previous_id = UUID(complete.checkpoint['data']['host']['durable_game_id'])
            timestamp = (await pool.execute('SELECT completed_at FROM games WHERE id=%s', (previous_id,))).rows
            assert (await table_action(database, game, inbox, lane, 'lock'))[0]['status'] == 'accepted'
            _, locked = await restore(store, game)
            outcome, start = await table_action(database, game, inbox, lane, 'start')
            assert outcome['status'] == 'accepted'
            detached, saved = await restore(store, game)
            state = detached.flush_target.adapter.checkpoint().get_state()
            assert state.round_number == round_number and state.status.value == 'awaiting_deal'
            assert state.revision == locked.checkpoint['data']['engine']['revision'] + 1
            assert state.round_start_revision == state.revision
            assert state.config.dealer_id == locked.checkpoint['data']['engine']['state']['settlement']['winner_ids'][0]
            assert detached.match_id == game.match_id and detached.table.table_id == game.table.table_id
            assert detached.durable_game_id == round_id(lane, users[0], start['command_id'], previous_id)
            assert detached.durable_game_id not in ids
            ids.add(detached.durable_game_id)
            assert saved.receipt_snapshot['receipts'] == locked.receipt_snapshot['receipts']
            assert (await pool.execute('SELECT current_sequence FROM games WHERE id=%s', (detached.durable_game_id,))).rows == [(0,)]
            archive = (await pool.execute('SELECT checkpoint FROM hosted_match_archives WHERE game_id=%s', (previous_id,))).rows[0][0]
            assert archive == locked.checkpoint
            assert decode_checkpoint(archive).record.data.engine.state['round_number'] == round_number - 1
            assert (await pool.execute('SELECT completed_at FROM games WHERE id=%s', (previous_id,))).rows == timestamp
            assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(2,)]
            assert (await inbox.enqueue(lane, users[0], start)).outcome == outcome
            assert (await table_action(database, game, inbox, lane, 'start'))[0]['status'] == 'rejected'
            assert await store.load(game.table.table_id) == saved
            new_lane = await current_lane(inbox, detached)
            # A retry arriving at a later round still resolves its original outcome.
            retry = await inbox.enqueue(new_lane, actor, original_fold)
            assert retry.lane_id == old_lane and retry.outcome['status'] == 'accepted'
            with pytest.raises(DurableGameConflict, match='different request'):
                await inbox.enqueue(new_lane, actor, {**original_fold, 'payload': {'changed': True}})
            for name in ('DEAL_CARDS', 'SKIP_CUT', 'FOLD'):
                detached, _ = await restore(store, game)
                player, body = command(detached, name)
                assert (await run(inbox, new_lane, fence, player, body))['status'] == 'accepted'
        assert (await pool.execute('SELECT count(*) FROM hosted_match_archives WHERE match_id=%s', (UUID(game.match_id),))).rows == [(2,)]
        assert (await pool.execute('SELECT round_number FROM game_finalization_jobs ORDER BY round_number')).rows == [(1,), (2,), (3,)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
        with pytest.raises(CheckViolation, match='immutable'):
            await pool.execute('DELETE FROM hosted_match_archives')
    finally:
        await host.close()


async def test_restart_rollback_and_unknown_commit_do_not_duplicate_round_or_events(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        await table_action(database, game, inbox, lane, 'lock')
        _, before = await restore(store, game)
        body = dict(command_id=uuid4().hex, command='start', match_id=game.match_id,
                    expected_revision=before.checkpoint['data']['table_revision'], payload={'rules_revision': 0})
        await inbox.enqueue(lane, users[0], body)
        events = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM hosted_match_archives')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(1,)]
        assert (await pool.execute("SELECT count(*) FROM command_lanes WHERE kind='game'")).rows == [(1,)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == events
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('commit response lost')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await TableLaneExecutor(inbox).execute_one(lane, fence)
        _, committed = await restore(store, game)
        events = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await inbox.enqueue(lane, users[0], body)).outcome['status'] == 'accepted'
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == committed
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == events
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(2,)]
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['unlocked', 'actor', 'rules', 'payload', 'stale', 'missing_intent', 'expired'])
async def test_invalid_or_unsafe_restart_cannot_create_round(database, case):
    pool, store, fence, users = database
    host, game, inbox, lane, _, _, _ = await finished(database)
    try:
        if case != 'unlocked': await table_action(database, game, inbox, lane, 'lock')
        _, before = await restore(store, game)
        body = dict(command_id=uuid4().hex, command='start', match_id=game.match_id,
                    expected_revision=before.checkpoint['data']['table_revision'], payload={'rules_revision': 0})
        actor = users[1] if case == 'actor' else users[0]
        if case == 'rules': body['payload']['rules_revision'] = 42
        if case == 'payload': body['payload']['play_mode'] = 'automatic'
        if case == 'stale': body['expected_revision'] -= 1
        await inbox.enqueue(lane, actor, body)
        if case == 'missing_intent': await pool.execute('DELETE FROM game_finalization_jobs')
        if case == 'expired':
            await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        if case in ('missing_intent', 'expired'):
            with pytest.raises(StaleGameOwner if case == 'expired' else DurableGameConflict):
                await TableLaneExecutor(inbox).execute_one(lane, fence)
            assert (await inbox.lookup(lane, actor, body['command_id'])).status == 'pending'
        else:
            assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(1,)]
        assert (await pool.execute('SELECT count(*) FROM hosted_match_archives')).rows == [(0,)]
    finally:
        await host.close()


async def test_restart_preserves_departure_and_stable_seat_mapping(database):
    pool, store, fence, _ = database
    host, game, inbox, lane, _, _, _ = await finished(database, count=3, leave=True)
    try:
        detached, before = await restore(store, game)
        remaining = list(detached.users)
        seats = tuple(str(detached.flush_seats[u]) for u in remaining)
        assert len(remaining) == 2
        assert (await table_action(database, game, inbox, lane, 'lock', actor=remaining[0]))[0]['status'] == 'accepted'
        assert (await table_action(database, game, inbox, lane, 'start', actor=remaining[0]))[0]['status'] == 'accepted'
        detached, after = await restore(store, game)
        assert detached.users == remaining
        assert detached.flush_target.adapter.checkpoint().get_state().config.player_ids == seats
        assert after.checkpoint['data']['host']['flush_seats'] == before.checkpoint['data']['host']['flush_seats']
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(2,)]
    finally:
        await host.close()


@pytest.mark.parametrize('pending', [False, True])
async def test_receipt_limit_is_not_reset_by_round_restart(database, pending):
    pool, store, _, _ = database
    host, game, inbox, lane, _, _, _ = await finished(database, receipt_limit=4 if pending else 3,
                                                   queue_followup=pending)
    try:
        await table_action(database, game, inbox, lane, 'lock')
        before = await store.load(game.table.table_id)
        outcome, _ = await table_action(database, game, inbox, lane, 'start')
        assert outcome['status'] == 'rejected' and 'receipt limit' in outcome['detail']
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(1,)]
    finally:
        await host.close()


async def test_new_round_recovery_keeps_old_settlement_and_both_game_lanes(database):
    pool, store, fence, _ = database
    host, game, inbox, lane, old_lane, _, _ = await finished(database)
    try:
        await table_action(database, game, inbox, lane, 'lock')
        await table_action(database, game, inbox, lane, 'start')
        detached, saved = await restore(store, game)
        new_lane = await current_lane(inbox, detached)
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        with pytest.raises(UnsupportedRecoveryWork):
            await PostgresRoomRecoveryStore(pool).load(fence, _DetachedHost(8))
        def validate(job):
            assert job.game_id == game.durable_game_id and job.round_number == 1
        loader = PostgresRoomRecoveryStore(pool, finalization_validators={('hosted_settlement', 1): validate})
        inventory = await loader.load(fence, _DetachedHost(8))
        assert inventory.tables[0].stored == saved
        assert {item.lane_id for item in inventory.lanes if item.kind == 'game'} == {old_lane, new_lane}
        assert len(inventory.finalization) == 1
    finally:
        await host.close()


async def test_pending_old_round_request_rejects_after_restart_without_changing_new_engine(database):
    pool, store, fence, users = database
    host, game, inbox, old_lane = await setup(database, 'flush', 2)
    try:
        detached, _ = await restore(store, game)
        actor, fold = command(detached, 'FOLD')
        _, later = command(detached, 'FOLD', expected=fold['expected_revision'] + 1)
        await inbox.enqueue(old_lane, actor, fold)
        await inbox.enqueue(old_lane, actor, later)
        assert (await GameLaneExecutor(inbox).execute_one(old_lane, fence)).outcome['status'] == 'accepted'
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        await table_action(database, game, inbox, lane, 'lock')
        assert (await table_action(database, game, inbox, lane, 'start'))[0]['status'] == 'accepted'
        detached, before = await restore(store, game)
        new_lane = await current_lane(inbox, detached)
        assert (await GameLaneExecutor(inbox).execute_one(old_lane, fence)).outcome['status'] == 'rejected'
        after = await store.load(game.table.table_id)
        assert after.checkpoint == before.checkpoint
        assert after.receipt_snapshot['receipt_count'] == before.receipt_snapshot['receipt_count'] + 1
        assert (await inbox.enqueue(new_lane, actor, later)).outcome['status'] == 'rejected'
        with pytest.raises(DurableGameConflict, match='no longer'):
            await inbox.enqueue(old_lane, actor, {**later, 'command_id': uuid4().hex})
    finally:
        await host.close()
