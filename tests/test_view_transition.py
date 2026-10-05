from copy import deepcopy
import pytest
from psycopg.errors import CheckViolation

from app.durable_games.checkpoint_store import PostgresCheckpointStore
from app.durable_games.checkpoints import capture_checkpoint
from app.durable_games.view_transition import record_view_transition
from app.durable_games.store import DurableGameConflict
from test_checkpoint_store import database, host_game, advance


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_exact_inputs_survive_later_moves_and_receipt_retries(database, kind):
    pool, _, fence, users = database
    store = PostgresCheckpointStore(pool, retain_view_transitions=True)
    host, game = await host_game(users, kind)
    try:
        before = capture_checkpoint(game, table_revision=0)
        await store.save(before, expected_revision=None, fence=fence)
        receipt = await advance(host, game)
        after = capture_checkpoint(game, table_revision=1)
        await store.save(after, expected_revision=0, fence=fence, receipt=receipt)
        assert (await store.save(after, expected_revision=0, fence=fence, receipt=receipt)).duplicate
        # A later table transition cannot overwrite either generation input.
        game.name = 'Later table metadata'
        latest = capture_checkpoint(game, table_revision=2)
        await store.save(latest, expected_revision=1, fence=fence)
        rows = (await pool.execute('SELECT revision,checkpoint FROM delivery_checkpoints ORDER BY revision')).rows
        assert rows == [(0, before), (1, after), (2, latest)]
        assert (await pool.execute('SELECT base_revision,revision,status FROM view_generation_jobs ORDER BY revision')).rows == [(0, 1, 'pending'), (1, 2, 'pending')]
        with pytest.raises(CheckViolation, match='immutable'):
            await pool.execute('UPDATE delivery_checkpoints SET checkpoint=checkpoint WHERE revision=0')
        with pytest.raises(CheckViolation, match='immutable'):
            await pool.execute('UPDATE view_generation_jobs SET base_revision=1 WHERE revision=1')
    finally:
        await host.close()


@pytest.mark.parametrize('declare', [False, True])
async def test_phase_based_declarations_retain_and_project_distinct_transitions(database, declare):
    from dataclasses import replace
    from uuid import UUID, uuid4
    from app.adapters.marriage.concurrency import declaration_phase_id
    from app.durable_games.executor import GameLaneExecutor
    from app.durable_games.inbox import PostgresInboxStore, LaneTarget
    from app.models.action import ReliableActionCommand
    pool, _, fence, users = database
    store = PostgresCheckpointStore(pool, retain_view_transitions=True)
    host, game = await host_game(users, 'marriage', started=False)
    try:
        game.marriage_scoring = replace(game.marriage_scoring, initial_tunnela_declaration=True)
        await host.table_command('room', users[0], game.match_id, 'lock')
        await host.start('room', users[0], game.match_id)
        game.durable_game_id = UUID(game.match_id)
        # A valid dealt Tunnela makes both declaring it and explicitly declining
        # it exercise the actual card visibility and declaration gate changes.
        from marriage import create_deck, validate_game_state
        engine=game.marriage_target.adapter._engine
        ids=[f'D{pack}:8H' for pack in range(3)]
        deck=create_deck()
        selected=tuple(c for c in deck if c.card_id in ids)
        rest=tuple(c for c in deck if c.card_id not in ids)
        state=engine.get_state()
        engine._state=replace(state,players=tuple(replace(p,hand=hand) for p,hand in
            zip(state.players,(selected+rest[:18],rest[18:39]))),stock=rest[39:-1],discard=rest[-1:])
        validate_game_state(engine.get_state())
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        inbox.checkpoints = store
        lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        for user in users[:2]:
            request = ReliableActionCommand(match_id=game.match_id, command_id=uuid4().hex,
                expected_revision=1, command='DECLARE_TUNNELAS',
                payload={'melds': [{'meld_type':'tunnela','card_ids':ids}] if declare and user==users[0] else [],
                    'declaration_phase_id': declaration_phase_id(game.match_id)})
            await inbox.enqueue(lane, user, request.model_dump(mode='json'))
        for expected in (2, 3):
            result = await GameLaneExecutor(inbox).execute_one(lane, fence)
            assert result.outcome['status'] == 'accepted'
            assert result.outcome['revision'] == expected
        rows = (await pool.execute('SELECT checkpoint FROM delivery_checkpoints ORDER BY revision')).rows
        assert [row[0]['data']['engine']['revision'] for row in rows] == [1, 2, 3]
        assert (await pool.execute('SELECT count(*) FROM view_generation_jobs')).rows == [(2,)]
        assert all(p['tunnela_declared'] for p in rows[-1][0]['data']['engine']['state']['players'])
        from app.durable_games.view_generation import ViewGenerationWorker, projected_view
        from app.durable_games.view_delta import apply_delta
        from test_view_generation import Presence
        worker=ViewGenerationWorker(pool,Presence(users[:2]))
        for revision in (1,2):
            claim,=await worker.claim()
            output=await worker.generate(claim)
            for uid,payload in output:
                actor=f'user-{uid}'
                assert apply_delta(projected_view(claim.before,actor,{u:u for u in users}),
                    payload['delta'],game_id=game.match_id,revision=revision-1)==projected_view(
                        claim.after,actor,{u:u for u in users})
            assert await worker.finish(claim,output)
    finally:
        await host.close()


