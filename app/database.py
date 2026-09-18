"""PostgreSQL lifecycle and versioned application schema.

The application consumes a normal PostgreSQL URL and does not depend on Docker.
Migrations are append-only and run under a PostgreSQL advisory lock so concurrent
application starts cannot race schema installation.
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


GAME_PERSISTENCE_SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id uuid PRIMARY KEY,
    room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    game_type text NOT NULL,
    engine_version integer NOT NULL CHECK (engine_version > 0),
    event_schema_version integer NOT NULL CHECK (event_schema_version > 0),
    initial_state jsonb NOT NULL,
    current_sequence bigint NOT NULL DEFAULT 0 CHECK (current_sequence >= 0),
    current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    status text NOT NULL CHECK (status IN ('active', 'completed', 'abandoned', 'corrupt', 'archived')),
    owner_instance_id text,
    ownership_epoch bigint NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
    lease_expires_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    summary_finalized_at timestamptz,
    CHECK ((status = 'active' AND completed_at IS NULL) OR status <> 'active')
);
CREATE INDEX IF NOT EXISTS games_room_status_started_idx
    ON games(room_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS games_expired_lease_idx
    ON games(lease_expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS game_commands (
    game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    actor_id text NOT NULL,
    command_id text NOT NULL CHECK (char_length(command_id) BETWEEN 1 AND 128),
    request_fingerprint text NOT NULL,
    expected_revision bigint NOT NULL CHECK (expected_revision >= 0),
    status text NOT NULL CHECK (status IN ('accepted', 'rejected')),
    first_sequence bigint,
    last_sequence bigint,
    resulting_revision bigint NOT NULL CHECK (resulting_revision >= 0),
    rejection_code text,
    rejection_detail text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, actor_id, command_id),
    CHECK ((first_sequence IS NULL) = (last_sequence IS NULL)),
    CHECK (first_sequence IS NULL OR (first_sequence > 0 AND last_sequence >= first_sequence)),
    CHECK ((status = 'accepted' AND rejection_code IS NULL) OR status = 'rejected')
);

CREATE TABLE IF NOT EXISTS game_events (
    game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    sequence bigint NOT NULL CHECK (sequence > 0),
    event_id uuid NOT NULL UNIQUE,
    actor_id text NOT NULL,
    command_id text NOT NULL,
    event_type text NOT NULL,
    event_version integer NOT NULL CHECK (event_version > 0),
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, sequence),
    FOREIGN KEY (game_id, actor_id, command_id)
        REFERENCES game_commands(game_id, actor_id, command_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS game_events_command_idx
    ON game_events(game_id, actor_id, command_id, sequence);

CREATE TABLE IF NOT EXISTS completed_games (
    game_id uuid PRIMARY KEY REFERENCES games(id) ON DELETE RESTRICT,
    room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    game_type text NOT NULL,
    final_sequence bigint NOT NULL CHECK (final_sequence >= 0),
    final_revision bigint NOT NULL CHECK (final_revision >= 0),
    result jsonb NOT NULL,
    journal_digest text NOT NULL,
    completed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS completed_games_room_time_idx
    ON completed_games(room_id, completed_at DESC);
"""


