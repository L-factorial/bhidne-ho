"""Additive account recovery and encrypted delivery schemas."""

RECOVERY_SCHEMA = """
CREATE TABLE account_recovery_contacts (
    user_id uuid PRIMARY KEY REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
    verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE account_recovery_challenges (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    UNIQUE (user_id, purpose),
    CHECK (expires_at > created_at)
);
CREATE INDEX account_recovery_challenges_expiry_idx ON account_recovery_challenges(expires_at);
CREATE TABLE account_recovery_limits (
    user_id uuid NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    window_start timestamptz NOT NULL,
    issued_count integer NOT NULL CHECK (issued_count BETWEEN 1 AND 5),
    next_allowed_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, purpose)
);
"""

RECOVERY_DELIVERY_SCHEMA = """
CREATE TABLE recovery_mail_outbox (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES account_credentials(user_id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
    token_hash bytea NOT NULL,
    envelope bytea NOT NULL,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    lease_id uuid,
    lease_until timestamptz,
    UNIQUE (user_id,purpose)
);
CREATE INDEX recovery_mail_due_idx ON recovery_mail_outbox(available_at);
CREATE TABLE recovery_reset_requests (
    id uuid PRIMARY KEY,
    envelope bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes'
);
CREATE INDEX recovery_reset_created_idx ON recovery_reset_requests(created_at);
CREATE TABLE recovery_request_limits (
    bucket bytea PRIMARY KEY,
    count integer NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX recovery_request_limits_expiry_idx ON recovery_request_limits(expires_at);
"""

USERNAME_RECOVERY_SCHEMA = """
ALTER TABLE recovery_mail_outbox DROP CONSTRAINT recovery_mail_outbox_purpose_check;
ALTER TABLE recovery_mail_outbox ADD CONSTRAINT recovery_mail_outbox_purpose_check
    CHECK (purpose IN ('verify_email','reset_password','username_reminder'));
ALTER TABLE recovery_mail_outbox ALTER COLUMN token_hash DROP NOT NULL;
ALTER TABLE recovery_mail_outbox ADD CONSTRAINT recovery_mail_token_purpose_check
    CHECK ((purpose='username_reminder' AND token_hash IS NULL)
        OR (purpose<>'username_reminder' AND token_hash IS NOT NULL));
CREATE INDEX account_recovery_contacts_email_idx ON account_recovery_contacts(email);
"""
