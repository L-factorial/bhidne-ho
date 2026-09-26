"""Whole-room recovery with real PostgreSQL/WASM SQL and detached engines."""
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from psycopg.types.json import Jsonb

from app.durable_games.checkpoints import CheckpointError, capture_checkpoint
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.room_recovery import (
    PostgresRoomRecoveryStore, RecoveryLimitExceeded, UnsupportedRecoveryWork,
)
from app.durable_games.store import StaleGameOwner
from test_checkpoint_store import database, host_game


@pytest.fixture
async def saved_room(database):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        yield pool, fence, users, host, game
    finally:
        await host.close()


async def test_multiple_tables_rebuild_in_one_snapshot_without_publishing(database):
    pool, checkpoints, fence, users = database
    hosts, ids = [], set()
    try:
        for players, kind in ((users[:2], 'marriage'), (users[2:4], 'flush'), (users[4:], 'marriage')):
            host, game = await host_game(players, kind, started=kind != 'flush')
            hosts.append(host)
            await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
            ids.add(UUID(game.table.table_id))
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        original = dict(hosts[0].games)
        result = await PostgresRoomRecoveryStore(pool).load(fence, hosts[0])
        assert {t.table_id for t in result.tables} == ids
        assert len(result.member_ids) == 6 and not result.timers and not result.finalization
        assert hosts[0].games == original
        assert 'checkpoint' not in repr(result) and 'engine' not in repr(result)
        assert (await pool.execute('SELECT runtime_status FROM room_ownership')).rows == [('recovering',)]
    finally:
        for host in hosts: await host.close()


async def test_empty_room_is_valid_but_wrong_fence_or_serving_state_is_not(database):
    pool, _, fence, users = database
    host, _ = await host_game(users, started=False)
    try:
        loader = PostgresRoomRecoveryStore(pool)
        with pytest.raises(StaleGameOwner): await loader.load(fence, host)
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        assert not (await loader.load(fence, host)).tables
        with pytest.raises(StaleGameOwner): await loader.load(replace(fence, token='wrong'), host)
    finally:
        await host.close()


@pytest.mark.parametrize('mutation', ['missing', 'digest', 'reservation', 'membership'])
async def test_corrupt_or_incomplete_table_prevents_entire_room_recovery(saved_room, mutation):
    pool, fence, users, host, game = saved_room
    if mutation == 'missing':
        await pool.execute('''INSERT INTO room_tables(table_id,room_id,name,game_type)
            VALUES (%s,'room','Missing checkpoint','marriage')''', (uuid4(),))
    elif mutation == 'digest':
        await pool.execute("UPDATE table_recovery_state SET state=jsonb_set(state,'{digest}','\"broken\"')")
    elif mutation == 'reservation':
        await pool.execute('DELETE FROM active_table_players')
    else:
        await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[0][5:]),))
    with pytest.raises(CheckpointError): await PostgresRoomRecoveryStore(pool).load(fence, host)
    assert host.games['room'] is game
    assert (await pool.execute('SELECT runtime_status FROM room_ownership')).rows == [('recovering',)]


async def test_unsupported_game_and_inventory_limits_fail_closed(saved_room):
    pool, fence, _, host, _ = saved_room
    with pytest.raises(UnsupportedRecoveryWork):
        await PostgresRoomRecoveryStore(pool, game_types=('flush',)).load(fence, host)
    with pytest.raises(RecoveryLimitExceeded):
        await PostgresRoomRecoveryStore(pool, max_items=1).load(fence, host)


async def test_pending_lane_cursors_are_preserved_and_missing_head_rejected(saved_room):
    pool, fence, users, host, _ = saved_room
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='room_chat', room_id='room'))
    await inbox.enqueue(lane, users[0], {'command_id': 'chat', 'command': 'SAY', 'payload': {'text': 'hello'}})
    loader = PostgresRoomRecoveryStore(pool)
    result = await loader.load(fence, host)
    assert result.lanes[0].enqueued_sequence == 1 and result.lanes[0].processed_sequence == 0
    await pool.execute('DELETE FROM command_inbox WHERE lane_id=%s', (lane,))
    with pytest.raises(CheckpointError, match='Pending lane'): await loader.load(fence, host)


async def test_timer_deadlines_generations_and_unknown_capability(saved_room):
    pool, fence, _, host, _ = saved_room
    lane = await PostgresInboxStore(pool).ensure_lane(LaneTarget(kind='room', room_id='room'))
    action_id = uuid4()
    await pool.execute('''INSERT INTO scheduled_actions
        (action_id,lane_id,action_type,generation,due_at,command_id,command,payload)
        VALUES (%s,%s,'room_test',7,clock_timestamp()-interval '1 hour','timer','TICK',%s)''',
        (action_id, lane, Jsonb({'generation': 7})))
    with pytest.raises(UnsupportedRecoveryWork): await PostgresRoomRecoveryStore(pool).load(fence, host)
    seen = []
    def validate(timer):
        assert timer.generation == timer.payload['generation'] == 7
        seen.append(timer.action_id)
        timer.payload['generation'] = 99  # Validator gets a detached copy.
    loader = PostgresRoomRecoveryStore(pool, timer_validators={('room', 'room_test'): validate})
    first, second = await loader.load(fence, host), await loader.load(fence, host)
    assert first.timers == second.timers and seen == [action_id, action_id]
    assert first.timers[0].due_at < first.observed_at
    assert first.timers[0].payload == {'generation': 7}
    assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]


