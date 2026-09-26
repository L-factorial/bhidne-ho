"""Additive migration 15: recovery checkpoints and durable delivery foundations.

No worker or API is enabled by this schema. Existing social writes remain valid
with NULL stream metadata until the distributed stores are integrated.
"""

FLUSH_ROUND_ARCHIVE_SCHEMA = """
    ALTER TABLE hosted_match_archives DROP CONSTRAINT hosted_match_archives_match_id_key;
    CREATE INDEX hosted_match_archives_match_idx ON hosted_match_archives(match_id);
    CREATE OR REPLACE FUNCTION validate_hosted_match_archive()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM games g JOIN table_recovery_state r ON r.table_id=g.table_id
            WHERE g.id=NEW.game_id AND g.table_id=NEW.table_id AND g.status='completed'
                AND ((g.game_type IN ('callbreak','marriage') AND r.phase='COMPLETED')
                    OR (g.game_type='flush' AND r.phase IN ('OPEN','LOCKED')
                        AND NEW.checkpoint->'data'->'engine'->'state'->>'status'='finished'))
                AND r.match_id=NEW.match_id AND r.revision=NEW.table_revision
                AND r.state->>'digest'=NEW.checkpoint->>'digest'
                AND (NEW.checkpoint->'data'->>'table_id')::uuid=NEW.table_id
                AND (NEW.checkpoint->'data'->>'match_id')::uuid=NEW.match_id
                AND (NEW.checkpoint->'data'->'host'->>'durable_game_id')::uuid=NEW.game_id
                AND (NEW.checkpoint->'data'->>'table_revision')::bigint=NEW.table_revision
        ) THEN
            RAISE EXCEPTION 'archive must identify the current completed checkpoint' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END;
    $$;
"""

HOSTED_MATCH_ARCHIVE_SCHEMA = """
    CREATE TABLE hosted_match_archives (
        game_id uuid PRIMARY KEY REFERENCES games(id) ON DELETE RESTRICT,
        table_id uuid NOT NULL REFERENCES room_tables(table_id) ON DELETE RESTRICT,
        match_id uuid NOT NULL UNIQUE,
        table_revision bigint NOT NULL CHECK (table_revision >= 0),
        checkpoint jsonb NOT NULL CHECK (
            (jsonb_typeof(checkpoint) = 'object' AND checkpoint->>'schema_version' = '1') IS TRUE),
        archived_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX hosted_match_archives_table_idx ON hosted_match_archives(table_id,table_revision);
    CREATE FUNCTION validate_hosted_match_archive()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM games g JOIN table_recovery_state r ON r.table_id=g.table_id
            WHERE g.id=NEW.game_id AND g.table_id=NEW.table_id AND g.status='completed'
                AND g.game_type IN ('callbreak','marriage')
                AND r.match_id=NEW.match_id AND r.revision=NEW.table_revision AND r.phase='COMPLETED'
                AND r.state->>'digest'=NEW.checkpoint->>'digest'
                AND (NEW.checkpoint->'data'->>'table_id')::uuid=NEW.table_id
                AND (NEW.checkpoint->'data'->>'match_id')::uuid=NEW.match_id
                AND (NEW.checkpoint->'data'->'host'->>'durable_game_id')::uuid=NEW.game_id
                AND (NEW.checkpoint->'data'->>'table_revision')::bigint=NEW.table_revision
        ) THEN
            RAISE EXCEPTION 'archive must identify the current completed checkpoint' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER hosted_match_archives_boundary BEFORE INSERT ON hosted_match_archives
        FOR EACH ROW EXECUTE FUNCTION validate_hosted_match_archive();
    CREATE TRIGGER hosted_match_archives_immutable BEFORE UPDATE OR DELETE ON hosted_match_archives
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record();
"""

INSTANCE_REGISTRATION_SCHEMA = """
    -- Legacy registrations are not silently granted boot credentials.
    ALTER TABLE server_instances ADD COLUMN registration_token_hash bytea
        CHECK (registration_token_hash IS NULL OR octet_length(registration_token_hash)=32);
    CREATE TRIGGER server_instances_boot_immutable BEFORE UPDATE ON server_instances
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record('heartbeat_at','draining');
"""

