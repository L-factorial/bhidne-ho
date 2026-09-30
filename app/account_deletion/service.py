"""Password/mail-proven deletion requests and private status capabilities."""
import asyncio
import hashlib
import hmac
import secrets
from uuid import UUID, uuid4

from app.auth.postgres import PostgresAuthService
from .inventory import inspect_account


class DeletionError(ValueError):
    pass


def digest(value):
    return hashlib.sha256(value.encode()).digest()


class DeletionService:
    def __init__(self, pool, recovery):
        self.pool, self.recovery = pool, recovery

    async def request(self, user_id=None, *, password='', token=None, session_token=None):
        status_token = secrets.token_urlsafe(32)
        async with self.pool.connection() as c:
            async with c.transaction():
                if token:
                    challenge = await (await c.execute("SELECT user_id FROM account_recovery_challenges WHERE token_hash=%s AND purpose='delete_account' AND expires_at>clock_timestamp()", (digest(token),))).fetchone()
                    if not challenge:
                        raise DeletionError('invalid_proof')
                    user_id = 'user-' + str(challenge[0])
                uid = UUID(user_id.removeprefix('user-'))
                credentials = await (await c.execute('SELECT password_salt,password_hash FROM account_credentials WHERE user_id=%s FOR UPDATE', (uid,))).fetchone()
                user = await (await c.execute('SELECT kind,deletion_pending,erased FROM users WHERE id=%s FOR UPDATE', (uid,))).fetchone()
                if not user or user[1] or user[2]:
                    raise DeletionError('invalid_proof')
                if token:
                    proof = await (await c.execute("SELECT token_hash FROM account_recovery_challenges WHERE user_id=%s AND token_hash=%s AND purpose='delete_account' AND expires_at>clock_timestamp() FOR UPDATE", (uid,digest(token)))).fetchone()
                    if not proof:
                        raise DeletionError('invalid_proof')
                elif credentials:
                    candidate = await asyncio.to_thread(PostgresAuthService._password_hash, password, bytes(credentials[0]))
                    if not hmac.compare_digest(candidate, bytes(credentials[1])):
                        raise DeletionError('invalid_proof')
                else:
                    # Social-only accounts need an actual recently issued login plus
                    # fresh encrypted grants from the verified browser code exchange.
                    fresh = await (await c.execute("SELECT 1 FROM auth_sessions WHERE user_id=%s AND token_hash=%s AND expires_at>clock_timestamp() AND (%s OR created_at>clock_timestamp()-interval '5 minutes')", (uid,digest(session_token or ''),user[0]=='guest'))).fetchone()
                    if not fresh:
                        raise DeletionError('reauthenticate')
                providers = await (await c.execute('SELECT provider FROM external_identities WHERE user_id=%s', (uid,))).fetchall()
                for (provider,) in providers:
                    grant = await (await c.execute("SELECT 1 FROM account_provider_grants WHERE user_id=%s AND provider=%s AND verified_at>clock_timestamp()-interval '5 minutes'", (uid,provider))).fetchone()
                    if not grant:
                        raise DeletionError('reauthenticate')
                inventory = await inspect_account(c, user_id)
                if inventory.active_games or inventory.reserved_tables or inventory.table_positions:
                    raise DeletionError('leave_games')
                if inventory.pending_commands:
                    raise DeletionError('pending_actions')
                await c.execute('UPDATE users SET deletion_pending=true WHERE id=%s', (uid,))
                await c.execute('DELETE FROM auth_sessions WHERE user_id=%s', (uid,))
                await c.execute('DELETE FROM account_recovery_challenges WHERE user_id=%s', (uid,))
                await c.execute('DELETE FROM recovery_mail_outbox WHERE user_id=%s', (uid,))
                job_id = uuid4()
                await c.execute('INSERT INTO account_deletion_jobs(id,user_id,status_hash) VALUES (%s,%s,%s)', (job_id,uid,digest(status_token)))
        return {'status':'pending', 'status_token':status_token}

    async def status(self, token):
        async with self.pool.connection() as c:
            row = await (await c.execute('SELECT status,reason FROM account_deletion_jobs WHERE status_hash=%s', (digest(token),))).fetchone()
        if row is None:
            raise DeletionError('invalid_proof')
        return {'status':row[0], 'reason':row[1]}
