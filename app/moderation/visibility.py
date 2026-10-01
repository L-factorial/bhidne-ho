"""One read-time redaction policy for history and durable replay."""
from uuid import UUID
REMOVED_TEXT = 'Message removed by moderation.'

async def redact_messages(connection, scope, messages):
    if not messages:return messages
    ids=[UUID(str(m['id'])) for m in messages]
    rows=await (await connection.execute('SELECT message_id FROM removed_messages WHERE scope=%s AND message_id=ANY(%s::uuid[])',(scope,[str(v) for v in ids]))).fetchall()
    removed={str(row[0]) for row in rows}
    return [{**m,'text':REMOVED_TEXT,'removed':True} if str(m['id']) in removed else m for m in messages]

async def redact_event(connection, payload):
    kind=payload.get('type')
    if kind not in ('CHAT_MESSAGE','DIRECT_MESSAGE'):return payload
    return (await redact_messages(connection,'chat' if kind=='CHAT_MESSAGE' else 'direct',[payload]))[0]
