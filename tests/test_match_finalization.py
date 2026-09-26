"""Match settlement is derived from validated historical engines and committed once."""
from contextlib import asynccontextmanager
from dataclasses import replace

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import CheckpointError
from app.durable_games.finalization import MatchFinalizationWorker
from app.durable_games.room_recovery import PostgresRoomRecoveryStore
from app.durable_games.store import StaleGameOwner
from app.ledger.store import InMemoryLedgerStore
from test_checkpoint_store import database
from test_rematch import completed, execute, request


async def job_id(pool):
    return (await pool.execute('SELECT job_id FROM game_finalization_jobs')).rows[0][0]


@pytest.mark.parametrize('kind', ['callbreak', 'marriage'])
@pytest.mark.parametrize('archived', [False, True])
async def test_settlement_matches_legacy_before_or_after_rematch(database, kind, archived):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, kind)
    try:
        saved = await store.load(game.table.table_id)
        from app.durable_games.executor import _DetachedHost
        from app.durable_games.recovery import rebuild_hosted_game
        detached = _DetachedHost(8)
        original = detached.game = rebuild_hosted_game(detached, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
        memory = InMemoryLedgerStore()
        host.ledger = memory
        await host._record_completed_ledger(original)
        expected = await memory.room_games('room')
        if archived:
            assert (await execute(inbox, lane, fence, users[0], request(saved)))['status'] == 'accepted'
        before = await store.load(game.table.table_id)
        worker = MatchFinalizationWorker(pool)
        identity = await job_id(pool)
        assert await worker.pending(fence) == (identity,)
        status = await worker.execute(identity, fence)
        assert status == ('projected' if expected else 'no_payment')
        assert await worker.ledger.room_games('room') == expected
        assert await worker.execute(identity, fence) == 'already_completed'
        assert await worker.pending(fence) == ()
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT attempts,completed_at IS NOT NULL FROM game_finalization_jobs')).rows == [(1, True)]
    finally:
        await host.close()


async def test_settlement_rollback_and_unknown_commit(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        worker = MatchFinalizationWorker(pool)
        identity = await job_id(pool)
        original = worker.ledger.record_game_in_transaction
        async def failing(connection, result):
            await original(connection, result)
            raise RuntimeError('failure after ledger inserts')
        with monkeypatch.context() as patch:
            patch.setattr(worker.ledger, 'record_game_in_transaction', failing)
            with pytest.raises(RuntimeError): await worker.execute(identity, fence)
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM game_ledger_entries')).rows == [(0,)]
        assert (await pool.execute('SELECT completed_at,attempts FROM game_finalization_jobs')).rows == [(None, 0)]
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('lost commit response')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await worker.execute(identity, fence)
        assert await worker.execute(identity, fence) == 'already_completed'
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(1,)]
    finally:
        await host.close()


@pytest.mark.parametrize('archived', [False, True])
async def test_recovery_validates_pending_match_settlement_without_writing(database, archived):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        if archived:
            await execute(inbox, lane, fence, users[0], request(await store.load(game.table.table_id)))
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        inventory = await PostgresRoomRecoveryStore(pool, match_settlement=True).load(fence, host)
        assert len(inventory.finalization) == 1
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
        assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
    finally:
        await host.close()


async def test_missing_archive_and_stale_fence_cannot_settle(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        identity = await job_id(pool)
        worker = MatchFinalizationWorker(pool)
        with pytest.raises(StaleGameOwner): await worker.execute(identity, replace(fence, token='wrong'))
        await execute(inbox, lane, fence, users[0], request(await store.load(game.table.table_id)))
        await pool.execute('ALTER TABLE hosted_match_archives DISABLE TRIGGER USER')
        await pool.execute('DELETE FROM hosted_match_archives')
        with pytest.raises(CheckpointError, match='archive'): await worker.execute(identity, fence)
        assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
    finally:
        await host.close()


async def test_existing_conflicting_projection_does_not_complete_job(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        worker = MatchFinalizationWorker(pool)
        from app.ledger.models import GameLedgerResult, GameLedgerAmount
        conflict = GameLedgerResult(room_id='room', table_id=game.table.table_id, game_id=game.match_id,
            game_type='marriage', amounts=[GameLedgerAmount(player_id=users[0], amount=123456),
                                          GameLedgerAmount(player_id=users[1], amount=-123456)])
        await worker.ledger.record_game(conflict)
        with pytest.raises(ValueError, match='different values'): await worker.execute(await job_id(pool), fence)
        assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
    finally:
        await host.close()


async def test_callbreak_distinct_placements_use_saved_payments(database):
    from types import SimpleNamespace
    from callbreak import (GameConfig, Phase, PlaceBid, PlayCard, RedealPolicy, StartDeal,
                           apply_control, apply_player, available_cards, create_match)
    from card_utils import standard_52
    from app.durable_games.checkpoints import capture_checkpoint
    from app.durable_games.executor import GameLaneExecutor
    from app.durable_games.inbox import PostgresInboxStore
    from test_checkpoint_store import host_game
    pool, store, fence, users = database
    host, game = await host_game(users, 'callbreak')
    try:
        state = create_match(GameConfig(redeal_policy=RedealPolicy(weak_hand_enabled=False, no_spades_enabled=False)))
        while state.phase != Phase.MATCH_COMPLETE:
            if state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
                state = apply_control(state, StartDeal(standard_52())).state
            else:
                action = PlaceBid(state.current_player) if state.phase == Phase.BIDDING else PlayCard(available_cards(state, state.current_player)[0])
                state = apply_player(state, state.current_player, action).state
        assert len(set(state.score_tenths)) == 4
        game.state = state
        game.settings['payments'] = [10, 20, 30, 0]
        game.table.sync(game)
        checkpoint = capture_checkpoint(game, table_revision=0)
        await store.save(checkpoint, expected_revision=None, fence=fence)
        await GameLaneExecutor(PostgresInboxStore(pool))._finalization(SimpleNamespace(connection=pool,
            target=SimpleNamespace(game_id=game.durable_game_id)), checkpoint)
        worker = MatchFinalizationWorker(pool)
        assert await worker.execute(await job_id(pool), fence) == 'projected'
        result = (await worker.ledger.room_games('room'))[0]
        assert {row['player_id']: row['amount'] for row in result['amounts']} == {
            users[0]: -20, users[1]: -10, users[2]: 60, users[3]: -30}
    finally:
        await host.close()


async def test_matching_legacy_projection_is_reused_by_pending_job(database):
    from app.durable_games.executor import _DetachedHost
    from app.durable_games.recovery import rebuild_hosted_game
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        worker = MatchFinalizationWorker(pool)
        saved = await store.load(game.table.table_id)
        detached = _DetachedHost(8)
        original = detached.game = rebuild_hosted_game(detached, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
        host.ledger = worker.ledger
        await host._record_completed_ledger(original)
        before = (await pool.execute('SELECT * FROM game_ledger_entries')).rows
        assert await worker.execute(await job_id(pool), fence) == 'projected'
        assert (await pool.execute('SELECT * FROM game_ledger_entries')).rows == before
    finally:
        await host.close()


async def test_new_owner_can_settle_archived_departed_players(database):
    from secrets import token_urlsafe
    from app.durable_games.ownership import InstanceRegistration, PostgresRoomOwnershipStore
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, leave=True)
    try:
        before = await store.load(game.table.table_id)
        remaining = next(p['user_id'] for p in before.checkpoint['data']['positions'] if p['seat'] is not None)
        await execute(inbox, lane, fence, remaining, request(before))
        owners = PostgresRoomOwnershipStore(pool)
        registration = InstanceRegistration.new()
        await owners.register(registration, 'http://replacement:8000')
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        lease = await owners.acquire('room', registration, expected_epoch=fence.epoch, token=token_urlsafe(32))
        worker = MatchFinalizationWorker(pool)
        identity = await job_id(pool)
        with pytest.raises(StaleGameOwner): await worker.execute(identity, fence)
        await PostgresRoomRecoveryStore(pool, match_settlement=True).load(lease.fence, host)
        await owners.activate(registration, lease.fence)
        assert await worker.execute(identity, lease.fence) == 'projected'
        projected = (await worker.ledger.room_games('room'))[0]
        assert {a['player_id'] for a in projected['amounts']} == set(users[:2])
    finally:
        await host.close()


@pytest.mark.parametrize('mutation', ['archive_digest', 'job_revision'])
async def test_corrupt_settlement_inputs_fail_closed(database, mutation):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        await execute(inbox, lane, fence, users[0], request(await store.load(game.table.table_id)))
        if mutation == 'archive_digest':
            await pool.execute('ALTER TABLE hosted_match_archives DISABLE TRIGGER USER')
            await pool.execute("UPDATE hosted_match_archives SET checkpoint=jsonb_set(checkpoint,'{digest}','\"bad\"')")
        else:
            await pool.execute('ALTER TABLE game_finalization_jobs DISABLE TRIGGER USER')
            await pool.execute("UPDATE game_finalization_jobs SET payload=jsonb_set(payload,'{revision}','999999')")
        worker = MatchFinalizationWorker(pool)
        with pytest.raises(CheckpointError): await worker.execute(await job_id(pool), fence)
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        with pytest.raises(CheckpointError):
            await PostgresRoomRecoveryStore(pool, match_settlement=True).load(fence, host)
        assert (await pool.execute('SELECT completed_at FROM game_finalization_jobs')).rows == [(None,)]
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
    finally:
        await host.close()
