"""Production inbox SQL against PostgreSQL/WASM; live lock races remain separate."""
from copy import deepcopy
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from psycopg.errors import CheckViolation

from app.durable_games.inbox import InboxRequest, LaneTarget, PostgresInboxStore
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.models.action import ReliableActionCommand
from app.runtime.command_runtime import request_fingerprint
from test_checkpoint_store import database, host_game, advance


def body(command_id='one', **changes):
    return {'command_id': command_id, 'command': 'SAY', 'payload': {'text': 'hello'}, **changes}


async def room_lane(pool, kind='room_chat', **bounds):
    store = PostgresInboxStore(pool, **bounds)
    lane = await store.ensure_lane(LaneTarget(kind=kind, room_id='room'))
    return store, lane


async def test_all_lane_targets_are_idempotent_and_isolated(database):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users)
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        store = PostgresInboxStore(pool)
        targets = [LaneTarget(kind=k, room_id='room') for k in ('room', 'room_chat')]
        targets += [LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)),
                    LaneTarget(kind='game', room_id='room', table_id=UUID(game.table.table_id), game_id=game.durable_game_id),
                    LaneTarget(kind='conversation', user_low=UUID(int=1), user_high=UUID(int=2)),
                    LaneTarget(kind='recipient', recipient_id=UUID(int=1))]
        lanes = []
        for target in targets:
            lane = await store.ensure_lane(target)
            assert await store.ensure_lane(target) == lane
            lanes.append(lane)
        assert len(set(lanes)) == 6
        with pytest.raises(ValueError):
            LaneTarget(kind='conversation', user_low=UUID(int=2), user_high=UUID(int=1))
        with pytest.raises(ValueError):
            LaneTarget(kind='room', room_id='room', game_id=uuid4())
    finally:
        await host.close()


async def test_dedup_order_limits_actor_isolation_and_terminal_retries(database):
    pool, _, fence, users = database
    store, lane = await room_lane(pool, max_pending=2)
    first = await store.enqueue(lane, users[0], body())
    second = await store.enqueue(lane, users[1], body())
    assert (first.sequence, second.sequence) == (1, 2)
    assert (await store.enqueue(lane, users[0], body())).duplicate
    with pytest.raises(DurableGameConflict, match='different request'):
        await store.enqueue(lane, users[0], body(payload={'text': 'changed'}))
    with pytest.raises(DurableGameConflict, match='pending limit'):
        await store.enqueue(lane, users[0], body('third'))
    assert await store.lookup(lane, users[2], 'one') is None
    assert await store.pending_lanes(room_id='room') == (lane,)
    for expected in (first, second):
        async with store.claim(lane, fence=fence) as claim:
            assert claim.entry == expected
            await claim.complete({'command_id': 'one', 'status': 'accepted'})
    assert await store.pending_lanes(room_id='room') == ()
    async with store.claim(lane, fence=fence) as empty:
        assert empty is None
    retried = await store.enqueue(lane, users[0], body())
    assert retried.duplicate and retried.status == 'accepted' and retried.sequence == 1
    assert (await store.enqueue(lane, users[0], body('third'))).sequence == 3
    with pytest.raises(CheckViolation):
        await pool.execute("UPDATE command_inbox SET original_request='{}'")
    with pytest.raises(CheckViolation):
        await pool.execute("UPDATE command_inbox SET dedup_match_id=%s", (uuid4(),))


