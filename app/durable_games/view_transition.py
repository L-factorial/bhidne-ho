"""Opt-in immutable inputs for post-commit player-view generation.

No worker or socket behavior is enabled here. References identify full hosted
checkpoints, including table metadata; engine snapshots alone are insufficient.
"""
from uuid import UUID

from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb

from .checkpoints import decode_checkpoint
from .store import DurableGameConflict


VIEW_TRANSITION_SCHEMA = """
    CREATE TABLE delivery_checkpoints (
        table_id uuid NOT NULL REFERENCES room_tables(table_id) ON DELETE RESTRICT,
        revision bigint NOT NULL CHECK (revision >= 0),
        checkpoint jsonb NOT NULL CHECK (jsonb_typeof(checkpoint)='object'),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (table_id,revision),
        CHECK (((checkpoint->'data'->>'table_id')::uuid=table_id) IS TRUE),
        CHECK (((checkpoint->'data'->>'table_revision')::bigint=revision) IS TRUE)
    );
    CREATE TABLE view_generation_jobs (
        table_id uuid NOT NULL,
        revision bigint NOT NULL,
        base_revision bigint NOT NULL CHECK (base_revision >= 0 AND revision=base_revision+1),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
        claim_token uuid,
        claim_expires_at timestamptz,
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        completed_at timestamptz,
        PRIMARY KEY (table_id,revision),
        FOREIGN KEY (table_id,revision) REFERENCES delivery_checkpoints(table_id,revision) ON DELETE RESTRICT,
        FOREIGN KEY (table_id,base_revision) REFERENCES delivery_checkpoints(table_id,revision) ON DELETE RESTRICT,
        CHECK ((claim_token IS NULL)=(claim_expires_at IS NULL)),
        CHECK ((status='completed')=(completed_at IS NOT NULL))
    );
    CREATE INDEX view_generation_pending_idx ON view_generation_jobs(next_attempt_at,table_id,revision)
        WHERE status='pending';
    CREATE FUNCTION protect_delivery_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        RAISE EXCEPTION 'delivery checkpoint inputs are immutable' USING ERRCODE='23514';
    END;
    $$;
    CREATE TRIGGER delivery_checkpoint_immutable BEFORE UPDATE ON delivery_checkpoints
        FOR EACH ROW EXECUTE FUNCTION protect_delivery_checkpoint();
    CREATE FUNCTION protect_view_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF (NEW.table_id,NEW.revision,NEW.base_revision) IS DISTINCT FROM
           (OLD.table_id,OLD.revision,OLD.base_revision) THEN
            RAISE EXCEPTION 'view job identity is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END;
    $$;
    CREATE TRIGGER view_job_identity_immutable BEFORE UPDATE ON view_generation_jobs
        FOR EACH ROW EXECUTE FUNCTION protect_view_job_identity();
"""


async def record_view_transition(connection, before, after):
    """Call under the existing table lock, in the checkpoint write transaction.

    A first creation retains a baseline only. Enabling on an existing table also
    retains its prior baseline. Duplicate calls cannot rewrite historical inputs.
    """
    if connection.info.transaction_status != TransactionStatus.INTRANS:
        raise DurableGameConflict('View transition requires the state transaction.')
    new = decode_checkpoint(after).record.data
    old = decode_checkpoint(before).record.data if before is not None else None
    if old is not None and (old.table_id != new.table_id or new.table_revision != old.table_revision + 1):
        raise DurableGameConflict('View transition is not contiguous.')
    table = UUID(new.table_id)
    for checkpoint in (before, after):
        if checkpoint is None:
            continue
        revision = checkpoint['data']['table_revision']
        await connection.execute('''INSERT INTO delivery_checkpoints(table_id,revision,checkpoint)
            VALUES (%s,%s,%s) ON CONFLICT (table_id,revision) DO NOTHING''',
            (table, revision, Jsonb(checkpoint)))
        saved = await (await connection.execute('''SELECT checkpoint FROM delivery_checkpoints
            WHERE table_id=%s AND revision=%s''', (table, revision))).fetchone()
        if saved is None or saved[0] != checkpoint:
            raise DurableGameConflict('View transition input differs from its committed identity.')
    if old is not None:
        # Under the table write lock: drop only unclaimed excess work. Clients
        # detect the resulting base gap and fetch a snapshot; never delay moves
        # indefinitely behind an unavailable projection worker.
        discarded = await (await connection.execute('''DELETE FROM view_generation_jobs j WHERE table_id=%s
            AND status='pending' AND claim_token IS NULL AND
            (SELECT count(*) FROM view_generation_jobs WHERE table_id=%s AND status='pending')>=64
            RETURNING revision''', (table, table))).fetchall()
        if discarded:
            # Bound retained bytes even while the generation worker is down.
            # Keep the new baseline and any still-claimed transition inputs.
            await connection.execute('''DELETE FROM delivery_checkpoints WHERE (table_id,revision) IN (
                SELECT p.table_id,p.revision FROM delivery_checkpoints p
                WHERE p.table_id=%s AND p.revision<%s
                AND NOT EXISTS(SELECT 1 FROM view_generation_jobs j WHERE j.table_id=p.table_id
                    AND (j.revision=p.revision OR j.base_revision=p.revision))
                ORDER BY p.revision LIMIT 128 FOR UPDATE SKIP LOCKED)''', (table, old.table_revision))
        await connection.execute('''INSERT INTO view_generation_jobs(table_id,revision,base_revision)
            VALUES (%s,%s,%s) ON CONFLICT (table_id,revision) DO NOTHING''',
            (table, new.table_revision, old.table_revision))
