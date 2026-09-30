"""Additive deletion lifecycle. Public activation remains an explicit deployment choice."""
DELETION_SCHEMA = """
ALTER TABLE users ADD COLUMN deletion_pending boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN erased boolean NOT NULL DEFAULT false;
-- A non-personal generation invalidates pre-erasure social handoffs without
-- retaining a provider subject or a permanent deleted-identity lookup.
CREATE TABLE account_identity_generation (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    generation bigint NOT NULL DEFAULT 0
);
INSERT INTO account_identity_generation(singleton) VALUES (true);
CREATE TABLE account_deletion_jobs (
    id uuid PRIMARY KEY,
    user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    status_hash bytea NOT NULL UNIQUE CHECK (octet_length(status_hash)=32),
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','waiting','failed','completed')),
    reason text,
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz
);
CREATE INDEX deletion_jobs_pending ON account_deletion_jobs(available_at) WHERE status<>'completed';
CREATE TABLE account_provider_grants (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK(provider IN ('google','apple','facebook')),
    envelope bytea NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(user_id,provider)
);
ALTER TABLE account_recovery_challenges DROP CONSTRAINT account_recovery_challenges_purpose_check;
ALTER TABLE account_recovery_challenges ADD CHECK (purpose IN ('verify_email','reset_password','delete_account'));
ALTER TABLE account_recovery_limits DROP CONSTRAINT account_recovery_limits_purpose_check;
ALTER TABLE account_recovery_limits ADD CHECK (purpose IN ('verify_email','reset_password','delete_account'));
ALTER TABLE recovery_mail_outbox DROP CONSTRAINT recovery_mail_outbox_purpose_check;
ALTER TABLE recovery_mail_outbox ADD CHECK (purpose IN ('verify_email','reset_password','username_reminder','delete_account'));

-- Erased records exist only as unlinked shared game-point references. They cannot
-- acquire credentials, provider identities or sessions, including racing logins.
CREATE FUNCTION reject_disabled_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
    target := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
    IF EXISTS (SELECT 1 FROM users WHERE id=target AND (deletion_pending OR erased) FOR SHARE) THEN
        RAISE EXCEPTION 'Account unavailable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER deletion_session_guard BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_credential_guard BEFORE INSERT ON account_credentials FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_identity_guard BEFORE INSERT ON external_identities FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_seat_guard BEFORE INSERT ON active_table_players FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_game_guard BEFORE INSERT ON active_game_players FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_position_guard BEFORE INSERT ON table_positions FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
"""

# Restrict history transformation to the transaction which owns a pending job.
# Normal game/social transactions retain all existing immutable-record checks.
DELETION_SCHEMA += """
ALTER TABLE account_deletion_jobs ADD COLUMN worker_xid bigint;
CREATE FUNCTION deletion_write_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS(SELECT 1 FROM account_deletion_jobs j
      WHERE j.id::text=current_setting('bhidne.deletion_job',true)
      AND j.worker_xid=txid_current() AND j.status<>'completed' AND j.user_id IS NOT NULL)
$$;
DO $$ DECLARE name text; definition text; BEGIN
    FOREACH name IN ARRAY ARRAY['preserve_durable_record','reject_command_request_change',
      'preserve_inbox_original_request','preserve_finished_work','validate_scheduled_action'] LOOP
        SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname=current_schema() AND p.proname=name;
        EXECUTE regexp_replace(definition,'BEGIN','BEGIN IF deletion_write_allowed() AND TG_TABLE_NAME IN (''game_commands'',''game_events'',''game_snapshots'',''hosted_match_archives'',''command_inbox'',''scheduled_actions'',''notification_outbox'',''game_finalization_jobs'',''room_chat_messages'') THEN IF TG_OP=''DELETE'' THEN RETURN OLD; END IF; RETURN NEW; END IF;');
    END LOOP;
END $$;
-- The only changed identity is an erased, non-login shared game-point reference.
-- Cascades preserve existing delete actions and all foreign-key validation.
DO $$ DECLARE r record; definition text; BEGIN
    FOR r IN SELECT conname,conrelid::regclass AS relation,pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype='f' AND confrelid='users'::regclass LOOP
        definition := replace(r.definition,'REFERENCES users(id)','REFERENCES users(id) ON UPDATE CASCADE');
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.relation,r.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',r.relation,r.conname,definition);
    END LOOP;
    FOR r IN SELECT conname,conrelid::regclass AS relation FROM pg_constraint
      WHERE contype='f' AND confrelid='game_commands'::regclass LOOP
        EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED',r.relation,r.conname);
    END LOOP;
END $$;
"""
DELETION_SCHEMA += """
CREATE OR REPLACE FUNCTION reject_disabled_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; value text; blocked boolean;
BEGIN
    IF deletion_write_allowed() THEN RETURN NEW; END IF;
    value := to_jsonb(NEW)->>TG_ARGV[0];
    IF value IS NULL THEN RETURN NEW; END IF;
    target := replace(value,'user-','')::uuid;
    SELECT deletion_pending OR erased INTO blocked FROM users WHERE id=target FOR SHARE;
    IF NOT FOUND OR blocked THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER deletion_profile_guard BEFORE INSERT OR UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_phrase_guard BEFORE INSERT OR UPDATE ON player_phrases FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_friend_low BEFORE INSERT OR UPDATE ON friendships FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_low');
CREATE TRIGGER deletion_friend_high BEFORE INSERT OR UPDATE ON friendships FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_high');
CREATE TRIGGER deletion_dm_sender BEFORE INSERT ON direct_messages FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('sender_id');
CREATE TRIGGER deletion_dm_recipient BEFORE INSERT ON direct_messages FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('recipient_id');
CREATE TRIGGER deletion_chat_sender BEFORE INSERT ON room_chat_messages FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('sender_id');
CREATE TRIGGER deletion_membership BEFORE INSERT ON room_memberships FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('user_id');
CREATE TRIGGER deletion_invitation_sender BEFORE INSERT ON room_invitations FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('inviter_id');
CREATE TRIGGER deletion_invitation_recipient BEFORE INSERT ON room_invitations FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('recipient_id');
"""
