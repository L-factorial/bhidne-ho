from uuid import UUID, uuid4

import pytest
from psycopg.errors import CheckViolation

from app.durable_games.chat import ChatIngress, ChatLaneExecutor, ChatHistory
from app.durable_games.delivery_store import PostgresDeliveryStore
from app.durable_games.inbox import PostgresInboxStore, LaneTarget
from app.durable_games.queries import QueryAccessDenied
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from test_checkpoint_store import database
from test_game_lane_executor import setup_game
from test_delivery import sql


def request(text='Hello', command_id=None):
    return dict(command_id=command_id or uuid4().hex, command='send-chat', payload={'text': text})


async def room(database):
    pool, _, fence, users = database
    inbox = PostgresInboxStore(pool)
    target = LaneTarget(kind='room_chat', room_id='room')
    return inbox, ChatIngress(inbox), ChatLaneExecutor(inbox), target


async def test_room_chat_is_atomic_ordered_deduplicated_and_replayed(database):
    pool, _, fence, users = database
    inbox, ingress, executor, target = await room(database)
    body = request(' Hello ')
    pending = await ingress.submit(users[0], target, body)
    lane = UUID(pending['lane_id'])
    result = await executor.execute_one(lane, fence)
    assert result.outcome['status'] == 'accepted'
    retry = await ingress.submit(users[0], target, body)
    assert retry['status'] == 'accepted' and retry['sequence'] == pending['sequence']
    with pytest.raises(DurableGameConflict): await ingress.submit(users[0], target, request('Different', body['command_id']))
    assert await executor.execute_one(lane, fence) is None
    messages = (await ChatHistory(pool).page(users[1], lane))['items']
    assert len(messages) == 1 and messages[0]['text'] == 'Hello'
    delivered = await PostgresDeliveryStore(pool).page(users[1], lane)
    assert [e['event_type'] for e in delivered.events] == ['CHAT_MESSAGE']
    assert delivered.events[0]['payload']['id'] == messages[0]['id']
    assert delivered.scanned_sequence == 2
    rejected = await ingress.submit(users[0], target, request('Too fast'))
    assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
    assert (await ingress.status(users[0], lane, rejected['command_id']))['status'] == 'rejected'
    assert len((await ChatHistory(pool).page(users[1], lane))['items']) == 1