async def test_default_path_does_not_accumulate_generation_jobs(database):
    pool, store, fence, users = database
    host, game = await host_game(users)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        assert (await pool.execute('SELECT count(*) FROM delivery_checkpoints')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM view_generation_jobs')).rows == [(0,)]
    finally:
        await host.close()


async def test_opt_in_existing_table_and_transaction_rollback(database):
    pool, store, fence, users = database
    host, game = await host_game(users)
    try:
        before = capture_checkpoint(game, table_revision=0)
        await store.save(before, expected_revision=None, fence=fence)
        enabled = PostgresCheckpointStore(pool, retain_view_transitions=True)
        receipt = await advance(host, game)
        after = capture_checkpoint(game, table_revision=1)
        with pytest.raises(RuntimeError, match='abort'):
            async with pool.connection() as connection:
                async with connection.transaction():
                    await enabled.save_in_transaction(connection, after, expected_revision=0, fence=fence, receipt=receipt)
                    raise RuntimeError('abort')
        assert (await store.load(game.table.table_id)).checkpoint == before
        assert (await pool.execute('SELECT count(*) FROM view_generation_jobs')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM delivery_checkpoints')).rows == [(0,)]
        await enabled.save(after, expected_revision=0, fence=fence, receipt=receipt)
        assert (await pool.execute('SELECT revision FROM delivery_checkpoints ORDER BY revision')).rows == [(0,), (1,)]
        changed = deepcopy(after)
        changed['data']['name'] = 'Different input'
        from test_hosted_checkpoints import resign
        resign(changed)
        with pytest.raises(DurableGameConflict, match='differs'):
            async with pool.connection() as connection:
                async with connection.transaction():
                    await record_view_transition(connection, before, changed)
    finally:
        await host.close()


async def test_backlog_compaction_bounds_retained_inputs_without_a_worker(database):
    pool,_,fence,users=database
    store=PostgresCheckpointStore(pool,retain_view_transitions=True)
    host,game=await host_game(users)
    try:
        await store.save(capture_checkpoint(game,table_revision=0),expected_revision=None,fence=fence)
        for revision in range(1,67):
            game.name=f'Table revision {revision}'
            await store.save(capture_checkpoint(game,table_revision=revision),expected_revision=revision-1,fence=fence)
        assert (await pool.execute('SELECT revision FROM view_generation_jobs ORDER BY revision')).rows==[(65,),(66,)]
        assert (await pool.execute('SELECT revision FROM delivery_checkpoints ORDER BY revision')).rows==[(64,),(65,),(66,)]
    finally:
        await host.close()