INBOX_REQUEST_SCHEMA = """
    -- Preserve client match spelling/identity independently from durable routing
    -- (Flush round game IDs differ from the hosted match ID).
    ALTER TABLE command_inbox ADD COLUMN original_request jsonb
        CHECK (original_request IS NULL OR jsonb_typeof(original_request) = 'object');
    ALTER TABLE command_inbox ADD COLUMN dedup_match_id uuid;
    CREATE UNIQUE INDEX command_inbox_hosted_request_key
        ON command_inbox(dedup_match_id,actor_id,command_id) WHERE dedup_match_id IS NOT NULL;
    CREATE FUNCTION preserve_inbox_original_request()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF NEW.original_request IS DISTINCT FROM OLD.original_request
           OR NEW.dedup_match_id IS DISTINCT FROM OLD.dedup_match_id THEN
            RAISE EXCEPTION 'original inbox request is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER command_inbox_original_immutable BEFORE UPDATE ON command_inbox
        FOR EACH ROW EXECUTE FUNCTION preserve_inbox_original_request();
"""

HOSTED_RECEIPT_SCHEMA = """
    -- NULL identifies legacy receipts whose original request cannot be inferred.
    ALTER TABLE game_commands ADD COLUMN original_request jsonb
        CHECK (original_request IS NULL OR jsonb_typeof(original_request) = 'object');
    CREATE TRIGGER game_commands_immutable BEFORE UPDATE ON game_commands
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record();
"""

