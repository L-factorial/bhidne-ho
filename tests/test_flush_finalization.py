"""Flush settlements retain per-round identities and historical players across restart."""
from contextlib import asynccontextmanager
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import CheckpointError
from app.durable_games.finalization import FlushFinalizationWorker, MatchFinalizationWorker
from app.durable_games.room_recovery import PostgresRoomRecoveryStore
from app.ledger.store import InMemoryLedgerStore
from test_checkpoint_store import database
from test_flush_restart import finished, table_action, current_lane
from test_game_departure import restore, run
from test_game_lane_executor import command


async def restart(database, game, inbox, lane, actor=None):
    for name in ('lock', 'start'):
        assert (await table_action(database, game, inbox, lane, name, actor=actor))[0]['status'] == 'accepted'


@pytest.mark.parametrize('mode', ['current', 'restarted', 'replaced', 'replaced_current', 'closed'])
async def test_flush_settlement_preserves_legacy_identity_and_historical_users(database, mode):
    pool, store, fence, users = database
    host, game, inbox, lane, *_ = await finished(database)
    try:
        original, _ = await restore(store, game)
        memory = InMemoryLedgerStore()
        host.ledger = memory
        await host._record_completed_ledger(original)
        expected = await memory.room_games('room')
        if mode in ('replaced', 'replaced_current'):
            for name, actor in [('join-queue', users[2]), ('join-queue', users[3]),
                                ('leave-seat', users[0]), ('leave-seat', users[1])]:
                assert (await table_action(database, game, inbox, lane, name, actor=actor))[0]['status'] == 'accepted'
            if mode == 'replaced':
                await restart(database, game, inbox, lane, users[2])
        elif mode == 'restarted':
            await restart(database, game, inbox, lane)
        elif mode == 'closed':
            assert (await table_action(database, game, inbox, lane, 'end'))[0]['status'] == 'accepted'
        before = await store.load(game.table.table_id)
        worker = FlushFinalizationWorker(pool)
        identity, = await worker.pending(fence)
        assert await MatchFinalizationWorker(pool).pending(fence) == ()
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        inventory = await PostgresRoomRecoveryStore(pool, flush_settlement=True).load(fence, host)
        assert len(inventory.finalization) == 1
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
        await pool.execute("UPDATE room_ownership SET runtime_status='serving'")
        assert await worker.execute(identity, fence) == 'projected'
        assert await worker.ledger.room_games('room') == expected
        assert expected[0]['game_id'] == uuid5(NAMESPACE_URL, f'bhidne-ho:{game.match_id}:flush:1').hex
        assert {r['player_id'] for r in expected[0]['amounts']} == set(users[:2])
        assert await worker.execute(identity, fence) == 'already_completed'
        assert await worker.pending(fence) == ()
        assert await store.load(game.table.table_id) == before
    finally:
        await host.close()


async def test_multiple_rounds_settle_independently_after_restarts(database):
    pool, store, fence, users = database
    host, game, inbox, lane, *_ = await finished(database)
    try:
        memory = InMemoryLedgerStore()
        host.ledger = memory
        for number in (1, 2, 3):
            if number > 1:
                await restart(database, game, inbox, lane)
                detached, _ = await restore(store, game)
                game_lane = await current_lane(inbox, detached)
                for name in ('DEAL_CARDS', 'SKIP_CUT', 'FOLD'):
                    detached, _ = await restore(store, game)
                    actor, body = command(detached, name)
                    assert (await run(inbox, game_lane, fence, actor, body))['status'] == 'accepted'
            detached, _ = await restore(store, game)
            await host._record_completed_ledger(detached)
        expected = await memory.room_games('room')
        worker = FlushFinalizationWorker(pool)
        jobs = await worker.pending(fence)
        assert len(jobs) == 3
        cursor = UUID(int=0)
        pages = []
        for _ in range(3):
            page = await worker.pending(fence, limit=1, after_job_id=cursor)
            assert len(page) == 1
            cursor = page[0]
            pages.extend(page)
        assert pages == sorted(jobs)
        assert await worker.pending(fence, limit=1, after_job_id=cursor) == ()
        for identity in reversed(jobs):
            assert await worker.execute(identity, fence) == 'projected'
        actual = await worker.ledger.room_games('room')
        assert sorted(actual, key=lambda g: g['game_id']) == sorted(expected, key=lambda g: g['game_id'])
        assert len({g['game_id'] for g in actual}) == 3
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs WHERE completed_at IS NOT NULL')).rows == [(3,)]
    finally:
        await host.close()


