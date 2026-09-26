"""Rematches preserve completed history while replacing only the current lobby."""
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from psycopg import OperationalError
from psycopg.errors import CheckViolation
from psycopg.types.json import Jsonb

from app.durable_games.checkpoints import capture_checkpoint, decode_checkpoint
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.rematch import rematch_id
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database, host_game
from test_game_lane_executor import command, setup_game


async def completed(database, kind='marriage', *, leave=False):
    pool, store, fence, users = database
    if kind == 'marriage':
        host, game, inbox, game_lane, executor = await setup_game(database, kind)
        actor, body = command(game, 'FOLD_AND_LEAVE' if leave else 'FOLD')
        await inbox.enqueue(game_lane, actor, body)
        # Retain a pre-completion queued request to exercise old-lane draining.
        _, queued = command(game)
        await inbox.enqueue(game_lane, actor, queued)
        assert (await executor.execute_one(game_lane, fence)).outcome['status'] == 'accepted'
    else:
        from callbreak import (GameConfig, Phase, PlaceBid, PlayCard, RedealPolicy, StartDeal,
            apply_control, apply_player, available_cards, create_match)
        from card_utils import standard_52
        host, game = await host_game(users, kind)
        state = create_match(GameConfig(redeal_policy=RedealPolicy(weak_hand_enabled=False, no_spades_enabled=False)))
        while state.phase != Phase.MATCH_COMPLETE:
            if state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
                state = apply_control(state, StartDeal(standard_52())).state
            else:
                action = PlaceBid(1) if state.phase == Phase.BIDDING else PlayCard(available_cards(state, state.current_player)[0])
                state = apply_player(state, state.current_player, action).state
        game.state = state
        game.table.sync(game)
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        game_lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        await GameLaneExecutor(inbox)._finalization(SimpleNamespace(connection=pool,
            target=SimpleNamespace(game_id=game.durable_game_id)), capture_checkpoint(game, table_revision=0))
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
    return host, game, inbox, lane, game_lane


def request(saved, name='next-match', **overrides):
    data = saved.checkpoint['data']
    return dict(command_id=uuid4().hex, command=name, expected_revision=data['table_revision'],
        match_id=data['match_id'], payload={}, **overrides)


async def execute(inbox, lane, fence, actor, body):
    await inbox.enqueue(lane, actor, body)
    return (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome


@pytest.mark.parametrize('kind', ['callbreak', 'marriage'])
async def test_rematch_keeps_table_and_completed_history_then_starts_new_engine(database, kind):
    pool, store, fence, users = database
    host, game, inbox, lane, game_lane = await completed(database, kind)
    try:
        await pool.execute('UPDATE rooms SET max_open_tables=1')
        before = await store.load(game.table.table_id)
        old_game = (await pool.execute('SELECT * FROM games')).rows
        jobs = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        body = request(before)
        outcome = await execute(inbox, lane, fence, users[0], body)
        assert outcome['status'] == 'accepted'
        assert outcome['table_id'] == game.table.table_id
        assert outcome['match_id'] == rematch_id(lane, users[0], body['command_id'], game.match_id).hex
        saved = await store.load(game.table.table_id)
        data = saved.checkpoint['data']
        assert data['phase'] == 'OPEN' and data['engine'] is None
        assert data['table_revision'] == before.checkpoint['data']['table_revision'] + 1
        assert data['host']['previous_match_id'] == game.match_id
        assert data['host']['settings'] == before.checkpoint['data']['host']['settings']
        assert data['host']['marriage_scoring'] == before.checkpoint['data']['host']['marriage_scoring']
        assert saved.receipt_snapshot['receipt_count'] == 0
        archive = (await pool.execute('SELECT checkpoint FROM hosted_match_archives')).rows[0][0]
        assert archive == before.checkpoint
        assert decode_checkpoint(archive).record.data.host.users == tuple(game.users)
        assert (await pool.execute('SELECT * FROM games')).rows == old_game
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == jobs
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
        assert (await pool.execute('SELECT DISTINCT match_id FROM active_table_players')).rows == [(UUID(outcome['match_id']),)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
        assert (await inbox.enqueue(lane, users[0], body)).outcome == outcome
        if kind == 'marriage':
            assert (await GameLaneExecutor(inbox).execute_one(game_lane, fence)).outcome['status'] == 'rejected'
            assert await store.load(game.table.table_id) == saved
        # Old-table commands cannot change the new match even at its new revision.
        old_end = request(saved, 'end')
        old_end['match_id'] = game.match_id
        assert (await execute(inbox, lane, fence, users[0], old_end))['status'] == 'rejected'
        if kind == 'marriage':
            assert (await execute(inbox, lane, fence, users[0], request(saved, 'lock')))['status'] == 'accepted'
            saved = await store.load(game.table.table_id)
        assert (await execute(inbox, lane, fence, users[0], request(saved, 'start')))['status'] == 'accepted'
        started = await store.load(game.table.table_id)
        detached = _DetachedHost(8)
        new = detached.game = rebuild_hosted_game(detached, started.checkpoint,
            receipt_snapshot=started.receipt_snapshot).game
        new_lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=new.durable_game_id))
        actor, action = command(new)
        await inbox.enqueue(new_lane, actor, action)
        assert (await GameLaneExecutor(inbox).execute_one(new_lane, fence)).outcome['status'] == 'accepted'
        assert (await pool.execute('SELECT count(*) FROM games')).rows == [(2,)]
        assert (await pool.execute('SELECT checkpoint FROM hosted_match_archives')).rows == [(archive,)]
    finally:
        await host.close()


