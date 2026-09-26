"""Atomic active-player departure using production SQL and real game engines."""
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.ownership import RoomWriteFence
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.room_recovery import PostgresRoomRecoveryStore
from app.durable_games.store import DurableGameConflict, StaleGameOwner, _token_hash
from app.models.action import ReliableActionCommand
from app.runtime.command_runtime import request_fingerprint
from test_checkpoint_store import database, GameHost, RoomService, Delivery
from test_game_lane_executor import command


async def setup(database, kind='marriage', count=3, *, prepare=True, receipt_limit=10000):
    pool, store, fence, users = database
    rooms = RoomService()
    for user in users:
        await rooms.join('room', user)
    host = GameHost(rooms, Delivery())
    waiting = await host.create('room', users[0], count, kind)
    for user in users[1:count]:
        await host.join('room', user, waiting['match_id'])
    game = host.games['room']
    if kind == 'marriage':
        game.marriage_scoring = replace(game.marriage_scoring, initial_tunnela_declaration=False)
    if kind != 'callbreak':
        await host.table_command('room', users[0], game.match_id, 'lock')
    await host.start('room', users[0], game.match_id, **({'rules_revision': 0} if kind == 'flush' else {}))
    game.durable_game_id = UUID(game.match_id)
    await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None,
                     fence=fence, receipt_limit=receipt_limit)
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
        table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
    if kind == 'flush' and prepare:
        for name in ('DEAL_CARDS', 'SKIP_CUT'):
            detached, _ = await restore(store, game)
            actor, body = command(detached, name)
            await run(inbox, lane, fence, actor, body)
    return host, game, inbox, lane


async def restore(store, game):
    saved = await store.load(game.table.table_id)
    host = _DetachedHost(8)
    restored = host.game = rebuild_hosted_game(host, saved.checkpoint,
        receipt_snapshot=saved.receipt_snapshot).game
    return restored, saved


async def run(inbox, lane, fence, actor, body):
    await inbox.enqueue(lane, actor, body)
    return (await GameLaneExecutor(inbox).execute_one(lane, fence)).outcome


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_off_turn_departure_recovers_and_releases_at_correct_boundary(database, kind):
    pool, store, fence, users = database
    host, game, inbox, lane = await setup(database, kind)
    try:
        original = capture_checkpoint(game, table_revision=0)
        detached, before = await restore(store, game)
        current, body = command(detached, 'FOLD_AND_LEAVE')
        actor = next(u for u in game.users if u != current)
        result = await run(inbox, lane, fence, actor, body)
        assert result['status'] == 'accepted'
        detached, saved = await restore(store, game)
        data = saved.checkpoint['data']
        assert capture_checkpoint(game, table_revision=0) == original
        receipt = saved.receipt_snapshot['receipts'][-1]
        assert receipt['request'] == body and receipt['outcome'] == result
        assert receipt['fingerprint'] == request_fingerprint(ReliableActionCommand(**body))
        assert data['table_revision'] == before.checkpoint['data']['table_revision'] + 1
        assert data['engine']['revision'] == before.checkpoint['data']['engine']['revision'] + 1
        expected_count = 2 if kind == 'marriage' else 3
        for table in ('active_game_players', 'active_table_players'):
            assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows == [(expected_count,)]
        field = 'departed' if kind == 'marriage' else 'pending_flush_departures'
        assert data['host'][field] == [actor]
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(0,)]
        # Room recovery retains a pending Flush departure and its reservation.
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        inventory = await PostgresRoomRecoveryStore(pool).load(fence, _DetachedHost(8))
        assert len(inventory.tables) == 1
        await pool.execute("UPDATE room_ownership SET runtime_status='serving'")
        # A different command ID cannot let the departed player act or leave again.
        _, later = command(detached, 'FOLD_AND_LEAVE')
        assert (await run(inbox, lane, fence, actor, later))['status'] == 'rejected'
        assert (await store.load(game.table.table_id)).checkpoint == saved.checkpoint
        # An ordinary remaining-player fold finishes the round and releases all pending leavers.
        other, fold = command(detached, 'FOLD')
        assert other != actor
        assert (await run(inbox, lane, fence, other, fold))['status'] == 'accepted'
        finished = await store.load(game.table.table_id)
        assert finished.checkpoint['data']['host']['pending_flush_departures'] == []
        assert actor not in [p['user_id'] for p in finished.checkpoint['data']['positions']]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(1,)]
        assert (await inbox.enqueue(lane, actor, body)).outcome == result
        with pytest.raises(DurableGameConflict, match='different request'):
            await inbox.enqueue(lane, actor, {**body, 'command': 'FOLD'})
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_already_folded_player_leaves_without_second_engine_transition(database, kind):
    pool, store, fence, _ = database
    host, game, inbox, lane = await setup(database, kind)
    try:
        detached, _ = await restore(store, game)
        actor, fold = command(detached, 'FOLD')
        assert (await run(inbox, lane, fence, actor, fold))['status'] == 'accepted'
        detached, before = await restore(store, game)
        journal = (await pool.execute('SELECT current_sequence FROM games')).rows
        _, body = command(detached, 'FOLD_AND_LEAVE')
        outcome = await run(inbox, lane, fence, actor, body)
        assert outcome['status'] == 'accepted'
        after = await store.load(game.table.table_id)
        assert after.checkpoint['data']['engine'] == before.checkpoint['data']['engine']
        assert (await pool.execute('SELECT current_sequence FROM games')).rows == journal
        assert after.receipt_snapshot['receipt_count'] == before.receipt_snapshot['receipt_count'] + 1
        assert after.receipt_snapshot['receipts'][-1]['request'] == body
        field = 'departed' if kind == 'marriage' else 'pending_flush_departures'
        assert after.checkpoint['data']['host'][field] == [actor]
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_terminal_departure_rolls_back_and_unknown_commit_preserves_one_settlement(database, kind, monkeypatch):
    pool, store, fence, _ = database
    host, game, inbox, lane = await setup(database, kind, count=2)
    try:
        detached, before = await restore(store, game)
        actor, body = command(detached, 'FOLD_AND_LEAVE')
        await inbox.enqueue(lane, actor, body)
        notifications = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        with pytest.raises(DurableGameConflict, match='event batch'):
            await GameLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == notifications
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(2,)]
        assert (await inbox.lookup(lane, actor, body['command_id'])).status == 'pending'
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('commit response lost')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError):
                await GameLaneExecutor(inbox).execute_one(lane, fence)
        detached, saved = await restore(store, game)
        assert saved.checkpoint['data']['phase'] == ('COMPLETED' if kind == 'marriage' else 'OPEN')
        assert actor not in [p['user_id'] for p in saved.checkpoint['data']['positions']]
        assert saved.checkpoint['data']['host']['pending_flush_departures'] == []
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows == [(1,)]
        assert (await pool.execute('SELECT round_number FROM game_finalization_jobs')).rows == [(0 if kind == 'marriage' else 1,)]
        assert (await pool.execute('SELECT original_request FROM game_commands WHERE command_id=%s', (body['command_id'],))).rows == [(body,)]
        notifications = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await inbox.enqueue(lane, actor, body)).outcome['status'] == 'accepted'
        assert await GameLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == saved
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == notifications
        if kind == 'marriage':
            private = (await pool.execute("SELECT audience_user_id,payload FROM notification_outbox WHERE event_type='PLAYER_STATE'")).rows
            assert private
            for recipient, message in private:
                assert recipient == UUID(game.users[int(message['payload']['player_id']) - 1][5:])
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['payload', 'stale', 'spectator', 'nonmember', 'system', 'callbreak', 'flush_preparation'])
async def test_invalid_departure_commits_only_rejection(database, case):
    pool, store, fence, users = database
    kind = 'callbreak' if case == 'callbreak' else 'flush' if case == 'flush_preparation' else 'marriage'
    host, game, inbox, lane = await setup(database, kind, 4 if kind == 'callbreak' else 3, prepare=False)
    try:
        detached, before = await restore(store, game)
        actor, body = command(detached, 'FOLD_AND_LEAVE')
        if case == 'payload': body['payload'] = {'force': True}
        if case == 'stale': body['expected_revision'] += 1
        if case in ('spectator', 'nonmember'): actor = users[-1]
        if case == 'system': actor = 'system:timer'
        await inbox.enqueue(lane, actor, body)
        if case == 'nonmember':
            await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
        result = await GameLaneExecutor(inbox).execute_one(lane, fence)
        assert result.outcome['status'] == 'rejected'
        after = await store.load(game.table.table_id)
        assert after.checkpoint == before.checkpoint
        assert after.receipt_snapshot['receipts'][-1]['request'] == body
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(0,)]
        assert (await pool.execute("SELECT count(*) FROM notification_outbox WHERE event_type<>'ACTION_ACK'")).rows == [(0,)]
    finally:
        await host.close()


