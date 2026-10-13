import pytest

from app.durable_games.ledger_queries import PostgresLedgerQueries
from app.durable_games.finalization import MatchFinalizationWorker
from test_checkpoint_store import database
from test_rematch import completed


async def test_ledger_read_never_performs_pending_settlement(database):
    pool, store, fence, users = database
    host, game, *_ = await completed(database)
    try:
        queries = PostgresLedgerQueries(pool)
        jobs_before = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        assert (await queries.snapshot('room', users[0]))['tables'] == []
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == jobs_before
        worker = MatchFinalizationWorker(pool)
        job = (await worker.pending(fence))[0]
        await worker.execute(job, fence)
        jobs_after = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        result = await queries.snapshot('room', users[0])
        assert result['tables'][0]['table_name'] == game.name
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == jobs_after
    finally:
        await host.close()


@pytest.mark.parametrize('archived', [False, True])
async def test_table_records_include_zero_payment_callbreak_without_financial_rows(database, archived):
    from test_rematch import execute, request
    pool, store, fence, users = database
    host, game, inbox, lane, _ = await completed(database, 'callbreak')
    try:
        worker = MatchFinalizationWorker(pool)
        job = (await worker.pending(fence))[0]
        assert await worker.execute(job, fence) == 'no_payment'
        if archived:
            saved = await store.load(game.table.table_id)
            assert (await execute(inbox, lane, fence, users[0], request(saved)))['status'] == 'accepted'
        before = (await pool.execute('SELECT * FROM game_finalization_jobs')).rows
        view = await PostgresLedgerQueries(pool).snapshot('room', users[0])
        assert view['tables'] == [] and view['balances'] == []
        table = view['record_tables'][0]
        assert table['table_id'] == game.table.table_id and table['game_count'] == 1
        assert {row['player_id']: row['amount'] for row in table['record_balances']} == dict.fromkeys(game.users, 0)
        assert table['games'][0]['game_id'] == game.match_id
        assert table['games'][0]['record_balances'] == table['record_balances']
        assert (await pool.execute('SELECT count(*) FROM ledger_games')).rows == [(0,)]
        assert (await pool.execute('SELECT * FROM game_finalization_jobs')).rows == before
    finally:
        await host.close()