async def test_departed_marriage_host_does_not_own_the_next_lobby(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, leave=True)
    try:
        before = await store.load(game.table.table_id)
        remaining = [p['user_id'] for p in before.checkpoint['data']['positions'] if p['seat'] is not None]
        departed = before.checkpoint['data']['host']['departed'][0]
        assert (await execute(inbox, lane, fence, departed, request(before)))['status'] == 'rejected'
        outcome = await execute(inbox, lane, fence, remaining[0], request(before))
        assert outcome['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['users'] == remaining
        assert saved.checkpoint['data']['host']['departed'] == []
        assert (await execute(inbox, lane, fence, remaining[0], request(saved, 'start')))['status'] == 'rejected'
        # A one-player Marriage rematch is an open lobby, not an automatic start.
        assert saved.checkpoint['data']['engine'] is None
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['actor', 'revision', 'match', 'payload'])
async def test_invalid_rematch_is_a_no_effect_rejection(database, case):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        before = await store.load(game.table.table_id)
        body = request(before)
        actor = users[-1] if case == 'actor' else users[0]
        if case == 'revision': body['expected_revision'] += 1
        if case == 'match': body['match_id'] = uuid4().hex
        if case == 'payload': body['payload'] = {'force': True}
        assert (await execute(inbox, lane, fence, actor, body))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM hosted_match_archives')).rows == [(0,)]
    finally:
        await host.close()


async def test_archive_and_rematch_rollback_then_unknown_commit_resolves_same_identity(database, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        before = await store.load(game.table.table_id)
        body = request(before)
        await pool.execute('''INSERT INTO scheduled_actions
            (action_id,lane_id,action_type,generation,due_at,command_id,command,match_id,payload)
            VALUES (%s,%s,'test',0,clock_timestamp(),'old-timer','test',%s,'{}')''',
            (uuid4(), lane, UUID(game.match_id)))
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT count(*) FROM hosted_match_archives')).rows == [(0,)]
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('response lost after commit')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await TableLaneExecutor(inbox).execute_one(lane, fence)
        saved = await store.load(game.table.table_id)
        notifications = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        outcome = (await inbox.enqueue(lane, users[0], body)).outcome
        assert outcome['match_id'] == saved.checkpoint['data']['match_id']
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == notifications
        assert (await pool.execute('SELECT count(*) FROM hosted_match_archives')).rows == [(1,)]
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('cancelled',)]
        with pytest.raises(DurableGameConflict, match='different request'):
            await inbox.enqueue(lane, users[0], {**body, 'payload': {'changed': True}})
    finally:
        await host.close()


