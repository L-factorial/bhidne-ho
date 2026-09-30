"""Recovery SQL integration tests; PGlite serializes connections (not a lock-race test)."""
import asyncio
from uuid import UUID

import pytest

from app.auth.postgres import PostgresAuthService
from app.auth.recovery import (InvalidRecoveryChallenge, PostgresRecoveryService,
                               RecoveryRateLimited, normalize_recovery_email)
from app.auth.service import AuthenticationError
from app.database import MIGRATIONS
from pglite_support import PGlitePool


@pytest.fixture
async def recovery_database():
    pool = await PGlitePool.open()
    try:
        for _, sql in MIGRATIONS:
            await pool.execute(sql, script=True)
        yield pool
    finally:
        await pool.close()


async def account(pool, name='recovery_player'):
    auth = PostgresAuthService(pool)
    credentials = await auth.sign_up(name, 'original-password')
    return auth, credentials, PostgresRecoveryService(pool)


async def verified(pool, name='recovery_player'):
    auth, credentials, recovery = await account(pool, name)
    challenge = await recovery.enroll_email(credentials.user_id, 'original-password', 'Player@Example.com')
    await recovery.verify_email(challenge.token)
    return auth, credentials, recovery


async def allow_next(pool, purpose):
    await pool.execute('''UPDATE account_recovery_limits SET next_allowed_at=clock_timestamp()-interval '1 second'
        WHERE purpose=%s''', (purpose,))


@pytest.mark.parametrize('value', ['missing', 'x@@example.com', 'x@localhost', 'a..b@example.com',
    '.a@example.com', 'a.@example.com', 'a@-example.com', 'a@example..com', 'a@exam_ple.com',
    'a\r\nb@example.com', 'नमस्ते@example.com', 'a' * 65 + '@example.com'])
def test_invalid_email(value):
    with pytest.raises(ValueError, match='valid email'):
        normalize_recovery_email(value)


def test_email_normalization_does_not_rewrite_mailbox_aliases():
    assert normalize_recovery_email(' Player.Name+tag@EXAMPLE.COM ') == 'Player.Name+tag@example.com'


async def test_upgrade_preserves_existing_login_and_unenrolled_accounts():
    pool = await PGlitePool.open()
    try:
        for version, sql in MIGRATIONS:
            if version < 28:
                await pool.execute(sql, script=True)
        auth, credentials, _ = await account(pool)
        await pool.execute(dict(MIGRATIONS)[28], script=True)
        assert (await auth.authenticate(credentials.token)).user_id == credentials.user_id
        assert (await auth.sign_in(credentials.username, 'original-password')).user_id == credentials.user_id
        recovery = PostgresRecoveryService(pool)
        assert await recovery.request_reset(credentials.username) is None
        assert await recovery.request_reset('unknown-user') is None
    finally:
        await pool.close()


async def test_verification_requires_password_and_single_use_hashed_mailbox_proof(recovery_database):
    pool = recovery_database
    auth, credentials, recovery = await account(pool)
    with pytest.raises(AuthenticationError):
        await recovery.enroll_email(credentials.user_id, 'wrong-password', 'attacker@example.com')
    guest = await auth.issue_guest()
    with pytest.raises(AuthenticationError):
        await recovery.enroll_email(guest.user_id, 'original-password', 'guest@example.com')
    challenge = await recovery.enroll_email(credentials.user_id, 'original-password', 'Player@EXAMPLE.com')
    assert challenge.email == 'Player@example.com'
    assert challenge.token not in repr(challenge) and challenge.email not in repr(challenge)
    assert await recovery.request_reset(credentials.username) is None
    assert (await pool.execute('SELECT token_hash FROM account_recovery_challenges')).rows == [
        (auth._token_hash(challenge.token),)]
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.reset_password(challenge.token, 'new-password')
    await recovery.verify_email(challenge.token)
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.verify_email(challenge.token)
    assert (await pool.execute('SELECT email FROM account_recovery_contacts')).rows == [('Player@example.com',)]


async def test_reset_revokes_all_sessions_and_pending_proofs_across_services(recovery_database):
    pool = recovery_database
    auth, credentials, recovery = await verified(pool)
    other_gateway = PostgresAuthService(pool)
    second = await other_gateway.sign_in(credentials.username, 'original-password')
    unrelated = await auth.sign_up('other_player', 'other-password')
    await allow_next(pool, 'verify_email')
    pending_email = await recovery.enroll_email(credentials.user_id, 'original-password', 'next@example.com')
    reset = await PostgresRecoveryService(pool).request_reset(' RECOVERY_PLAYER ')
    assert reset.email == 'Player@example.com'
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.verify_email(reset.token)
    await recovery.reset_password(reset.token, 'replacement-password')
    for token in (credentials.token, second.token):
        with pytest.raises(AuthenticationError):
            await other_gateway.authenticate(token)
    assert (await other_gateway.authenticate(unrelated.token)).user_id == unrelated.user_id
    with pytest.raises(AuthenticationError):
        await auth.sign_in(credentials.username, 'original-password')
    assert (await other_gateway.sign_in(credentials.username, 'replacement-password')).user_id == credentials.user_id
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.verify_email(pending_email.token)
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.reset_password(reset.token, 'another-password')


