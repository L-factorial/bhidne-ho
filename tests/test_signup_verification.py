"""Signup mailbox uniqueness, preserved legacy conflicts, and verification lifecycle."""
import asyncio

import pytest

from app.auth.postgres import PostgresAuthService
from app.auth.service import AuthenticationError, EmailTakenError, InMemoryAuthService
from app.auth.recovery import PostgresRecoveryService
from app.auth.recovery_delivery import RecoveryConfig, RecoveryRuntime
from app.database import MIGRATIONS
from pglite_support import PGlitePool
from test_account_recovery import recovery_database
from test_distributed_platform import application
from test_recovery_delivery import config, async_noop


async def test_case_insensitive_duplicate_signup_is_atomic_in_memory():
    auth = InMemoryAuthService()
    replies = await asyncio.gather(
        auth.sign_up('first_player', 'original-password', email='Player@example.test'),
        auth.sign_up('second_player', 'original-password', email='player@EXAMPLE.test'),
        return_exceptions=True)
    assert sum(isinstance(reply, EmailTakenError) for reply in replies) == 1
    assert len(auth._accounts) == len(auth._identities) == 1


async def test_pending_verified_replacement_and_removal_reserve_mailboxes(recovery_database):
    pool = recovery_database; auth = PostgresAuthService(pool); recovery = PostgresRecoveryService(pool)
    user = await auth.sign_up('first_player', 'original-password', email='first@example.test')
    with pytest.raises(EmailTakenError):
        await auth.sign_up('second_player', 'original-password', email='FIRST@example.test')
    assert (await pool.execute('SELECT count(*) FROM users')).rows == [(1,)]
    proof = await recovery.enroll_email(user.user_id, 'original-password', 'first@example.test')
    await recovery.verify_email(proof.token)
    with pytest.raises(EmailTakenError):
        await auth.sign_up('second_player', 'original-password', email='first@example.test')
    await pool.execute('DELETE FROM account_recovery_limits')
    replacement = await recovery.enroll_email(user.user_id, 'original-password', 'new@example.test')
    assert (await auth.sign_in('first@example.test', 'original-password')).user_id == user.user_id
    with pytest.raises(AuthenticationError):
        await auth.sign_in('new@example.test', 'original-password')
    with pytest.raises(EmailTakenError):
        await auth.sign_up('second_player', 'original-password', email='new@example.test')
    await recovery.verify_email(replacement.token)
    with pytest.raises(AuthenticationError):
        await auth.sign_in('first@example.test', 'original-password')
    await auth.sign_up('second_player', 'original-password', email='first@example.test')
    await recovery.remove_email(user.user_id, 'original-password')
    await auth.sign_up('third_player', 'original-password', email='new@example.test')


async def test_migration_preserves_shared_accounts_and_reserves_conflicts():
    pool = await PGlitePool.open()
    try:
        for version, sql in MIGRATIONS:
            if version < 41: await pool.execute(sql, script=True)
        auth = PostgresAuthService(pool)
        first = await auth.sign_up('first_player','original-password',email='same@example.test')
        second = await auth.sign_up('second_player','original-password',email='SAME@example.test')
        recovery = PostgresRecoveryService(pool)
        proof = await recovery.enroll_email(first.user_id,'original-password','same@example.test')
        await recovery.verify_email(proof.token)
        before = (await pool.execute('SELECT * FROM account_credentials ORDER BY username')).rows
        await pool.execute(dict(MIGRATIONS)[41], script=True)
        assert (await pool.execute('SELECT * FROM account_credentials ORDER BY username')).rows == before
        assert (await pool.execute('SELECT user_id FROM account_email_claims')).rows == [(None,)]
        for user in [first, second]:
            assert (await auth.sign_in(user.username,'original-password')).user_id == user.user_id
            assert (await auth.authenticate(user.token)).user_id == user.user_id
        with pytest.raises(EmailTakenError):
            await auth.sign_up('third_player','original-password',email='same@example.test')
        with pytest.raises(AuthenticationError):
            await auth.sign_in('same@example.test','original-password')
        await recovery.remove_email(first.user_id, 'original-password')
        assert (await pool.execute('SELECT user_id FROM account_email_claims')).rows == [(None,)]
        await recovery.remove_email(second.user_id, 'original-password')
        assert (await pool.execute('SELECT count(*) FROM account_email_claims')).rows == [(0,)]
    finally: await pool.close()


async def test_signup_resend_verify_and_email_login_http(recovery_database, monkeypatch):
    monkeypatch.setattr(RecoveryConfig, 'from_environment', classmethod(lambda cls: config()))
    monkeypatch.setattr(RecoveryRuntime, 'start', lambda self: async_noop())
    async with application(recovery_database) as (client, app, _):
        payload = dict(username='signup_player',email='Player@example.test',password='original-password',community_rules_version='2026-10-01')
        response = await client.post('/auth/signup',json=payload)
        assert response.status_code == 201
        user = response.json(); headers = {'Authorization':'Bearer '+user['token']}
        assert (await client.post('/auth/signup',json={**payload,'username':'other_player','email':'PLAYER@EXAMPLE.TEST'})).status_code == 409
        assert (await client.post('/auth/signin',json={'username':payload['email'],'password':payload['password']})).status_code == 401
        status = (await client.get('/auth/recovery/email',headers=headers)).json()
        assert status['enabled'] and status['pending_email'] == payload['email'] and status['verified_email'] is None
        rows = (await recovery_database.execute("SELECT envelope FROM recovery_mail_outbox WHERE purpose='verify_email'")).rows
        original = app.state.recovery.decrypt(rows[0][0])['token']
        assert (await client.post('/auth/recovery/email/resend',headers=headers,json={})).status_code == 429
        assert (await client.post('/auth/recovery/email/resend',json={})).status_code == 401
        await recovery_database.execute("UPDATE account_recovery_limits SET next_allowed_at=clock_timestamp()-interval '1 second'")
        resent = await client.post('/auth/recovery/email/resend',headers=headers,json={})
        assert resent.status_code == 202 and resent.json() == {'accepted':True}
        assert (await client.post('/auth/recovery/verify',json={'token':original})).status_code == 400
        rows = (await recovery_database.execute("SELECT envelope FROM recovery_mail_outbox WHERE purpose='verify_email'")).rows
        fresh = app.state.recovery.decrypt(rows[0][0])['token']
        assert (await client.post('/auth/recovery/verify',json={'token':fresh})).status_code == 200
        assert (await client.post('/auth/recovery/verify',json={'token':fresh})).status_code == 400
        login = await client.post('/auth/signin',json={'username':'PLAYER@EXAMPLE.TEST','password':payload['password']})
        assert login.status_code == 200 and login.json()['user_id'] == user['user_id']
        status = (await client.get('/auth/recovery/email',headers=headers)).json()
        assert status['pending_email'] is None and status['verified_email'] == payload['email']
