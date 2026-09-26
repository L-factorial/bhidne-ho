"""PostgreSQL lifecycle and versioned application schema.

The application consumes a normal PostgreSQL URL and does not depend on Docker.
Migrations are append-only and run under a PostgreSQL advisory lock so concurrent
application starts cannot race schema installation.
"""

from psycopg_pool import AsyncConnectionPool

from app.distributed_schema import DELIVERY_RECOVERY_SCHEMA, HOSTED_RECEIPT_SCHEMA, INBOX_REQUEST_SCHEMA, INSTANCE_REGISTRATION_SCHEMA, HOSTED_MATCH_ARCHIVE_SCHEMA, FLUSH_ROUND_ARCHIVE_SCHEMA
from app.distributed_schema import HOSTED_INVITATION_SCHEMA, SCOPED_CHAT_SCHEMA


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
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_visibility_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_visibility_check CHECK (visibility IN ('public', 'private', 'friends'));
UPDATE rooms SET visibility='private' WHERE visibility='friends';
CREATE TABLE IF NOT EXISTS room_invitations (
    id text PRIMARY KEY,
    room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    inviter_id text NOT NULL,
    recipient_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS room_invitations_recipient_idx ON room_invitations(recipient_id, status);
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
    (8, """
        INSERT INTO room_memberships (room_id, user_id, joined_at)
        SELECT id, creator_id, created_at FROM rooms
        ON CONFLICT (room_id, user_id) DO NOTHING;
    """),
    (9, """
        CREATE TABLE social_login_attempts (
            id text PRIMARY KEY,
            provider text NOT NULL CHECK (provider IN ('google', 'apple', 'facebook')),
            state_hash text NOT NULL UNIQUE,
            secret_hash text NOT NULL,
            status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verifying', 'ready')),
            expires_at timestamptz NOT NULL,
            data jsonb NOT NULL
        );
        CREATE INDEX social_login_attempts_expiry_idx ON social_login_attempts(expires_at);
    """),
    (10, """
        ALTER TABLE ledger_games ADD COLUMN table_name text NOT NULL DEFAULT '';
    """),
    (11, """
        ALTER TABLE user_profiles
            ADD COLUMN theme_family text NOT NULL DEFAULT 'heritage'
                CHECK (theme_family IN ('heritage', 'himalayan', 'courtyard')),
            ADD COLUMN theme_mode text NOT NULL DEFAULT 'system'
                CHECK (theme_mode IN ('system', 'light', 'dark'));
    """),
    (12, """
        -- Existing installations already recorded migration 1. Changes to its
        -- bootstrap SQL alone cannot upgrade those databases.
        ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_visibility_check;
        ALTER TABLE rooms ADD CONSTRAINT rooms_visibility_check
            CHECK (visibility IN ('public', 'private', 'friends'));
        UPDATE rooms SET visibility='private' WHERE visibility='friends';
        CREATE TABLE IF NOT EXISTS room_invitations (
            id text PRIMARY KEY,
            room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            inviter_id text NOT NULL,
            recipient_id text NOT NULL,
            status text NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS room_invitations_recipient_idx
            ON room_invitations(recipient_id, status);
        CREATE TABLE IF NOT EXISTS deleted_rooms (
            id text PRIMARY KEY,
            deleted_at timestamptz NOT NULL DEFAULT now()
        );
    """),
    (13, """
        -- Additive foundations only: the existing host does not yet write these
        -- tables. Legacy games keep a NULL table_id until runtime reconstruction
        -- can establish their table identity without guessing.
        CREATE TABLE server_instances (
            instance_id text PRIMARY KEY CHECK (char_length(instance_id) > 0),
            internal_address text NOT NULL CHECK (char_length(internal_address) > 0),
            started_at timestamptz NOT NULL DEFAULT now(),
            heartbeat_at timestamptz NOT NULL DEFAULT now(),
            draining boolean NOT NULL DEFAULT false,
            capabilities jsonb NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(capabilities) = 'object')
        );
        CREATE INDEX server_instances_heartbeat_idx ON server_instances(heartbeat_at);

        CREATE TABLE room_ownership (
            room_id text PRIMARY KEY REFERENCES rooms(id) ON DELETE RESTRICT,
            owner_instance_id text REFERENCES server_instances(instance_id) ON DELETE RESTRICT,
            ownership_epoch bigint NOT NULL DEFAULT 0 CHECK (ownership_epoch >= 0),
            fencing_token_hash bytea,
            lease_expires_at timestamptz,
            runtime_status text NOT NULL DEFAULT 'unowned'
                CHECK (runtime_status IN ('unowned', 'recovering', 'serving', 'draining', 'quarantined')),
            CHECK (
                (runtime_status = 'unowned' AND owner_instance_id IS NULL
                    AND fencing_token_hash IS NULL AND lease_expires_at IS NULL)
                OR
                (runtime_status <> 'unowned' AND owner_instance_id IS NOT NULL
                    AND fencing_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL
                    AND ownership_epoch > 0)
            )
        );
        CREATE INDEX room_ownership_owner_idx ON room_ownership(owner_instance_id)
            WHERE owner_instance_id IS NOT NULL;
        CREATE INDEX room_ownership_expiry_idx ON room_ownership(lease_expires_at)
            WHERE owner_instance_id IS NOT NULL;

        ALTER TABLE rooms ADD COLUMN max_open_tables integer NOT NULL DEFAULT 5
            CHECK (max_open_tables > 0);
        ALTER TABLE rooms ADD COLUMN open_table_count integer NOT NULL DEFAULT 0
            CHECK (open_table_count >= 0);
        ALTER TABLE rooms ADD CONSTRAINT room_open_table_limit
            CHECK (open_table_count <= max_open_tables);
        CREATE TABLE room_tables (
            table_id uuid PRIMARY KEY,
            room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
            name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
            game_type text NOT NULL CHECK (game_type IN ('callbreak', 'marriage', 'flush')),
            status text NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'playing', 'closed')),
            revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
            configuration jsonb NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(configuration) = 'object'),
            created_at timestamptz NOT NULL DEFAULT now(),
            closed_at timestamptz,
            UNIQUE (table_id, room_id),
            CHECK ((status = 'closed') = (closed_at IS NOT NULL))
        );
        CREATE INDEX room_tables_room_status_idx ON room_tables(room_id, status);

        -- Atomic counter updates serialize allocations even across processes.
        -- AFTER triggers count only actual writes (including ON CONFLICT), and
        -- roll back with the table mutation if the room limit would be exceeded.
        -- Gameplay never updates this allocation counter.
        CREATE FUNCTION maintain_room_table_count()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            count_change integer;
            affected_room text;
        BEGIN
            IF TG_OP = 'UPDATE' THEN
                IF NEW.table_id IS DISTINCT FROM OLD.table_id
                   OR NEW.room_id IS DISTINCT FROM OLD.room_id THEN
                    RAISE EXCEPTION 'table identity and room are immutable'
                        USING ERRCODE = '23514';
                END IF;
                count_change := (NEW.status <> 'closed')::integer
                    - (OLD.status <> 'closed')::integer;
                affected_room := NEW.room_id;
            ELSIF TG_OP = 'INSERT' THEN
                count_change := (NEW.status <> 'closed')::integer;
                affected_room := NEW.room_id;
            ELSE
                count_change := -((OLD.status <> 'closed')::integer);
                affected_room := OLD.room_id;
            END IF;
            IF count_change <> 0 THEN
                UPDATE rooms SET open_table_count = open_table_count + count_change
                    WHERE id = affected_room;
            END IF;
            RETURN NULL;
        END;
        $$;
        CREATE TRIGGER room_tables_count
            AFTER INSERT OR UPDATE OR DELETE ON room_tables
            FOR EACH ROW EXECUTE FUNCTION maintain_room_table_count();

        ALTER TABLE games ADD COLUMN table_id uuid;
        ALTER TABLE games ADD CONSTRAINT games_table_room_fk
            FOREIGN KEY (table_id, room_id) REFERENCES room_tables(table_id, room_id)
            ON DELETE RESTRICT;
        CREATE UNIQUE INDEX games_one_active_per_table_idx ON games(table_id)
            WHERE status = 'active' AND table_id IS NOT NULL;
        CREATE INDEX games_table_history_idx ON games(table_id, started_at DESC, id)
            WHERE table_id IS NOT NULL;
    """),
    (14, """
        -- Recovery records are populated only by the future durable table store.
        -- Do not synthesize checkpoints for legacy in-memory tables. The versioned
        -- document holds historical roster, departures, releases, offers, rule
        -- proposals/votes, invitations and table event history. Current positions
        -- live only in table_positions and must be saved in the same transaction.
        CREATE TABLE table_recovery_state (
            table_id uuid PRIMARY KEY REFERENCES room_tables(table_id) ON DELETE RESTRICT,
            match_id uuid NOT NULL,
            schema_version integer NOT NULL CHECK (schema_version > 0),
            revision bigint NOT NULL CHECK (revision >= 0),
            phase text NOT NULL CHECK (phase IN ('OPEN','LOCKED','STARTED','COMPLETED','ENDED')),
            capacity integer NOT NULL CHECK (capacity >= 2),
            state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
            saved_at timestamptz NOT NULL DEFAULT now()
        );
        -- match_id can identify a waiting lobby before a durable game exists;
        -- it intentionally is not a foreign key to games.
        CREATE TABLE table_positions (
            table_id uuid NOT NULL REFERENCES table_recovery_state(table_id) ON DELETE RESTRICT,
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            seat integer CHECK (seat > 0),
            queue_position bigint CHECK (queue_position > 0),
            joined_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (table_id, user_id),
            CHECK ((seat IS NOT NULL) <> (queue_position IS NOT NULL)),
            UNIQUE (table_id, seat),
            UNIQUE (table_id, queue_position)
        );
        CREATE INDEX table_positions_user_idx ON table_positions(user_id);
        -- Existing active_table_players remains the cross-table seat reservation
        -- authority. The future store must update it and positions atomically.

        -- Composite identity allows a game lane to prove both its table and room.
        ALTER TABLE games ADD CONSTRAINT games_identity_table_room_key
            UNIQUE (id, table_id, room_id);
        CREATE TABLE command_lanes (
            lane_id uuid PRIMARY KEY,
            kind text NOT NULL CHECK (kind IN
                ('room', 'table', 'game', 'room_chat', 'conversation', 'recipient')),
            room_id text REFERENCES rooms(id) ON DELETE RESTRICT,
            table_id uuid,
            game_id uuid,
            user_low uuid REFERENCES users(id) ON DELETE RESTRICT,
            user_high uuid REFERENCES users(id) ON DELETE RESTRICT,
            recipient_id uuid REFERENCES users(id) ON DELETE RESTRICT,
            enqueued_sequence bigint NOT NULL DEFAULT 0 CHECK (enqueued_sequence >= 0),
            processed_sequence bigint NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            CHECK (processed_sequence >= 0 AND processed_sequence <= enqueued_sequence),
            CONSTRAINT command_lanes_target_check CHECK (
                (kind IN ('room', 'room_chat') AND room_id IS NOT NULL
                    AND table_id IS NULL AND game_id IS NULL
                    AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NULL)
                OR (kind = 'table' AND room_id IS NOT NULL AND table_id IS NOT NULL
                    AND game_id IS NULL AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NULL)
                OR (kind = 'game' AND room_id IS NOT NULL AND table_id IS NOT NULL
                    AND game_id IS NOT NULL AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NULL)
                OR (kind = 'conversation' AND room_id IS NULL AND table_id IS NULL AND game_id IS NULL
                    AND user_low IS NOT NULL AND user_high IS NOT NULL AND user_low < user_high
                    AND recipient_id IS NULL)
                OR (kind = 'recipient' AND room_id IS NULL AND table_id IS NULL AND game_id IS NULL
                    AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NOT NULL)
            ),
            FOREIGN KEY (table_id, room_id) REFERENCES room_tables(table_id, room_id) ON DELETE RESTRICT,
            FOREIGN KEY (game_id, table_id, room_id) REFERENCES games(id, table_id, room_id) ON DELETE RESTRICT
        );
        CREATE UNIQUE INDEX command_lanes_room_key ON command_lanes(room_id, kind)
            WHERE kind IN ('room', 'room_chat');
        CREATE UNIQUE INDEX command_lanes_table_key ON command_lanes(table_id) WHERE kind = 'table';
        CREATE UNIQUE INDEX command_lanes_game_key ON command_lanes(game_id) WHERE kind = 'game';
        CREATE UNIQUE INDEX command_lanes_conversation_key ON command_lanes(user_low, user_high)
            WHERE kind = 'conversation';
        CREATE UNIQUE INDEX command_lanes_recipient_key ON command_lanes(recipient_id) WHERE kind = 'recipient';
        CREATE INDEX command_lanes_room_idx ON command_lanes(room_id) WHERE room_id IS NOT NULL;
        CREATE INDEX command_lanes_pending_idx ON command_lanes(room_id, lane_id)
            WHERE processed_sequence < enqueued_sequence;

        CREATE TABLE command_inbox (
            lane_id uuid NOT NULL REFERENCES command_lanes(lane_id) ON DELETE RESTRICT,
            sequence bigint NOT NULL CHECK (sequence > 0),
            -- Actors also include trusted server timers/controllers. User identity
            -- is authenticated by ingress, never taken from the client's payload.
            actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) > 0),
            command_id text NOT NULL CHECK
                (char_length(command_id) BETWEEN 1 AND 128 AND command_id ~ '^[A-Za-z0-9_-]+$'),
            request_version integer NOT NULL DEFAULT 1 CHECK (request_version > 0),
            command text NOT NULL CHECK (char_length(btrim(command)) > 0),
            match_id uuid,
            expected_revision bigint CHECK (expected_revision >= 0),
            payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
            request_fingerprint text NOT NULL CHECK (char_length(request_fingerprint) > 0),
            status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
            outcome jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            completed_at timestamptz,
            PRIMARY KEY (lane_id, sequence),
            UNIQUE (lane_id, actor_id, command_id),
            CONSTRAINT command_inbox_outcome_check CHECK (
                (status = 'pending' AND outcome IS NULL AND completed_at IS NULL)
                OR (status <> 'pending' AND outcome IS NOT NULL
                    AND jsonb_typeof(outcome) = 'object' AND completed_at IS NOT NULL)
            )
        );
        CREATE INDEX command_inbox_pending_idx ON command_inbox(lane_id, sequence) WHERE status = 'pending';

        CREATE FUNCTION validate_game_inbox_target()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            target_game uuid;
        BEGIN
            SELECT game_id INTO target_game FROM command_lanes
                WHERE lane_id = NEW.lane_id AND kind = 'game';
            IF FOUND AND (NEW.match_id IS DISTINCT FROM target_game OR NEW.expected_revision IS NULL) THEN
                RAISE EXCEPTION 'game command requires its lane match and expected revision'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER command_inbox_game_target BEFORE INSERT ON command_inbox
            FOR EACH ROW EXECUTE FUNCTION validate_game_inbox_target();

        -- Lane targets and accepted request identity cannot be rewritten during
        -- recovery, retry, or rematch. Sequence allocation/head-only execution and
        -- cursor advancement belong to the transactional store (increment 3).
        CREATE FUNCTION reject_command_lane_retarget()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF ROW(NEW.lane_id,NEW.kind,NEW.room_id,NEW.table_id,NEW.game_id,
                   NEW.user_low,NEW.user_high,NEW.recipient_id)
               IS DISTINCT FROM ROW(OLD.lane_id,OLD.kind,OLD.room_id,OLD.table_id,OLD.game_id,
                   OLD.user_low,OLD.user_high,OLD.recipient_id) THEN
                RAISE EXCEPTION 'command lane target is immutable' USING ERRCODE = '23514';
            END IF;
            IF NEW.enqueued_sequence < OLD.enqueued_sequence OR NEW.processed_sequence < OLD.processed_sequence THEN
                RAISE EXCEPTION 'command lane cursors cannot move backwards' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER command_lanes_immutable_target BEFORE UPDATE ON command_lanes
            FOR EACH ROW EXECUTE FUNCTION reject_command_lane_retarget();

        CREATE FUNCTION reject_command_request_change()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF ROW(NEW.lane_id,NEW.sequence,NEW.actor_id,NEW.command_id,NEW.request_version,
                   NEW.command,NEW.match_id,NEW.expected_revision,NEW.payload,NEW.request_fingerprint,NEW.created_at)
               IS DISTINCT FROM ROW(OLD.lane_id,OLD.sequence,OLD.actor_id,OLD.command_id,OLD.request_version,
                   OLD.command,OLD.match_id,OLD.expected_revision,OLD.payload,OLD.request_fingerprint,OLD.created_at) THEN
                RAISE EXCEPTION 'queued command request is immutable' USING ERRCODE = '23514';
            END IF;
            IF OLD.status <> 'pending' AND ROW(NEW.status,NEW.outcome,NEW.completed_at)
                    IS DISTINCT FROM ROW(OLD.status,OLD.outcome,OLD.completed_at) THEN
                RAISE EXCEPTION 'command outcome is immutable' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER command_inbox_immutable_request BEFORE UPDATE ON command_inbox
            FOR EACH ROW EXECUTE FUNCTION reject_command_request_change();
    """),
    (15, DELIVERY_RECOVERY_SCHEMA),
    (16, HOSTED_RECEIPT_SCHEMA),
    (17, INBOX_REQUEST_SCHEMA),
    (18, INSTANCE_REGISTRATION_SCHEMA),
    (19, HOSTED_MATCH_ARCHIVE_SCHEMA),
    (20, FLUSH_ROUND_ARCHIVE_SCHEMA),
    (21, HOSTED_INVITATION_SCHEMA),
    (22, """
        CREATE INDEX command_inbox_lane_actor_idx ON command_inbox(lane_id, actor_id);
    """),
    (23, SCOPED_CHAT_SCHEMA),
    (24, """
        ALTER TABLE friend_notifications ADD COLUMN source_actor_id uuid;
        -- Preserve actor metadata on durable notifications without a cascading
        -- foreign key. Legacy unsequenced notifications retain their old behavior.
        ALTER TABLE friend_notifications DISABLE TRIGGER friend_notifications_stream;
        UPDATE friend_notifications SET source_actor_id=actor_id,actor_id=NULL WHERE lane_id IS NOT NULL;
        ALTER TABLE friend_notifications ENABLE TRIGGER friend_notifications_stream;
        CREATE INDEX social_lanes_pending_idx ON command_lanes(kind,lane_id)
            WHERE processed_sequence<enqueued_sequence AND kind IN ('conversation','recipient');
        CREATE INDEX direct_messages_sender_recent_idx ON direct_messages(lane_id,sender_id,sent_at DESC)
            WHERE lane_id IS NOT NULL;
        CREATE INDEX direct_messages_legacy_page_idx ON direct_messages(sender_id,recipient_id,sent_at DESC,id DESC)
            WHERE lane_id IS NULL;
        CREATE INDEX notifications_legacy_page_idx ON friend_notifications(user_id,created_at DESC,id DESC)
            WHERE lane_id IS NULL;
        CREATE INDEX conversation_low_streams_idx ON command_lanes(user_low,lane_id) WHERE kind='conversation';
        CREATE INDEX conversation_high_streams_idx ON command_lanes(user_high,lane_id) WHERE kind='conversation';
    """),
    (25, """
        CREATE INDEX command_inbox_poke_rate_idx ON command_inbox(lane_id,actor_id,completed_at DESC)
            WHERE command='send-poke' AND status='accepted';
    """),
)


class Database:
    def __init__(self, url: str) -> None:
        self.pool = AsyncConnectionPool(url, min_size=1, max_size=10, open=False)

    async def open(self) -> None:
        await self.pool.open(wait=True)
        try:
            async with self.pool.connection() as connection:
                async with connection.transaction():
                    # Stable application-specific key; held only for this transaction.
                    await connection.execute("SELECT pg_advisory_xact_lock(%s)", (0x424849444E45484F,))
                    marker = await (await connection.execute(
                        "SELECT to_regclass('public.runtime_dataset')"
                    )).fetchone()
                    if marker and marker[0] is not None:
                        raise RuntimeError('This dataset is reserved for an explicit runtime; legacy startup is refused.')
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
        except BaseException:
            await self.pool.close()
            raise

    async def close(self) -> None:
        await self.pool.close()