async def test_email_replacement_invalidates_old_reset_and_superseded_verification(recovery_database):
    pool = recovery_database
    _, credentials, recovery = await verified(pool)
    old_reset = await recovery.request_reset(credentials.username)
    await allow_next(pool, 'verify_email')
    first = await recovery.enroll_email(credentials.user_id, 'original-password', 'first@example.com')
    await allow_next(pool, 'verify_email')
    replacement = await recovery.enroll_email(credentials.user_id, 'original-password', 'second@example.com')
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.verify_email(first.token)
    await recovery.verify_email(replacement.token)
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.reset_password(old_reset.token, 'replacement-password')
    await allow_next(pool, 'reset_password')
    assert (await recovery.request_reset(credentials.username)).email == 'second@example.com'


async def test_shared_limits_and_resend_invalidate_only_on_success(recovery_database):
    pool = recovery_database
    _, credentials, recovery = await verified(pool)
    first = await recovery.request_reset(credentials.username)
    assert await PostgresRecoveryService(pool).request_reset(credentials.username) is None
    assert (await pool.execute("SELECT token_hash FROM account_recovery_challenges WHERE purpose='reset_password'")).rows == [
        (PostgresAuthService._token_hash(first.token),)]
    with pytest.raises(RecoveryRateLimited):
        await recovery.enroll_email(credentials.user_id, 'original-password', 'other@example.com')
    for _ in range(4):
        await allow_next(pool, 'reset_password')
        last = await recovery.request_reset(credentials.username)
        assert last is not None
    await allow_next(pool, 'reset_password')
    assert await recovery.request_reset(credentials.username) is None
    with pytest.raises(InvalidRecoveryChallenge):
        await recovery.reset_password(first.token, 'replacement-password')
    await pool.execute("UPDATE account_recovery_limits SET window_start=clock_timestamp()-interval '2 hours'")
    assert await recovery.request_reset(credentials.username) is not None


@pytest.mark.parametrize('purpose', ['verify_email', 'reset_password'])
async def test_expired_challenges_are_rejected_and_bounded_cleanup_preserves_live_ones(recovery_database, purpose):
    pool = recovery_database
    _, credentials, recovery = await account(pool)
    proof = await recovery.enroll_email(credentials.user_id, 'original-password', 'player@example.com')
    if purpose == 'reset_password':
        await recovery.verify_email(proof.token)
        proof = await recovery.request_reset(credentials.username)
    await pool.execute('''UPDATE account_recovery_challenges SET created_at=clock_timestamp()-interval '2 hours',
        expires_at=clock_timestamp()-interval '1 hour' ''')
    _, other, _ = await account(pool, 'other_player')
    live = await recovery.enroll_email(other.user_id, 'original-password', 'other@example.com')
    with pytest.raises(InvalidRecoveryChallenge):
        if purpose == 'verify_email':
            await recovery.verify_email(proof.token)
        else:
            await recovery.reset_password(proof.token, 'replacement-password')
    assert await recovery.purge_expired(1) == 1
    assert await recovery.purge_expired(1) == 0
    await recovery.verify_email(live.token)


async def test_reset_rollback_keeps_password_session_and_token_usable(recovery_database):
    pool = recovery_database
    auth, credentials, recovery = await verified(pool)
    challenge = await recovery.request_reset(credentials.username)
    await pool.execute('''CREATE FUNCTION fail_recovery_test() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'test injected failure'; END; $$;
        CREATE TRIGGER fail_recovery_test BEFORE DELETE ON auth_sessions
            FOR EACH ROW EXECUTE FUNCTION fail_recovery_test();''', script=True)
    with pytest.raises(Exception, match='test injected failure'):
        await recovery.reset_password(challenge.token, 'replacement-password')
    assert (await auth.authenticate(credentials.token)).user_id == credentials.user_id
    await auth.sign_in(credentials.username, 'original-password')
    await pool.execute('DROP TRIGGER fail_recovery_test ON auth_sessions')
    await recovery.reset_password(challenge.token, 'replacement-password')


async def test_duplicate_completion_has_one_winner(recovery_database):
    pool = recovery_database
    _, credentials, recovery = await verified(pool)
    reset = await recovery.request_reset(credentials.username)
    results = await asyncio.gather(recovery.reset_password(reset.token, 'replacement-password'),
        PostgresRecoveryService(pool).reset_password(reset.token, 'other-password'), return_exceptions=True)
    assert sum(result is None for result in results) == 1
    assert sum(isinstance(result, InvalidRecoveryChallenge) for result in results) == 1


async def test_invalid_input_does_not_consume_valid_token(recovery_database):
    pool = recovery_database
    _, credentials, recovery = await verified(pool)
    proof = await recovery.request_reset(credentials.username)
    for token in ('', 'x' * 43, '../invalid', None):
        with pytest.raises(InvalidRecoveryChallenge):
            await recovery.reset_password(token, 'replacement-password')
    for password in ('short', 'x' * 129, None):
        with pytest.raises(ValueError, match='Password'):
            await recovery.reset_password(proof.token, password)
    await recovery.reset_password(proof.token, 'replacement-password')


async def test_deleted_credentials_cascade_recovery_material(recovery_database):
    pool = recovery_database
    _, credentials, recovery = await verified(pool)
    await recovery.request_reset(credentials.username)
    await pool.execute('DELETE FROM account_credentials WHERE user_id=%s', (UUID(credentials.user_id[5:]),))
    for table in ('account_recovery_contacts', 'account_recovery_challenges', 'account_recovery_limits'):
        assert (await pool.execute(f'SELECT count(*) FROM {table}')).rows == [(0,)]