async def test_claim_abort_incomplete_and_stale_owner_do_not_advance(database):
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    await store.enqueue(lane, users[0], body())
    with pytest.raises(StaleGameOwner):
        async with store.claim(lane): pass
    with pytest.raises(StaleGameOwner):
        async with store.claim(lane, fence=replace(fence, epoch=2)): pass
    with pytest.raises(DurableGameConflict, match='without atomic completion'):
        async with store.claim(lane, fence=fence): pass
    with pytest.raises(RuntimeError, match='crash'):
        async with store.claim(lane, fence=fence) as claim:
            await claim.complete({'command_id': 'one', 'status': 'rejected', 'detail': 'denied'})
            await pool.execute("UPDATE rooms SET name='rolled back' WHERE id='room'")
            raise RuntimeError('crash after completion')
    assert (await store.lookup(lane, users[0], 'one')).status == 'pending'
    assert (await pool.execute("SELECT name FROM rooms WHERE id='room'")).rows == [('Room',)]
    with pytest.raises(DurableGameConflict, match='inactive'):
        await claim.complete({'command_id': 'one', 'status': 'accepted'})
    with pytest.raises(StaleGameOwner):
        async with store.claim(lane, fence=fence) as claim:
            await claim.complete({'command_id': 'one', 'status': 'accepted'})
            await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    assert (await store.lookup(lane, users[0], 'one')).status == 'pending'


async def test_allocation_rollback_has_no_sequence_gap_and_checks_size(database):
    pool, _, fence, users = database
    store, lane = await room_lane(pool, max_request_bytes=256)
    with pytest.raises(RuntimeError, match='open transaction'):
        await store.enqueue_in_transaction(pool, lane, users[0], body())
    with pytest.raises(RuntimeError, match='abort'):
        async with pool.transaction():
            await store.enqueue_in_transaction(pool, lane, users[0], body())
            raise RuntimeError('abort')
    with pytest.raises(DurableGameConflict, match='size limit'):
        await store.enqueue(lane, users[0], body(payload={'text': 'x' * 300}))
    assert (await store.enqueue(lane, users[0], body())).sequence == 1


async def test_missing_head_fails_closed_without_skipping(database):
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    await store.enqueue(lane, users[0], body())
    await store.enqueue(lane, users[0], body('two'))
    await pool.execute('DELETE FROM command_inbox WHERE lane_id=%s AND sequence=1', (lane,))
    with pytest.raises(DurableGameConflict, match='refusing to skip'):
        async with store.claim(lane, fence=fence): pass
    assert (await store.lookup(lane, users[0], 'two')).status == 'pending'


@pytest.mark.parametrize('kind', ['conversation', 'recipient'])
async def test_platform_lanes_use_transaction_ownership_without_room_lease(database, kind):
    pool, _, _, users = database
    store = PostgresInboxStore(pool)
    target = (LaneTarget(kind=kind, recipient_id=UUID(int=1)) if kind == 'recipient'
              else LaneTarget(kind=kind, user_low=UUID(int=1), user_high=UUID(int=2)))
    lane = await store.ensure_lane(target)
    await store.enqueue(lane, users[0], body())
    async with store.claim(lane) as claim:
        with pytest.raises(DurableGameConflict, match='another command'):
            await claim.complete({'command_id': 'wrong', 'status': 'accepted'})
        await claim.complete({'command_id': 'one', 'status': 'accepted'})
        with pytest.raises(DurableGameConflict, match='already completed'):
            await claim.complete({'command_id': 'one', 'status': 'accepted'})


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_game_receipt_checkpoint_and_inbox_complete_atomically(database, kind):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, kind)
    try:
        # Explicitly exercise a durable round ID different from the hosted match.
        if kind == 'flush': game.durable_game_id = uuid4()
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        store = PostgresInboxStore(pool)
        lane = await store.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        receipt = await advance(host, game)
        entry = await store.enqueue(lane, receipt['actor_id'], receipt['request'])
        assert entry.fingerprint == request_fingerprint(ReliableActionCommand(**receipt['request']))
        assert entry.request.match_id == game.match_id
        assert (await pool.execute('SELECT match_id FROM command_inbox WHERE lane_id=%s', (lane,))).rows == [(game.durable_game_id,)]
        candidate = capture_checkpoint(game, table_revision=1)
        with pytest.raises(DurableGameConflict, match='identical durable'):
            async with store.claim(lane, fence=fence) as claim:
                await claim.complete(receipt['outcome'])
        with pytest.raises(RuntimeError, match='crash'):
            async with store.claim(lane, fence=fence) as claim:
                await checkpoints.save_in_transaction(claim.connection, candidate, expected_revision=0,
                                                      fence=fence, receipt=receipt)
                await claim.complete(receipt['outcome'])
                raise RuntimeError('crash before commit')
        assert (await checkpoints.load(game.table.table_id)).receipt_snapshot['receipt_count'] == 0
        assert (await store.lookup(lane, receipt['actor_id'], entry.request.command_id)).status == 'pending'
        async with store.claim(lane, fence=fence) as claim:
            await checkpoints.save_in_transaction(claim.connection, candidate, expected_revision=0,
                                                  fence=fence, receipt=receipt)
            await claim.complete(receipt['outcome'])
        assert (await store.lookup(lane, receipt['actor_id'], entry.request.command_id)).outcome == receipt['outcome']
        rejected = await advance(host, game, expected=0)
        await store.enqueue(lane, rejected['actor_id'], rejected['request'])
        async with store.claim(lane, fence=fence) as claim:
            await checkpoints.save_in_transaction(claim.connection, capture_checkpoint(game, table_revision=2),
                                                  expected_revision=1, fence=fence, receipt=rejected)
            await claim.complete(rejected['outcome'])
        assert (await store.lookup(lane, rejected['actor_id'], rejected['request']['command_id'])).status == 'rejected'
    finally:
        await host.close()


