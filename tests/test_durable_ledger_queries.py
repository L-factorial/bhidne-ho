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
