"""Offer deadlines survive dispatch, failure, retries and recovery without resetting."""
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import UUID

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoints import CheckpointError, capture_checkpoint
from app.durable_games.executor import _DetachedHost
from app.durable_games.offer_expiry import OfferExpiryDispatcher, SYSTEM_ACTOR
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.room_recovery import PostgresRoomRecoveryStore, UnsupportedRecoveryWork
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database
from test_rematch import request
from test_seat_offers import action, offers, vacancy


async def prepare(database, *, due=True, queued=True):
    pool, store, fence, users = database
    host, game, inbox, lane = await vacancy(database)
    saved = await store.load(game.table.table_id)
    detached = _DetachedHost(8)
    rebuilt = detached.game = rebuild_hosted_game(detached, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
    rebuilt.table.offer_seconds = 0.000001 if due else 3600
    revision = saved.checkpoint['data']['table_revision']
    await store.save(capture_checkpoint(rebuilt, table_revision=revision+1), expected_revision=revision, fence=fence)
    if queued:
        for user in users[4:]: await action(database, game, inbox, lane, user, 'join-queue')
    else:
        await action(database, game, inbox, lane, users[0], 'invite-seat', {'seat_id': 1, 'recipient': users[4]})
    return host, game, inbox, lane


async def test_expiry_advances_fifo_and_duplicate_dispatch_has_no_effect(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database)
    try:
        original = await store.load(game.table.table_id)
        dispatcher = OfferExpiryDispatcher(inbox)
        entries = await dispatcher.dispatch_due(fence)
        assert len(entries) == 1 and entries[0].actor_id == SYSTEM_ACTOR
        assert await dispatcher.dispatch_due(fence) == ()
        assert await store.load(game.table.table_id) == original
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
        state = await offers(database, game)
        assert [(o['status'], o['offered_to_player_id']) for o in state] == [('EXPIRED', users[4]), ('PENDING', users[5])]
        assert (await store.load(game.table.table_id)).checkpoint['data']['engine'] == original.checkpoint['data']['engine']
        assert (await inbox.lookup(lane, SYSTEM_ACTOR, entries[0].request.command_id)).status == 'accepted'
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert len(await dispatcher.dispatch_due(fence)) == 1
        await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert all(o['status'] == 'EXPIRED' for o in await offers(database, game))
    finally:
        await host.close()


async def test_not_due_and_stale_owner_do_not_dispatch(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database, due=False)
    try:
        dispatcher = OfferExpiryDispatcher(inbox)
        assert await dispatcher.dispatch_one(lane, fence) is None
        with pytest.raises(StaleGameOwner):
            await dispatcher.dispatch_one(lane, replace(fence, token='wrong'))
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]
        with pytest.raises(ValueError): await dispatcher.dispatch_due(fence, limit=0)
    finally:
        await host.close()


async def test_queued_withdrawal_wins_before_dispatched_expiry(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database)
    try:
        body = request(await store.load(game.table.table_id), 'leave-queue')
        await inbox.enqueue(lane, users[4], body)
        await OfferExpiryDispatcher(inbox).dispatch_one(lane, fence)
        executor = TableLaneExecutor(inbox)
        await executor.execute_one(lane, fence)
        before = await store.load(game.table.table_id)
        outbox = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == outbox
        assert (await offers(database, game))[0]['status'] == 'CANCELLED'
    finally:
        await host.close()


async def test_player_cannot_forge_expiry(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database)
    try:
        before = await store.load(game.table.table_id)
        identity = (await offers(database, game))[0]['offer_id']
        result = await action(database, game, inbox, lane, users[4], 'expire-seat-offer', {'offer_id': identity})
        assert result['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert len(await OfferExpiryDispatcher(inbox).dispatch_due(fence)) == 1
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    finally:
        await host.close()


async def test_dispatch_backpressure_and_unknown_commit(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database)
    try:
        # A full lane rolls back dispatch bookkeeping as well as allocation.
        inbox.max_pending = 1
        await inbox.enqueue(lane, users[0], request(await store.load(game.table.table_id), 'leave-queue'))
        with pytest.raises(DurableGameConflict, match='pending limit'):
            await OfferExpiryDispatcher(inbox).dispatch_one(lane, fence)
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]
        await TableLaneExecutor(inbox).execute_one(lane, fence)
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('lost response')
        dispatcher = OfferExpiryDispatcher(inbox)
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await dispatcher.dispatch_one(lane, fence)
        assert await dispatcher.dispatch_one(lane, fence) is None
        assert (await pool.execute("SELECT count(*) FROM command_inbox WHERE actor_id=%s", (SYSTEM_ACTOR,))).rows == [(1,)]
        before = await store.load(game.table.table_id)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await TableLaneExecutor(inbox).execute_one(lane, fence)
        after = await store.load(game.table.table_id)
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == after
    finally:
        await host.close()