async def test_flush_retry_follows_original_lane_after_round_rollover(database):
    pool, checkpoints, fence, users = database
    host, game = await host_game(users, 'flush')
    try:
        await checkpoints.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        store = PostgresInboxStore(pool)
        old_lane = await store.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        receipts = []
        for revision, command in enumerate(('DEAL_CARDS', 'SKIP_CUT', 'FOLD'), 1):
            receipt = await advance(host, game, command=command)
            receipts.append(receipt)
            await store.enqueue(old_lane, receipt['actor_id'], receipt['request'])
            async with store.claim(old_lane, fence=fence) as claim:
                await checkpoints.save_in_transaction(claim.connection, capture_checkpoint(game, table_revision=revision),
                    expected_revision=revision - 1, fence=fence, receipt=receipt)
                await claim.complete(receipt['outcome'])
        await host.table_command('room', users[0], game.match_id, 'lock')
        await host.start('room', users[0], game.match_id, rules_revision=0)
        game.durable_game_id = uuid4()
        await checkpoints.save(capture_checkpoint(game, table_revision=4), expected_revision=3, fence=fence)
        new_lane = await store.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        retry = await store.enqueue(new_lane, receipts[0]['actor_id'], receipts[0]['request'])
        assert retry.duplicate and retry.lane_id == old_lane and retry.outcome == receipts[0]['outcome']
        assert (await pool.execute('SELECT enqueued_sequence FROM command_lanes WHERE lane_id=%s', (new_lane,))).rows == [(0,)]
        conflicting = deepcopy(receipts[0]['request'])
        conflicting['expected_revision'] += 1
        with pytest.raises(DurableGameConflict, match='different request'):
            await store.enqueue(new_lane, receipts[0]['actor_id'], conflicting)
        # A fresh request cannot be routed back into the ended round.
        request = {**receipts[0]['request'], 'command_id': 'new-old-round'}
        with pytest.raises(DurableGameConflict, match='no longer'):
            await store.enqueue(old_lane, receipts[0]['actor_id'], request)
    finally:
        await host.close()


async def test_unsupported_original_request_at_head_is_not_silently_reconstructed(database):
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    async with pool.transaction():
        await pool.execute('''INSERT INTO command_inbox
            (lane_id,sequence,actor_id,command_id,command,payload,request_fingerprint)
            VALUES (%s,1,%s,'legacy','SAY','{}','unknown')''', (lane, users[0]))
        await pool.execute('UPDATE command_lanes SET enqueued_sequence=1 WHERE lane_id=%s', (lane,))
    with pytest.raises(DurableGameConflict, match='supported original'):
        async with store.claim(lane, fence=fence): pass
    assert (await pool.execute('SELECT processed_sequence FROM command_lanes WHERE lane_id=%s', (lane,))).rows == [(0,)]
