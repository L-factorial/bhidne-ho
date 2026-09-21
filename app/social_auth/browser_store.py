"""Short-lived login attempts. Provider tokens and app sessions are never stored here."""
from copy import deepcopy
from time import time

from psycopg.types.json import Jsonb


class MemoryBrowserAttempts:
    def __init__(self):
        self.attempts = {}

    async def create(self, attempt):
        self.attempts = {key: value for key, value in self.attempts.items() if value['expires_at'] > time()}
        self.attempts[attempt['id']] = deepcopy(attempt)

    async def claim(self, provider, state_hash):
        for attempt in self.attempts.values():
            if (attempt['provider'] == provider and attempt['state_hash'] == state_hash
                    and attempt['status'] == 'pending' and attempt['expires_at'] > time()):
                attempt['status'] = 'verifying'
                return deepcopy(attempt)
        return None

    async def finish(self, attempt_id, result):
        attempt = self.attempts[attempt_id]
        attempt.update(status='ready', result=result)
        attempt.pop('code_verifier', None)
        attempt.pop('nonce', None)

    async def consume(self, attempt_id, secret_hash, handoff_hash):
        attempt = self.attempts.get(attempt_id)
        if (not attempt or attempt['secret_hash'] != secret_hash or attempt['expires_at'] <= time()
                or attempt['status'] != 'ready' or attempt['result']['handoff_hash'] != handoff_hash):
            return None
        return self.attempts.pop(attempt_id)['result']


class PostgresBrowserAttempts:
    def __init__(self, pool):
        self.pool = pool

    async def create(self, attempt):
        async with self.pool.connection() as connection:
            await connection.execute('DELETE FROM social_login_attempts WHERE expires_at <= now()')
            await connection.execute('''
                INSERT INTO social_login_attempts (id, provider, state_hash, secret_hash, expires_at, data)
                VALUES (%s, %s, %s, %s, to_timestamp(%s), %s)
            ''', (attempt['id'], attempt['provider'], attempt['state_hash'], attempt['secret_hash'],
                  attempt['expires_at'], Jsonb(attempt)))

    async def claim(self, provider, state_hash):
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''
                UPDATE social_login_attempts SET status='verifying'
                WHERE provider=%s AND state_hash=%s AND status='pending' AND expires_at > now()
                RETURNING data
            ''', (provider, state_hash))).fetchone()
            return row[0] if row else None

    async def finish(self, attempt_id, result):
        async with self.pool.connection() as connection:
            await connection.execute('''
                UPDATE social_login_attempts SET status='ready', data=%s WHERE id=%s AND status='verifying'
            ''', (Jsonb(result), attempt_id))

    async def consume(self, attempt_id, secret_hash, handoff_hash):
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''
                DELETE FROM social_login_attempts
                WHERE id=%s AND secret_hash=%s AND data->>'handoff_hash'=%s AND status='ready' AND expires_at > now()
                RETURNING data
            ''', (attempt_id, secret_hash, handoff_hash))).fetchone()
            return row[0] if row else None