async def test_admitted_chat_rechecks_membership_and_closed_room_receipts(database):
    pool, _, fence, users = database
    inbox, ingress, executor, target = await room(database)
    body = request()
    pending = await ingress.submit(users[0], target, body)
    lane = UUID(pending['lane_id'])
    await sql(pool, 'DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[0][5:]),))
    assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
    assert (await ingress.submit(users[0], target, body))['status'] == 'rejected'
    with pytest.raises(QueryAccessDenied): await ingress.submit(users[0], target, request())
    with pytest.raises(QueryAccessDenied): await ChatHistory(pool).page(users[0], lane)
    page = await PostgresDeliveryStore(pool).page(users[0], lane)
    assert [e['event_type'] for e in page.events] == ['CHAT_COMMAND_ACK']


async def test_message_and_receipt_roll_back_when_completion_fails(database, monkeypatch):
    pool, _, fence, users = database
    inbox, ingress, executor, target = await room(database)
    pending = await ingress.submit(users[0], target, request())
    lane = UUID(pending['lane_id'])
    original = inbox._complete
    async def fail(*args): raise RuntimeError('injected before commit')
    monkeypatch.setattr(inbox, '_complete', fail)
    with pytest.raises(RuntimeError): await executor.execute_one(lane, fence)
    assert await sql(pool, 'SELECT count(*) FROM room_chat_messages') == [(0,)]
    assert await sql(pool, 'SELECT count(*) FROM notification_outbox') == [(0,)]
    assert (await ingress.status(users[0], lane, pending['command_id']))['status'] == 'pending'
    monkeypatch.setattr(inbox, '_complete', original)
    assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_table_and_game_chat_are_separate_from_gameplay_and_scoped(database, kind):
    pool, checkpoints, fence, users = database
    host, game, inbox, game_lane, _ = await setup_game(database, kind)
    try:
        ingress, executor = ChatIngress(inbox), ChatLaneExecutor(inbox)
        before = await checkpoints.load(game.table.table_id)
        targets = [LaneTarget(kind=kind, room_id='room', table_id=UUID(game.table.table_id),
                    **({'game_id': game.durable_game_id} if kind == 'game_chat' else {}))
                   for kind in ('table_chat','game_chat')]
        lanes = []
        same_request = request()
        for target in targets:
            pending = await ingress.submit(users[0], target, same_request)
            lane = UUID(pending['lane_id'])
            lanes.append(lane)
            assert lane != game_lane
            assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
            assert len((await ChatHistory(pool).page(users[1], lane))['items']) == 1
            with pytest.raises(QueryAccessDenied): await ingress.submit(users[-1], target, request())
            with pytest.raises(QueryAccessDenied): await ChatHistory(pool).page(users[-1], lane)
            with pytest.raises(QueryAccessDenied): await PostgresDeliveryStore(pool).page(users[-1], lane)
        assert len(set(lanes)) == 2
        assert (await checkpoints.load(game.table.table_id)) == before
        await sql(pool, "UPDATE room_tables SET status='closed',closed_at=clock_timestamp() WHERE table_id=%s", (UUID(game.table.table_id),))
        for lane in lanes:
            with pytest.raises(QueryAccessDenied): await ChatHistory(pool).page(users[0], lane)
            assert all(e['event_type'] == 'CHAT_COMMAND_ACK' for e in (await PostgresDeliveryStore(pool).page(users[0], lane)).events)
        assert await sql(pool, 'SELECT count(*) FROM room_chat_messages') == [(2,)]
    finally:
        await host.close()


async def test_room_chat_preserves_active_play_pause(database):
    pool, _, _, users = database
    host, game, inbox, _, _ = await setup_game(database)
    try:
        ingress = ChatIngress(inbox)
        target = LaneTarget(kind='room_chat', room_id='room')
        with pytest.raises(QueryAccessDenied): await ingress.submit(users[0], target, request())
        assert (await ingress.submit(users[-1], target, request()))['status'] == 'pending'
    finally:
        await host.close()


async def test_replacement_room_owner_recovers_all_chat_scopes(database):
    from test_room_runtime import start, outcome
    pool, checkpoints, old_fence, users = database
    host, game, inbox, _, _ = await setup_game(database)
    runtime = None
    try:
        before = await checkpoints.load(game.table.table_id)
        ingress = ChatIngress(inbox)
        targets = [LaneTarget(kind='room_chat', room_id='room'),
            LaneTarget(kind='table_chat', room_id='room', table_id=UUID(game.table.table_id)),
            LaneTarget(kind='game_chat', room_id='room', table_id=UUID(game.table.table_id), game_id=game.durable_game_id)]
        pending = []
        for target in targets:
            actor = users[-1] if target.kind == 'room_chat' else users[0]
            body = request()
            accepted = await ingress.submit(actor, target, body)
            pending.append((UUID(accepted['lane_id']), actor, body))
        runtime, fence = await start(database)
        for lane, actor, body in pending:
            assert (await outcome(inbox, lane, actor, body))['status'] == 'accepted'
        assert fence.epoch > old_fence.epoch
        with pytest.raises(StaleGameOwner): await ChatLaneExecutor(inbox).execute_one(pending[0][0], old_fence)
        assert await sql(pool, 'SELECT count(*) FROM room_chat_messages') == [(3,)]
        assert await checkpoints.load(game.table.table_id) == before
    finally:
        if runtime: await runtime.stop()
        await host.close()


async def test_table_queue_read_access_but_no_send(database):
    from test_checkpoint_store import host_game
    from app.durable_games.checkpoints import capture_checkpoint
    from app.durable_games.table_executor import TableLaneExecutor
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, started=False)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        table = UUID(game.table.table_id)
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=table))
        await inbox.enqueue(lane, users[2], dict(command_id=uuid4().hex, command='join-queue',
            expected_revision=0, match_id=game.match_id, payload={}))
        assert (await TableLaneExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
        target = LaneTarget(kind='table_chat', room_id='room', table_id=table)
        ingress = ChatIngress(inbox)
        pending = await ingress.submit(users[0], target, request())
        chat = UUID(pending['lane_id'])
        await ChatLaneExecutor(inbox).execute_one(chat, fence)
        assert len((await ChatHistory(pool).page(users[2], chat))['items']) == 1
        assert len((await PostgresDeliveryStore(pool).page(users[2], chat)).events) == 1
        with pytest.raises(QueryAccessDenied): await ingress.submit(users[2], target, request())
        await sql(pool, 'DELETE FROM table_positions WHERE table_id=%s AND user_id=%s', (table, UUID(users[2][5:])))
        with pytest.raises(QueryAccessDenied): await ChatHistory(pool).page(users[2], chat)
    finally:
        await host.close()


async def test_table_history_survives_real_rematch_and_game_chat_closes(database):
    from test_game_lane_executor import command
    from test_rematch import request as table_request, execute as execute_table
    pool, checkpoints, fence, users = database
    host, game, inbox, game_lane, engine = await setup_game(database)
    try:
        table_id = UUID(game.table.table_id)
        table_target = LaneTarget(kind='table_chat', room_id='room', table_id=table_id)
        game_target = LaneTarget(kind='game_chat', room_id='room', table_id=table_id, game_id=game.durable_game_id)
        ingress = ChatIngress(inbox)
        chat_lanes = []
        for target in (table_target, game_target):
            pending = await ingress.submit(users[0], target, request())
            chat = UUID(pending['lane_id'])
            chat_lanes.append(chat)
            await ChatLaneExecutor(inbox).execute_one(chat, fence)
        actor, fold = command(game, 'FOLD')
        await inbox.enqueue(game_lane, actor, fold)
        assert (await engine.execute_one(game_lane, fence)).outcome['status'] == 'accepted'
        with pytest.raises(QueryAccessDenied): await ChatHistory(pool).page(users[0], chat_lanes[1])
        table_lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=table_id))
        saved = await checkpoints.load(table_id)
        rematch = await execute_table(inbox, table_lane, fence, users[0], table_request(saved))
        assert rematch['status'] == 'accepted'
        assert await inbox.ensure_lane(table_target) == chat_lanes[0]
        assert len((await ChatHistory(pool).page(users[0], chat_lanes[0]))['items']) == 1
        with pytest.raises(QueryAccessDenied): await ingress.submit(users[0], game_target, request())
    finally:
        await host.close()


