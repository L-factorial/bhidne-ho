"""Append validated public/private lane events inside the command transaction."""
from uuid import uuid4

from psycopg.types.json import Jsonb
from psycopg.pq import TransactionStatus

from .checkpoint_store import user_uuid
from .checkpoints import canonical_json
from .store import DurableGameConflict


async def append_lane_events(claim, events, *, max_events=512):
    if (claim.connection.info.transaction_status != TransactionStatus.INTRANS
            or not claim._active or claim._completed):
        raise DurableGameConflict('Outbox append requires an active, uncompleted lane claim.')
    if len(events) > max_events:
        raise DurableGameConflict('Command exceeded the event batch limit.')
    if not events:
        return
    for event in events:
        canonical_json(event.message)
    end = await (await claim.connection.execute('''UPDATE command_lanes
        SET emitted_sequence=emitted_sequence+%s WHERE lane_id=%s RETURNING emitted_sequence''',
        (len(events), claim.entry.lane_id))).fetchone()
    for sequence, event in enumerate(events, end[0] - len(events) + 1):
        await claim.connection.execute('''INSERT INTO notification_outbox
            (event_id,lane_id,sequence,event_type,audience_user_id,payload) VALUES (%s,%s,%s,%s,%s,%s)''',
            (uuid4(), claim.entry.lane_id, sequence, event.message.get('event') or event.message['type'],
             user_uuid(event.recipient) if event.recipient else None, Jsonb(event.message)))
