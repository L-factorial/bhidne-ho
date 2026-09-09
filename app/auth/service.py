import asyncio
import hashlib
import hmac
import secrets
from typing import Protocol
from uuid import uuid4

from app.auth.models import AccountCredentials, GuestCredentials
from app.models.user import UserIdentity


class AuthenticationError(Exception):
    pass


class AuthService(Protocol):
    async def authenticate(self, token: str) -> UserIdentity: ...


class GuestAuthService:
    """Process-local credentials, valid until this service is discarded."""

    def __init__(self) -> None:
        self._identities: dict[str, UserIdentity] = {}

    async def issue_guest(self) -> GuestCredentials:
        identity = UserIdentity(user_id=f"user-{uuid4()}")
        token = secrets.token_urlsafe(32)
        # No awaits: these dictionary operations are atomic on our event loop.
        self._identities[token] = identity
        return GuestCredentials(user_id=identity.user_id, token=token)

    async def authenticate(self, token: str) -> UserIdentity:
        identity = self._identities.get(token)
        if identity is None:
            raise AuthenticationError("Invalid guest token")
        return identity


class UsernameTakenError(Exception):
    pass


class InMemoryAuthService(GuestAuthService):
    """Development accounts. Password hashes and sessions disappear on restart."""

    def __init__(self) -> None:
        super().__init__()
        self._accounts: dict[str, tuple[UserIdentity, bytes, bytes]] = {}

    @staticmethod
    def _hash(password: str, salt: bytes) -> bytes:
        return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)

    def _session(self, username: str, identity: UserIdentity) -> AccountCredentials:
        token = secrets.token_urlsafe(32)
        self._identities[token] = identity
        return AccountCredentials(username=username, user_id=identity.user_id, token=token)

    async def sign_up(self, username: str, password: str) -> AccountCredentials:
        salt = secrets.token_bytes(16)
        hashed = await asyncio.to_thread(self._hash, password, salt)
        # Check after hashing: concurrent signups cannot overwrite an account.
        if username in self._accounts:
            raise UsernameTakenError("Username is already taken")
        identity = UserIdentity(user_id=f"user-{uuid4()}")
        self._accounts[username] = (identity, salt, hashed)
        return self._session(username, identity)

    async def sign_in(self, username: str, password: str) -> AccountCredentials:
        account = self._accounts.get(username)
        salt = account[1] if account else bytes(16)
        hashed = await asyncio.to_thread(self._hash, password, salt)
        if account is None or not hmac.compare_digest(account[2], hashed):
            raise AuthenticationError("Invalid username or password")
        return self._session(username, account[0])
