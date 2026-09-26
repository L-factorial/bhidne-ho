"""Durable lobby transitions, ordered receipts, reservations and atomic outbox."""
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database, host_game


@pytest.fixture
async def lobby(database):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, started=False)
    await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
    try:
        yield pool, checkpoints, fence, users, host, game, inbox, lane, TableLaneExecutor(inbox)
    finally:
        await host.close()


def request(game, command, revision, **changes):
    return dict(command_id=uuid4().hex, command=command, expected_revision=revision,
                match_id=game.match_id, payload={}, **changes)


async def execute(lobby, actor, command, revision):
    _, _, fence, _, _, game, inbox, lane, executor = lobby
    body = request(game, command, revision)
    await inbox.enqueue(lane, actor, body)
    return await executor.execute_one(lane, fence), body


async def test_queue_departure_promotes_fifo_and_commits_reservations(lobby):
    pool, checkpoints, _, users, host, game, _, _, _ = lobby
    before = capture_checkpoint(game, table_revision=0)
    for revision, actor, command in [(0, users[2], 'join-queue'), (1, users[3], 'join-queue'),
                                      (2, users[0], 'leave-seat')]:
        result, _ = await execute(lobby, actor, command, revision)
        assert result.outcome['status'] == 'accepted'
    stored = await checkpoints.load(game.table.table_id)
    data = stored.checkpoint['data']
    assert data['host']['users'] == [users[1], users[2]] and data['positions'][-1]['user_id'] == users[3]
    assert data['table_revision'] == 3 and stored.receipt_snapshot['receipt_count'] == 0
    assert (await pool.execute('SELECT user_id FROM active_table_players ORDER BY user_id')).rows == [
        (UUID(users[1][5:]),), (UUID(users[2][5:]),)]
    assert capture_checkpoint(game, table_revision=0) == before  # Detached executor never mutates live host.
    assert host.games['room'] is game
    assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows[0][0] >= 6


async def test_lock_authorization_stale_revision_and_duplicate_receipt(lobby):
    pool, checkpoints, fence, users, _, game, inbox, lane, executor = lobby
    denied, _ = await execute(lobby, users[1], 'lock', 0)
    assert denied.outcome['status'] == 'rejected' and denied.outcome['revision'] == 0
    locked, body = await execute(lobby, users[0], 'lock', 0)
    assert locked.outcome['status'] == 'accepted'
    duplicate = await inbox.enqueue(lane, users[0], body)
    assert duplicate.duplicate and duplicate.outcome == locked.outcome
    assert await executor.execute_one(lane, fence) is None
    stale, _ = await execute(lobby, users[0], 'lock', 0)
    assert stale.outcome['status'] == 'rejected'
    leaving, _ = await execute(lobby, users[0], 'leave-seat', 1)
    assert leaving.outcome['status'] == 'rejected'
    saved = await checkpoints.load(game.table.table_id)
    assert saved.checkpoint['data']['phase'] == 'LOCKED'
    assert saved.checkpoint['data']['table_revision'] == 1
    assert (await pool.execute('SELECT count(*) FROM game_commands')).rows == [(0,)]


async def test_join_seat_and_close_last_seat_release_table_allocation(lobby):
    pool, checkpoints, _, users, _, game, _, _, _ = lobby
    for revision, actor, command in [(0, users[0], 'leave-seat'), (1, users[2], 'join-seat'),
                                      (2, users[1], 'leave-seat'), (3, users[2], 'leave-seat')]:
        result, _ = await execute(lobby, actor, command, revision)
        assert result.outcome['status'] == 'accepted'
    saved = await checkpoints.load(game.table.table_id)
    assert saved.checkpoint['data']['host']['ended']
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(0,)]
    rejected, _ = await execute(lobby, users[0], 'join-seat', 4)
    assert rejected.outcome['status'] == 'rejected'


@pytest.mark.parametrize('actor', ['system:timer', 'missing', 'nonmember', 'unknown_uuid'])
async def test_execution_rechecks_actor_and_membership(lobby, actor):
    pool, _, _, users, _, _, _, _, _ = lobby
    if actor == 'nonmember':
        actor = users[-1]
        await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
    elif actor == 'unknown_uuid':
        actor = f'user-{uuid4()}'
    result, _ = await execute(lobby, actor, 'join-queue', 0)
    assert result.outcome['status'] == 'rejected' and result.outcome['revision'] == 0


async def test_full_table_and_invalid_match_revision_payload_are_no_effect_rejections(lobby):
    _, checkpoints, fence, users, _, game, inbox, lane, executor = lobby
    bodies = [request(game, 'join-seat', 0), request(game, 'lock', None)]
    wrong = request(game, 'lock', 0)
    wrong['match_id'] = uuid4().hex
    bodies.append(wrong)
    payload = request(game, 'lock', 0)
    payload['payload'] = {'ignored': True}
    bodies.append(payload)
    for body in bodies:
        await inbox.enqueue(lane, users[2] if body['command'] == 'join-seat' else users[0], body)
        result = await executor.execute_one(lane, fence)
        assert result.outcome['status'] == 'rejected'
    assert (await checkpoints.load(game.table.table_id)).checkpoint['data']['table_revision'] == 0


async def test_unsupported_commands_stay_pending_and_old_fence_cannot_execute(lobby):
    pool, _, fence, users, _, game, inbox, lane, executor = lobby
    body = request(game, 'advance-game-timer', 0)
    await inbox.enqueue(lane, users[0], body)
    with pytest.raises(DurableGameConflict): await executor.execute_one(lane, fence)
    assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    with pytest.raises(StaleGameOwner): await executor.execute_one(lane, fence)


