MODERATION_SCHEMA = """
CREATE TABLE moderation_reports (
    id uuid PRIMARY KEY,
    reporter_id uuid NOT NULL REFERENCES users(id),
    reported_id uuid NOT NULL REFERENCES users(id),
    scope text NOT NULL CHECK(scope IN ('player','direct','chat')),
    message_id uuid,
    category text NOT NULL CHECK(category IN ('harassment','hate','sexual','spam','other')),
    explanation text NOT NULL CHECK(length(explanation)<=1000),
    evidence jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
    CHECK(reporter_id<>reported_id),
    CHECK((scope='player')=(message_id IS NULL))
);
CREATE INDEX moderation_report_queue ON moderation_reports(reported_id,created_at DESC,id);
CREATE INDEX moderation_report_rate ON moderation_reports(reporter_id,created_at DESC);
CREATE INDEX moderation_report_expiry ON moderation_reports(expires_at);
CREATE TABLE moderation_decisions (
    report_id uuid PRIMARY KEY REFERENCES moderation_reports(id) ON DELETE CASCADE,
    moderator_id uuid NOT NULL REFERENCES users(id),
    decision text NOT NULL CHECK(decision IN ('accepted','declined')),
    reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
"""
