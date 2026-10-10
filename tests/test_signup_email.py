"""New signup requires email; legacy login and verified recovery remain separate."""
from uuid import UUID

from fastapi.testclient import TestClient
import pytest

from app.auth.postgres import PostgresAuthService
from app.auth.recovery import PostgresRecoveryService
from app.database import MIGRATIONS
from app.main import create_app
from pglite_support import PGlitePool
from test_account_recovery import recovery_database
from test_distributed_platform import application


@pytest.mark.parametrize('email', [None, '', '   ', 'invalid', 'x@localhost', 'a..b@example.com',
    'a@-example.com', 'a@exam_ple.com', 'a\r\nb@example.com', 'a' * 65 + '@example.com'])
def test_signup_requires_valid_email_without_creating_account(email):
    with TestClient(create_app()) as client:
        payload = dict(community_rules_version='2026-10-01', username='new_player', password='original-password')
        if email is not None:
            payload['email'] = email
        result = client.post('/auth/signup', json=payload)
        assert result.status_code == 422
        assert any(error['loc'] == ['body', 'email'] for error in result.json()['detail'])
        assert not client.app.state.auth._accounts


def test_memory_signup_normalizes_private_email_and_signin_needs_no_email():
    with TestClient(create_app()) as client:
        payload = dict(community_rules_version='2026-10-01', username='new_player', password='original-password', email=' Player.Name+tag@EXAMPLE.COM ')
        result = client.post('/auth/signup', json=payload)
        assert result.status_code == 201
        credentials = result.json()
        assert client.app.state.auth._unverified_emails[credentials['user_id']] == 'Player.Name+tag@example.com'
        assert 'email' not in credentials
        login = client.post('/auth/signin', json=dict(username='new_player', password='original-password'))
        assert login.status_code == 200
        me = client.get('/auth/me', headers={'Authorization': 'Bearer ' + credentials['token']})
        assert 'email' not in me.json() and 'unverified_email' not in me.json()
        forged = client.post('/auth/signup', json={**payload, 'username': 'forged', 'email_verified': True})
        assert forged.status_code == 422


async def test_distributed_signup_email_is_durable_private_and_untrusted(recovery_database):
    pool = recovery_database
    async with application(pool) as (client, _, __):
        assert (await client.post('/auth/signup', json=dict(username='new_player', password='original-password'))).status_code == 422
        reply = await client.post('/auth/signup', json=dict(community_rules_version='2026-10-01', username='new_player', password='original-password', email=' Player@EXAMPLE.COM '))
        assert reply.status_code == 201, reply.text
        credentials = reply.json()
        user_id = UUID(credentials['user_id'][5:])
        assert (await pool.execute('SELECT unverified_email FROM account_credentials WHERE user_id=%s', (user_id,))).rows == [('Player@example.com',)]
        assert (await pool.execute('SELECT count(*) FROM account_recovery_contacts')).rows == [(0,)]
        assert (await pool.execute('SELECT count(*) FROM account_recovery_challenges')).rows == [(0,)]
        recovery = PostgresRecoveryService(pool)
        assert await recovery.request_reset('new_player') is None
        # A second service can still log in without email. Email is not a public profile field.
        assert (await PostgresAuthService(pool).sign_in('new_player', 'original-password')).user_id == credentials['user_id']
        headers = {'Authorization': 'Bearer ' + credentials['token']}
        for path in ('/auth/me', '/players/' + credentials['user_id']):
            public = (await client.get(path, headers=headers)).json()
            assert 'email' not in public and 'unverified_email' not in public
        # A shared email address does not silently merge accounts.
        other = await client.post('/auth/signup', json=dict(community_rules_version='2026-10-01', username='other_player', password='original-password', email='Player@example.com'))
        assert other.status_code == 201 and other.json()['user_id'] != credentials['user_id']
        proof = await recovery.enroll_email(credentials['user_id'], 'original-password', 'Player@example.com')
        await recovery.verify_email(proof.token)
        assert (await pool.execute('SELECT unverified_email FROM account_credentials WHERE user_id=%s', (user_id,))).rows == [(None,)]
        assert (await recovery.request_reset('new_player')).email == 'Player@example.com'