async def test_archives_require_current_completion_and_are_immutable(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        saved = await store.load(game.table.table_id)
        with pytest.raises(CheckViolation, match='current completed'):
            await pool.execute('''INSERT INTO hosted_match_archives
                (game_id,table_id,match_id,table_revision,checkpoint) VALUES (%s,%s,%s,%s,%s)''',
                (game.durable_game_id, UUID(game.table.table_id), UUID(game.match_id), 99, Jsonb(saved.checkpoint)))
        assert (await execute(inbox, lane, fence, users[0], request(saved)))['status'] == 'accepted'
        with pytest.raises(CheckViolation, match='immutable'):
            await pool.execute("UPDATE hosted_match_archives SET checkpoint='{}'")
        with pytest.raises(CheckViolation, match='immutable'):
            await pool.execute('DELETE FROM hosted_match_archives')
        assert (await pool.execute('SELECT checkpoint FROM hosted_match_archives')).rows == [(saved.checkpoint,)]
    finally:
        await host.close()


async def test_missing_settlement_intent_and_stale_owner_leave_rematch_pending(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        before = await store.load(game.table.table_id)
        body = request(before)
        await inbox.enqueue(lane, users[0], body)
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        with pytest.raises(StaleGameOwner): await TableLaneExecutor(inbox).execute_one(lane, fence)
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()+interval '1 hour'")
        await pool.execute('DELETE FROM game_finalization_jobs')
        with pytest.raises(DurableGameConflict, match='finalization intent'):
            await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['active', 'closed', 'flush'])
async def test_rematch_does_not_replace_an_active_closed_or_flush_table(database, case):
    pool, store, fence, users = database
    host, game, inbox, _, _ = await setup_game(database, 'flush' if case == 'flush' else 'marriage')
    try:
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        saved = await store.load(game.table.table_id)
        if case == 'closed':
            assert (await execute(inbox, lane, fence, users[0], request(saved, 'end')))['status'] == 'accepted'
            saved = await store.load(game.table.table_id)
        assert (await execute(inbox, lane, fence, users[0], request(saved)))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == saved
        assert (await pool.execute('SELECT count(*) FROM hosted_match_archives')).rows == [(0,)]
    finally:
        await host.close()


@pytest.mark.parametrize('pending_offer', [False, True])
async def test_outstanding_releases_or_offers_prevent_rematch(database, pending_offer):
    from app.multiplayer.table import SeatOffer
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        saved = await store.load(game.table.table_id)
        detached_host = _DetachedHost(8)
        detached = detached_host.game = rebuild_hosted_game(detached_host, saved.checkpoint,
            receipt_snapshot=saved.receipt_snapshot).game
        detached.table.next_seats[0] = None
        detached.table.releases[1] = users[0]
        if pending_offer:
            offer = SeatOffer(uuid4().hex, game.match_id, 1, users[0], users[-1], 1.0, 31.0)
            detached.table.offers[offer.offer_id] = offer
        revision = saved.checkpoint['data']['table_revision']
        await store.save(capture_checkpoint(detached, table_revision=revision + 1), expected_revision=revision, fence=fence)
        before = await store.load(game.table.table_id)
        assert (await execute(inbox, lane, fence, users[1], request(before)))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
    finally:
        await host.close()


async def test_new_match_preserves_queue_but_archives_old_match_invitations(database):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        saved = await store.load(game.table.table_id)
        detached_host = _DetachedHost(8)
        detached = detached_host.game = rebuild_hosted_game(detached_host, saved.checkpoint,
            receipt_snapshot=saved.receipt_snapshot).game
        detached.table.queue.append(users[-1])
        revision = saved.checkpoint['data']['table_revision']
        invitation = dict(room_id='room', match_id=game.match_id, status='pending', recipient_id=users[-2])
        await store.save(capture_checkpoint(detached, table_revision=revision + 1, invitations=[invitation]),
            expected_revision=revision, fence=fence)
        before = await store.load(game.table.table_id)
        assert (await execute(inbox, lane, fence, users[0], request(before)))['status'] == 'accepted'
        after = await store.load(game.table.table_id)
        assert after.checkpoint['data']['positions'] == before.checkpoint['data']['positions']
        assert after.checkpoint['data']['invitations'] == []
        assert (await pool.execute('SELECT checkpoint FROM hosted_match_archives')).rows == [(before.checkpoint,)]
    finally:
        await host.close()
