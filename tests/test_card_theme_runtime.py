"""Actual SQL transactions for shared card themes and durable retry semantics."""
from uuid import UUID, uuid4

import pytest

from app.multiplayer.card_themes import card_theme_controller
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.table_executor import TableLaneExecutor
from app.durable_games.view_generation import projected_view
from test_checkpoint_store import database, host_game
from test_creation_executor import creation, request as creation_request, create


@pytest.mark.parametrize('kind', ['callbreak', 'flush', 'marriage'])
async def test_theme_command_is_shared_recoverable_revisioned_and_retry_safe(database, kind):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, kind, started=True)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        original = await checkpoints.load(game.table.table_id)
        lane_target = LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id))
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(lane_target)
        executor = TableLaneExecutor(inbox)
        controller = card_theme_controller(game)
        async def run(actor, theme, revision=0, **payload):
            body = dict(command_id=uuid4().hex, command='card-theme', match_id=game.match_id,
                        expected_revision=revision, payload=dict(card_theme=theme, **payload))
            await inbox.enqueue(lane, actor, body)
            return await executor.execute_one(lane, fence), body
        forbidden = next(user for user in users if user != controller)
        result, _ = await run(forbidden, 'everest')
        assert result.outcome['status'] == 'rejected' and result.outcome['revision'] == 0
        result, _ = await run(controller, 'not-bundled')
        assert result.outcome['status'] == 'rejected'
        result, _ = await run(controller, 'everest', controller='fake')
        assert result.outcome['status'] == 'rejected'
        accepted, body = await run(controller, 'everest')
        assert accepted.outcome['status'] == 'accepted' and accepted.outcome['revision'] == 1
        duplicate = await inbox.enqueue(lane, controller, body)
        assert duplicate.duplicate and duplicate.outcome == accepted.outcome
        assert await executor.execute_one(lane, fence) is None
        stale, _ = await run(controller, 'lumbini')
        assert stale.outcome['status'] == 'rejected' and stale.outcome['revision'] == 1
        saved = await checkpoints.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['card_theme'] == 'everest'
        assert saved.checkpoint['data']['engine'] == original.checkpoint['data']['engine']
        for actor in users:
            view = projected_view(saved.checkpoint, actor, {})
            assert view['card_theme'] == 'everest'
            assert view['can_change_card_theme'] == (actor == controller)
        recovered = rebuild_hosted_game(None, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
        assert recovered.card_theme == 'everest' and card_theme_controller(recovered) == controller
        # Detached execution preserves the live host until its authoritative refresh.
        assert game.card_theme == 'kathmandu'
        assert (await pool.execute("SELECT count(*) FROM notification_outbox WHERE lane_id=%s AND event_type='TABLE_STATE_CHANGED'", (lane,))).rows[0][0] >= 1
        await pool.execute('DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s', ('room', UUID(users[-1][5:])))
        nonmember, _ = await run(users[-1], 'rara', 1)
        assert nonmember.outcome['status'] == 'rejected' and 'member' in nonmember.outcome['detail']
    finally:
        await host.close()


async def test_durable_creation_stores_selected_theme(creation):
    _, checkpoints, _, users, _, _, _ = creation
    body = creation_request()
    body['payload']['card_theme'] = 'annapurna'
    outcome = await create(creation, users[0], body)
    assert outcome['status'] == 'accepted'
    saved = await checkpoints.load(outcome['table_id'])
    view = projected_view(saved.checkpoint, users[0], {})
    assert view['card_theme'] == 'annapurna' and view['can_change_card_theme']


@pytest.mark.parametrize('kind', ['marriage', 'callbreak'])
async def test_rematch_retains_table_card_theme(database, kind):
    from test_rematch import completed, request as rematch_request, execute as rematch_execute
    _, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, kind)
    try:
        before = await store.load(game.table.table_id)
        recovered = rebuild_hosted_game(None, before.checkpoint, receipt_snapshot=before.receipt_snapshot).game
        body = dict(command_id=uuid4().hex, command='card-theme', match_id=game.match_id,
            expected_revision=before.checkpoint['data']['table_revision'], payload={'card_theme': 'pokhara'})
        controller = card_theme_controller(recovered)
        assert (await rematch_execute(inbox, lane, fence, controller, body))['status'] == 'accepted'
        before_rematch = await store.load(game.table.table_id)
        outcome = await rematch_execute(inbox, lane, fence, users[0], rematch_request(before_rematch))
        assert outcome['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert saved.checkpoint['data']['host']['card_theme'] == 'pokhara'
        assert saved.checkpoint['data']['engine'] is None
        assert saved.checkpoint['data']['match_id'] != game.match_id
    finally:
        await host.close()
