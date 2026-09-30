"""Deletion against independent PostgreSQL connections and actual HTTP validation."""
import asyncio
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.account_deletion.http import router
from app.account_deletion.runtime import DeletionRuntime
from app.account_deletion.service import DeletionError
from app.auth.recovery_http import RecoveryNoStore
from app.auth.service import AuthenticationError
from app.multiplayer.player_profiles import PostgresPlayerProfileService
from app.players.store import PostgresPlayerStore
from app.players.service import PlayerSocialService
from test_account_deletion import setup
from test_account_recovery_concurrency import postgres_pool


async def test_worker_retries_provider_failure_and_preserves_other_accounts(postgres_pool):
    pool=postgres_pool;auth,a,recovery,deletion=await setup(pool)
    b=await auth.sign_up('surviving_player','original-password')
    runtime=DeletionRuntime(pool,recovery,SimpleNamespace(providers={}),enabled=True)
    uid=UUID(a.user_id[5:])
    async with pool.connection() as c:
        await c.execute("INSERT INTO external_identities(provider,provider_subject,user_id) VALUES ('apple','private-subject',%s)",(uid,))
    with pytest.raises(DeletionError,match='reauthenticate'):
        await deletion.request(a.user_id,password='original-password')
    await runtime.save_grant(a.user_id,'apple',recovery.encrypt({'token':'private-provider-token'}).decode())
    accepted=await deletion.request(a.user_id,password='original-password')
    calls=[]
    async def failing(provider,envelope):
        calls.append(provider)
        # Another connection remains usable while the provider request is pending.
        assert (await auth.authenticate(b.token)).user_id==b.user_id
        raise RuntimeError('Provider unavailable')
    runtime.revoke=failing
    await runtime.tick()
    assert (await deletion.status(accepted['status_token']))['status']=='failed'
    async with pool.connection() as c:
        assert (await(await c.execute('SELECT count(*) FROM account_provider_grants')).fetchone())[0]==1
        await c.execute('UPDATE account_deletion_jobs SET available_at=clock_timestamp()')
    async def success(provider,envelope):calls.append(provider)
    runtime.revoke=success
    await asyncio.gather(runtime.tick(),runtime.tick())
    assert (await deletion.status(accepted['status_token']))['status']=='waiting'
    async with pool.connection() as c:
        await c.execute('UPDATE account_deletion_jobs SET available_at=clock_timestamp()')
    await runtime.tick()
    assert (await deletion.status(accepted['status_token']))['status']=='completed'
    assert calls==['apple','apple']
    async with pool.connection() as c:
        assert (await(await c.execute('SELECT count(*) FROM external_identities')).fetchone())[0]==0
        assert (await(await c.execute('SELECT count(*) FROM account_provider_grants')).fetchone())[0]==0
        assert (await(await c.execute('SELECT user_id FROM account_deletion_jobs')).fetchone())[0] is None
    assert (await auth.authenticate(b.token)).user_id==b.user_id


async def test_http_proof_validation_public_privacy_and_status_capability(postgres_pool):
    pool=postgres_pool;auth,a,recovery,deletion=await setup(pool)
    app=FastAPI();app.add_middleware(RecoveryNoStore);app.include_router(router)
    app.state.auth=auth;app.state.players=PlayerSocialService(PostgresPlayerStore(pool))
    app.state.player_profiles=PostgresPlayerProfileService(pool)
    app.state.deletion=DeletionRuntime(pool,recovery,SimpleNamespace(providers={}),enabled=True)
    headers={'Authorization':'Bearer '+a.token}
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
        bad=await client.post('/auth/deletion/request',headers=headers,json={'confirmation':'delete','current_password':'original-password'})
        assert bad.status_code==422 and bad.headers['cache-control']=='no-store'
        assert (await auth.authenticate(a.token)).user_id==a.user_id
        replies=[]
        for username in ('deletion_player','missing_player'):
            response=await client.post('/auth/deletion/email',json={'username':username,'email':'private@example.test'})
            replies.append((response.status_code,response.json()))
        assert replies==[(202,{'accepted':True})]*2
        wrong=await client.post('/auth/deletion/request',headers=headers,json={'confirmation':'DELETE','current_password':'wrong'})
        assert wrong.status_code==409
        done=await client.post('/auth/deletion/request',headers=headers,json={'confirmation':'DELETE','current_password':'original-password'})
        assert done.status_code==202,done.text
        assert done.headers['cache-control']=='no-store'
        assert (await client.post('/auth/deletion/status',json={'token':'x'*43})).status_code==409
        assert (await client.post('/auth/deletion/status',json={'token':done.json()['status_token']})).json()['status']=='pending'
        with pytest.raises(AuthenticationError):await auth.authenticate(a.token)


async def test_concurrent_signin_cannot_leave_a_usable_deleted_session(postgres_pool):
    pool=postgres_pool;auth,a,recovery,deletion=await setup(pool)
    results=await asyncio.gather(
        auth.sign_in('deletion_player','original-password'),
        deletion.request(a.user_id,password='original-password'),return_exceptions=True)
    assert isinstance(results[1],dict)
    for value in (a,results[0]):
        if not isinstance(value,Exception):
            with pytest.raises(AuthenticationError):await auth.authenticate(value.token)
    async with pool.connection() as c:
        assert (await(await c.execute('SELECT count(*) FROM auth_sessions')).fetchone())[0]==0
