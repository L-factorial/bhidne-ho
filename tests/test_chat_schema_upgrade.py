"""Existing durable room messages survive the scoped-chat schema upgrade."""
from uuid import UUID, uuid4

import pytest
from psycopg.errors import CheckViolation

from app.database import MIGRATIONS
from pglite_support import PGlitePool


async def test_existing_room_history_and_stream_constraints_survive_upgrade():
    pool = await PGlitePool.open()
    user, lane, message = UUID(int=1), uuid4(), uuid4()
    try:
        for version, script in MIGRATIONS:
            if version < 23:
                await pool.execute(script, script=True)
        await pool.execute("INSERT INTO users(id,kind) VALUES (%s,'account')", (user,))
        await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES ('room',%s,'Room','private')", (user,))
        await pool.execute("INSERT INTO command_lanes(lane_id,kind,room_id,emitted_sequence) VALUES (%s,'room_chat','room',1)", (lane,))
        await pool.execute('''INSERT INTO room_chat_messages(id,room_id,sender_id,lane_id,sequence,command_id,text)
            VALUES (%s,'room',%s,%s,1,'existing','Preserved')''', (message,user,lane))
        await pool.execute(dict(MIGRATIONS)[23], script=True)
        assert (await pool.execute('SELECT id,text,table_id,game_id FROM room_chat_messages')).rows == [(message,'Preserved',None,None)]
        with pytest.raises(CheckViolation):
            await pool.execute("UPDATE room_chat_messages SET text='Rewritten' WHERE id=%s", (message,))
        with pytest.raises(CheckViolation):
            await pool.execute("INSERT INTO command_lanes(lane_id,kind,room_id) VALUES (%s,'game_chat','room')", (uuid4(),))
        with pytest.raises(CheckViolation):
            await pool.execute('''INSERT INTO room_chat_messages(id,room_id,sender_id,lane_id,sequence,command_id,text)
                VALUES (%s,'room',%s,%s,2,'ahead','Invalid')''', (uuid4(),user,lane))
        assert (await pool.execute('SELECT count(*) FROM room_chat_messages')).rows == [(1,)]
    finally:
        await pool.close()
