"""Fenced closure, reservation release and queued gameplay on production SQL."""
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


async def setup(database, kind='marriage', started=True):
    pool, store, fence, users = database
    host, game = await host_game(users, kind, started=started)
    await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
    return host, game, inbox, lane


def request(game, name='end', revision=0):
    return dict(command_id=uuid4().hex, command=name, match_id=game.match_id,
                expected_revision=revision, payload={})


async def execute(inbox, lane, fence, actor, body):
    await inbox.enqueue(lane, actor, body)
    return (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
@pytest.mark.parametrize('started', [False, True])
async def test_end_releases_all_reservations_preserving_engine_and_retry(database, kind, started):
    pool, store, fence, users = database
    host, game, inbox, lane = await setup(database, kind, started)
    try:
        before = await store.load(game.table.table_id)
        body = request(game)
        outcome = await execute(inbox, lane, fence, users[0], body)
        assert outcome['status'] == 'accepted' and outcome['revision'] == 1
        saved = await store.load(game.table.table_id)
        data = saved.checkpoint['data']
        assert data['phase'] == 'ENDED' and data['host']['ended'] and data['positions'] == []
        assert data['engine'] == before.checkpoint['data']['engine']
        assert saved.receipt_snapshot == before.receipt_snapshot
        assert not game.ended
        for table in ('active_game_players', 'active_table_players', 'table_positions', 'game_events'):
            assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows == [(0,)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(0,)]
        if started:
            assert (await pool.execute('SELECT status FROM games')).rows == [('abandoned',)]
        rebuilt_host = _DetachedHost(8)
        restored = rebuilt_host.game = rebuild_hosted_game(rebuilt_host, saved.checkpoint,
            receipt_snapshot=saved.receipt_snapshot).game
        assert restored.ended
        count = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await inbox.enqueue(lane, users[0], body)).outcome == outcome
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == count
        # A fresh End request is a no-op success at the current table revision.
        assert (await execute(inbox, lane, fence, users[0], request(game, revision=1)))['status'] == 'accepted'
        assert await store.load(game.table.table_id) == saved
    finally:
        await host.close()


