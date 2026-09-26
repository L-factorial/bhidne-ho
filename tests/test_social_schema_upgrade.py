from uuid import UUID,uuid4

import pytest
from psycopg.errors import CheckViolation

from app.database import MIGRATIONS
from pglite_support import PGlitePool


async def test_upgrade_preserves_sequenced_actor_metadata_and_legacy_notifications():
    pool=await PGlitePool.open()
    user,origin,lane=UUID(int=1),UUID(int=2),uuid4()
    native,legacy=uuid4(),uuid4()
    try:
        for version,script in MIGRATIONS:
            if version<24:
                await pool.execute(script,script=True)
        for identity in (user,origin):
            await pool.execute("INSERT INTO users(id,kind) VALUES (%s,'account')",(identity,))
        await pool.execute("INSERT INTO command_lanes(lane_id,kind,recipient_id,emitted_sequence) VALUES (%s,'recipient',%s,1)",(lane,user))
        await pool.execute('''INSERT INTO friend_notifications(id,user_id,actor_id,kind,lane_id,sequence,deduplication_key)
            VALUES (%s,%s,%s,'friend_accepted',%s,1,'before-upgrade')''',(native,user,origin,lane))
        await pool.execute("INSERT INTO friend_notifications(id,user_id,actor_id,kind) VALUES (%s,%s,%s,'friend_accepted')",(legacy,user,origin))
        await pool.execute(dict(MIGRATIONS)[24],script=True)
        assert (await pool.execute('SELECT actor_id,source_actor_id,sequence,deduplication_key FROM friend_notifications WHERE id=%s',(native,))).rows==[(None,origin,1,'before-upgrade')]
        assert (await pool.execute('SELECT actor_id,source_actor_id FROM friend_notifications WHERE id=%s',(legacy,))).rows==[(origin,None)]
        with pytest.raises(CheckViolation):
            await pool.execute("UPDATE friend_notifications SET kind='rewritten' WHERE id=%s",(native,))
        await pool.execute('UPDATE friend_notifications SET read_at=clock_timestamp() WHERE id=%s',(native,))
        await pool.execute('DELETE FROM users WHERE id=%s',(origin,))
        assert (await pool.execute('SELECT id,source_actor_id,read_at IS NOT NULL FROM friend_notifications')).rows==[(native,origin,True)]
    finally:
        await pool.close()