async def test_takeover_executes_pending_departure_without_consuming_extra_receipt_capacity(database):
    pool, store, fence, _ = database
    host, game, inbox, lane = await setup(database, receipt_limit=1)
    try:
        detached, before = await restore(store, game)
        actor, body = command(detached, 'FOLD_AND_LEAVE')
        await inbox.enqueue(lane, actor, body)
        with pytest.raises(DurableGameConflict, match='receipt admission limit'):
            await inbox.enqueue(lane, actor, {**body, 'command_id': uuid4().hex})
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        with pytest.raises(StaleGameOwner):
            await GameLaneExecutor(inbox).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await inbox.lookup(lane, actor, body['command_id'])).status == 'pending'
        successor = RoomWriteFence('room', 'two', 2, 'successor-secret')
        await pool.execute("INSERT INTO server_instances(instance_id,internal_address) VALUES ('two','two')")
        await pool.execute('''UPDATE room_ownership SET owner_instance_id='two',ownership_epoch=2,
            fencing_token_hash=%s,lease_expires_at=clock_timestamp()+interval '1 hour' ''',
            (_token_hash(successor.token),))
        with pytest.raises(StaleGameOwner):
            await GameLaneExecutor(inbox).execute_one(lane, fence)
        assert (await GameLaneExecutor(inbox).execute_one(lane, successor)).outcome['status'] == 'accepted'
        assert (await inbox.enqueue(lane, actor, body)).outcome['status'] == 'accepted'
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_queued_action_is_rejected_after_departure_even_with_current_revision(database, kind):
    _, store, fence, _ = database
    host, game, inbox, lane = await setup(database, kind)
    try:
        detached, _ = await restore(store, game)
        actor, leave = command(detached, 'FOLD_AND_LEAVE')
        _, later = command(detached, 'FOLD_AND_LEAVE', expected=leave['expected_revision'] + 1)
        first = await inbox.enqueue(lane, actor, leave)
        second = await inbox.enqueue(lane, actor, later)
        executor = GameLaneExecutor(inbox)
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        result = await executor.execute_one(lane, fence)
        assert result.sequence == first.sequence + 1 == second.sequence
        assert result.outcome['status'] == 'rejected'
        assert ('left this seat' if kind == 'marriage' else 'Take a seat') in result.outcome['detail']
        assert (await store.load(game.table.table_id)).checkpoint == saved.checkpoint
    finally:
        await host.close()