async def test_outbox_failure_rolls_back_checkpoint_positions_and_lane(lobby):
    pool, checkpoints, fence, users, _, game, inbox, lane, _ = lobby
    body = request(game, 'leave-seat', 0)
    await inbox.enqueue(lane, users[0], body)
    # The mutation produces more than one event. Failure occurs after checkpoint save.
    with pytest.raises(DurableGameConflict, match='event batch'):
        await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
    assert (await checkpoints.load(game.table.table_id)).checkpoint['data']['table_revision'] == 0
    assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
    assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
    assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows == [(2,)]


async def test_cross_table_reservation_prevents_seating_or_queue_admission(lobby):
    _, checkpoints, fence, users, _, _, _, _, _ = lobby
    other_host, other = await host_game(users[2:4], started=False)
    try:
        await checkpoints.save(capture_checkpoint(other, table_revision=0), expected_revision=None, fence=fence)
        result, _ = await execute(lobby, users[2], 'join-queue', 0)
        assert result.outcome['status'] == 'rejected'
    finally:
        await other_host.close()


async def test_lost_commit_response_resolves_original_receipt_without_repeating_effect(lobby):
    pool, checkpoints, fence, users, _, game, inbox, lane, _ = lobby
    body = request(game, 'leave-seat', 0)
    await inbox.enqueue(lane, users[0], body)
    class LostCommit:
        @asynccontextmanager
        async def connection(self):
            class Connection:
                def __getattr__(self, name): return getattr(pool, name)
                @asynccontextmanager
                async def transaction(self):
                    async with pool.transaction(): yield
                    raise OperationalError('response lost after commit')
            yield Connection()
    with pytest.raises(OperationalError):
        await TableLaneExecutor(PostgresInboxStore(LostCommit())).execute_one(lane, fence)
    count = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
    duplicate = await inbox.enqueue(lane, users[0], body)
    assert duplicate.duplicate and duplicate.outcome['status'] == 'accepted'
    assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
    assert (await checkpoints.load(game.table.table_id)).checkpoint['data']['table_revision'] == 1
    assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == count


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_lobby_roster_changes_preserve_each_games_seat_mapping(database, kind):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, kind, started=False)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        executor = TableLaneExecutor(inbox)
        for revision, actor, command in [(0, users[-1], 'join-queue'), (1, users[0], 'leave-seat')]:
            await inbox.enqueue(lane, actor, request(game, command, revision))
            assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        saved = (await checkpoints.load(game.table.table_id)).checkpoint['data']
        assert users[0] not in saved['host']['users'] and saved['host']['users'][-1] == users[-1]
        assert saved['engine'] is None and not any(p['queue_position'] for p in saved['positions'])
        await inbox.enqueue(lane, users[1], request(game, 'lock', 2))
        result = await executor.execute_one(lane, fence)
        assert result.outcome['status'] == ('rejected' if kind == 'callbreak' else 'accepted')
    finally:
        await host.close()


async def test_leave_queue_compacts_positions_and_targets_ack_to_actor(lobby):
    pool, checkpoints, _, users, _, game, _, _, _ = lobby
    await execute(lobby, users[2], 'join-queue', 0)
    await execute(lobby, users[3], 'join-queue', 1)
    result, body = await execute(lobby, users[2], 'leave-queue', 2)
    assert result.outcome['status'] == 'accepted'
    data = (await checkpoints.load(game.table.table_id)).checkpoint['data']
    queued = [p for p in data['positions'] if p['queue_position'] is not None]
    assert queued == [{'user_id': users[3], 'seat': None, 'queue_position': 1}]
    rows = (await pool.execute("SELECT audience_user_id FROM notification_outbox WHERE payload->>'command_id'=%s",
                               (body['command_id'],))).rows
    assert rows == [(UUID(users[2][5:]),)]


async def test_promotion_conflict_rolls_back_departure_and_keeps_fifo(lobby):
    _, checkpoints, fence, users, _, game, _, _, _ = lobby
    await execute(lobby, users[2], 'join-queue', 0)
    other_host, other = await host_game(users[2:4], started=False)
    try:
        await checkpoints.save(capture_checkpoint(other, table_revision=0), expected_revision=None, fence=fence)
        result, _ = await execute(lobby, users[0], 'leave-seat', 1)
        assert result.outcome['status'] == 'rejected'
        data = (await checkpoints.load(game.table.table_id)).checkpoint['data']
        assert data['table_revision'] == 1 and users[0] in data['host']['users']
        assert data['positions'][-1]['user_id'] == users[2]
    finally:
        await other_host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush', 'callbreak'])
async def test_active_game_seating_is_rejected_without_blocking_lane(database, kind):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, kind)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        body = request(game, 'join-seat', 0)
        await inbox.enqueue(lane, users[-1], body)
        result = await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert result.outcome['status'] == 'rejected'
        assert (await inbox.lookup(lane, users[-1], body['command_id'])).status == 'rejected'
    finally:
        await host.close()


async def test_rotation_roster_is_not_treated_as_an_ordinary_lobby(lobby):
    _, checkpoints, fence, users, _, game, inbox, lane, executor = lobby
    game.table.next_seats = list(game.users)
    await checkpoints.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence)
    body = request(game, 'leave-seat', 1)
    await inbox.enqueue(lane, users[0], body)
    with pytest.raises(DurableGameConflict): await executor.execute_one(lane, fence)
    assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
