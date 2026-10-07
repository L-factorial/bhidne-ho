"""Transactional, deduplicated chat/poke notices without copying message text."""
from .social import NotificationProducer
from .queries import QueryAccessDenied


async def notify(connection, inbox, *, actor, recipients, key, kind, payload):
    from app.player_blocks.service import require_contact
    producer = NotificationProducer(inbox)
    for recipient in sorted(set(recipients) - {actor}):
        try:
            await require_contact(connection, actor, recipient)
        except QueryAccessDenied:
            continue
        await producer.enqueue_in_transaction(connection, recipient,
            key=f'{kind}:{key}:{recipient}',kind=kind,actor=actor,payload=payload)


async def chat_recipients(connection, target):
    if target.kind == 'room_chat':
        rows = await (await connection.execute('SELECT user_id FROM room_memberships WHERE room_id=%s',
            (target.room_id,))).fetchall()
    else:
        rows = await (await connection.execute('''SELECT p.user_id FROM table_positions p
            JOIN room_memberships m ON m.user_id=p.user_id AND m.room_id=%s
            WHERE p.table_id=%s AND (p.seat IS NOT NULL OR (%s='table_chat' AND p.queue_position IS NOT NULL))''',
            (target.room_id,target.table_id,target.kind))).fetchall()
    return [f'user-{row[0]}' for row in rows]
