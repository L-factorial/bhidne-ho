BLOCK_SCHEMA = """
CREATE TABLE social_policy_revision (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    revision bigint NOT NULL DEFAULT 0
);
INSERT INTO social_policy_revision(singleton) VALUES (true);
CREATE TABLE player_blocks (
    blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    active boolean NOT NULL DEFAULT true,
    blocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id<>blocked_id)
);
CREATE INDEX player_blocks_reverse ON player_blocks(blocked_id,blocker_id);
CREATE TRIGGER block_owner_available BEFORE INSERT OR UPDATE ON player_blocks
    FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('blocker_id');
CREATE TRIGGER block_target_available BEFORE INSERT OR UPDATE ON player_blocks
    FOR EACH ROW EXECUTE FUNCTION reject_disabled_identity('blocked_id');
CREATE FUNCTION social_blocked(a uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS(SELECT 1 FROM player_blocks WHERE active AND
        ((blocker_id=a AND blocked_id=b) OR (blocker_id=b AND blocked_id=a)))
$$;
-- Old queued contact/invitations cannot become valid again after unblock.
CREATE FUNCTION social_contact_allowed(a uuid,b uuid,issued timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT NOT EXISTS(SELECT 1 FROM player_blocks WHERE
        ((blocker_id=a AND blocked_id=b) OR (blocker_id=b AND blocked_id=a))
        AND (active OR issued IS NULL OR updated_at>=issued))
$$;
CREATE FUNCTION social_notification_allowed(viewer uuid,source uuid,kind text,data jsonb,issued timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT social_contact_allowed(viewer,source,issued) AND
        CASE WHEN kind='friendship_changed' AND data->>'other_user_id' ~
            '^user-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN social_contact_allowed(viewer,substring(data->>'other_user_id' from 6)::uuid,issued)
        ELSE true END
$$;
"""
