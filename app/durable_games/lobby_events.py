"""Transactional invalidations, never private room data on the public stream."""
from uuid import uuid4
from psycopg.types.json import Jsonb
from .inbox import LaneTarget
from .checkpoint_store import user_uuid


async def audience(connection, room_id):
    rows = await (await connection.execute('''SELECT user_id FROM room_memberships WHERE room_id=%s
        UNION SELECT replace(recipient_id,'user-','')::uuid FROM room_invitations WHERE room_id=%s AND status='pending' ''',
        (room_id, room_id))).fetchall()
    return {row[0] for row in rows}


async def changed(connection, inbox, room_id, *, before=(), public_before=False, extra=(), message=None):
    room = await (await connection.execute('SELECT visibility,creator_id FROM rooms WHERE id=%s', (room_id,))).fetchone()
    if room is None:
        return
    users = set(before) | await audience(connection, room_id) | {room[1]} | {user_uuid(u) for u in extra}
    targets = []
    if public_before or room[0] == 'public':
        targets.append(LaneTarget(kind='lobby'))
    targets.extend(LaneTarget(kind='recipient', recipient_id=user) for user in sorted(users))
    for target in targets:
        lane = await inbox.ensure_lane_in_transaction(connection, target)
        seq = await (await connection.execute('''UPDATE command_lanes SET emitted_sequence=emitted_sequence+1
            WHERE lane_id=%s RETURNING emitted_sequence''', (lane,))).fetchone()
        await connection.execute('''INSERT INTO notification_outbox
            (event_id,lane_id,sequence,event_type,audience_user_id,payload) VALUES (%s,%s,%s,%s,%s,%s)''',
            (uuid4(), lane, seq[0], (message or {'type':'LOBBY_CHANGED'})['type'], target.recipient_id, Jsonb(message or {'type':'LOBBY_CHANGED'})))
