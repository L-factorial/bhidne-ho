"""An existing migration ledger must still receive the room privacy upgrade."""
from contextlib import asynccontextmanager

import pytest

from app.database import Database, MIGRATIONS


@pytest.mark.asyncio
async def test_room_upgrade_runs_after_previously_applied_bootstrap_and_only_once():
    class Pool:
        def __init__(self):
            self.applied = set(range(1, 12))
            self.executed = []

        async def open(self, **kwargs):
            pass

        @asynccontextmanager
        async def connection(self):
            yield self

        @asynccontextmanager
        async def transaction(self):
            yield self

        async def execute(self, sql, params=()):
            self.executed.append(sql)
            if sql.startswith('INSERT INTO schema_migrations'):
                self.applied.add(params[0])
            return self

        async def fetchall(self):
            return [(version,) for version in self.applied]

    database = Database.__new__(Database)
    database.pool = Pool()
    await database.open()
    upgrade = dict(MIGRATIONS)[12]
    assert upgrade in database.pool.executed
    assert dict(MIGRATIONS)[1] not in database.pool.executed
    assert 12 in database.pool.applied
    await database.open()
    assert database.pool.executed.count(upgrade) == 1
