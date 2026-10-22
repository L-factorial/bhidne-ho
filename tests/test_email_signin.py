"""Email aliases require verified mailbox ownership and reuse the account password."""
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.auth.postgres import PostgresAuthService
from app.auth.service import AuthenticationError, EmailTakenError
from app.auth.recovery import PostgresRecoveryService
from app.main import create_app
from test_account_recovery import recovery_database


def test_memory_signup_rejects_duplicate_email_and_unverified_email_login():
    with TestClient(create_app()) as client:
        signup = client.post('/auth/signup', json={
            'username': 'email_player', 'password': 'original-password',
            'email': 'Player@example.test', 'community_rules_version': '2026-10-01',
        }).json()
        for identifier in ['email_player']:
            login = client.post('/auth/signin', json={'username': identifier, 'password': 'original-password'})
            assert login.status_code == 200
            assert login.json()['user_id'] == signup['user_id']
            assert login.json()['username'] == 'email_player'
            assert login.json()['token'] != signup['token']
        for identifier in ['player@example.test', 'unknown@example.test']:
            assert client.post('/auth/signin', json={
                'username': identifier, 'password': 'incorrect-password',
            }).status_code == 401
        duplicate = client.post('/auth/signup', json={
            'username': 'other_player', 'password': 'other-new-password',
            'email': 'player@example.test', 'community_rules_version': '2026-10-01',
        })
        assert duplicate.status_code == 409
        assert client.post('/auth/signin', json={
            'username': 'player@example.test', 'password': 'original-password',
        }).status_code == 401
        assert client.post('/auth/signin', json={
            'username': 'email_player', 'password': 'original-password',
        }).status_code == 200


async def test_durable_email_signin_signup_verified_changed_shared_and_legacy(recovery_database):
    pool = recovery_database
    auth = PostgresAuthService(pool)
    first = await auth.sign_up('email_player', 'original-password', email='Player@example.test')
    restarted = PostgresAuthService(pool)
    with pytest.raises(AuthenticationError):
        await restarted.sign_in(' PLAYER@EXAMPLE.TEST ', 'original-password')
    for identifier, password in [('player@example.test', 'incorrect-password'),
                                 ('missing@example.test', 'original-password')]:
        with pytest.raises(AuthenticationError):
            await restarted.sign_in(identifier, password)
    recovery = PostgresRecoveryService(pool)
    assert await recovery.request_reset('email_player') is None
    proof = await recovery.enroll_email(first.user_id, 'original-password', 'verified@example.test')
    await recovery.verify_email(proof.token)
    assert (await restarted.sign_in('VERIFIED@example.test', 'original-password')).user_id == first.user_id
    with pytest.raises(AuthenticationError):
        await restarted.sign_in('player@example.test', 'original-password')
    with pytest.raises(EmailTakenError):
        await auth.sign_up('other_player', 'other-password', email='VERIFIED@example.test')
    other = await auth.sign_up('other_player', 'other-password', email='other@example.test')
    assert (await restarted.sign_in('email_player', 'original-password')).user_id == first.user_id
    legacy = await auth.sign_up('legacy_player', 'original-password')
    assert (await restarted.sign_in('legacy_player', 'original-password')).user_id == legacy.user_id
    # Normal account availability restrictions still apply to an email alias.
    await pool.execute('UPDATE users SET deletion_pending=true WHERE id=%s', (UUID(other.user_id[5:]),))
    with pytest.raises(AuthenticationError):
        await restarted.sign_in('other_player', 'other-password')