async def test_deleted_room_closes_all_chat_reads_without_erasing_history(database):
    pool, _, fence, users = database
    inbox, ingress, executor, target = await room(database)
    body = request()
    pending = await ingress.submit(users[0], target, body)
    lane = UUID(pending['lane_id'])
    await executor.execute_one(lane, fence)
    await sql(pool, "INSERT INTO deleted_rooms(id) VALUES ('room')")
    with pytest.raises(QueryAccessDenied): await ChatHistory(pool).page(users[0], lane)
    with pytest.raises(QueryAccessDenied): await ingress.submit(users[0], target, request())
    assert (await ingress.submit(users[0], target, body))['status'] == 'accepted'
    assert await sql(pool, 'SELECT count(*) FROM room_chat_messages') == [(1,)]


async def test_deleted_sender_pending_command_rejects_without_poisoning_lane(database):
    pool, _, fence, users = database
    inbox, ingress, executor, target = await room(database)
    pending = await ingress.submit(users[-1], target, request())
    lane = UUID(pending['lane_id'])
    await sql(pool, 'DELETE FROM users WHERE id=%s', (UUID(users[-1][5:]),))
    assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
    assert await sql(pool, 'SELECT count(*) FROM notification_outbox') == [(0,)]
    await ingress.submit(users[0], target, request())
    assert (await executor.execute_one(lane, fence)).outcome['status'] == 'accepted'
