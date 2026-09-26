"""Runs the production psycopg store SQL against PostgreSQL/WASM, not SQL mocks."""
from copy import deepcopy
from dataclasses import replace
from uuid import UUID, uuid4

import pytest
from psycopg.errors import CheckViolation

from app.database import MIGRATIONS
from app.durable_games.checkpoint_store import PostgresCheckpointStore, RoomWriteFence
from app.durable_games.checkpoints import CheckpointError, capture_checkpoint
from app.durable_games.recovery import rebuild_hosted_game
from app.durable_games.store import DurableGameConflict, StaleGameOwner, _token_hash
from app.models.action import ReliableActionCommand
from app.multiplayer.room_service import RoomService
from app.runtime.command_runtime import request_fingerprint
from app.test_games.http import GameAction
from app.test_games.service import TestGameService as GameHost
from pglite_support import PGlitePool
from test_hosted_checkpoints import engine_state, resign
from test_hosted_recovery import Delivery


@pytest.fixture
async def database():
    pool = await PGlitePool.open()
    try:
        for _, sql in MIGRATIONS:
            await pool.execute(sql, script=True)
        users = [f'user-{UUID(int=i)}' for i in range(1, 7)]
        for user in users:
            await pool.execute("INSERT INTO users (id,kind) VALUES (%s,'account')", (UUID(user[5:]),))
        await pool.execute("INSERT INTO rooms (id,creator_id,name,visibility) VALUES ('room',%s,'Room','private')", (UUID(int=1),))
        for user in users:
            await pool.execute("INSERT INTO room_memberships (room_id,user_id) VALUES ('room',%s)", (UUID(user[5:]),))
        await pool.execute("INSERT INTO server_instances (instance_id,internal_address) VALUES ('one','one')")
        fence = RoomWriteFence('room', 'one', 1, 'secret')
        await pool.execute('''INSERT INTO room_ownership
            (room_id,owner_instance_id,ownership_epoch,fencing_token_hash,lease_expires_at,runtime_status)
            VALUES ('room','one',1,%s,clock_timestamp()+interval '1 hour','serving')''', (_token_hash(fence.token),))
        yield pool, PostgresCheckpointStore(pool), fence, users
    finally:
        await pool.close()


async def host_game(users, kind='marriage', started=True):
    rooms = RoomService()
    for user in users:
        await rooms.join('room', user)
    host = GameHost(rooms, Delivery())
    count = 4 if kind == 'callbreak' else 2
    waiting = await host.create('room', users[0], count, kind)
    for user in users[1:count]:
        await host.join('room', user, waiting['match_id'])
    game = host.games['room']
    if kind == 'marriage':
        game.marriage_scoring = replace(game.marriage_scoring, initial_tunnela_declaration=False)
    if started:
        if kind != 'callbreak':
            await host.table_command('room', users[0], game.match_id, 'lock')
        await host.start('room', users[0], game.match_id, **({'rules_revision': 0} if kind == 'flush' else {}))
        game.durable_game_id = UUID(game.match_id)
    return host, game


