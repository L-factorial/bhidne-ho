"""Encrypted PostgreSQL mail outbox. SMTP delivery is at least once, outside locks."""
import asyncio
from dataclasses import dataclass, field
from email.message import EmailMessage
import hashlib
import json
import logging
import os
import smtplib
import ssl
from urllib.parse import urlsplit
from uuid import uuid4

from cryptography.fernet import Fernet, MultiFernet, InvalidToken
from app.auth.email import normalize_recovery_email
from app.auth.postgres import PostgresAuthService
from app.auth.recovery import PostgresRecoveryService

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class RecoveryConfig:
    origin: str
    sender: str
    host: str
    port: int
    tls: str
    username: str = field(repr=False)
    password: str = field(repr=False)
    cipher: MultiFernet = field(repr=False)

    @classmethod
    def from_environment(cls):
        if os.getenv('BHIDNE_HO_RECOVERY_ENABLED', '0') != '1':
            return None
        def required(name):
            value = os.getenv('BHIDNE_HO_RECOVERY_' + name, '').strip()
            if not value:
                raise ValueError('Missing recovery setting: ' + name)
            return value
        origin = required('PUBLIC_ORIGIN').rstrip('/')
        parsed = urlsplit(origin)
        local = parsed.hostname in ('localhost', '127.0.0.1', '::1')
        if (parsed.scheme != 'https' and not (local and parsed.scheme == 'http')) or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('Recovery public origin must be an HTTPS origin (HTTP loopback for tests).')
        host = required('SMTP_HOST')
        tls = os.getenv('BHIDNE_HO_RECOVERY_SMTP_TLS', 'starttls')
        if tls not in ('starttls', 'ssl', 'local') or (tls == 'local' and host not in ('localhost', '127.0.0.1', '::1')):
            raise ValueError('Recovery SMTP requires TLS; local mode is loopback only.')
        port = int(os.getenv('BHIDNE_HO_RECOVERY_SMTP_PORT', '465' if tls == 'ssl' else '587'))
        if not 1 <= port <= 65535:
            raise ValueError('Invalid recovery SMTP port.')
        try:
            cipher = MultiFernet([Fernet(key.strip().encode()) for key in required('KEYS').split(',')])
        except Exception:
            raise ValueError('Recovery encryption keys must be valid Fernet keys.') from None
        return cls(origin, normalize_recovery_email(required('FROM')), host, port, tls,
                   os.getenv('BHIDNE_HO_RECOVERY_SMTP_USERNAME', ''),
                   os.getenv('BHIDNE_HO_RECOVERY_SMTP_PASSWORD', ''), cipher)

    def send(self, payload):
        verify = payload['purpose'] == 'verify_email'
        message = EmailMessage()
        message['From'] = self.sender
        message['To'] = payload['email']
        if payload['purpose'] == 'username_reminder':
            message['Subject'] = 'Your Bhidne Ho username'
            message.set_content('Usernames linked to this verified recovery email:\n\n' +
                '\n'.join(payload['usernames']) + '\n\nSign in at ' + self.origin +
                '/\n\nIf you did not request this reminder, you can ignore this email. Your password has not changed.\n')
        else:
            message['Subject'] = 'Verify your Bhidne Ho email' if verify else 'Reset your Bhidne Ho password'
            link = self.origin + '/#recovery=' + payload['purpose'] + '&token=' + payload['token']
            message.set_content(('Confirm your recovery email' if verify else 'Choose a new password') +
                ' by opening this link:\n\n' + link + '\n\nThis link expires in ' +
                ('30' if verify else '15') + ' minutes and works once. If you did not request this, ignore this email.\n')
        context = ssl.create_default_context()
        smtp_type = smtplib.SMTP_SSL if self.tls == 'ssl' else smtplib.SMTP
        kwargs = {'context': context} if self.tls == 'ssl' else {}
        with smtp_type(self.host, self.port, timeout=10, **kwargs) as smtp:
            if self.tls == 'starttls':
                smtp.starttls(context=context)
            if self.username:
                smtp.login(self.username, self.password)
            smtp.send_message(message)


