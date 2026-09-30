"""Opt-in independent PostgreSQL connections; no external database is touched."""
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import tempfile

from psycopg_pool import AsyncConnectionPool
import pytest

from app.auth.postgres import PostgresAuthService
from app.auth.recovery import InvalidRecoveryChallenge, PostgresRecoveryService
from app.auth.service import AuthenticationError
from app.database import MIGRATIONS


@pytest.fixture
async def postgres_pool():
    binaries = os.environ.get('POSTGRES_TEST_BIN')
    if not binaries:
        pytest.skip('Set POSTGRES_TEST_BIN to test real PostgreSQL account locking.')
    # Keep socket paths below the macOS Unix socket length limit.
    with tempfile.TemporaryDirectory(prefix='bh-recovery-', dir='/tmp') as directory:
        data = str(Path(directory) / 'data')
        initialized = await asyncio.create_subprocess_exec(str(Path(binaries) / 'initdb'),
            '-D', data, '--no-locale', '--encoding=UTF8', '--auth=trust',
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        output, _ = await initialized.communicate()
        assert initialized.returncode == 0, output.decode()
        with open(Path(directory) / 'postgres.log', 'wb') as log:
            process = await asyncio.create_subprocess_exec(str(Path(binaries) / 'postgres'),
                '-D', data, '-k', directory, '-h', '', stdout=log, stderr=log)
            pool = AsyncConnectionPool(f'host={directory} dbname=postgres connect_timeout=2',
                                       min_size=1, max_size=5, open=False)
            try:
                await pool.open(wait=True, timeout=15)
                async with pool.connection() as connection:
                    for _, sql in MIGRATIONS:
                        await connection.execute(sql)
                yield pool
            finally:
                await pool.close()
                if process.returncode is None:
                    process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 10)
                except TimeoutError:
                    process.kill()
                    await process.wait()


async def enrolled(pool):
    auth = PostgresAuthService(pool)
    credentials = await auth.sign_up('concurrent_player', 'original-password')
    recovery = PostgresRecoveryService(pool)
    proof = await recovery.enroll_email(credentials.user_id, 'original-password', 'player@example.com')
    await recovery.verify_email(proof.token)
    reset = await recovery.request_reset(credentials.username)
    return credentials, reset


async def wait_for_account_lock(pool):
    async with asyncio.timeout(10):
        while True:
            async with pool.connection() as connection:
                row = await (await connection.execute('''SELECT count(*) FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                    AND query LIKE '%%FROM account_credentials%%' ''')).fetchone()
            if row[0]:
                return
            await asyncio.sleep(.01)


@asynccontextmanager
async def tasks_released_by(release):
    tasks = []
    try:
        yield tasks
    finally:
        release.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def test_login_started_before_reset_cannot_leave_a_valid_old_password_session(postgres_pool):
    pool = postgres_pool
    credentials, reset = await enrolled(pool)
    entered, release = asyncio.Event(), asyncio.Event()

    class PausedLogin(PostgresAuthService):
        async def _session(self, connection, user_id, username=None):
            entered.set()
            await release.wait()
            return await super()._session(connection, user_id, username)

    async with tasks_released_by(release) as tasks:
        login = asyncio.create_task(PausedLogin(pool).sign_in(credentials.username, 'original-password'))
        tasks.append(login)
        await asyncio.wait_for(entered.wait(), 10)
        resetting = asyncio.create_task(PostgresRecoveryService(pool).reset_password(reset.token, 'replacement-password'))
        tasks.append(resetting)
        await wait_for_account_lock(pool)
        release.set()
        session, _ = await asyncio.wait_for(asyncio.gather(login, resetting), 10)
        with pytest.raises(AuthenticationError):
            await PostgresAuthService(pool).authenticate(session.token)


async def test_login_waiting_for_reset_must_check_the_new_password(postgres_pool):
    pool = postgres_pool
    credentials, reset = await enrolled(pool)
    entered, release = asyncio.Event(), asyncio.Event()

    class PausedReset(PostgresRecoveryService):
        async def _challenge(self, connection, token, purpose):
            result = await super()._challenge(connection, token, purpose)
            entered.set()
            await release.wait()
            return result

    async with tasks_released_by(release) as tasks:
        resetting = asyncio.create_task(PausedReset(pool).reset_password(reset.token, 'replacement-password'))
        tasks.append(resetting)
        await asyncio.wait_for(entered.wait(), 10)
        login = asyncio.create_task(PostgresAuthService(pool).sign_in(credentials.username, 'original-password'))
        tasks.append(login)
        await wait_for_account_lock(pool)
        release.set()
        results = await asyncio.wait_for(asyncio.gather(resetting, login, return_exceptions=True), 10)
        assert results[0] is None and isinstance(results[1], AuthenticationError)
        assert (await PostgresAuthService(pool).sign_in(credentials.username, 'replacement-password')).user_id == credentials.user_id


async def test_concurrent_reset_consumption_has_one_winner(postgres_pool):
    pool = postgres_pool
    _, reset = await enrolled(pool)
    results = await asyncio.gather(
        PostgresRecoveryService(pool).reset_password(reset.token, 'replacement-password'),
        PostgresRecoveryService(pool).reset_password(reset.token, 'different-password'), return_exceptions=True)
    assert sum(result is None for result in results) == 1
    assert sum(isinstance(result, InvalidRecoveryChallenge) for result in results) == 1
