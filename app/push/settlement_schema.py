"""Enqueue new ledger notices atomically; do not resend historical settlements."""
SETTLEMENT_PUSH_SCHEMA = """
CREATE OR REPLACE FUNCTION queue_push_social_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind NOT IN ('chat','poke','settlement_requested','settlement_accepted') THEN RETURN NEW; END IF;
    INSERT INTO push_deliveries(id,device_id,kind,room_id,match_id,table_id,source_id,event_key,expires_at)
        SELECT gen_random_uuid(),d.id,NEW.kind,COALESCE(NEW.payload->>'room_id',''),
            CASE WHEN NEW.kind IN ('chat','poke') THEN NEW.payload->>'match_id' END,
            (NEW.payload->>'table_id')::uuid,NEW.id::text,
            NEW.kind || ':' || NEW.id::text,NEW.created_at+
                CASE WHEN NEW.kind='poke' THEN interval '5 minutes' ELSE interval '1 day' END
        FROM push_devices d WHERE d.user_id=NEW.user_id
        ON CONFLICT(device_id,event_key) DO NOTHING;
    RETURN NEW;
END;
$$;
"""
