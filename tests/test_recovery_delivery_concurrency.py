import asyncio
import threading

from app.auth.postgres import PostgresAuthService
from app.auth.recovery_delivery import RecoveryConfig, RecoveryRuntime
from test_account_recovery_concurrency import postgres_pool
from test_recovery_delivery import config


async def test_two_workers_claim_once_without_holding_database_during_smtp(postgres_pool, monkeypatch):
    pool = postgres_pool
    auth = PostgresAuthService(pool)
    first = RecoveryRuntime(pool,auth,config())
    second = RecoveryRuntime(pool,auth,first.config)
    user = await auth.sign_up('worker_player','old-password',email='worker@example.test')
    started, release = threading.Event(), threading.Event()
    delivered = []
    def send(self, payload):
        started.set()
        if not release.wait(10): raise TimeoutError()
        delivered.append(payload)
    monkeypatch.setattr(RecoveryConfig,'send',send)
    job = asyncio.create_task(first.deliver_one())
    try:
        async with asyncio.timeout(5):
            while not started.is_set(): await asyncio.sleep(.01)
        await asyncio.wait_for(second.deliver_one(), 3)
        # Proof removal can commit while SMTP is paused. An in-flight message may
        # arrive, but its proof must no longer be usable or restore the queue row.
        await asyncio.wait_for(second.service.remove_email(user.user_id,'old-password'),3)
    finally:
        release.set()
        await job
    assert len(delivered) == 1
    async with pool.connection() as c:
        assert await (await c.execute('SELECT count(*) FROM recovery_mail_outbox')).fetchone() == (0,)
        assert await (await c.execute('SELECT count(*) FROM account_recovery_challenges')).fetchone() == (0,)
