"""Manual deal review survives restart and advances only on a creator command."""
from contextlib import asynccontextmanager
from dataclasses import replace
from secrets import token_urlsafe
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError
from callbreak import (GameConfig, Phase, PlaceBid, PlayCard, RedealPolicy, StartDeal,
                       apply_control, apply_player, available_cards, create_match)
from card_utils import standard_52

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.ownership import InstanceRegistration, PostgresRoomOwnershipStore
from app.durable_games.room_recovery import PostgresRoomRecoveryStore, UnsupportedRecoveryWork
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from test_checkpoint_store import database, host_game
from test_game_lane_executor import setup_game


async def summary(database):
    pool, store, fence, users = database
    host, game = await host_game(users, 'callbreak')
    state = create_match(GameConfig(redeal_policy=RedealPolicy(weak_hand_enabled=False, no_spades_enabled=False)))
    state = apply_control(state, StartDeal(standard_52())).state
    while True:
        action = PlaceBid(1) if state.phase == Phase.BIDDING else PlayCard(available_cards(state, state.current_player)[0])
        after = apply_player(state, state.current_player, action).state
        if after.phase == Phase.DEAL_COMPLETE:
            break
        state = after
    game.state = state
    await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room', table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
    await inbox.enqueue(lane, users[state.current_player-1], dict(command_id=uuid4().hex, command='PLAY_CARD',
        match_id=game.match_id, expected_revision=state.revision,
        payload={'card': str(available_cards(state, state.current_player)[0])}))
    assert (await GameLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
    return host, game, inbox, lane


async def body(store, game, **changes):
    data = (await store.load(game.table.table_id)).checkpoint['data']
    return dict(command_id=uuid4().hex, command='NEXT_DEAL', match_id=game.match_id,
                expected_revision=data['engine']['revision'], payload={'deal_number': 1}) | changes


async def test_review_persists_without_deadline_then_creator_advances_once(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await summary(database)
    try:
        before = await store.load(game.table.table_id)
        assert before.checkpoint['data']['engine']['state']['phase'] == 'DEAL_COMPLETE'
        assert (await pool.execute('SELECT count(*) FROM scheduled_actions')).rows == [(0,)]
        request = await body(store, game)
        await inbox.enqueue(lane, users[0], request)
        executor = GameLaneExecutor(inbox)
        outcome = (await executor.execute_one(lane, fence)).outcome
        assert outcome['status'] == 'accepted'
        after = await store.load(game.table.table_id)
        state = after.checkpoint['data']['engine']['state']
        assert state['phase'] == 'AWAITING_SHUFFLE'
        assert state['preparation']['number'] == 2
        assert after.receipt_snapshot['receipt_count'] == before.receipt_snapshot['receipt_count'] + 1
        assert after.receipt_snapshot['receipts'][-1]['request'] == request
        events = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await inbox.enqueue(lane, users[0], request)).outcome == outcome
        assert await executor.execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == after
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == events
        # Legacy parity: a fresh request at current revision for this same deal is harmless.
        await inbox.enqueue(lane, users[0], await body(store, game))
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        assert (await store.load(game.table.table_id)).checkpoint['data']['engine'] == after.checkpoint['data']['engine']
        # Actual play continues through the next preparation stage.
        from app.durable_games.recovery import rebuild_hosted_game
        from test_game_lane_executor import command
        saved = await store.load(game.table.table_id)
        detached = _DetachedHost(8)
        rebuilt = detached.game = rebuild_hosted_game(detached, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
        actor, shuffle = command(rebuilt)
        await inbox.enqueue(lane, actor, shuffle)
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
        assert (await pool.execute('SELECT count(*) FROM scheduled_actions')).rows == [(0,)]
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['nonhost', 'spectator', 'system', 'revision', 'deal', 'payload', 'disabled', 'fence'])
async def test_invalid_continuation_cannot_advance_review(database, case):
    pool, store, fence, users = database
    host, game, inbox, lane = await summary(database)
    try:
        before = await store.load(game.table.table_id)
        request = await body(store, game)
        actor = {'nonhost': users[1], 'spectator': users[-1], 'system': 'system:timer'}.get(case, users[0])
        if case == 'revision': request['expected_revision'] -= 1
        if case == 'deal': request['payload'] = {'deal_number': 2}
        if case == 'payload': request['payload'] = {'deal_number': True, 'force': True}
        await inbox.enqueue(lane, actor, request)
        executor = GameLaneExecutor(inbox, round_summary_seconds=0 if case == 'disabled' else 8)
        if case == 'fence':
            with pytest.raises(StaleGameOwner): await executor.execute_one(lane, replace(fence, token='wrong'))
            assert (await inbox.lookup(lane, actor, request['command_id'])).status == 'pending'
        else:
            assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert (await store.load(game.table.table_id)).checkpoint == before.checkpoint
        assert (await pool.execute('SELECT count(*) FROM scheduled_actions')).rows == [(0,)]
    finally:
        await host.close()


async def test_outbox_rollback_and_unknown_commit_preserve_next_deal_identity(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane = await summary(database)
    try:
        before = await store.load(game.table.table_id)
        request = await body(store, game)
        await inbox.enqueue(lane, users[0], request)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await GameLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('lost response')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await GameLaneExecutor(inbox).execute_one(lane, fence)
        after = await store.load(game.table.table_id)
        assert (await inbox.enqueue(lane, users[0], request)).outcome['status'] == 'accepted'
        assert await GameLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == after
    finally:
        await host.close()


async def test_takeover_recovers_review_and_pending_creator_command(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await summary(database)
    try:
        request = await body(store, game)
        await inbox.enqueue(lane, users[0], request)
        owners = PostgresRoomOwnershipStore(pool)
        registration = InstanceRegistration.new()
        await owners.register(registration, 'http://replacement:8000')
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        lease = await owners.acquire('room', registration, expected_epoch=fence.epoch, token=token_urlsafe(32))
        with pytest.raises(UnsupportedRecoveryWork, match='summary'):
            await PostgresRoomRecoveryStore(pool).load(lease.fence, _DetachedHost(8))
        before = await store.load(game.table.table_id)
        inventory = await PostgresRoomRecoveryStore(pool, callbreak_review=True).load(lease.fence, _DetachedHost(8))
        assert len(inventory.tables) == 1 and not inventory.timers
        assert await store.load(game.table.table_id) == before
        await owners.activate(registration, lease.fence)
        with pytest.raises(StaleGameOwner): await GameLaneExecutor(inbox).execute_one(lane, fence)
        assert (await GameLaneExecutor(inbox).execute_one(lane, lease.fence)).outcome['status'] == 'accepted'
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_next_deal_is_not_another_game_command(database, kind):
    pool, store, fence, users = database
    host, game, inbox, lane, executor = await setup_game(database, kind)
    try:
        before = await store.load(game.table.table_id)
        await inbox.enqueue(lane, users[0], await body(store, game))
        assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert (await store.load(game.table.table_id)).checkpoint == before.checkpoint
    finally:
        await host.close()
