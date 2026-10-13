from uuid import UUID

from app.players.store import PostgresPlayerStore
from test_checkpoint_store import database


async def test_conversations_latest_friend_only_and_blocked(database):
    pool, _, _, users = database
    store = PostgresPlayerStore(pool)
    await pool.execute("INSERT INTO friendships(user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'accepted')", (UUID(int=1),UUID(int=2),UUID(int=1)))
    await pool.execute("INSERT INTO direct_messages(id,sender_id,recipient_id,text,sent_at) VALUES (%s,%s,%s,'Old',now()-interval '1 day'),(%s,%s,%s,'Latest',now()),(%s,%s,%s,'Private elsewhere',now())",
                       (UUID(int=101),UUID(int=1),UUID(int=2),UUID(int=102),UUID(int=2),UUID(int=1),UUID(int=103),UUID(int=2),UUID(int=3)))
    rows=await store.conversations(users[0])
    assert [(row['user_id'],row['text']) for row in rows] == [(users[1],'Latest')]
    assert await store.conversations(users[2]) == []
    await pool.execute("INSERT INTO removed_messages(scope,message_id) VALUES ('direct',%s)",(UUID(int=102),))
    redacted=await store.conversations(users[0])
    assert redacted[0]['removed'] is True and redacted[0]['text'] != 'Latest'
    await pool.execute('INSERT INTO player_blocks(blocker_id,blocked_id) VALUES (%s,%s)', (UUID(int=2),UUID(int=1)))
    assert await store.conversations(users[0]) == []