DELIVERY_RECOVERY_SCHEMA = """
    -- A lane orders commands and emitted events independently: one command may
    -- emit multiple events, or none. Allocate event sequence in its transaction.
    ALTER TABLE command_lanes ADD COLUMN emitted_sequence bigint NOT NULL DEFAULT 0
        CHECK (emitted_sequence >= 0);
    CREATE FUNCTION prevent_event_cursor_regression()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF NEW.emitted_sequence < OLD.emitted_sequence THEN
            RAISE EXCEPTION 'event cursor cannot move backwards' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER command_lanes_event_cursor BEFORE UPDATE ON command_lanes
        FOR EACH ROW EXECUTE FUNCTION prevent_event_cursor_regression();

    -- Protect all columns except explicitly named delivery/progress fields.
    CREATE FUNCTION preserve_durable_record()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF (to_jsonb(NEW) - COALESCE(TG_ARGV, ARRAY[]::text[]))
            IS DISTINCT FROM (to_jsonb(OLD) - COALESCE(TG_ARGV, ARRAY[]::text[])) THEN
            RAISE EXCEPTION 'durable record identity and content are immutable'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;

    CREATE TABLE game_snapshots (
        game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
        sequence bigint NOT NULL CHECK (sequence >= 0),
        revision bigint NOT NULL CHECK (revision >= 0),
        engine_version integer NOT NULL CHECK (engine_version > 0),
        event_schema_version integer NOT NULL CHECK (event_schema_version > 0),
        snapshot_schema_version integer NOT NULL CHECK (snapshot_schema_version > 0),
        state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
        state_digest text NOT NULL CHECK (state_digest ~ '^[0-9a-f]{64}$'),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (game_id, sequence)
    );
    CREATE FUNCTION validate_game_snapshot_boundary()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
        game games%ROWTYPE;
    BEGIN
        SELECT * INTO game FROM games WHERE id = NEW.game_id;
        IF FOUND AND (NEW.sequence > game.current_sequence OR NEW.revision > game.current_revision
                OR NEW.engine_version <> game.engine_version
                OR NEW.event_schema_version <> game.event_schema_version) THEN
            RAISE EXCEPTION 'snapshot is outside the committed game boundary'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER game_snapshots_boundary BEFORE INSERT ON game_snapshots
        FOR EACH ROW EXECUTE FUNCTION validate_game_snapshot_boundary();
    CREATE TRIGGER game_snapshots_immutable BEFORE UPDATE ON game_snapshots
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record();

    CREATE TABLE scheduled_actions (
        action_id uuid PRIMARY KEY,
        lane_id uuid NOT NULL REFERENCES command_lanes(lane_id) ON DELETE RESTRICT,
        action_type text NOT NULL CHECK (char_length(btrim(action_type)) > 0),
        generation bigint NOT NULL CHECK (generation >= 0),
        due_at timestamptz NOT NULL,
        command_id text NOT NULL CHECK
            (char_length(command_id) BETWEEN 1 AND 128 AND command_id ~ '^[A-Za-z0-9_-]+$'),
        command text NOT NULL CHECK (char_length(btrim(command)) > 0),
        match_id uuid,
        expected_revision bigint CHECK (expected_revision >= 0),
        payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','enqueued','cancelled')),
        inbox_sequence bigint,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (lane_id, action_type, generation),
        UNIQUE (lane_id, command_id),
        FOREIGN KEY (lane_id, inbox_sequence) REFERENCES command_inbox(lane_id, sequence) ON DELETE RESTRICT,
        CHECK (
            (status = 'pending' AND inbox_sequence IS NULL AND finished_at IS NULL)
            OR (status = 'enqueued' AND inbox_sequence IS NOT NULL AND finished_at IS NOT NULL)
            OR (status = 'cancelled' AND inbox_sequence IS NULL AND finished_at IS NOT NULL)
        )
    );
    CREATE INDEX scheduled_actions_due_idx ON scheduled_actions(due_at, lane_id)
        WHERE status = 'pending';
    CREATE INDEX scheduled_actions_lane_idx ON scheduled_actions(lane_id);
    CREATE TRIGGER scheduled_actions_identity BEFORE UPDATE ON scheduled_actions
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record('status','inbox_sequence','finished_at');
    CREATE FUNCTION validate_scheduled_action()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
        target_game uuid;
    BEGIN
        IF TG_OP = 'UPDATE' THEN
            IF OLD.status <> 'pending' AND NEW IS DISTINCT FROM OLD THEN
                RAISE EXCEPTION 'finished timer cannot be changed' USING ERRCODE = '23514';
            END IF;
        END IF;
        SELECT game_id INTO target_game FROM command_lanes WHERE lane_id = NEW.lane_id AND kind = 'game';
        IF FOUND AND (NEW.match_id IS DISTINCT FROM target_game OR NEW.expected_revision IS NULL) THEN
            RAISE EXCEPTION 'game timer requires its lane match and revision' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'enqueued' AND NOT EXISTS (
            SELECT 1 FROM command_inbox WHERE lane_id = NEW.lane_id AND sequence = NEW.inbox_sequence
                AND actor_id = 'system:timer' AND command_id = NEW.command_id AND command = NEW.command
                AND match_id IS NOT DISTINCT FROM NEW.match_id
                AND expected_revision IS NOT DISTINCT FROM NEW.expected_revision AND payload = NEW.payload
        ) THEN
            RAISE EXCEPTION 'timer must reference its original system command' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER scheduled_actions_target BEFORE INSERT OR UPDATE ON scheduled_actions
        FOR EACH ROW EXECUTE FUNCTION validate_scheduled_action();

    CREATE TABLE notification_outbox (
        event_id uuid PRIMARY KEY,
        lane_id uuid NOT NULL REFERENCES command_lanes(lane_id) ON DELETE RESTRICT,
        sequence bigint NOT NULL CHECK (sequence > 0),
        event_type text NOT NULL CHECK (char_length(btrim(event_type)) > 0),
        event_version integer NOT NULL DEFAULT 1 CHECK (event_version > 0),
        -- NULL means the lane's authorized audience, not a global broadcast.
        audience_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
        payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now(),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error text,
        claim_token uuid,
        claim_expires_at timestamptz,
        published_at timestamptz,
        UNIQUE (lane_id, sequence),
        CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL)),
        CHECK (published_at IS NULL OR claim_token IS NULL)
    );
    CREATE INDEX notification_outbox_pending_idx ON notification_outbox(next_attempt_at, event_id)
        WHERE published_at IS NULL;
    CREATE FUNCTION validate_outbox_target()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
        lane command_lanes%ROWTYPE;
    BEGIN
        SELECT * INTO lane FROM command_lanes WHERE lane_id = NEW.lane_id;
        IF NOT FOUND THEN RETURN NEW; END IF;
        IF NEW.sequence > lane.emitted_sequence
            OR (NEW.audience_user_id IS NOT NULL AND (
                (lane.kind = 'recipient' AND NEW.audience_user_id <> lane.recipient_id)
                OR (lane.kind = 'conversation' AND NEW.audience_user_id NOT IN (lane.user_low, lane.user_high))
            )) THEN
            RAISE EXCEPTION 'outbox target or sequence is invalid' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER notification_outbox_target BEFORE INSERT ON notification_outbox
        FOR EACH ROW EXECUTE FUNCTION validate_outbox_target();
    CREATE TRIGGER notification_outbox_identity BEFORE UPDATE ON notification_outbox
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record(
            'next_attempt_at','attempts','last_error','claim_token','claim_expires_at','published_at');

    CREATE TABLE delivery_cursors (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        client_id text NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 128),
        lane_id uuid NOT NULL REFERENCES command_lanes(lane_id) ON DELETE RESTRICT,
        last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, client_id, lane_id)
    );
    CREATE INDEX delivery_cursors_lane_idx ON delivery_cursors(lane_id);
    CREATE TRIGGER delivery_cursors_identity BEFORE UPDATE ON delivery_cursors
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record('last_sequence','updated_at');
    CREATE FUNCTION validate_delivery_cursor()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
        lane command_lanes%ROWTYPE;
    BEGIN
        IF TG_OP = 'UPDATE' THEN
            IF NEW.last_sequence < OLD.last_sequence THEN
                RAISE EXCEPTION 'delivery cursor cannot move backwards' USING ERRCODE = '23514';
            END IF;
        END IF;
        SELECT * INTO lane FROM command_lanes WHERE lane_id = NEW.lane_id;
        IF FOUND AND (NEW.last_sequence > lane.emitted_sequence
                OR (lane.kind = 'recipient' AND NEW.user_id <> lane.recipient_id)
                OR (lane.kind = 'conversation' AND NEW.user_id NOT IN (lane.user_low, lane.user_high))) THEN
            RAISE EXCEPTION 'delivery cursor target or sequence is invalid' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER delivery_cursors_boundary BEFORE INSERT OR UPDATE ON delivery_cursors
        FOR EACH ROW EXECUTE FUNCTION validate_delivery_cursor();

    CREATE TABLE room_chat_messages (
        id uuid PRIMARY KEY,
        room_id text NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
        sender_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        lane_id uuid NOT NULL REFERENCES command_lanes(lane_id) ON DELETE RESTRICT,
        sequence bigint NOT NULL CHECK (sequence > 0),
        command_id text NOT NULL CHECK
            (char_length(command_id) BETWEEN 1 AND 128 AND command_id ~ '^[A-Za-z0-9_-]+$'),
        text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 500),
        sent_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (lane_id, sequence),
        UNIQUE (room_id, sender_id, command_id)
    );
    CREATE INDEX room_chat_messages_room_idx ON room_chat_messages(room_id, sequence);
    CREATE TRIGGER room_chat_messages_immutable BEFORE UPDATE ON room_chat_messages
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record();

    -- Preserve legacy writes. New sequenced records must supply all metadata;
    -- old records remain readable through the existing timestamp-based API.
    ALTER TABLE direct_messages
        ADD COLUMN lane_id uuid REFERENCES command_lanes(lane_id) ON DELETE RESTRICT,
        ADD COLUMN sequence bigint CHECK (sequence > 0),
        ADD COLUMN command_id text CHECK
            (char_length(command_id) BETWEEN 1 AND 128 AND command_id ~ '^[A-Za-z0-9_-]+$'),
        ADD CONSTRAINT direct_messages_stream_metadata CHECK (
            (lane_id IS NULL AND sequence IS NULL AND command_id IS NULL)
            OR (lane_id IS NOT NULL AND sequence IS NOT NULL AND command_id IS NOT NULL)
        );
    CREATE UNIQUE INDEX direct_messages_stream_idx ON direct_messages(lane_id, sequence) WHERE lane_id IS NOT NULL;
    CREATE UNIQUE INDEX direct_messages_request_idx ON direct_messages(lane_id, sender_id, command_id) WHERE lane_id IS NOT NULL;

    ALTER TABLE friend_notifications
        ALTER COLUMN actor_id DROP NOT NULL,
        DROP CONSTRAINT friend_notifications_kind_check,
        ADD CONSTRAINT friend_notifications_kind_check CHECK (char_length(btrim(kind)) BETWEEN 1 AND 128),
        ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
        ADD COLUMN lane_id uuid REFERENCES command_lanes(lane_id) ON DELETE RESTRICT,
        ADD COLUMN sequence bigint CHECK (sequence > 0),
        ADD COLUMN deduplication_key text CHECK (char_length(deduplication_key) BETWEEN 1 AND 256),
        ADD CONSTRAINT friend_notifications_stream_metadata CHECK (
            (lane_id IS NULL AND sequence IS NULL AND deduplication_key IS NULL)
            OR (lane_id IS NOT NULL AND sequence IS NOT NULL AND deduplication_key IS NOT NULL)
        );
    CREATE UNIQUE INDEX friend_notifications_stream_idx ON friend_notifications(lane_id, sequence) WHERE lane_id IS NOT NULL;
    CREATE UNIQUE INDEX friend_notifications_dedup_idx ON friend_notifications(user_id, deduplication_key)
        WHERE deduplication_key IS NOT NULL;

    CREATE FUNCTION validate_message_stream()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
        lane command_lanes%ROWTYPE;
        valid_target boolean;
    BEGIN
        IF TG_OP = 'UPDATE' THEN
            IF OLD.lane_id IS NOT NULL AND (to_jsonb(NEW) - ARRAY['read_at'])
                    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['read_at']) THEN
                RAISE EXCEPTION 'sequenced message is immutable' USING ERRCODE = '23514';
            END IF;
        END IF;
        IF NEW.lane_id IS NULL THEN RETURN NEW; END IF;
        SELECT * INTO lane FROM command_lanes WHERE lane_id = NEW.lane_id;
        IF NOT FOUND THEN RETURN NEW; END IF; -- Foreign key reports missing lane.
        IF TG_TABLE_NAME = 'room_chat_messages' THEN
            valid_target := lane.kind = 'room_chat' AND lane.room_id = NEW.room_id;
        ELSIF TG_TABLE_NAME = 'direct_messages' THEN
            valid_target := lane.kind = 'conversation'
                AND lane.user_low = LEAST(NEW.sender_id, NEW.recipient_id)
                AND lane.user_high = GREATEST(NEW.sender_id, NEW.recipient_id);
        ELSE
            valid_target := lane.kind = 'recipient' AND lane.recipient_id = NEW.user_id;
        END IF;
        IF valid_target IS NOT TRUE OR NEW.sequence > lane.emitted_sequence THEN
            RAISE EXCEPTION 'message stream target or sequence is invalid' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER room_chat_messages_stream BEFORE INSERT OR UPDATE ON room_chat_messages
        FOR EACH ROW EXECUTE FUNCTION validate_message_stream();
    CREATE TRIGGER direct_messages_stream BEFORE INSERT OR UPDATE ON direct_messages
        FOR EACH ROW EXECUTE FUNCTION validate_message_stream();
    CREATE TRIGGER friend_notifications_stream BEFORE INSERT OR UPDATE ON friend_notifications
        FOR EACH ROW EXECUTE FUNCTION validate_message_stream();

    CREATE TABLE game_finalization_jobs (
        job_id uuid PRIMARY KEY,
        game_id uuid NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
        round_number integer NOT NULL DEFAULT 0 CHECK (round_number >= 0),
        job_type text NOT NULL CHECK (char_length(btrim(job_type)) > 0),
        payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
        payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now(),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        last_error text,
        completed_at timestamptz,
        UNIQUE (game_id, round_number, job_type)
    );
    CREATE INDEX game_finalization_jobs_pending_idx ON game_finalization_jobs(next_attempt_at, job_id)
        WHERE completed_at IS NULL;
    CREATE TRIGGER game_finalization_jobs_identity BEFORE UPDATE ON game_finalization_jobs
        FOR EACH ROW EXECUTE FUNCTION preserve_durable_record('next_attempt_at','attempts','last_error','completed_at');
    -- round_number=0 denotes match completion. Round settlement uses its real
    -- positive number. Existing completed_games and ledger tables remain the
    -- results/effects authority; job payload contains their stable effect IDs.

    CREATE FUNCTION preserve_finished_work()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'finished work cannot be changed' USING ERRCODE = '23514';
        END IF;
        IF NEW.attempts < OLD.attempts THEN
            RAISE EXCEPTION 'attempt counter cannot move backwards' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER notification_outbox_finished BEFORE UPDATE ON notification_outbox
        FOR EACH ROW EXECUTE FUNCTION preserve_finished_work('published_at');
    CREATE TRIGGER game_finalization_jobs_finished BEFORE UPDATE ON game_finalization_jobs
        FOR EACH ROW EXECUTE FUNCTION preserve_finished_work('completed_at');
"""
HOSTED_INVITATION_SCHEMA = """
    ALTER TABLE rooms ADD COLUMN creation_request_id text, ADD COLUMN creation_fingerprint text,
        ADD CONSTRAINT rooms_creation_identity_pair CHECK ((creation_request_id IS NULL)=(creation_fingerprint IS NULL));
    CREATE UNIQUE INDEX rooms_creation_request_idx ON rooms(creator_id,creation_request_id)
        WHERE creation_request_id IS NOT NULL;
    CREATE INDEX hosted_invitation_recipient_idx ON table_recovery_state
        USING gin ((state->'data'->'invitations') jsonb_path_ops);
    CREATE TABLE hosted_invitation_limits (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        attempts double precision[] NOT NULL DEFAULT '{}',
        CHECK (cardinality(attempts)<=30)
    );
"""

