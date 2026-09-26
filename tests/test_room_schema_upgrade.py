"""Installed schemas receive pending migrations once, without replaying bootstrap."""
from contextlib import asynccontextmanager

import pytest

from app.database import Database, MIGRATIONS


@pytest.mark.asyncio
@pytest.mark.parametrize('last_applied', [11, 12, 13, 14, 15, 16, 17, 18, 19])
async def test_room_upgrade_runs_after_previously_applied_bootstrap_and_only_once(last_applied):
    class Pool:
        def __init__(self):
            self.applied = set(range(1, last_applied + 1))
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

        async def fetchone(self):
            # Existing legacy datasets have no explicit integration marker.
            assert self.executed[-1] == "SELECT to_regclass('public.runtime_dataset')"
            return (None,)

    database = Database.__new__(Database)
    database.pool = Pool()
    await database.open()
    pending = [sql for version, sql in MIGRATIONS if version > last_applied]
    assert pending
    for upgrade in pending:
        assert upgrade in database.pool.executed
    assert dict(MIGRATIONS)[1] not in database.pool.executed
    assert database.pool.applied == {version for version, _ in MIGRATIONS}
    await database.open()
    for upgrade in pending:
        assert database.pool.executed.count(upgrade) == 1
