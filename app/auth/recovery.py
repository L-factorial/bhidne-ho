"""PostgreSQL recovery protocol; public adapters never expose issued credentials.

Only a trusted delivery adapter may receive IssuedChallenge. Never return it to
an API caller or log it. All mutations lock account_credentials first, including
password sign-in, so old-password sessions cannot be created after a reset.
"""
import asyncio
from dataclasses import dataclass, field
import hmac
import re
import secrets
from uuid import UUID

from app.auth.email import normalize_recovery_email
from app.auth.postgres import PostgresAuthService
from app.auth.service import AuthenticationError


class InvalidRecoveryChallenge(ValueError):
    def __init__(self):
        super().__init__('This recovery link is invalid or expired. Request a new one.')


class RecoveryRateLimited(ValueError):
    def __init__(self):
        super().__init__('Please wait before requesting another recovery email.')


@dataclass(frozen=True)
class IssuedChallenge:
    # Avoid accidental disclosure through repr/logging. Not an API response model.
    email: str = field(repr=False)
    token: str = field(repr=False)
    purpose: str


class PostgresRecoveryService:
    def __init__(self, pool, *, outbox=None):
        self.pool = pool
        self.outbox = outbox

    async def _issue(self, connection, user_id, purpose, email):
        # The caller holds the account row lock. Limits are shared across gateways
        # and survive process restarts. Denied attempts do not invalidate valid links.
        allowed = await (await connection.execute('''
            INSERT INTO account_recovery_limits
                (user_id,purpose,window_start,issued_count,next_allowed_at)
            VALUES (%s,%s,clock_timestamp(),1,clock_timestamp()+interval '60 seconds')
            ON CONFLICT (user_id,purpose) DO UPDATE SET
                window_start=CASE WHEN account_recovery_limits.window_start <= clock_timestamp()-interval '1 hour'
                    THEN clock_timestamp() ELSE account_recovery_limits.window_start END,
                issued_count=CASE WHEN account_recovery_limits.window_start <= clock_timestamp()-interval '1 hour'
                    THEN 1 ELSE account_recovery_limits.issued_count+1 END,
                next_allowed_at=clock_timestamp()+interval '60 seconds'
            WHERE account_recovery_limits.next_allowed_at <= clock_timestamp()
                AND (account_recovery_limits.window_start <= clock_timestamp()-interval '1 hour'
                     OR account_recovery_limits.issued_count < 5)
            RETURNING user_id''', (user_id, purpose))).fetchone()
        if allowed is None:
            return None
        token = secrets.token_urlsafe(32)
        lifetime = 30 if purpose == 'verify_email' else 15
        await connection.execute('''INSERT INTO account_recovery_challenges
            (token_hash,user_id,purpose,email,expires_at)
            VALUES (%s,%s,%s,%s,clock_timestamp()+(%s * interval '1 minute'))
            ON CONFLICT (user_id,purpose) DO UPDATE SET token_hash=EXCLUDED.token_hash,
                email=EXCLUDED.email,created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at''',
            (PostgresAuthService._token_hash(token), user_id, purpose, email, lifetime))
        challenge = IssuedChallenge(email=email, token=token, purpose=purpose)
        if self.outbox is not None:
            await self.outbox.enqueue(connection, user_id, challenge)
        return challenge

    async def enroll_email(self, user_id: str, current_password: str, email: str):
        """Fresh password proof; existing verified contact survives until confirmation."""
        email = normalize_recovery_email(email)
        user = UUID(user_id.removeprefix('user-'))
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row = await (await connection.execute('''SELECT password_salt,password_hash
                    FROM account_credentials WHERE user_id=%s FOR UPDATE''', (user,))).fetchone()
                candidate = await asyncio.to_thread(PostgresAuthService._password_hash,
                    current_password, bytes(row[0]) if row else bytes(16))
                if row is None or not hmac.compare_digest(bytes(row[1]), candidate):
                    raise AuthenticationError('Confirm your current account password.')
                result = await self._issue(connection, user, 'verify_email', email)
                if result is None:
                    raise RecoveryRateLimited()
                await connection.execute('UPDATE account_credentials SET unverified_email=%s WHERE user_id=%s', (email, user))
                return result

    async def request_reset(self, username: str):
        """Internal delivery result only. Public responses must not disclose this result."""
        async with self.pool.connection() as connection:
            async with connection.transaction():
                return await self._request_reset(connection, username)

    async def _request_reset(self, connection, username):
        row = await (await connection.execute('''SELECT user_id FROM account_credentials
            WHERE username=%s FOR UPDATE''', (username.strip().lower(),))).fetchone()
        if row is None:
            return None
        contact = await (await connection.execute('''SELECT email FROM account_recovery_contacts
            WHERE user_id=%s''', (row[0],))).fetchone()
        if contact is None:
            return None
        return await self._issue(connection, row[0], 'reset_password', contact[0])

    async def email_status(self, user_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''SELECT c.unverified_email,r.email AS verified_email,
                (SELECT email FROM account_recovery_challenges WHERE user_id=c.user_id
                    AND purpose='verify_email' AND expires_at>clock_timestamp()) AS pending_email
                FROM account_credentials c LEFT JOIN account_recovery_contacts r ON r.user_id=c.user_id
                WHERE c.user_id=%s''', (UUID(user_id.removeprefix('user-')),))).fetchone()
        return dict(password_account=row is not None, verified_email=row[1] if row else None,
                    pending_email=(row[2] or row[0]) if row else None)

    async def remove_email(self, user_id, current_password):
        user = UUID(user_id.removeprefix('user-'))
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row = await (await connection.execute('''SELECT password_salt,password_hash
                    FROM account_credentials WHERE user_id=%s FOR UPDATE''', (user,))).fetchone()
                candidate = await asyncio.to_thread(PostgresAuthService._password_hash,
                    current_password, bytes(row[0]) if row else bytes(16))
                if row is None or not hmac.compare_digest(bytes(row[1]), candidate):
                    raise AuthenticationError('Confirm your current account password.')
                await connection.execute('DELETE FROM account_recovery_contacts WHERE user_id=%s', (user,))
                await connection.execute('DELETE FROM account_recovery_challenges WHERE user_id=%s', (user,))
                await connection.execute('UPDATE account_credentials SET unverified_email=NULL WHERE user_id=%s', (user,))
                if self.outbox is not None:
                    await connection.execute('DELETE FROM recovery_mail_outbox WHERE user_id=%s', (user,))

    async def _challenge(self, connection, token, purpose):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            raise InvalidRecoveryChallenge()
        digest = PostgresAuthService._token_hash(token)
        # Lookup without a challenge lock first, to preserve the global lock order.
        row = await (await connection.execute('''SELECT user_id FROM account_recovery_challenges
            WHERE token_hash=%s AND purpose=%s''', (digest, purpose))).fetchone()
        if row is None:
            raise InvalidRecoveryChallenge()
        account = await (await connection.execute('''SELECT user_id FROM account_credentials
            WHERE user_id=%s FOR UPDATE''', (row[0],))).fetchone()
        if account is None:
            raise InvalidRecoveryChallenge()
        challenge = await (await connection.execute('''SELECT user_id,email FROM account_recovery_challenges
            WHERE token_hash=%s AND purpose=%s AND expires_at>clock_timestamp() FOR UPDATE''',
            (digest, purpose))).fetchone()
        if challenge is None:
            raise InvalidRecoveryChallenge()
        return challenge

    async def verify_email(self, token: str):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                user_id, email = await self._challenge(connection, token, 'verify_email')
                await connection.execute('''INSERT INTO account_recovery_contacts (user_id,email)
                    VALUES (%s,%s) ON CONFLICT (user_id) DO UPDATE
                    SET email=EXCLUDED.email,verified_at=clock_timestamp()''', (user_id, email))
                # Invalidate pending resets issued to the old mailbox as well.
                await connection.execute('DELETE FROM account_recovery_challenges WHERE user_id=%s', (user_id,))
                await connection.execute('UPDATE account_credentials SET unverified_email=NULL WHERE user_id=%s', (user_id,))
                if self.outbox is not None:
                    await connection.execute('DELETE FROM recovery_mail_outbox WHERE user_id=%s', (user_id,))

    async def reset_password(self, token: str, password: str):
        if not isinstance(password, str) or not 8 <= len(password) <= 128:
            raise ValueError('Password must contain between 8 and 128 characters.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                user_id, email = await self._challenge(connection, token, 'reset_password')
                contact = await (await connection.execute('''SELECT email FROM account_recovery_contacts
                    WHERE user_id=%s''', (user_id,))).fetchone()
                if contact is None or contact[0] != email:
                    raise InvalidRecoveryChallenge()
                salt = secrets.token_bytes(16)
                hashed = await asyncio.to_thread(PostgresAuthService._password_hash, password, salt)
                await connection.execute('''UPDATE account_credentials SET password_salt=%s,password_hash=%s
                    WHERE user_id=%s''', (salt, hashed, user_id))
                await connection.execute('DELETE FROM auth_sessions WHERE user_id=%s', (user_id,))
                await connection.execute('DELETE FROM account_recovery_challenges WHERE user_id=%s', (user_id,))
                if self.outbox is not None:
                    await connection.execute('DELETE FROM recovery_mail_outbox WHERE user_id=%s', (user_id,))

    async def purge_expired(self, limit: int = 100):
        """Bounded cleanup for the delivery worker; no token material returned."""
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1000:
            raise ValueError('Cleanup limit must be between 1 and 1000.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                rows = await (await connection.execute('''DELETE FROM account_recovery_challenges
                    WHERE token_hash IN (SELECT token_hash FROM account_recovery_challenges
                        WHERE expires_at<=clock_timestamp() ORDER BY expires_at
                        LIMIT %s FOR UPDATE SKIP LOCKED) RETURNING user_id''', (limit,))).fetchall()
                return len(rows)