async def advance(host, game, command=None, expected=None, command_id=None):
    state = engine_state(game)
    actor = (game.users[state.current_player - 1] if game.game_type == 'callbreak'
             else next(u for u in game.users if str(game.flush_seats[u]) == state.config.player_ids[state.current_seat])
             if game.game_type == 'flush' else game.users[state.current_seat])
    command = command or {'callbreak': 'SHUFFLE_DECK', 'marriage': 'DRAW_CARD', 'flush': 'DEAL_CARDS'}[game.game_type]
    request = GameAction(match_id=game.match_id, command_id=command_id or uuid4().hex,
        expected_revision=state.revision if expected is None else expected, command=command,
        payload={'source': 'stock'} if command == 'DRAW_CARD' else {})
    result = await host.action('room', actor, request)
    return {'actor_id': actor, 'request': request.model_dump(mode='json'),
            'fingerprint': request_fingerprint(request), 'outcome': result['action_ack']}


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_database_roundtrip_retries_rejections_and_detached_rebuild(database, kind):
    pool, store, fence, users = database
    host, game = await host_game(users, kind)
    recovered_host = GameHost(host.rooms, Delivery())
    try:
        initial = capture_checkpoint(game, table_revision=0)
        await store.save(initial, expected_revision=None, fence=fence)
        assert (await store.load(game.table.table_id)).checkpoint == initial
        receipt = await advance(host, game)
        checkpoint = capture_checkpoint(game, table_revision=1)
        saved = await store.save(checkpoint, expected_revision=0, fence=fence, receipt=receipt)
        assert saved.checkpoint == checkpoint
        assert saved.receipt_snapshot['receipts'] == [receipt]
        # An uncertain commit must not append events or reroll speculative cards.
        again = await store.save(checkpoint, expected_revision=0, fence=fence, receipt=receipt)
        assert again.duplicate
        assert (await pool.execute('SELECT count(*) FROM game_events')).rows == [(1,)]
        conflict = deepcopy(receipt)
        conflict['request']['payload'] = {'different': True}
        conflict['fingerprint'] = request_fingerprint(ReliableActionCommand(**conflict['request']))
        with pytest.raises(DurableGameConflict, match='different request'):
            await store.save(checkpoint, expected_revision=0, fence=fence, receipt=conflict)
        rejected = await advance(host, game, expected=0)
        assert rejected['outcome']['status'] == 'rejected'
        final = capture_checkpoint(game, table_revision=2)
        await store.save(final, expected_revision=1, fence=fence, receipt=rejected)
        loaded = await store.load(game.table.table_id)
        rebuilt = rebuild_hosted_game(recovered_host, loaded.checkpoint, receipt_snapshot=loaded.receipt_snapshot).game
        assert engine_state(rebuilt) == engine_state(game)
        assert rebuilt.commands.receipts == game.commands.receipts
        assert recovered_host.games == {}
        assert (await pool.execute('SELECT count(*) FROM game_events')).rows == [(1,)]
        request = ReliableActionCommand(**receipt['request'])
        assert await store.lookup_receipt(game.table.table_id, receipt['actor_id'], request) == receipt['outcome']
        assert await store.lookup_receipt(game.table.table_id, users[-1], request) is None
        # Terminal host state still retains receipts and releases all reservations.
        game.ended = True
        game.table.phase = 'ENDED'
        await store.save(capture_checkpoint(game, table_revision=3), expected_revision=2, fence=fence)
        assert (await pool.execute('SELECT count(*) FROM active_table_players')).rows == [(0,)]
        assert await store.lookup_receipt(game.table.table_id, receipt['actor_id'], request) == receipt['outcome']
    finally:
        await recovered_host.close()
        await host.close()


async def test_waiting_positions_membership_and_conflicting_reservation_rollback(database):
    pool, store, fence, users = database
    host, game = await host_game(users, started=False)
    other_host, other = await host_game(users, started=False)
    try:
        checkpoint = capture_checkpoint(game, table_revision=0)
        await store.save(checkpoint, expected_revision=None, fence=fence)
        assert (await store.save(checkpoint, expected_revision=None, fence=fence)).duplicate
        with pytest.raises(DurableGameConflict):
            await store.save(capture_checkpoint(other, table_revision=0), expected_revision=None, fence=fence)
        assert (await pool.execute('SELECT count(*) FROM room_tables')).rows == [(1,)]
        assert (await pool.execute("SELECT open_table_count FROM rooms WHERE id='room'")).rows == [(1,)]
        assert (await store.load(game.table.table_id)).checkpoint == checkpoint
        await pool.execute('DELETE FROM room_memberships WHERE user_id=%s', (UUID(users[0][5:]),))
        with pytest.raises(CheckpointError, match='former room member'):
            await store.load(game.table.table_id)
    finally:
        await host.close()
        await other_host.close()


