"""PostgreSQL lifecycle and the small initial schema.

The application consumes a normal PostgreSQL URL and does not depend on Docker.
Use a migration tool before the schema needs changes; this bootstrap is deliberately
idempotent so the first persistence milestone has no separate deployment step.
"""

from psycopg_pool import AsyncConnectionPool


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('guest', 'account')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_credentials (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username text NOT NULL UNIQUE,
    password_salt bytea NOT NULL,
    password_hash bytea NOT NULL
);
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash bytea PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS external_identities (
    provider text NOT NULL CHECK (provider IN ('google', 'apple', 'facebook')),
    provider_subject text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email text,
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS external_identities_user_id_idx ON external_identities(user_id);
"""


class Database:
    def __init__(self, url: str) -> None:
        self.pool = AsyncConnectionPool(url, min_size=1, max_size=10, open=False)

    async def open(self) -> None:
        await self.pool.open(wait=True)
        async with self.pool.connection() as connection:
            await connection.execute(SCHEMA)

    async def close(self) -> None:
        await self.pool.close()
