"""Recovery orchestration composed with the real ownership and recovery SQL."""
from uuid import uuid4

import pytest

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.coordination import RoomLeaseCoordinator
from app.durable_games.ownership import PostgresRoomOwnershipStore
from app.durable_games.recovery_coordinator import RoomRecoveryCoordinator
from app.durable_games.room_recovery import PostgresRoomRecoveryStore
from test_checkpoint_store import database, host_game


@pytest.fixture
async def recovery_runtime(database):
    pool, checkpoints, old_fence, users = database
    host, game = await host_game(users)
    await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=old_fence)
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    store = PostgresRoomOwnershipStore(pool)
    leases = RoomLeaseCoordinator(store, 'http://recovery:8000')
    await leases.start()
    try:
        yield pool, store, leases, RoomRecoveryCoordinator(leases, PostgresRoomRecoveryStore(pool)), host, game
    finally:
        await leases.stop()
        await host.close()


async def test_expired_owner_is_recovered_without_activation_or_host_replacement(recovery_runtime):
    pool, store, leases, runner, host, game = recovery_runtime
    result = await runner.prepare('room', expected_epoch=1, host=host)
    assert result.status == 'prepared' and result.fence.epoch == 2
    assert result.inventory.tables[0].stored.checkpoint['data']['match_id'] == game.match_id
    assert host.games['room'] is game
    assert leases.confirms(result.fence, status='recovering') and not leases.admits(result.fence)
    assert (await store.inspect('room')).status == 'recovering'
    assert await store.routing_hint('room') is None
    assert runner.discard(result)
    before = await store.inspect('room')
    await leases.renew_once()
    assert await store.inspect('room') == before  # No renewal after discard.


@pytest.mark.parametrize(('failure', 'expected'), [('checkpoint', 'invalid'), ('job', 'unsupported')])
async def test_bad_recovery_returns_typed_failure_without_quarantine_or_reset(recovery_runtime, failure, expected):
    pool, store, leases, runner, host, game = recovery_runtime
    if failure == 'checkpoint':
        await pool.execute("UPDATE table_recovery_state SET state=jsonb_set(state,'{digest}','\"broken\"')")
    else:
        await pool.execute('''INSERT INTO game_finalization_jobs(job_id,game_id,job_type,payload)
            VALUES (%s,%s,'unknown','{}')''', (uuid4(), game.durable_game_id))
    result = await runner.prepare('room', expected_epoch=1, host=host)
    assert result.status == expected and result.inventory is None
    assert not leases.confirms(result.fence, status='recovering')
    state = await store.inspect('room')
    assert state.status == 'recovering' and state.epoch == 2
    await leases.renew_once()
    assert await store.inspect('room') == state
    assert host.games['room'] is game
    if failure == 'job':
        assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