class RecoveryRuntime:
    def __init__(self, pool, auth, config=None):
        self.pool, self.config = pool, config
        self.enabled = config is not None
        if self.enabled and pool is None:
            raise ValueError('Email recovery requires PostgreSQL.')
        self.service = PostgresRecoveryService(pool, outbox=self if self.enabled else None) if pool else None
        if self.enabled:
            auth.recovery = self.service
        self.task = None
        self.stopping = asyncio.Event()

    @classmethod
    def from_environment(cls, pool, auth):
        return cls(pool, auth, RecoveryConfig.from_environment())

    def encrypt(self, payload):
        return self.config.cipher.encrypt(json.dumps(payload).encode())

    def decrypt(self, envelope):
        return json.loads(self.config.cipher.decrypt(bytes(envelope)))

    async def budget(self, connection, scope, identity, maximum, seconds):
        bucket = hashlib.sha256((scope + ':' + identity).encode()).digest()
        row = await (await connection.execute('''INSERT INTO recovery_request_limits(bucket,count,expires_at)
            VALUES (%s,1,clock_timestamp()+(%s * interval '1 second'))
            ON CONFLICT(bucket) DO UPDATE SET
              count=CASE WHEN recovery_request_limits.expires_at<=clock_timestamp() THEN 1 ELSE recovery_request_limits.count+1 END,
              expires_at=CASE WHEN recovery_request_limits.expires_at<=clock_timestamp() THEN EXCLUDED.expires_at ELSE recovery_request_limits.expires_at END
            WHERE recovery_request_limits.expires_at<=clock_timestamp() OR recovery_request_limits.count<%s
            RETURNING bucket''', (bucket, seconds, maximum))).fetchone()
        return row is not None

    async def enqueue(self, connection, user_id, challenge):
        # A recipient budget also bounds mail abuse through repeated new signups.
        if not await self.budget(connection, 'recipient', challenge.email.lower(), 10, 3600):
            return
        await connection.execute('''INSERT INTO recovery_mail_outbox(id,user_id,purpose,token_hash,envelope,expires_at)
            SELECT %s,user_id,purpose,token_hash,%s,expires_at FROM account_recovery_challenges
            WHERE user_id=%s AND purpose=%s
            ON CONFLICT(user_id,purpose) DO UPDATE SET id=EXCLUDED.id,token_hash=EXCLUDED.token_hash,
            envelope=EXCLUDED.envelope,expires_at=EXCLUDED.expires_at,attempts=0,
            available_at=clock_timestamp(),lease_id=NULL,lease_until=NULL''',
            (uuid4(), self.encrypt(dict(email=challenge.email,token=challenge.token,purpose=challenge.purpose)), user_id, challenge.purpose))

    async def request_reset(self, username, peer):
        # No account lookup in the HTTP path. All callers get the same response.
        async with self.pool.connection() as c:
            async with c.transaction():
                if not await self.budget(c, 'reset-ip', peer, 20, 600):
                    return
                if not await self.budget(c, 'reset-username', username.strip().lower(), 5, 3600):
                    return
                await c.execute('INSERT INTO recovery_reset_requests(id,envelope) VALUES (%s,%s)',
                    (uuid4(), self.encrypt(dict(username=username.strip().lower()))))

    async def request_username(self, email, peer):
        email = normalize_recovery_email(email)
        async with self.pool.connection() as c:
            async with c.transaction():
                if not await self.budget(c, 'reset-ip', peer, 20, 600):
                    return
                if not await self.budget(c, 'username-email', email.lower(), 5, 3600):
                    return
                if not await self.budget(c, 'username-email-minute', email.lower(), 1, 60):
                    return
                await c.execute('INSERT INTO recovery_reset_requests(id,envelope) VALUES (%s,%s)',
                    (uuid4(), self.encrypt(dict(purpose='username_reminder', email=email, username=''))))

    async def enqueue_username(self, c, email):
        # Select only verified contacts, never signup metadata. One email covers
        # all matching accounts; resolve the current usernames again before send.
        row = await (await c.execute('''SELECT user_id FROM account_recovery_contacts
            WHERE email=%s ORDER BY user_id LIMIT 1''', (email,))).fetchone()
        if row is None or not await self.budget(c, 'recipient', email.lower(), 10, 3600):
            return
        await c.execute('''INSERT INTO recovery_mail_outbox
            (id,user_id,purpose,token_hash,envelope,expires_at)
            VALUES (%s,%s,'username_reminder',NULL,%s,clock_timestamp()+interval '10 minutes')
            ON CONFLICT(user_id,purpose) DO NOTHING''',
            (uuid4(), row[0], self.encrypt(dict(purpose='username_reminder', email=email))))

    async def process_reset(self):
        async with self.pool.connection() as c:
            async with c.transaction():
                row = await (await c.execute('''SELECT id,envelope FROM recovery_reset_requests
                    WHERE expires_at>clock_timestamp() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED''')).fetchone()
                if row is None:
                    return
                try:
                    payload = self.decrypt(row[1])
                except InvalidToken:
                    log.warning('Discarding unreadable recovery request; check encryption key configuration.')
                else:
                    if payload.get('purpose') == 'username_reminder':
                        await self.enqueue_username(c, payload['email'])
                    else:
                        await self.service._request_reset(c, payload['username'])
                await c.execute('DELETE FROM recovery_reset_requests WHERE id=%s', (row[0],))

    async def deliver_one(self):
        lease = uuid4()
        async with self.pool.connection() as c:
            async with c.transaction():
                row = await (await c.execute('''UPDATE recovery_mail_outbox SET lease_id=%s,
                    lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1
                    WHERE id=(SELECT o.id FROM recovery_mail_outbox o
                    LEFT JOIN account_recovery_challenges c ON c.token_hash=o.token_hash
                    WHERE (o.purpose='username_reminder' OR c.token_hash IS NOT NULL)
                    AND o.available_at<=clock_timestamp() AND o.expires_at>clock_timestamp()
                    AND o.attempts<5 AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp())
                    ORDER BY o.available_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED)
                    RETURNING id,envelope,attempts''', (lease,))).fetchone()
        if row is None:
            return
        try:
            payload = self.decrypt(row[1])
            if payload['purpose'] == 'username_reminder':
                async with self.pool.connection() as c:
                    accounts = await (await c.execute('''SELECT c.username FROM account_credentials c
                        JOIN account_recovery_contacts r ON r.user_id=c.user_id
                        WHERE r.email=%s ORDER BY c.username''', (payload['email'],))).fetchall()
                payload['usernames'] = [account[0] for account in accounts]
            if payload['purpose'] != 'username_reminder' or payload['usernames']:
                await asyncio.to_thread(self.config.send, payload)
        except Exception:
            # SMTP exceptions may contain recipient addresses; never log their text.
            log.warning('Recovery delivery failed; attempt %s of 5', row[2])
            async with self.pool.connection() as c:
                await c.execute('''UPDATE recovery_mail_outbox SET lease_id=NULL,lease_until=NULL,
                    available_at=clock_timestamp()+(%s * interval '1 second') WHERE id=%s AND lease_id=%s''',
                    (min(300, 15 * 2 ** row[2]), row[0], lease))
        else:
            async with self.pool.connection() as c:
                await c.execute('DELETE FROM recovery_mail_outbox WHERE id=%s AND lease_id=%s', (row[0], lease))

    async def cleanup(self):
        async with self.pool.connection() as c:
            await c.execute('''DELETE FROM recovery_mail_outbox WHERE id IN (SELECT o.id FROM recovery_mail_outbox o
                WHERE o.expires_at<=clock_timestamp() OR (o.attempts>=5 AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp()))
                OR (o.purpose<>'username_reminder' AND NOT EXISTS(SELECT 1 FROM account_recovery_challenges c WHERE c.token_hash=o.token_hash)) LIMIT 100 FOR UPDATE OF o SKIP LOCKED)''')
            await c.execute('''DELETE FROM recovery_reset_requests WHERE id IN
                (SELECT id FROM recovery_reset_requests WHERE expires_at<=clock_timestamp() LIMIT 100)''')
            await c.execute('''DELETE FROM recovery_request_limits WHERE bucket IN
                (SELECT bucket FROM recovery_request_limits WHERE expires_at<=clock_timestamp() LIMIT 100)''')
        await self.service.purge_expired()

    async def tick(self):
        await self.process_reset()
        await self.deliver_one()
        await self.cleanup()

    async def run(self):
        while not self.stopping.is_set():
            try:
                await self.tick()
            except Exception:
                log.warning('Recovery worker cycle failed; will retry.')
            try:
                await asyncio.wait_for(self.stopping.wait(), timeout=1)
            except TimeoutError:
                pass

    async def start(self):
        if self.enabled and self.task is None:
            self.task = asyncio.create_task(self.run(), name='recovery-delivery')

    async def stop(self):
        self.stopping.set()
        if self.task:
            await self.task
            self.task = None