MIGRATIONS = (
    (1, SCHEMA),
    (2, GAME_PERSISTENCE_SCHEMA),
    (3, """
        ALTER TABLE games ADD COLUMN IF NOT EXISTS start_command_id text;
        ALTER TABLE games ADD COLUMN IF NOT EXISTS fencing_token_hash bytea;
        CREATE UNIQUE INDEX IF NOT EXISTS games_room_start_command_idx
            ON games(room_id, start_command_id) WHERE start_command_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS active_game_players (
            user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
            game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
            room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
            seat integer NOT NULL CHECK (seat > 0),
            joined_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (game_id, seat),
            UNIQUE (game_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS active_game_players_game_idx
            ON active_game_players(game_id);
    """),
    (4, """
        ALTER TABLE games ADD COLUMN IF NOT EXISTS rules_schema_version integer
            NOT NULL DEFAULT 1 CHECK (rules_schema_version > 0);
        ALTER TABLE games ADD COLUMN IF NOT EXISTS rules jsonb
            NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE games ADD COLUMN IF NOT EXISTS rules_digest text
            NOT NULL DEFAULT '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
        CREATE OR REPLACE FUNCTION reject_started_game_rule_change()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.rules_schema_version IS DISTINCT FROM OLD.rules_schema_version
               OR NEW.rules IS DISTINCT FROM OLD.rules
               OR NEW.rules_digest IS DISTINCT FROM OLD.rules_digest THEN
                RAISE EXCEPTION 'started game rules are immutable';
            END IF;
            RETURN NEW;
        END;
        $$;
        DROP TRIGGER IF EXISTS games_rules_immutable ON games;
        CREATE TRIGGER games_rules_immutable
            BEFORE UPDATE OF rules_schema_version, rules, rules_digest ON games
            FOR EACH ROW EXECUTE FUNCTION reject_started_game_rule_change();
    """),
    (5, """
        CREATE TABLE ledger_games (
            game_id uuid PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
            table_id uuid NOT NULL, game_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ledger_games_room_table_idx ON ledger_games(room_id,table_id,created_at);
        CREATE TABLE game_ledger_entries (
            game_id uuid NOT NULL REFERENCES ledger_games(game_id) ON DELETE RESTRICT,
            player_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, amount bigint NOT NULL,
            PRIMARY KEY(game_id,player_id)
        );
        CREATE TABLE settlement_batches (
            batch_id uuid PRIMARY KEY, room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
            table_id uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('game','table')), game_id uuid,
            status text NOT NULL CHECK(status IN ('OPEN','PARTIALLY_RESOLVED','RESOLVED','CANCELLED')),
            created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, idempotency_key text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(created_by,idempotency_key),
            CHECK((scope='game')=(game_id IS NOT NULL))
        );
        CREATE TABLE settlement_games (
            batch_id uuid NOT NULL REFERENCES settlement_batches(batch_id) ON DELETE RESTRICT,
            game_id uuid NOT NULL UNIQUE REFERENCES ledger_games(game_id) ON DELETE RESTRICT,
            PRIMARY KEY(batch_id,game_id)
        );
        CREATE TABLE settlement_transfers (
            transfer_id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES settlement_batches(batch_id) ON DELETE RESTRICT,
            payer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            payee_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, amount bigint NOT NULL CHECK(amount>0),
            status text NOT NULL CHECK(status IN ('OPEN','MARKED_PAID','RESOLVED','DISPUTED','CANCELLED')),
            marked_paid_at timestamptz, resolved_at timestamptz, CHECK(payer_id<>payee_id)
        );
        CREATE INDEX settlement_transfers_party_idx ON settlement_transfers(payer_id,payee_id,status);
        CREATE TABLE settlement_actions (
            actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, action text NOT NULL,
            idempotency_key text NOT NULL, transfer_id uuid NOT NULL REFERENCES settlement_transfers(transfer_id),
            created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,action,idempotency_key)
        );
    """),
    (6, """
        CREATE TABLE player_phrases (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 30),
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX player_phrases_user_time_idx ON player_phrases(user_id,created_at,id);
        CREATE UNIQUE INDEX player_phrases_user_text_idx ON player_phrases(user_id,lower(text));
    """),
    (7, """
        CREATE TABLE active_table_players (
            user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
            table_id uuid NOT NULL,
            match_id uuid NOT NULL,
            room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
            game_type text NOT NULL CHECK (game_type IN ('callbreak','marriage','flush')),
            seat integer NOT NULL CHECK (seat > 0),
            reserved_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (table_id, seat),
            UNIQUE (table_id, user_id)
        );
        CREATE INDEX active_table_players_room_table_idx
            ON active_table_players(room_id, table_id);
    """),
)


class Database:
    def __init__(self, url: str) -> None:
        self.pool = AsyncConnectionPool(url, min_size=1, max_size=10, open=False)

    async def open(self) -> None:
        await self.pool.open(wait=True)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                # Stable application-specific key; held only for this transaction.
                await connection.execute("SELECT pg_advisory_xact_lock(%s)", (0x424849444E45484F,))
                await connection.execute("""
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        version integer PRIMARY KEY,
                        applied_at timestamptz NOT NULL DEFAULT now()
                    )
                """)
                rows = await (await connection.execute(
                    "SELECT version FROM schema_migrations"
                )).fetchall()
                applied = {row[0] for row in rows}
                for version, sql in MIGRATIONS:
                    if version in applied:
                        continue
                    await connection.execute(sql)
                    await connection.execute(
                        "INSERT INTO schema_migrations (version) VALUES (%s)", (version,),
                    )

    async def close(self) -> None:
        await self.pool.close()
