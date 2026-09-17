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
CREATE TABLE IF NOT EXISTS friendships (
    user_low uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_low, user_high),
    CHECK (user_low < user_high),
    CHECK (requested_by = user_low OR requested_by = user_high)
);
CREATE INDEX IF NOT EXISTS friendships_requested_by_idx ON friendships(requested_by, status);
CREATE TABLE IF NOT EXISTS direct_messages (
    id uuid PRIMARY KEY,
    sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
    sent_at timestamptz NOT NULL DEFAULT now(),
    CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS direct_messages_sender_recipient_time_idx
    ON direct_messages (sender_id, recipient_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS direct_messages_recipient_sender_time_idx
    ON direct_messages (recipient_id, sender_id, sent_at DESC);
CREATE TABLE IF NOT EXISTS friend_notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('friend_accepted', 'friend_rejected')),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE INDEX IF NOT EXISTS friend_notifications_user_time_idx
    ON friend_notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS rooms (
    id text PRIMARY KEY,
    creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    visibility text NOT NULL CHECK (visibility IN ('public', 'friends')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rooms_creator_time_idx ON rooms(creator_id, created_at DESC);
CREATE TABLE IF NOT EXISTS room_memberships (
    room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS room_memberships_user_time_idx
    ON room_memberships(user_id, joined_at DESC);
CREATE TABLE IF NOT EXISTS deleted_rooms (
    id text PRIMARY KEY,
    deleted_at timestamptz NOT NULL DEFAULT now()
);
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