async def test_migration_29_preserves_legacy_accounts_sessions_profiles_and_verified_contacts():
    pool = await PGlitePool.open()
    try:
        for version, sql in MIGRATIONS:
            if version < 29:
                await pool.execute(sql, script=True)
        auth = PostgresAuthService(pool)
        legacy = await auth.sign_up('legacy_player', 'original-password')
        legacy_id = UUID(legacy.user_id[5:])
        await pool.execute("UPDATE user_profiles SET display_name='Legacy Player' WHERE user_id=%s", (legacy_id,))
        await pool.execute('INSERT INTO account_recovery_contacts (user_id,email) VALUES (%s,%s)', (legacy_id, 'verified@example.com'))
        before = (await pool.execute('SELECT * FROM account_recovery_contacts')).rows
        await pool.execute(dict(MIGRATIONS)[29], script=True)
        assert (await auth.authenticate(legacy.token)).user_id == legacy.user_id
        assert (await auth.sign_in('legacy_player', 'original-password')).user_id == legacy.user_id
        assert (await pool.execute('SELECT unverified_email FROM account_credentials')).rows == [(None,)]
        assert (await pool.execute('SELECT display_name FROM user_profiles')).rows == [('Legacy Player',)]
        assert (await pool.execute('SELECT * FROM account_recovery_contacts')).rows == before
        # Accounts without any recovery enrollment continue working too.
        await pool.execute('DELETE FROM account_recovery_contacts')
        assert (await auth.sign_in('legacy_player', 'original-password')).user_id == legacy.user_id
    finally:
        await pool.close()


async def test_signup_email_write_failure_rolls_back_entire_account(recovery_database):
    pool = recovery_database
    await pool.execute('''CREATE FUNCTION reject_signup_email_test() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test email failure'; END; $$;
        CREATE TRIGGER reject_signup_email_test BEFORE UPDATE OF unverified_email ON account_credentials
            FOR EACH ROW EXECUTE FUNCTION reject_signup_email_test();''', script=True)
    with pytest.raises(Exception, match='test email failure'):
        await PostgresAuthService(pool).sign_up('new_player', 'original-password', email='player@example.com')
    for table in ('users', 'account_credentials', 'user_profiles', 'auth_sessions'):
        assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows == [(0,)]


@pytest.mark.parametrize('version', [None, '', 'old-version', True])
def test_signup_requires_explicit_current_rules_acceptance(version):
    with TestClient(create_app()) as client:
        payload = dict(username='new_player', password='original-password', email='player@example.com')
        if version is not None:
            payload['community_rules_version'] = version
        response = client.post('/auth/signup', json=payload)
        assert response.status_code == 422
        assert not client.app.state.auth._accounts


async def test_signup_records_rules_acceptance_atomically(recovery_database):
    pool = recovery_database
    async with application(pool) as (client, _, __):
        response = await client.post('/auth/signup', json=dict(username='consenting_player',
            password='original-password', email='player@example.com', community_rules_version='2026-10-01'))
        assert response.status_code == 201, response.text
        user_id = UUID(response.json()['user_id'][5:])
        assert (await pool.execute('SELECT version FROM community_acceptance WHERE user_id=%s',
            (user_id,))).rows == [('2026-10-01',)]
        from app.moderation.policy import require_posting
        async with pool.connection() as connection:
            await require_posting(connection, response.json()['user_id'], category='invitation')


async def test_rules_acceptance_failure_rolls_back_account_and_session(recovery_database):
    pool = recovery_database
    await pool.execute('''CREATE FUNCTION reject_signup_rules_test() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test rules failure'; END; $$;
        CREATE TRIGGER reject_signup_rules_test BEFORE INSERT ON community_acceptance
            FOR EACH ROW EXECUTE FUNCTION reject_signup_rules_test();''', script=True)
    with pytest.raises(Exception, match='test rules failure'):
        await PostgresAuthService(pool).sign_up('new_player', 'original-password',
            email='player@example.com', community_rules_version='2026-10-01')
    for table in ('users', 'account_credentials', 'user_profiles', 'auth_sessions', 'community_acceptance'):
        assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows == [(0,)]
