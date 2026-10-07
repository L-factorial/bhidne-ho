SOCIAL_PUSH_SCHEMA = """
CREATE TABLE table_dismissals (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    table_id uuid NOT NULL REFERENCES room_tables(table_id) ON DELETE CASCADE,
    match_id text NOT NULL,
    PRIMARY KEY(user_id,table_id,match_id)
);
CREATE INDEX account_recovery_contacts_login_email_idx ON account_recovery_contacts(lower(email));
CREATE FUNCTION queue_push_social_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind NOT IN ('chat','poke') THEN RETURN NEW; END IF;
    INSERT INTO push_deliveries(id,device_id,kind,room_id,match_id,table_id,source_id,event_key,expires_at)
        SELECT gen_random_uuid(),d.id,NEW.kind,COALESCE(NEW.payload->>'room_id',''),
            NEW.payload->>'match_id',(NEW.payload->>'table_id')::uuid,NEW.id::text,
            NEW.kind || ':' || NEW.id::text,NEW.created_at+
                CASE WHEN NEW.kind='poke' THEN interval '5 minutes' ELSE interval '1 day' END
        FROM push_devices d WHERE d.user_id=NEW.user_id
        ON CONFLICT(device_id,event_key) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER queue_push_social_notification AFTER INSERT ON friend_notifications
    FOR EACH ROW EXECUTE FUNCTION queue_push_social_notification();
"""