async def test_callbreak_abandon_and_queued_gameplay_cannot_advance_closed_engine(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await setup(database, 'callbreak')
    try:
        game_lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        actor, action = command(game)
        await inbox.enqueue(game_lane, actor, action)
        before = (await store.load(game.table.table_id)).checkpoint['data']['engine']
        body = request(game, 'abandon')
        result = await execute(inbox, lane, fence, users[1], body)
        assert result['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['departed'] == [users[1]]
        assert saved.checkpoint['data']['engine'] == before
        assert (await GameLaneExecutor(inbox).execute_one(game_lane, fence)).outcome['status'] == 'rejected'
        after = await store.load(game.table.table_id)
        assert after.checkpoint == saved.checkpoint and after.receipt_snapshot['receipt_count'] == 1
        with pytest.raises(DurableGameConflict, match='no longer'):
            await inbox.enqueue(game_lane, actor, {**action, 'command_id': uuid4().hex})
        assert (await pool.execute('SELECT count(*) FROM game_finalization_jobs')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['noncreator', 'nonmember', 'stale', 'match', 'payload',
                                  'marriage_abandon', 'flush_abandon', 'spectator_abandon', 'lobby_abandon'])
async def test_invalid_closure_has_no_effect(database, case):
    pool, store, fence, users = database
    kind = 'flush' if case == 'flush_abandon' else 'marriage' if case == 'marriage_abandon' else 'callbreak'
    host, game, inbox, lane = await setup(database, kind, case != 'lobby_abandon')
    try:
        body = request(game, 'abandon' if 'abandon' in case else 'end')
        actor = users[0]
        if case == 'noncreator': actor = users[1]
        if case == 'spectator_abandon': actor = users[-1]
        if case == 'nonmember':
            actor = users[-1]
            await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
        if case == 'stale': body['expected_revision'] = 99
        if case == 'match': body['match_id'] = uuid4().hex
        if case == 'payload': body['payload'] = {'force': True}
        before = await store.load(game.table.table_id)
        assert (await execute(inbox, lane, fence, actor, body))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
    finally:
        await host.close()


async def test_pending_timers_cancel_atomically_and_sole_member_can_repeat_end(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await setup(database)
    try:
        await pool.execute('''INSERT INTO scheduled_actions
            (action_id,lane_id,action_type,generation,due_at,command_id,command,match_id,payload)
            VALUES (%s,%s,'test',0,clock_timestamp(),'timer','next-match',%s,'{}')''',
            (uuid4(), lane, UUID(game.match_id)))
        body = request(game)
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('pending',)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(2,)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
        assert (await inbox.lookup(lane, users[0], body['command_id'])).status == 'pending'
        assert (await store.load(game.table.table_id)).checkpoint['data']['table_revision'] == 0
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
        assert (await pool.execute('SELECT status FROM scheduled_actions')).rows == [('cancelled',)]
        assert (await pool.execute('SELECT count(*) FROM active_game_players')).rows == [(0,)]
        await pool.execute('DELETE FROM room_memberships WHERE user_id<>%s', (UUID(users[-1][5:]),))
        assert (await execute(inbox, lane, fence, users[-1], request(game, revision=1)))['status'] == 'accepted'
    finally:
        await host.close()


async def test_unknown_commit_and_stale_owner_do_not_repeat_closure(database):
    pool, store, fence, users = database
    host, game, inbox, lane = await setup(database)
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
        body = request(game)
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(OperationalError):
            await TableLaneExecutor(PostgresInboxStore(LostCommit())).execute_one(lane, fence)
        before = await store.load(game.table.table_id)
        assert (await inbox.enqueue(lane, users[0], body)).outcome['status'] == 'accepted'
        await inbox.enqueue(lane, users[0], request(game, revision=1))
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        with pytest.raises(StaleGameOwner):
            await TableLaneExecutor(inbox).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(0,)]
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_finished_game_policy_preserves_settlement_intent(database, kind):
    pool, store, fence, users = database
    host, game, inbox, lane = await setup(database, kind)
    try:
        game_lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        names = ('FOLD',) if kind == 'marriage' else ('DEAL_CARDS', 'SKIP_CUT', 'FOLD')
        for name in names:
            stored = await store.load(game.table.table_id)
            detached_host = _DetachedHost(8)
            detached = detached_host.game = rebuild_hosted_game(detached_host, stored.checkpoint,
                receipt_snapshot=stored.receipt_snapshot).game
            actor, body = command(detached, name)
            await inbox.enqueue(game_lane, actor, body)
            assert (await GameLaneExecutor(inbox).execute_one(game_lane, fence)).outcome['status'] == 'accepted'
        before = await store.load(game.table.table_id)
        jobs = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        assert len(jobs) == 1
        outcome = await execute(inbox, lane, fence, users[0], request(game, revision=len(names)))
        assert outcome['status'] == ('rejected' if kind == 'marriage' else 'accepted')
        after = await store.load(game.table.table_id)
        assert after.checkpoint['data']['engine'] == before.checkpoint['data']['engine']
        assert after.receipt_snapshot == before.receipt_snapshot
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == jobs
        assert (await pool.execute('SELECT status FROM games')).rows == [('completed',)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1 if kind == 'marriage' else 0,)]
    finally:
        await host.close()


async def test_end_clears_queue_and_invitations_without_touching_other_table(database):
    pool, store, fence, users = database
    host, game = await host_game(users[:2], started=False)
    other_host, other = await host_game(users[2:4], started=False)
    try:
        game.table.queue.append(users[-1])
        invitation = dict(room_id='room', match_id=game.match_id, status='pending', recipient_id=users[-2])
        await store.save(capture_checkpoint(game, table_revision=0, invitations=[invitation]), expected_revision=None, fence=fence)
        await store.save(capture_checkpoint(other, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lanes = [await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(g.table.table_id)))
                 for g in (game, other)]
        for lane in lanes:
            await pool.execute('''INSERT INTO scheduled_actions
                (action_id,lane_id,action_type,generation,due_at,command_id,command,payload)
                VALUES (%s,%s,'test',0,clock_timestamp(),'timer','test','{}')''', (uuid4(), lane))
        before_other = await store.load(other.table.table_id)
        assert (await execute(inbox, lanes[0], fence, users[0], request(game)))['status'] == 'accepted'
        after = await store.load(game.table.table_id)
        assert after.checkpoint['data']['positions'] == []
        assert after.checkpoint['data']['invitations'][0]['status'] == 'cancelled'
        assert await store.load(other.table.table_id) == before_other
        assert (await pool.execute('SELECT status FROM scheduled_actions WHERE lane_id=%s', (lanes[1],))).rows == [('pending',)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
        assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows == [(2,)]
    finally:
        await host.close()
        await other_host.close()


async def test_end_during_callbreak_summary_recovers_without_timer_capability(database):
    from callbreak import (GameConfig, Phase, PlaceBid, PlayCard, RedealPolicy, StartDeal,
                          apply_control, apply_player, available_cards, create_match)
    from card_utils import standard_52
    from app.durable_games.room_recovery import PostgresRoomRecoveryStore, UnsupportedRecoveryWork
    pool, store, fence, users = database
    host, game = await host_game(users, 'callbreak')
    try:
        state = create_match(GameConfig(redeal_policy=RedealPolicy(weak_hand_enabled=False, no_spades_enabled=False)))
        state = apply_control(state, StartDeal(standard_52())).state
        while state.phase != Phase.DEAL_COMPLETE:
            action = PlaceBid(1) if state.phase == Phase.BIDDING else PlayCard(available_cards(state, state.current_player)[0])
            state = apply_player(state, state.current_player, action).state
        game.state = state
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        with pytest.raises(UnsupportedRecoveryWork, match='summary'):
            await PostgresRoomRecoveryStore(pool).load(fence, _DetachedHost(8))
        await pool.execute("UPDATE room_ownership SET runtime_status='serving'")
        assert (await execute(inbox, lane, fence, users[0], request(game)))['status'] == 'accepted'
        await pool.execute("UPDATE room_ownership SET runtime_status='recovering'")
        inventory = await PostgresRoomRecoveryStore(pool).load(fence, _DetachedHost(8))
        assert len(inventory.tables) == 1 and not inventory.timers
    finally:
        await host.close()