async def test_stale_fence_revision_and_transaction_abort_leave_no_partial_state(database):
    pool, store, fence, users = database
    host, game = await host_game(users)
    try:
        initial = capture_checkpoint(game, table_revision=0)
        with pytest.raises(StaleGameOwner):
            await store.save(initial, expected_revision=None, fence=replace(fence, epoch=2))
        await store.save(initial, expected_revision=None, fence=fence)
        receipt = await advance(host, game)
        candidate = capture_checkpoint(game, table_revision=1)
        with pytest.raises(DurableGameConflict, match='revision changed'):
            await store.save(candidate, expected_revision=1, fence=fence, receipt=receipt)
        # Real transaction rollback after every storage step succeeds, before commit.
        async with pool.connection() as connection:
            with pytest.raises(RuntimeError, match='crash'):
                async with connection.transaction():
                    await store.save_in_transaction(connection, candidate, expected_revision=0, fence=fence, receipt=receipt)
                    raise RuntimeError('crash before commit')
        assert (await store.load(game.table.table_id)).checkpoint == initial
        assert (await pool.execute('SELECT count(*) FROM game_commands')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM game_snapshots')).rows == [(1,)]
        # Expire during the transaction: final wall-clock fence check must abort.
        original = store._positions
        async def expire(connection, *args):
            await original(connection, *args)
            await connection.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        store._positions = expire
        with pytest.raises(StaleGameOwner):
            await store.save(candidate, expected_revision=0, fence=fence, receipt=receipt)
        store._positions = original
        assert (await store.load(game.table.table_id)).checkpoint == initial
        await store.save(candidate, expected_revision=0, fence=fence, receipt=receipt)
        with pytest.raises(CheckViolation):
            await pool.execute("UPDATE game_commands SET request_fingerprint='changed'")
    finally:
        await host.close()


@pytest.mark.parametrize('sql,reason', [
    ('DELETE FROM active_table_players', 'reservations'),
    ('DELETE FROM table_positions', 'digest'),
    ('DELETE FROM game_events', 'journal'),
    ('DELETE FROM game_commands CASCADE', None),
])
async def test_corrupted_committed_view_fails_closed(database, sql, reason):
    pool, store, fence, users = database
    host, game = await host_game(users)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        receipt = await advance(host, game)
        await store.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence, receipt=receipt)
        if sql == 'DELETE FROM game_commands CASCADE':
            # Receipts are FK-protected by events; rejected receipts have no events.
            rejected = await advance(host, game, expected=0)
            await store.save(capture_checkpoint(game, table_revision=2), expected_revision=1, fence=fence, receipt=rejected)
            await pool.execute("DELETE FROM game_commands WHERE status='rejected'")
        else:
            await pool.execute(sql)
        with pytest.raises(ValueError, match=reason):
            await store.load(game.table.table_id)
    finally:
        await host.close()


async def test_waiting_to_started_and_rematch_preserve_historical_receipts(database):
    pool, store, fence, users = database
    host, game = await host_game(users, started=False)
    next_host, next_game = await host_game(users)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        await host.table_command('room', users[0], game.match_id, 'lock')
        await host.start('room', users[0], game.match_id)
        game.durable_game_id = UUID(game.match_id)
        await store.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=fence)
        receipt = await advance(host, game, command='FOLD')
        assert game.finished
        await store.save(capture_checkpoint(game, table_revision=2), expected_revision=1, fence=fence, receipt=receipt)
        next_game.table.table_id = game.table.table_id
        next_game.previous_match_id = game.match_id
        rematch = capture_checkpoint(next_game, table_revision=3)
        await store.save(rematch, expected_revision=2, fence=fence)
        loaded = await store.load(game.table.table_id)
        assert loaded.checkpoint == rematch and loaded.receipt_snapshot['receipt_count'] == 0
        assert (await pool.execute("SELECT count(*) FROM games WHERE status='active'")).rows == [(1,)]
        assert await store.lookup_receipt(game.table.table_id, receipt['actor_id'],
            ReliableActionCommand(**receipt['request'])) == receipt['outcome']
        # Reusing a command ID in a different match is a different identity.
        new = await advance(next_host, next_game, command_id=receipt['request']['command_id'])
        await store.save(capture_checkpoint(next_game, table_revision=4), expected_revision=3, fence=fence, receipt=new)
    finally:
        await host.close()
        await next_host.close()


