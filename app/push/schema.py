PUSH_SCHEMA = """
CREATE TABLE push_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    actions boolean NOT NULL DEFAULT true,
    invitations boolean NOT NULL DEFAULT true,
    sound boolean NOT NULL DEFAULT true,
    quiet_start integer CHECK (quiet_start BETWEEN 0 AND 1439),
    quiet_end integer CHECK (quiet_end BETWEEN 0 AND 1439),
    CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);
CREATE TABLE push_devices (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash bytea NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('apns','fcm')),
    token text NOT NULL CHECK (length(token) BETWEEN 32 AND 4096),
    environment text NOT NULL CHECK (environment IN ('production','development')),
    locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ne')),
    timezone_offset integer NOT NULL DEFAULT 0 CHECK (timezone_offset BETWEEN -840 AND 840),
    foreground_until timestamptz,
    viewed_match text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider,token)
);
CREATE INDEX push_devices_user_idx ON push_devices(user_id);
CREATE TABLE push_game_jobs (
    table_id uuid PRIMARY KEY REFERENCES room_tables(table_id) ON DELETE CASCADE,
    revision bigint NOT NULL,
    processed_revision bigint NOT NULL DEFAULT -1,
    next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_game_jobs_due_idx ON push_game_jobs(next_attempt_at)
    WHERE revision>processed_revision;
CREATE FUNCTION queue_push_game() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO push_game_jobs(table_id,revision) VALUES (NEW.table_id,NEW.revision)
        ON CONFLICT (table_id) DO UPDATE SET revision=EXCLUDED.revision,next_attempt_at=now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER queue_push_game AFTER INSERT OR UPDATE OF revision ON table_recovery_state
    FOR EACH ROW EXECUTE FUNCTION queue_push_game();
CREATE TABLE push_deliveries (
    id uuid PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
    kind text NOT NULL,
    room_id text NOT NULL,
    match_id text,
    table_id uuid,
    source_id text,
    event_key text NOT NULL,
    action_key text,
    expires_at timestamptz NOT NULL,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','expired','failed')),
    claim_token uuid,
    claim_until timestamptz,
    UNIQUE(device_id,event_key)
);
CREATE INDEX push_deliveries_due_idx ON push_deliveries(next_attempt_at)
    WHERE status='pending';
CREATE FUNCTION queue_push_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
    INSERT INTO push_deliveries(id,device_id,kind,room_id,source_id,event_key,expires_at)
        SELECT gen_random_uuid(),d.id,'room_invitation',NEW.room_id,NEW.id,
            'room_invitation:' || NEW.id,now()+interval '1 day'
        FROM push_devices d WHERE d.user_id=replace(NEW.recipient_id,'user-','')::uuid
        ON CONFLICT(device_id,event_key) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER queue_push_room_invitation AFTER INSERT ON room_invitations
    FOR EACH ROW EXECUTE FUNCTION queue_push_invitation();
"""
