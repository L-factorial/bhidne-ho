"""Durable table start through real SQL, detached engines and game-lane continuation."""
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database, host_game
from test_game_lane_executor import command


async def lobby(database, kind):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, kind, started=False)
    if kind != 'callbreak':
        await host.table_command('room', users[0], game.match_id, 'lock')
    await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
    body = {'command_id': uuid4().hex, 'command': 'start', 'match_id': game.match_id,
            'expected_revision': 0, 'payload': {'rules_revision': 0} if kind == 'flush' else {}}
    return host, game, inbox, lane, body


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_initial_start_commits_recoverable_engine_and_continues_game_lane(database, kind):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, body = await lobby(database, kind)
    try:
        before = capture_checkpoint(game, table_revision=0)
        await inbox.enqueue(lane, users[0], body)
        result = await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert result.outcome['status'] == 'accepted' and result.outcome['revision'] == 1
        stored = await checkpoints.load(game.table.table_id)
        data = stored.checkpoint['data']
        assert data['phase'] == 'STARTED' and UUID(data['host']['durable_game_id']) == UUID(game.match_id)
        assert stored.receipt_snapshot['receipt_count'] == 0
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(len(game.users),)]
        assert (await pool.execute('SELECT current_sequence FROM games')).rows == [(0,)]
        assert (await pool.execute("SELECT count(*) FROM notification_outbox WHERE event_type='GAME_STATE_CHANGED'")).rows == [(1,)]
        if kind == 'marriage':
            rows = (await pool.execute("SELECT audience_user_id,payload FROM notification_outbox WHERE event_type='PLAYER_STATE'")).rows
            assert rows
            for audience, message in rows:
                assert audience == UUID(game.users[int(message['payload']['player_id']) - 1][5:])
        assert capture_checkpoint(game, table_revision=0) == before
        game_lane = (await pool.execute("SELECT lane_id FROM command_lanes WHERE kind='game'")).rows[0][0]
        recovered_host = _DetachedHost(8)
        rebuilt = recovered_host.game = rebuild_hosted_game(recovered_host, stored.checkpoint,
            receipt_snapshot=stored.receipt_snapshot).game
        actor, action = command(rebuilt)
        await inbox.enqueue(game_lane, actor, action)
        assert (await GameLaneExecutor(inbox).execute_one(game_lane, fence)).outcome['status'] == 'accepted'
        assert (await inbox.enqueue(lane, users[0], body)).outcome == result.outcome
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_new_start_request_never_redeals_an_already_started_match(database, kind):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, body = await lobby(database, kind)
    try:
        await inbox.enqueue(lane, users[0], body)
        executor = TableLaneExecutor(inbox)
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        before = await checkpoints.load(game.table.table_id)
        await inbox.enqueue(lane, users[0], {**body, 'command_id': uuid4().hex, 'expected_revision': 1})
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert await checkpoints.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(1,)]
    finally:
        await host.close()


@pytest.mark.parametrize('failure', ['actor', 'revision', 'match', 'mode', 'extra', 'rules_revision'])
async def test_start_rejections_do_not_create_engines(database, failure):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, body = await lobby(database, 'flush')
    actor = users[0]
    try:
        if failure == 'actor': actor = users[1]
        elif failure == 'revision': body['expected_revision'] = 10
        elif failure == 'match': body['match_id'] = uuid4().hex
        elif failure == 'mode': body['payload']['play_mode'] = 'automatic'
        elif failure == 'extra': body['payload']['extra'] = True
        else: body['payload']['rules_revision'] = 2
        await inbox.enqueue(lane, actor, body)
        outcome = (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome
        assert outcome['status'] == 'rejected' and outcome['revision'] == 0
        assert (await checkpoints.load(game.table.table_id)).checkpoint['data']['engine'] is None
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(0,)]
        assert (await pool.execute("SELECT count(*) FROM command_lanes WHERE kind='game'")).rows == [(0,)]
    finally:
        await host.close()


async def test_start_requires_roster_lock(database):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, 'marriage', started=False)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        body = {'command_id': 'start', 'command': 'start', 'match_id': game.match_id, 'expected_revision': 0, 'payload': {}}
        await inbox.enqueue(lane, users[0], body)
        result = await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert result.outcome['status'] == 'rejected' and 'Lock' in result.outcome['detail']
    finally:
        await host.close()


