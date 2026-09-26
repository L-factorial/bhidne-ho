"""Completed roster edits preserve historical engines and settlement inputs."""
from contextlib import asynccontextmanager

import pytest
from psycopg import OperationalError

from app.durable_games.checkpoint_store import user_uuid
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database
from test_rematch import completed, execute, request


@pytest.mark.parametrize('kind', ['callbreak', 'marriage'])
async def test_release_queue_and_rematch_preserve_history(database, kind):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, kind)
    try:
        before = await store.load(game.table.table_id)
        jobs = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        async def action(actor, name):
            saved = await store.load(game.table.table_id)
            return await execute(inbox, lane, fence, actor, request(saved, name))
        assert (await action(users[0], 'join-queue'))['status'] == 'rejected'
        assert (await action(users[-1], 'join-queue'))['status'] == 'accepted'
        body = request(await store.load(game.table.table_id), 'leave-seat')
        outcome = await execute(inbox, lane, fence, users[0], body)
        assert outcome['status'] == 'accepted'
        released = await store.load(game.table.table_id)
        assert (await inbox.enqueue(lane, users[0], body)).outcome == outcome
        data = released.checkpoint['data']
        assert data['engine'] == before.checkpoint['data']['engine']
        assert data['host']['users'] == before.checkpoint['data']['host']['users']
        assert users[0] in data['host']['departed']
        assert released.receipt_snapshot == before.receipt_snapshot
        assert not any(p['seat'] is not None and p['user_id'] == users[0] for p in data['positions'])
        assert (await pool.execute('SELECT count(*) FROM active_table_players WHERE user_id=%s', (user_uuid(users[0]),))).rows == [(0,)]
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == jobs
        assert bool(data['table']['offers']) == (kind == 'callbreak')
        if kind == 'callbreak':
            assert data['table']['offers'][0]['offered_to_player_id'] == users[-1]
        assert bool(data['table']['releases']) == (kind == 'callbreak')
        # Historical engine membership must not prevent joining the next roster's queue.
        assert (await action(users[0], 'join-queue'))['status'] == 'accepted'
        assert (await action(users[-1], 'leave-queue'))['status'] == 'accepted'
        assert (await action(users[0], 'leave-queue'))['status'] == 'accepted'
        assert (await action(users[0], 'leave-seat'))['status'] == 'accepted'
        assert (await action(users[1], 'next-match'))['status'] == ('rejected' if kind == 'callbreak' else 'accepted')
        if kind == 'marriage':
            archive = (await pool.execute('SELECT checkpoint FROM hosted_match_archives')).rows[0][0]
            assert archive['data']['engine'] == before.checkpoint['data']['engine']
            assert (await store.load(game.table.table_id)).checkpoint['data']['host']['users'] == [users[1]]
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage'])
async def test_all_completed_seats_can_release_without_rewriting_engine(database, kind):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, kind)
    try:
        before = await store.load(game.table.table_id)
        for actor in game.users:
            saved = await store.load(game.table.table_id)
            assert (await execute(inbox, lane, fence, actor, request(saved, 'leave-seat')))['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['engine'] == before.checkpoint['data']['engine']
        assert saved.checkpoint['data']['phase'] == 'COMPLETED'
        assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows == [(0,)]
        assert (await pool.execute('SELECT open_table_count FROM rooms')).rows == [(1,)]
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage'])
async def test_release_rollback_and_unknown_commit_retry(database, kind, monkeypatch):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, kind)
    try:
        before = await store.load(game.table.table_id)
        body = request(before, 'leave-seat')
        await inbox.enqueue(lane, users[0], body)
        with pytest.raises(DurableGameConflict, match='event batch'):
            await TableLaneExecutor(inbox, max_events=1).execute_one(lane, fence)
        assert await store.load(game.table.table_id) == before
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction():
                yield pool
            raise OperationalError('response lost after commit')
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError):
                await TableLaneExecutor(inbox).execute_one(lane, fence)
        after = await store.load(game.table.table_id)
        events = (await pool.execute('SELECT count(*) FROM notification_outbox')).rows
        assert (await inbox.enqueue(lane, users[0], body)).outcome['status'] == 'accepted'
        assert await TableLaneExecutor(inbox).execute_one(lane, fence) is None
        assert await store.load(game.table.table_id) == after
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == events
    finally:
        await host.close()


@pytest.mark.parametrize('case', ['revision', 'payload', 'membership', 'intent', 'fence'])
async def test_invalid_completed_roster_command_preserves_state(database, case):
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database)
    try:
        before = await store.load(game.table.table_id)
        actor = users[-1] if case == 'membership' else users[0]
        body = request(before, 'leave-seat')
        if case == 'revision': body['expected_revision'] += 1
        if case == 'payload': body['payload'] = {'force': True}
        if case == 'membership':
            await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (user_uuid(actor),))
        if case == 'intent': await pool.execute('DELETE FROM game_finalization_jobs')
        if case == 'fence':
            await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        await inbox.enqueue(lane, actor, body)
        if case in ('intent', 'fence'):
            with pytest.raises(StaleGameOwner if case == 'fence' else DurableGameConflict):
                await TableLaneExecutor(inbox).execute_one(lane, fence)
            assert (await inbox.lookup(lane, actor, body['command_id'])).status == 'pending'
        else:
            assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
    finally:
        await host.close()
