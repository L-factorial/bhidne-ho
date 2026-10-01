ENFORCEMENT_SCHEMA = """
ALTER TABLE users ADD COLUMN muted_until timestamptz;
ALTER TABLE users ADD COLUMN suspended_until timestamptz;
CREATE FUNCTION reject_suspended_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; blocked boolean;
BEGIN
 IF deletion_write_allowed() THEN RETURN NEW; END IF;
 target := replace(to_jsonb(NEW)->>TG_ARGV[0],'user-','')::uuid;
 SELECT suspended_until>clock_timestamp() INTO blocked FROM users WHERE id=target FOR SHARE;
 IF blocked THEN RAISE EXCEPTION 'Account suspended' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER suspended_session BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION reject_suspended_identity('user_id');
CREATE TRIGGER suspended_seat BEFORE INSERT ON active_table_players FOR EACH ROW EXECUTE FUNCTION reject_suspended_identity('user_id');
CREATE TRIGGER suspended_game BEFORE INSERT ON active_game_players FOR EACH ROW EXECUTE FUNCTION reject_suspended_identity('user_id');
CREATE TRIGGER suspended_position BEFORE INSERT ON table_positions FOR EACH ROW EXECUTE FUNCTION reject_suspended_identity('user_id');
CREATE TABLE moderation_actions (
 id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 report_id uuid REFERENCES moderation_reports(id) ON DELETE SET NULL,
 moderator_id uuid REFERENCES users(id) ON DELETE SET NULL,
 target_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL CHECK(action IN ('remove_message','mute','unmute','suspend','unsuspend')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 hours integer NOT NULL, until_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX moderation_action_target ON moderation_actions(target_id,created_at DESC);
CREATE TABLE removed_messages (
 scope text NOT NULL CHECK(scope IN ('chat','direct')), message_id uuid NOT NULL,
 removed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scope,message_id)
);
CREATE TABLE community_acceptance (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 version text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE social_abuse_limits (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category text NOT NULL, window_at timestamptz NOT NULL, count integer NOT NULL,
 last_hash text, last_at timestamptz,
 PRIMARY KEY(user_id,category)
);
"""