async def test_flush_rollback_and_unknown_commit(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane, *_ = await finished(database)
    try:
        worker = FlushFinalizationWorker(pool)
        identity, = await worker.pending(fence)
        original = worker.ledger.record_game_in_transaction
        async def failing(connection, result):
            await original(connection, result)
            raise RuntimeError('fail after projection')
        with monkeypatch.context() as patch:
            patch.setattr(worker.ledger, 'record_game_in_transaction', failing)
            with pytest.raises(RuntimeError): await worker.execute(identity, fence)
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
        assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('lost response')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await worker.execute(identity, fence)
        assert await worker.execute(identity, fence) == 'already_completed'
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(1,)]
    finally:
        await host.close()


@pytest.mark.parametrize('mutation', ['round', 'match', 'missing_archive'])
async def test_wrong_round_or_missing_history_cannot_settle(database, mutation):
    pool, store, fence, users = database
    host, game, inbox, lane, *_ = await finished(database)
    try:
        worker = FlushFinalizationWorker(pool)
        identity, = await worker.pending(fence)
        await restart(database, game, inbox, lane)
        if mutation == 'missing_archive':
            await pool.execute('ALTER TABLE hosted_match_archives DISABLE TRIGGER USER')
            await pool.execute('DELETE FROM hosted_match_archives')
        else:
            await pool.execute('ALTER TABLE game_finalization_jobs DISABLE TRIGGER USER')
            if mutation == 'round':
                await pool.execute('UPDATE game_finalization_jobs SET round_number=2')
            else:
                await pool.execute("UPDATE game_finalization_jobs SET payload=jsonb_set(payload,'{match_id}','\"00000000000000000000000000000009\"')")
        with pytest.raises(CheckpointError): await worker.execute(identity, fence)
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        with pytest.raises(CheckpointError):
            await PostgresRoomRecoveryStore(pool, flush_settlement=True).load(fence, host)
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
        assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
    finally:
        await host.close()


@pytest.mark.parametrize('conflict', [False, True])
async def test_legacy_round_projection_is_reused_or_conflict_stays_pending(database, conflict):
    from app.ledger.models import GameLedgerAmount
    from app.durable_games.finalization import project_flush
    from app.durable_games.checkpoints import decode_checkpoint
    pool, store, fence, users = database
    host, game, inbox, lane, *_ = await finished(database)
    try:
        worker = FlushFinalizationWorker(pool)
        identity, = await worker.pending(fence)
        result = project_flush(decode_checkpoint((await store.load(game.table.table_id)).checkpoint))
        if conflict:
            result.amounts = [GameLedgerAmount(player_id=users[0], amount=12345),
                              GameLedgerAmount(player_id=users[1], amount=-12345)]
        await worker.ledger.record_game(result)
        before = (await pool.execute('SELECT * FROM game_ledger_entries')).rows
        if conflict:
            with pytest.raises(ValueError, match='different values'): await worker.execute(identity, fence)
            assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
        else:
            assert await worker.execute(identity, fence) == 'projected'
        assert (await pool.execute('SELECT * FROM game_ledger_entries')).rows == before
    finally:
        await host.close()


async def test_takeover_settles_old_round_while_new_round_is_active(database):
    from secrets import token_urlsafe
    from app.durable_games.ownership import InstanceRegistration, PostgresRoomOwnershipStore
    from app.durable_games.store import StaleGameOwner
    pool, store, fence, users = database
    host, game, inbox, lane, *_ = await finished(database)
    try:
        worker = FlushFinalizationWorker(pool)
        identity, = await worker.pending(fence)
        await restart(database, game, inbox, lane)
        before = await store.load(game.table.table_id)
        ownership = PostgresRoomOwnershipStore(pool)
        registration = InstanceRegistration.new()
        await ownership.register(registration, 'http://replacement:8000')
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        lease = await ownership.acquire('room', registration, expected_epoch=fence.epoch, token=token_urlsafe(32))
        with pytest.raises(StaleGameOwner): await worker.execute(identity, fence)
        await PostgresRoomRecoveryStore(pool, flush_settlement=True).load(lease.fence, host)
        await ownership.activate(registration, lease.fence)
        assert await worker.execute(identity, lease.fence) == 'projected'
        assert await store.load(game.table.table_id) == before
    finally:
        await host.close()