SCOPED_CHAT_SCHEMA = """
    ALTER TABLE command_lanes DROP CONSTRAINT command_lanes_kind_check;
    ALTER TABLE command_lanes ADD CONSTRAINT command_lanes_kind_check CHECK (kind IN
        ('room','table','game','room_chat','table_chat','game_chat','conversation','recipient'));
    ALTER TABLE command_lanes DROP CONSTRAINT command_lanes_target_check;
    ALTER TABLE command_lanes ADD CONSTRAINT command_lanes_target_check CHECK (
        (kind IN ('room','room_chat') AND room_id IS NOT NULL AND table_id IS NULL AND game_id IS NULL
            AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NULL)
        OR (kind IN ('table','table_chat') AND room_id IS NOT NULL AND table_id IS NOT NULL AND game_id IS NULL
            AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NULL)
        OR (kind IN ('game','game_chat') AND room_id IS NOT NULL AND table_id IS NOT NULL AND game_id IS NOT NULL
            AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NULL)
        OR (kind='conversation' AND room_id IS NULL AND table_id IS NULL AND game_id IS NULL
            AND user_low IS NOT NULL AND user_high IS NOT NULL AND user_low<user_high AND recipient_id IS NULL)
        OR (kind='recipient' AND room_id IS NULL AND table_id IS NULL AND game_id IS NULL
            AND user_low IS NULL AND user_high IS NULL AND recipient_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX command_lanes_table_chat_key ON command_lanes(table_id) WHERE kind='table_chat';
    CREATE UNIQUE INDEX command_lanes_game_chat_key ON command_lanes(game_id) WHERE kind='game_chat';
    ALTER TABLE room_chat_messages
        ADD COLUMN table_id uuid,
        ADD COLUMN game_id uuid,
        ADD CONSTRAINT chat_table_room_fk FOREIGN KEY (table_id,room_id)
            REFERENCES room_tables(table_id,room_id) ON DELETE RESTRICT,
        ADD CONSTRAINT chat_game_table_room_fk FOREIGN KEY (game_id,table_id,room_id)
            REFERENCES games(id,table_id,room_id) ON DELETE RESTRICT,
        ADD CONSTRAINT chat_scope_check CHECK (game_id IS NULL OR table_id IS NOT NULL),
        DROP CONSTRAINT room_chat_messages_room_id_sender_id_command_id_key,
        ADD CONSTRAINT chat_lane_sender_request_key UNIQUE (lane_id,sender_id,command_id);
    CREATE INDEX chat_sender_recent_idx ON room_chat_messages(lane_id,sender_id,sent_at DESC);
    CREATE FUNCTION validate_scoped_chat_stream() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE lane command_lanes%ROWTYPE;
    BEGIN
        SELECT * INTO lane FROM command_lanes WHERE lane_id=NEW.lane_id;
        IF NOT FOUND THEN RETURN NEW; END IF;
        IF lane.kind NOT IN ('room_chat','table_chat','game_chat')
            OR lane.room_id IS DISTINCT FROM NEW.room_id
            OR lane.table_id IS DISTINCT FROM NEW.table_id
            OR lane.game_id IS DISTINCT FROM NEW.game_id
            OR NEW.sequence>lane.emitted_sequence THEN
            RAISE EXCEPTION 'chat stream target or sequence is invalid' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    DROP TRIGGER room_chat_messages_stream ON room_chat_messages;
    CREATE TRIGGER room_chat_messages_stream BEFORE INSERT ON room_chat_messages
        FOR EACH ROW EXECUTE FUNCTION validate_scoped_chat_stream();
"""
