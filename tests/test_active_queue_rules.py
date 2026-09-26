"""Active waitlists and rules commands retain durable receipts and engine state."""
from dataclasses import asdict
from uuid import UUID, uuid4

import pytest

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.table_executor import TableLaneExecutor
from test_checkpoint_store import database, host_game


def queue(saved):
    return [p['user_id'] for p in sorted(
        (p for p in saved.checkpoint['data']['positions'] if p['queue_position'] is not None),
        key=lambda p: p['queue_position'])]


async def action(store, inbox, lane, fence, game, actor, name, payload=None, revision=None):
    saved = await store.load(game.table.table_id)
    body = dict(command_id=uuid4().hex, match_id=game.match_id, command=name,
        expected_revision=saved.checkpoint['data']['table_revision'] if revision is None else revision,
        payload=payload or {})
    await inbox.enqueue(lane, actor, body)
    result = await TableLaneExecutor(inbox).execute_one(lane, fence)
    return result.outcome, body


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_active_queue_fifo_retries_and_stale_revision_preserve_engine(database, kind):
    pool, store, fence, users = database
    host, game = await host_game(users, kind)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        before = await store.load(game.table.table_id)
        for actor in users[-2:]:
            result, body = await action(store, inbox, lane, fence, game, actor, 'join-queue')
            assert result['status'] == 'accepted'
            assert (await inbox.enqueue(lane, actor, body)).outcome == result
        assert (await action(store, inbox, lane, fence, game, users[-1], 'leave-queue', revision=0))[0]['status'] == 'rejected'
        saved = await store.load(game.table.table_id)
        assert queue(saved) == users[-2:]
        assert (await action(store, inbox, lane, fence, game, users[-2], 'leave-queue'))[0]['status'] == 'accepted'
        after = await store.load(game.table.table_id)
        assert after.checkpoint['data']['engine'] == before.checkpoint['data']['engine']
        assert after.receipt_snapshot == before.receipt_snapshot
        assert queue(after) == users[-1:]
        assert (await pool.execute('SELECT count(*) FROM game_commands')).rows == [(0,)]
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_propose_vote_and_recover_rules_without_engine_mutation(database, kind):
    _, store, fence, users = database
    host, game = await host_game(users, kind, started=False)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(store.pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        name, payload = ('settings', {'weak_hand_enabled': False, 'payments': [1,2,3,4]}) if kind == 'callbreak' else (
            ('marriage-settings', {'scoring': asdict(game.marriage_scoring)}) if kind == 'marriage' else
            ('flush-settings', {'rules_revision': 0, 'rules': asdict(game.flush_rules)}))
        denied, _ = await action(store, inbox, lane, fence, game, users[-1], name, payload)
        assert denied['status'] == 'rejected'
        result, body = await action(store, inbox, lane, fence, game, game.users[0], name, payload)
        assert result['status'] == 'accepted'
        proposal = (await store.load(game.table.table_id)).checkpoint['data']['host']['rule_proposal']
        assert proposal['status'] == 'PENDING'
        assert (await inbox.enqueue(lane, game.users[0], body)).outcome == result
        for actor in game.users[1:]:
            result, _ = await action(store, inbox, lane, fence, game, actor, 'rule-vote',
                {'proposal_id': proposal['id'], 'accept': True})
            assert result['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['rule_proposal']['status'] == 'ACCEPTED'
        assert saved.checkpoint['data']['engine'] is None
        if kind == 'flush': assert saved.checkpoint['data']['host']['flush_rules_revision'] == 1
    finally:
        await host.close()


async def test_roster_change_cancels_proposal_and_invalid_settings_do_not_mutate(database):
    pool, store, fence, users = database
    host, game = await host_game(users, 'callbreak', started=False)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        before = await store.load(game.table.table_id)
        assert (await action(store, inbox, lane, fence, game, users[0], 'settings', {'payments':[True,0,0,0]}))[0]['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await action(store, inbox, lane, fence, game, users[0], 'settings', {'weak_hand_enabled':False}))[0]['status'] == 'accepted'
        proposal = (await store.load(game.table.table_id)).checkpoint['data']['host']['rule_proposal']
        assert (await action(store, inbox, lane, fence, game, users[1], 'leave-seat'))[0]['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['rule_proposal']['status'] == 'CANCELLED'
        result, _ = await action(store, inbox, lane, fence, game, users[2], 'rule-vote', {'proposal_id':proposal['id'], 'accept':True})
        assert result['status'] == 'rejected'
        assert await store.load(game.table.table_id) == saved
    finally:
        await host.close()