async def test_receipt_capacity_rollback_and_independent_tables(database):
    pool, store, fence, users = database
    host, game = await host_game(users[:2])
    other_host, other = await host_game(users[2:])
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence, receipt_limit=1)
        await store.save(capture_checkpoint(other, table_revision=0), expected_revision=None, fence=fence)
        first = await advance(host, game)
        checkpoint = capture_checkpoint(game, table_revision=1)
        await store.save(checkpoint, expected_revision=0, fence=fence, receipt=first, receipt_limit=1)
        rejected = await advance(host, game, expected=0)
        with pytest.raises(ValueError, match='capacity'):
            await store.save(capture_checkpoint(game, table_revision=2), expected_revision=1,
                             fence=fence, receipt=rejected, receipt_limit=1)
        assert (await store.load(game.table.table_id)).checkpoint == checkpoint
        other_receipt = await advance(other_host, other)
        await store.save(capture_checkpoint(other, table_revision=1), expected_revision=0, fence=fence, receipt=other_receipt)
        assert (await pool.execute('SELECT count(*) FROM game_commands')).rows == [(2,)]
    finally:
        await host.close()
        await other_host.close()


async def test_legacy_postgres_store_preserves_original_request_and_rejection(database):
    from app.durable_games.hosted import HostedEngineDefinition
    from app.durable_games.store import PostgresGameStore
    pool, _, _, users = database
    store = PostgresGameStore(pool)
    definition = HostedEngineDefinition('marriage')
    game_id = uuid4()
    started = await store.start(game_id, 'room', definition, start_command_id='start',
        owner_instance_id='one', players=((users[0], 1), (users[1], 2)), initial_state={'revision': 1}, rules={})
    request = ReliableActionCommand(match_id=game_id.hex, command_id='command', expected_revision=1,
                                    command='DRAW_CARD', payload={'source': 'stock'})
    args = dict(actor_id=users[0], command_id='command', expected_revision=1, command='DRAW_CARD',
                ownership=started.ownership, original_request=request.model_dump(mode='json'))
    first = await store.execute(game_id, definition, payload={'authoritative_state': {'revision': 2}}, **args)
    repeated = await store.execute(game_id, definition, payload={'authoritative_state': {'revision': 999}}, **args)
    assert repeated.duplicate and repeated.game.state == first.game.state
    request = request.model_copy(update={'command_id': 'rejected', 'expected_revision': 0})
    args.update(command_id='rejected', expected_revision=0, original_request=request.model_dump(mode='json'))
    rejected = await store.execute(game_id, definition, payload={}, rejection_detail='Stale view', **args)
    assert rejected.receipt.status == 'rejected' and rejected.receipt.detail == 'Stale view'
    row = (await pool.execute("SELECT original_request,request_fingerprint FROM game_commands WHERE command_id='rejected'")).rows[0]
    assert row == (request.model_dump(mode='json'), request_fingerprint(request))


async def test_flush_round_rollover_retains_match_receipts(database):
    pool, store, fence, users = database
    host, game = await host_game(users, 'flush')
    try:
        with pytest.raises(RuntimeError, match='open transaction'):
            await store.save_in_transaction(pool, capture_checkpoint(game, table_revision=0),
                                            expected_revision=None, fence=fence)
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        receipts = []
        for revision, command in enumerate(('DEAL_CARDS', 'SKIP_CUT', 'FOLD'), 1):
            receipt = await advance(host, game, command=command)
            receipts.append(receipt)
            await store.save(capture_checkpoint(game, table_revision=revision),
                             expected_revision=revision - 1, fence=fence, receipt=receipt)
        assert engine_state(game).status.value == "finished"
        old_id = game.durable_game_id
        # The legacy Flush host gives each started round its own durable game ID.
        await host.table_command('room', users[0], game.match_id, 'lock')
        await host.start('room', users[0], game.match_id, rules_revision=0)
        game.durable_game_id = uuid4()
        checkpoint = capture_checkpoint(game, table_revision=4)
        await store.save(checkpoint, expected_revision=3, fence=fence)
        loaded = await store.load(game.table.table_id)
        assert loaded.checkpoint == checkpoint
        assert loaded.receipt_snapshot['receipt_count'] == 3
        assert (await pool.execute('SELECT status FROM games WHERE id=%s', (old_id,))).rows == [('completed',)]
        assert await store.lookup_receipt(game.table.table_id, receipts[0]['actor_id'],
            ReliableActionCommand(**receipts[0]['request'])) == receipts[0]['outcome']
    finally:
        await host.close()
