"""Opt-in deletion worker. Only generic failure codes leave this module."""
import asyncio
import os
import logging
from uuid import UUID

import httpx
from .service import DeletionService
from .erasure import erase, CleanupWaiting

log = logging.getLogger(__name__)


class DeletionRuntime:
    def __init__(self, pool, recovery, browser, *, enabled=None, cache=None, profiles=None):
        self.pool, self.recovery, self.browser = pool, recovery, browser
        self.cache, self.profiles = cache, profiles
        selected = os.getenv('BHIDNE_HO_ACCOUNT_DELETION_ENABLED') == '1' if enabled is None else enabled
        self.enabled = bool(selected and pool and recovery.enabled)
        self.service = DeletionService(pool,recovery) if pool else None
        self.task = None
        self.stopping = asyncio.Event()
        if self.enabled:
            browser.deletion = self

    async def generation(self):
        async with self.pool.connection() as c:
            return (await (await c.execute('SELECT generation FROM account_identity_generation')).fetchone())[0]

    async def save_grant(self, user_id, provider, envelope):
        async with self.pool.connection() as c:
            await c.execute('''INSERT INTO account_provider_grants(user_id,provider,envelope)
                SELECT id,%s,%s FROM users WHERE id=%s AND NOT deletion_pending AND NOT erased
                ON CONFLICT(user_id,provider) DO UPDATE SET envelope=EXCLUDED.envelope,verified_at=clock_timestamp()''',
                (provider,envelope.encode(),UUID(user_id[5:])))

    async def revoke(self, provider, envelope):
        grant = self.recovery.decrypt(envelope)
        config = self.browser.providers.get(provider)
        if not config:
            raise CleanupWaiting('provider_unavailable')
        async with httpx.AsyncClient(timeout=10) as client:
            if provider == 'google':
                reply = await client.post('https://oauth2.googleapis.com/revoke',data={'token':grant['token']})
            elif provider == 'apple':
                reply = await client.post('https://appleid.apple.com/auth/revoke',data={
                    'client_id':config.client_id,'client_secret':config.client_secret,
                    'token':grant['token'],'token_type_hint':grant['hint']})
            else:
                reply = await client.delete(config.token_url.removesuffix('/oauth/access_token')+'/'+grant['subject']+'/permissions',
                    headers={'Authorization':'Bearer '+grant['token']})
            # Google's documented invalid_token means expired/already revoked.
            # Only this exact terminal error is safe to accept after a retry.
            if provider == 'google' and reply.status_code == 400:
                try:
                    if reply.json().get('error') == 'invalid_token':
                        return
                except (ValueError, AttributeError):
                    pass
            reply.raise_for_status()
            if provider == 'facebook' and reply.json() != {'success': True}:
                raise ValueError('Provider did not confirm revocation')

    async def tick(self):
        if self.cache:
            self.cache.prune_expired()
        if self.profiles:
            # Distributed game projections load names from their SQL snapshot;
            # these legacy dictionaries are not an authoritative read model.
            self.profiles.names.clear()
            self.profiles.usernames.clear()
            self.profiles.appearances.clear()
        async with self.pool.connection() as c:
            row = await (await c.execute("SELECT id,user_id FROM account_deletion_jobs WHERE status<>'completed' AND available_at<=clock_timestamp() ORDER BY created_at LIMIT 1")).fetchone()
        if not row:
            return
        job_id, uid = row
        # PostgreSQL advisory locks serialize gateways, including network revocation.
        # No table/row transaction is held open during an external provider call.
        async with self.pool.connection() as c:
            async with c.transaction():
                locked = await (await c.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,0))',(str(job_id),))).fetchone()
            if not locked[0]:
                return
            try:
                async with c.transaction():
                    state = await (await c.execute("SELECT status,user_id,available_at<=clock_timestamp() FROM account_deletion_jobs WHERE id=%s",(job_id,))).fetchone()
                if not state or state[0]=='completed' or not state[2]:
                    return
                if state[1] is None:
                    async with c.transaction():
                        await c.execute("UPDATE account_deletion_jobs SET status='completed',reason=NULL,completed_at=clock_timestamp() WHERE id=%s", (job_id,))
                    return
                async with c.transaction():
                    grants = await (await c.execute('SELECT provider,envelope FROM account_provider_grants WHERE user_id=%s',(uid,))).fetchall()
                for provider,envelope in grants:
                    await self.revoke(provider,envelope)
                    async with c.transaction():
                        await c.execute('DELETE FROM account_provider_grants WHERE user_id=%s AND provider=%s',(uid,provider))
                async with c.transaction():
                    await c.execute("SET LOCAL lock_timeout='2s'")
                    await c.execute("SET LOCAL statement_timeout='5s'")
                    await c.execute('SELECT generation FROM account_identity_generation FOR UPDATE')
                    await c.execute('SELECT user_id FROM account_credentials WHERE user_id=%s FOR UPDATE',(uid,))
                    await c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,))
                    await c.execute('UPDATE account_deletion_jobs SET worker_xid=txid_current(),attempts=attempts+1 WHERE id=%s',(job_id,))
                    await c.execute("SELECT set_config('bhidne.deletion_job',%s,true)",(str(job_id),))
                    await erase(c,row,self.recovery)
                    # Redis TTL plus a possible local re-fill must expire before
                    # reporting completion. The completed job stores no user ID.
                    delay = max(60, 2 * self.cache.ttl + 5) if self.cache else 60
                    await c.execute("UPDATE account_deletion_jobs SET status='waiting',reason='cache_expiry',available_at=clock_timestamp()+%s*interval '1 second',worker_xid=NULL WHERE id=%s",(delay,job_id))
            except CleanupWaiting as e:
                async with c.transaction():
                    await c.execute("UPDATE account_deletion_jobs SET status='waiting',reason=%s,available_at=clock_timestamp()+interval '30 seconds',worker_xid=NULL WHERE id=%s",(str(e),job_id))
            except Exception:
                log.warning('Account deletion stage failed; retry scheduled.')
                async with c.transaction():
                    await c.execute("UPDATE account_deletion_jobs SET status='failed',reason='retrying',available_at=clock_timestamp()+interval '1 minute',worker_xid=NULL WHERE id=%s",(job_id,))
            finally:
                async with c.transaction():
                    await c.execute('SELECT pg_advisory_unlock(hashtextextended(%s,0))',(str(job_id),))

    async def run(self):
        while not self.stopping.is_set():
            try:
                await self.tick()
            except Exception:
                log.warning('Account deletion worker unavailable; will retry.')
            try:
                await asyncio.wait_for(self.stopping.wait(),2)
            except TimeoutError:
                pass

    async def start(self):
        if self.enabled and self.task is None:
            self.task = asyncio.create_task(self.run(),name='account-deletion')

    async def stop(self):
        self.stopping.set()
        if self.task:
            await self.task
            self.task = None