async def test_outbox_failure_rolls_back_engine_lane_and_reservations(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, body = await lobby(database, 'marriage')
    try:
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        for table in ('games', 'game_snapshots', 'active_game_players', 'notification_outbox'):
            assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows == [(0,)]
        assert (await checkpoints.load(game.table.table_id)).checkpoint['data']['engine'] is None
        assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    finally:
        await host.close()


async def test_lost_commit_response_preserves_exact_random_engine_state(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, body = await lobby(database, 'marriage')
    class LostCommit:
        @asynccontextmanager
        async def connection(self):
            class Connection:
                def __getattr__(self, name): return getattr(pool, name)
                @asynccontextmanager
                async def transaction(self):
                    async with pool.transaction(): yield
                    raise OperationalError('commit response lost')
            yield Connection()
    try:
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(OperationalError):
            await TableLaneExecutor(PostgresInboxStore(LostCommit())).execute_one(lane, fence)
        stored = await checkpoints.load(game.table.table_id)
        events = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await inbox.enqueue(lane, users[0], body)).outcome['status'] == 'accepted'
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await checkpoints.load(game.table.table_id) == stored
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == events
    finally:
        await host.close()


async def test_old_owner_cannot_start(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, body = await lobby(database, 'marriage')
    try:
        await inbox.enqueue(lane, users[0], body)
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        with pytest.raises(StaleGameOwner): await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert (await checkpoints.load(game.table.table_id)).checkpoint['data']['engine'] is None
    finally:
        await host.close()


async def test_creation_seating_start_and_gameplay_share_durable_identities(database):
    from app.durable_games.creation_executor import RoomCreationExecutor
    pool, checkpoints, fence, users = database
    inbox = PostgresInboxStore(pool)
    room_lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
    await inbox.enqueue(room_lane, users[0], {'command_id': 'create', 'command': 'create-table',
        'payload': {'game_type': 'callbreak', 'capacity': 4, 'name': 'Players'}})
    created = (await RoomCreationExecutor(inbox).execute_one(room_lane, fence)).outcome
    table_lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(created['table_id'])))
    executor = TableLaneExecutor(inbox)
    def body(cmd, revision, cid):
        return {'command_id': cid, 'command': cmd, 'match_id': created['match_id'],
                'expected_revision': revision, 'payload': {}}
    await inbox.enqueue(table_lane, users[0], body('start', 0, 'early'))
    assert (await executor.execute_one(table_lane, fence)).outcome['status'] == 'rejected'
    for revision, actor in enumerate(users[1:4]):
        await inbox.enqueue(table_lane, actor, body('join-seat', revision, f'join-{revision}'))
        assert (await executor.execute_one(table_lane, fence)).outcome['status'] == 'accepted'
    await inbox.enqueue(table_lane, users[0], body('start', 3, 'start'))
    assert (await executor.execute_one(table_lane, fence)).outcome['status'] == 'accepted'
    saved = await checkpoints.load(created['table_id'])
    host = _DetachedHost(8)
    game = host.game = rebuild_hosted_game(host, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
    assert str(game.durable_game_id) == str(UUID(created['match_id']))
    game_lane = (await pool.execute("SELECT lane_id FROM command_lanes WHERE kind='game'")).rows[0][0]
    actor, action = command(game)
    await inbox.enqueue(game_lane, actor, action)
    assert (await GameLaneExecutor(inbox).execute_one(game_lane, fence)).outcome['status'] == 'accepted'
    assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
    assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(4,)]


async def test_pending_rule_approval_prevents_initial_start(database):
    pool, checkpoints, fence, users = database
    host, game, inbox, lane, body = await lobby(database, 'marriage')
    try:
        game.rule_proposal = {'id': uuid4().hex, 'status': 'PENDING', 'voters': list(game.users),
                              'accepted': [users[0]], 'proposed': {}}
        await checkpoints.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence)
        body['expected_revision'] = 1
        await inbox.enqueue(lane, users[0], body)
        outcome = (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome
        assert outcome['status'] == 'rejected' and 'accept' in outcome['detail']
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(0,)]
    finally:
        await host.close()
