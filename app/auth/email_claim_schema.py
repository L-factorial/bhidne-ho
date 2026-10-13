"""Reserve password-account mailboxes across pending and verified contacts."""
EMAIL_CLAIM_SCHEMA = r"""
CREATE TABLE account_email_claims (
    email text PRIMARY KEY,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL
);
-- Preserve existing shared addresses as reserved conflicts, without merging users.
INSERT INTO account_email_claims(email,user_id)
SELECT email, CASE WHEN count(DISTINCT user_id)=1 THEN (array_agg(user_id))[1] ELSE NULL END
FROM (
    SELECT lower(unverified_email) email,user_id FROM account_credentials WHERE unverified_email IS NOT NULL
    UNION
    SELECT lower(email),user_id FROM account_recovery_contacts
) addresses GROUP BY email;
CREATE FUNCTION reserve_account_email() RETURNS trigger AS $$
DECLARE address text; owner uuid;
BEGIN
    IF TG_TABLE_NAME='account_credentials' THEN
        address := NEW.unverified_email;
        IF TG_OP='UPDATE' AND NEW.unverified_email IS NOT DISTINCT FROM OLD.unverified_email THEN RETURN NEW; END IF;
    ELSE
        address := NEW.email;
        IF TG_OP='UPDATE' AND NEW.email IS NOT DISTINCT FROM OLD.email THEN RETURN NEW; END IF;
    END IF;
    IF address IS NULL THEN RETURN NEW; END IF;
    INSERT INTO account_email_claims(email,user_id) VALUES(lower(address),NEW.user_id)
        ON CONFLICT(email) DO NOTHING;
    SELECT user_id INTO owner FROM account_email_claims WHERE email=lower(address) FOR UPDATE;
    IF owner IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'Email is already associated with an account'
            USING ERRCODE='23505', CONSTRAINT='account_email_claims_pkey';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION release_account_email() RETURNS trigger AS $$
DECLARE address text;
BEGIN
    IF TG_TABLE_NAME='account_credentials' THEN address := OLD.unverified_email;
    ELSE address := OLD.email; END IF;
    IF address IS NOT NULL THEN
        DELETE FROM account_email_claims c WHERE c.email=lower(address) AND (c.user_id=OLD.user_id OR c.user_id IS NULL)
            AND NOT EXISTS(SELECT 1 FROM account_credentials a WHERE lower(a.unverified_email)=c.email)
            AND NOT EXISTS(SELECT 1 FROM account_recovery_contacts r WHERE lower(r.email)=c.email);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER reserve_signup_email BEFORE INSERT OR UPDATE OF unverified_email ON account_credentials
    FOR EACH ROW EXECUTE FUNCTION reserve_account_email();
CREATE TRIGGER reserve_verified_email BEFORE INSERT OR UPDATE OF email ON account_recovery_contacts
    FOR EACH ROW EXECUTE FUNCTION reserve_account_email();
CREATE TRIGGER release_signup_email AFTER DELETE OR UPDATE OF unverified_email ON account_credentials
    FOR EACH ROW EXECUTE FUNCTION release_account_email();
CREATE TRIGGER release_verified_email AFTER DELETE OR UPDATE OF email ON account_recovery_contacts
    FOR EACH ROW EXECUTE FUNCTION release_account_email();
"""
