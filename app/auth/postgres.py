import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
from uuid import uuid4

from psycopg.errors import UniqueViolation

from app.auth.models import AccountCredentials, GuestCredentials
from app.auth.service import AuthenticationError, InMemoryAuthService, UsernameTakenError
from app.models.user import UserIdentity


class PostgresAuthService:
    """Durable users, password credentials and opaque, revocable sessions."""

    session_lifetime = timedelta(days=30)

    def __init__(self, pool) -> None:
        self.pool = pool

    @staticmethod
    def _token_hash(token: str) -> bytes:
        return hashlib.sha256(token.encode()).digest()

    @staticmethod
    def _password_hash(password: str, salt: bytes) -> bytes:
        return InMemoryAuthService._hash(password, salt)

    async def _session(self, connection, user_id, username=None):
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + self.session_lifetime
        await connection.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
            (self._token_hash(token), user_id, expires),
        )
        values = {"user_id": f"user-{user_id}", "token": token}
        return AccountCredentials(username=username, **values) if username else GuestCredentials(**values)

    async def issue_guest(self) -> GuestCredentials:
        user_id = uuid4()
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute("INSERT INTO users (id, kind) VALUES (%s, 'guest')", (user_id,))
                await connection.execute("INSERT INTO user_profiles (user_id) VALUES (%s)", (user_id,))
                return await self._session(connection, user_id)

    async def authenticate(self, token: str) -> UserIdentity:
        if not token:
            raise AuthenticationError("Invalid session token")
        async with self.pool.connection() as connection:
            result = await connection.execute(
                "SELECT user_id FROM auth_sessions WHERE token_hash = %s AND expires_at > now()",
                (self._token_hash(token),),
            )
            row = await result.fetchone()
        if row is None:
            raise AuthenticationError("Invalid session token")
        return UserIdentity(user_id=f"user-{row[0]}")

    async def sign_up(self, username: str, password: str) -> AccountCredentials:
        user_id, salt = uuid4(), secrets.token_bytes(16)
        password_hash = await asyncio.to_thread(self._password_hash, password, salt)
        try:
            async with self.pool.connection() as connection:
                async with connection.transaction():
                    await connection.execute("INSERT INTO users (id, kind) VALUES (%s, 'account')", (user_id,))
                    await connection.execute(
                        "INSERT INTO account_credentials (user_id, username, password_salt, password_hash) VALUES (%s, %s, %s, %s)",
                        (user_id, username, salt, password_hash),
                    )
                    await connection.execute("INSERT INTO user_profiles (user_id) VALUES (%s)", (user_id,))
                    return await self._session(connection, user_id, username)
        except UniqueViolation:
            raise UsernameTakenError("Username is already taken") from None

    async def sign_in(self, username: str, password: str) -> AccountCredentials:
        async with self.pool.connection() as connection:
            result = await connection.execute(
                "SELECT user_id, password_salt, password_hash FROM account_credentials WHERE username = %s",
                (username,),
            )
            row = await result.fetchone()
            salt = bytes(row[1]) if row else bytes(16)
            candidate = await asyncio.to_thread(self._password_hash, password, salt)
            if row is None or not hmac.compare_digest(bytes(row[2]), candidate):
                raise AuthenticationError("Invalid username or password")
            return await self._session(connection, row[0], username)

    async def revoke(self, token: str) -> None:
        async with self.pool.connection() as connection:
            await connection.execute("DELETE FROM auth_sessions WHERE token_hash = %s", (self._token_hash(token),))

    async def issue_identity(self, user_id) -> GuestCredentials:
        async with self.pool.connection() as connection:
            return await self._session(connection, user_id)
