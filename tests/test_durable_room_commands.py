from uuid import UUID, uuid4

import pytest

from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.creation_executor import RoomCreationExecutor
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from test_checkpoint_store import database, host_game


async def run(pool, fence, actor, command, payload=None):
    inbox = PostgresInboxStore(pool)
    lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
    request = dict(command_id=uuid4().hex, command=command, payload=payload or {})
    await inbox.enqueue(lane, actor, request)
    result = await RoomCreationExecutor(inbox).execute_one(lane, fence)
    assert (await inbox.enqueue(lane, actor, request)).outcome == result.outcome
    return result.outcome


async def test_room_invite_entry_privacy_and_deletion(database):
    pool, store, fence, users = database
    actor = users[-1]
    await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(actor[5:]),))
    assert (await run(pool, fence, actor, 'enter-room'))['status'] == 'rejected'
    assert (await run(pool, fence, actor, 'room-visibility', {'visibility':'public'}))['status'] == 'rejected'
    assert (await run(pool, fence, users[0], 'invite-room', {'recipients':[actor]}))['status'] == 'accepted'
    invitation = (await pool.execute('SELECT id FROM room_invitations')).rows[0][0]
    assert (await run(pool, fence, users[1], 'answer-room-invitation', {'invitation_id':invitation,'accept':True}))['status'] == 'rejected'
    assert (await run(pool, fence, actor, 'answer-room-invitation', {'invitation_id':invitation,'accept':True}))['status'] == 'accepted'
    assert (await run(pool, fence, actor, 'leave-room'))['status'] == 'accepted'
    assert (await run(pool, fence, users[0], 'leave-room'))['status'] == 'rejected'
    assert (await run(pool, fence, users[0], 'room-visibility', {'visibility':'public'}))['status'] == 'accepted'
    assert (await run(pool, fence, actor, 'enter-room'))['status'] == 'accepted'
    assert (await run(pool, fence, users[0], 'delete-room'))['status'] == 'accepted'
    assert (await run(pool, fence, actor, 'enter-room'))['status'] == 'rejected'
    assert (await pool.execute('SELECT count(*) FROM room_memberships')).rows == [(0,)]
    assert (await pool.execute('SELECT count(*) FROM rooms')).rows == [(1,)]


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_room_departure_releases_lobby_seat_and_waitlist_atomically(database, kind):
    pool, store, fence, users = database
    host, game = await host_game(users, kind, started=False)
    try:
        game.table.queue.append(users[-1])
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        assert (await run(pool, fence, users[0], 'delete-room'))['status'] == 'rejected'
        assert (await run(pool, fence, users[1], 'leave-room'))['status'] == 'accepted'
        saved = await store.load(game.table.table_id)
        assert users[1] not in saved.checkpoint['data']['host']['users']
        assert users[-1] in saved.checkpoint['data']['host']['users']
        assert (await pool.execute('SELECT 1 FROM room_memberships WHERE user_id=%s',(UUID(users[1][5:]),))).rows == []
    finally:
        await host.close()


async def test_multi_table_departure_rolls_back_as_one_unit(database, monkeypatch):
    pool, store, fence, users = database
    from app.durable_games import room_commands
    host, game = await host_game(users[:2], started=False)
    other_host, other = await host_game(users[2:4], started=False)
    try:
        other.table.queue.append(users[1])
        for item in (game, other):
            await store.save(capture_checkpoint(item, table_revision=0), expected_revision=None, fence=fence)
        before = [await store.load(item.table.table_id) for item in (game, other)]
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='room', room_id='room'))
        body = dict(command_id=uuid4().hex, command='leave-room', payload={})
        await inbox.enqueue(lane, users[1], body)
        original, count = room_commands.append_lane_events, 0
        async def fail_second(*args, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError('outbox unavailable')
            await original(*args, **kwargs)
        monkeypatch.setattr(room_commands, 'append_lane_events', fail_second)
        with pytest.raises(OSError):
            await RoomCreationExecutor(inbox).execute_one(lane, fence)
        assert [await store.load(item.table.table_id) for item in (game, other)] == before
        assert (await inbox.lookup(lane, users[1], body['command_id'])).status == 'pending'
        monkeypatch.setattr(room_commands, 'append_lane_events', original)
        assert (await RoomCreationExecutor(inbox).execute_one(lane, fence)).outcome['status'] == 'accepted'
        for item in (game, other):
            assert all(p['user_id'] != users[1] for p in (await store.load(item.table.table_id)).checkpoint['data']['positions'])
    finally:
        await host.close()
        await other_host.close()


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_completed_departure_preserves_engine_and_schedules_table_offers(database, kind):
    pool, store, fence, users = database
    from app.durable_games.table_executor import TableLaneExecutor
    if kind == 'flush':
        from test_flush_restart import finished
        host, game, inbox, table_lane, *_ = await finished(database)
    else:
        from test_rematch import completed
        host, game, inbox, table_lane, *_ = await completed(database, kind)
    try:
        saved = await store.load(game.table.table_id)
        await inbox.enqueue(table_lane, users[-1], dict(command_id=uuid4().hex, command='join-queue',
            match_id=game.match_id, expected_revision=saved.checkpoint['data']['table_revision'], payload={}))
        assert (await TableLaneExecutor(inbox).execute_one(table_lane, fence)).outcome['status'] == 'accepted'
        before = await store.load(game.table.table_id)
        assert (await run(pool, fence, users[1], 'leave-room'))['status'] == 'accepted'
        after = await store.load(game.table.table_id)
        assert after.checkpoint['data']['engine'] == before.checkpoint['data']['engine']
        assert all(p['user_id'] != users[1] for p in after.checkpoint['data']['positions'])
        if kind == 'callbreak':
            offers = [o for o in after.checkpoint['data']['table']['offers'] if o['status'] == 'PENDING']
            assert offers[0]['offered_to_player_id'] == users[-1]
            assert (await pool.execute("SELECT lane_id FROM scheduled_actions WHERE action_type='seat_offer_expiry'")).rows == [(table_lane,)]
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_active_seat_blocks_room_departure_without_mutation(database, kind):
    pool, store, fence, users = database
    host, game = await host_game(users, kind)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        before = await store.load(game.table.table_id)
        assert (await run(pool, fence, users[1], 'leave-room'))['status'] == 'rejected'
        assert await store.load(game.table.table_id) == before
        assert (await pool.execute('SELECT 1 FROM room_memberships WHERE user_id=%s',(UUID(users[1][5:]),))).rows == [(1,)]
        # An unseated spectator can still leave an active room.
        assert (await run(pool, fence, users[-1], 'leave-room'))['status'] == 'accepted'
    finally:
        await host.close()