@pytest.mark.parametrize('dispatched', [False, True])
async def test_recovery_preserves_pending_or_dispatched_expiry(database, dispatched):
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database)
    try:
        if dispatched: await OfferExpiryDispatcher(inbox).dispatch_one(lane, fence)
        deadlines = (await pool.execute('SELECT * FROM scheduled_actions')).rows
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        jobs = {('hosted_settlement', 1): lambda job: None}
        with pytest.raises(UnsupportedRecoveryWork):
            await PostgresRoomRecoveryStore(pool, finalization_validators=jobs).load(fence, host)
        result = await PostgresRoomRecoveryStore(pool, offer_expiry=True, finalization_validators=jobs).load(fence, host)
        assert len(result.timers) == (0 if dispatched else 1)
        assert (await pool.execute('SELECT * FROM scheduled_actions')).rows == deadlines
        await pool.execute("UPDATE room_ownership SET runtime_status='serving'")
        if not dispatched: await OfferExpiryDispatcher(inbox).dispatch_one(lane, fence)
        await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert (await offers(database, game))[0]['status'] == 'EXPIRED'
    finally:
        await host.close()


@pytest.mark.parametrize('mutation', ['missing', 'cancelled', 'deadline', 'generation'])
async def test_recovery_rejects_unreconciled_offer_deadlines(database, mutation):
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database)
    try:
        if mutation == 'missing': await pool.execute('DELETE FROM scheduled_actions')
        elif mutation == 'cancelled':
            await pool.execute("UPDATE scheduled_actions SET status='cancelled',finished_at=clock_timestamp()")
        else:
            # Simulate storage corruption; ordinary writes prohibit identity changes.
            await pool.execute('ALTER TABLE scheduled_actions DISABLE TRIGGER scheduled_actions_identity')
            await pool.execute('UPDATE scheduled_actions SET ' + ("due_at=due_at+interval '1 second'" if mutation == 'deadline' else 'generation=generation+1'))
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        with pytest.raises(CheckpointError):
            await PostgresRoomRecoveryStore(pool, offer_expiry=True,
                finalization_validators={('hosted_settlement', 1): lambda job: None}).load(fence, host)
    finally:
        await host.close()


async def test_new_owner_recovers_dispatched_expiry_and_fences_previous_owner(database):
    from secrets import token_urlsafe
    from app.durable_games.ownership import InstanceRegistration, PostgresRoomOwnershipStore
    pool, store, fence, users = database
    host, game, inbox, lane = await prepare(database)
    try:
        await OfferExpiryDispatcher(inbox).dispatch_one(lane, fence)
        owners = PostgresRoomOwnershipStore(pool)
        registration = InstanceRegistration.new()
        await owners.register(registration, 'http://replacement:8000')
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        lease = await owners.acquire('room', registration, expected_epoch=fence.epoch, token=token_urlsafe(32))
        with pytest.raises(StaleGameOwner): await TableLaneExecutor(inbox).execute_one(lane, fence)
        with pytest.raises(StaleGameOwner): await OfferExpiryDispatcher(inbox).dispatch_one(lane, fence)
        await PostgresRoomRecoveryStore(pool, offer_expiry=True,
            finalization_validators={('hosted_settlement', 1): lambda job: None}).load(lease.fence, host)
        await owners.activate(registration, lease.fence)
        assert (await TableLaneExecutor(inbox).execute_one(lane, lease.fence)).outcome['status'] == 'accepted'
        assert (await offers(database, game))[0]['status'] == 'EXPIRED'
    finally:
        await host.close()
