from uuid import UUID, uuid4

import pytest

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.ingress import HostedCommandIngress
from app.durable_games.queries import PostgresHostedQueries, QueryAccessDenied
from app.durable_games.store import DurableGameConflict, DurableGameNotFound
from app.durable_games.table_executor import TableLaneExecutor
from app.multiplayer.player_profiles import PlayerProfileService
from test_checkpoint_store import database, host_game


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_committed_remote_projection_private_seats_and_read_purity(database, kind):
    pool, store, fence, users = database
    host, game = await host_game(users, kind)
    host.profiles = PlayerProfileService()
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        before = await store.load(game.table.table_id)
        queries = PostgresHostedQueries(pool)
        for actor in (users[0], users[-1]):
            result = await queries.room('room', actor, table_id=game.table.table_id)
            expected = host._snapshot(game, actor)
            snapshot = result['snapshot']
            for key in expected:
                if key != 'tables':
                    assert snapshot[key] == expected[key]
            assert snapshot['table_revision'] == 0
            assert result['tables'][0]['table_id'] == game.table.table_id
        after = await store.load(game.table.table_id)
        assert before == after
        assert (await pool.execute('SELECT count(*) FROM notification_outbox')).rows == [(0,)]
        await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
        with pytest.raises(QueryAccessDenied):
            await queries.room('room', users[-1], table_id=game.table.table_id)
        with pytest.raises(DurableGameNotFound):
            await queries.room('room', users[0], table_id=uuid4())
    finally:
        await host.close()


async def test_pending_commit_before_failed_wakeup_own_status_and_retry(database):
    pool, store, fence, users = database
    host, game = await host_game(users, started=False)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        observed = []

        async def wakeup(room, lane):
            observed.append((await inbox.lookup(lane, users[-1], body['command_id'])).status)
            raise OSError('Redis unavailable')

        ingress = HostedCommandIngress(inbox, wakeup=wakeup)
        target = LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id))
        body = dict(command_id=uuid4().hex, match_id=game.match_id,
                    expected_revision=0, command='join-queue', payload={})
        pending = await ingress.submit(users[-1], target, body)
        assert pending['status'] == 'pending' and pending['outcome'] is None
        assert observed == ['pending']
        assert await ingress.submit(users[-1], target, body) == pending
        with pytest.raises(DurableGameConflict):
            await ingress.submit(users[-1], target, dict(body, command='leave-queue'))
        with pytest.raises(DurableGameNotFound):
            await ingress.status(users[0], pending['lane_id'], body['command_id'])
        await TableLaneExecutor(inbox).execute_one(UUID(pending['lane_id']), fence)
        accepted = await ingress.status(users[-1], pending['lane_id'], body['command_id'])
        assert accepted['status'] == 'accepted' and accepted['outcome']['revision'] == 1
        assert await ingress.submit(users[-1], target, body) == accepted
        await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[-1][5:]),))
        assert await ingress.status(users[-1], pending['lane_id'], body['command_id']) == accepted
        with pytest.raises(QueryAccessDenied):
            await ingress.submit(users[-1], target, dict(body, command_id=uuid4().hex))
        with pytest.raises(ValueError):
            await ingress.submit('system:timer', target, body)
    finally:
        await host.close()


async def test_unsupported_ingress_rolls_back_lane_and_command(database):
    pool, store, fence, users = database
    ingress = HostedCommandIngress(PostgresInboxStore(pool))
    with pytest.raises(DurableGameConflict):
        await ingress.submit(users[0], LaneTarget(kind='room', room_id='room'),
            dict(command_id=uuid4().hex, command='future-room-command', payload={}))
    assert (await pool.execute('SELECT count(*) FROM command_lanes')).rows == [(0,)]
    assert (await pool.execute('SELECT count(*) FROM command_inbox')).rows == [(0,)]