async def test_pending_finalization_version_and_retry_state_are_retained(saved_room):
    pool, fence, _, host, game = saved_room
    job_id = uuid4()
    await pool.execute('''INSERT INTO game_finalization_jobs
        (job_id,game_id,round_number,job_type,payload_version,payload,attempts)
        VALUES (%s,%s,2,'test_job',2,%s,3)''', (job_id, game.durable_game_id, Jsonb({'effect_id': 'stable'})))
    with pytest.raises(UnsupportedRecoveryWork): await PostgresRoomRecoveryStore(pool).load(fence, host)
    with pytest.raises(UnsupportedRecoveryWork):
        await PostgresRoomRecoveryStore(pool, finalization_validators={('test_job', 1): lambda job: None}).load(fence, host)
    def validate(job):
        assert job.payload == {'effect_id': 'stable'}
    loader = PostgresRoomRecoveryStore(pool, finalization_validators={('test_job', 2): validate})
    result = await loader.load(fence, host)
    assert result.finalization[0].job_id == job_id
    assert result.finalization[0].attempts == 3 and result.finalization[0].round_number == 2
    assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]


async def test_fresh_fence_check_rejects_ownership_loss_after_snapshot(saved_room):
    pool, fence, _, host, _ = saved_room
    class LoseOwnership:
        calls = 0
        @asynccontextmanager
        async def connection(self):
            self.calls += 1
            if self.calls == 2:
                await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
            yield pool
    wrapper = LoseOwnership()
    with pytest.raises(StaleGameOwner): await PostgresRoomRecoveryStore(wrapper).load(fence, host)
    assert wrapper.calls == 2


def test_invalid_limits_and_async_validators():
    async def invalid(work): pass
    with pytest.raises(ValueError): PostgresRoomRecoveryStore(None, max_items=0)
    with pytest.raises(ValueError): PostgresRoomRecoveryStore(None, timer_validators={('room', 'x'): invalid})


async def test_active_legacy_game_cannot_be_silently_omitted(saved_room):
    pool, fence, _, host, _ = saved_room
    await pool.execute('''INSERT INTO games(id,room_id,game_type,engine_version,event_schema_version,initial_state,status)
        VALUES (%s,'room','marriage',1,1,'{}','active')''', (uuid4(),))
    with pytest.raises(CheckpointError, match='active game'):
        await PostgresRoomRecoveryStore(pool).load(fence, host)


async def test_closed_table_with_pending_work_is_included(database):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        game.ended = True
        game.table.phase = 'ENDED'
        await checkpoints.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence)
        lane = await PostgresInboxStore(pool).ensure_lane(LaneTarget(
            kind='game', room_id='room', table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        result = await PostgresRoomRecoveryStore(pool).load(fence, host)
        assert result.tables[0].status == 'closed'
        assert result.lanes[0].lane_id == lane
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(0,)]
    finally:
        await host.close()


async def test_completed_historical_game_without_settlement_intent_is_rejected(saved_room):
    pool, fence, _, host, game = saved_room
    await pool.execute('''INSERT INTO games(id,room_id,table_id,game_type,engine_version,event_schema_version,
        initial_state,status,completed_at) VALUES (%s,'room',%s,'marriage',1,1,'{}','completed',clock_timestamp())''',
        (uuid4(), UUID(game.table.table_id)))
    with pytest.raises(CheckpointError, match='finalization intent'):
        await PostgresRoomRecoveryStore(pool).load(fence, host)


async def test_invalid_work_payload_prevents_returning_partial_inventory(saved_room):
    pool, fence, _, host, game = saved_room
    await pool.execute('''INSERT INTO game_finalization_jobs(job_id,game_id,job_type,payload)
        VALUES (%s,%s,'bad_payload','{}')''', (uuid4(), game.durable_game_id))
    def validate(job):
        raise ValueError('Missing effect identity')
    with pytest.raises(CheckpointError, match='malformed'):
        await PostgresRoomRecoveryStore(pool, finalization_validators={('bad_payload', 1): validate}).load(fence, host)
    assert (await pool.execute('SELECT runtime_status FROM room_ownership')).rows == [('recovering',)]


async def test_checkpoint_reads_share_the_read_only_repeatable_read_transaction(saved_room):
    pool, fence, _, host, _ = saved_room
    class Connections:
        count = 0
        @asynccontextmanager
        async def connection(self):
            self.count += 1
            yield pool
    connections = Connections()
    loader = PostgresRoomRecoveryStore(connections)
    original = loader.checkpoints.load_in_snapshot
    async def checked(connection, table_id):
        assert connection is pool
        isolation = await (await connection.execute('SHOW transaction_isolation')).fetchone()
        read_only = await (await connection.execute('SHOW transaction_read_only')).fetchone()
        assert isolation == ('repeatable read',) and read_only == ('on',)
        return await original(connection, table_id)
    loader.checkpoints.load_in_snapshot = checked
    await loader.load(fence, host)
    assert connections.count == 2  # Inventory transaction, then fresh fence check.
