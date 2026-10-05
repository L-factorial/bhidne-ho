from datetime import datetime, timezone
import hashlib
from fastapi import HTTPException
from app.durable_games.checkpoint_store import user_uuid

DEFAULTS = dict(actions=True,invitations=True,sound=True,quiet_start=None,quiet_end=None)

def quiet(preferences, offset, now=None):
    start,end = preferences['quiet_start'],preferences['quiet_end']
    if start is None:return False
    now = now or datetime.now(timezone.utc)
    minute = (now.hour*60+now.minute-offset)%1440
    return start <= minute < end if start < end else minute >= start or minute < end

class PushService:
    def __init__(self,pool,providers):self.pool,self.providers=pool,providers

    async def preferences(self,actor):
        async with self.pool.connection() as c:
            row=await (await c.execute('SELECT actions,invitations,sound,quiet_start,quiet_end FROM push_preferences WHERE user_id=%s',(user_uuid(actor),))).fetchone()
        return dict(zip(DEFAULTS,row)) if row else dict(DEFAULTS)

    async def update_preferences(self,actor,body):
        values=body.model_dump()
        async with self.pool.connection() as c:
            await c.execute('''INSERT INTO push_preferences(user_id,actions,invitations,sound,quiet_start,quiet_end)
                VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT(user_id) DO UPDATE SET
                actions=EXCLUDED.actions,invitations=EXCLUDED.invitations,sound=EXCLUDED.sound,
                quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end''',(user_uuid(actor),*values.values()))
        return values

    async def register(self,actor,session_token,device_id,body):
        if body.provider not in self.providers.available:raise HTTPException(503,'Push delivery is not configured for this platform.')
        user=user_uuid(actor);session_hash=hashlib.sha256(session_token.encode()).digest()
        async with self.pool.connection() as c, c.transaction():
            await c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user,))
            valid=await (await c.execute('SELECT 1 FROM auth_sessions WHERE user_id=%s AND token_hash=%s AND expires_at>now()',(user,session_hash))).fetchone()
            if not valid:raise HTTPException(401,'Sign in again before enabling notifications.')
            count=await (await c.execute('SELECT count(*) FROM push_devices WHERE user_id=%s AND id<>%s',(user,device_id))).fetchone()
            if count[0]>=20:raise HTTPException(409,'Too many registered notification devices.')
            # Native tokens can rotate; one installation transfers on account switch.
            await c.execute('DELETE FROM push_devices WHERE provider=%s AND token=%s AND id<>%s',(body.provider,body.token,device_id))
            prior=await (await c.execute('SELECT user_id,provider,token FROM push_devices WHERE id=%s',(device_id,))).fetchone()
            if prior and prior[0]!=user:
                if prior[1]!=body.provider or prior[2]!=body.token:
                    raise HTTPException(409,'This notification installation belongs to another account.')
                await c.execute('DELETE FROM push_devices WHERE id=%s',(device_id,))
                prior=None
            await c.execute('''INSERT INTO push_devices(id,user_id,session_hash,provider,token,environment,locale,timezone_offset)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,
                session_hash=EXCLUDED.session_hash,provider=EXCLUDED.provider,token=EXCLUDED.token,
                environment=EXCLUDED.environment,locale=EXCLUDED.locale,timezone_offset=EXCLUDED.timezone_offset,updated_at=now()''',
                (device_id,user,session_hash,body.provider,body.token,body.environment,body.locale,body.timezone_offset))
            if prior is None:
                await c.execute('''INSERT INTO push_game_jobs(table_id,revision)
                SELECT r.table_id,r.revision FROM table_recovery_state r JOIN table_positions p USING(table_id)
                WHERE p.user_id=%s ON CONFLICT(table_id) DO UPDATE SET processed_revision=-1,next_attempt_at=now()''',(user,))
        return {'registered':True}

    async def unregister(self,actor,device_id):
        async with self.pool.connection() as c:
            await c.execute('DELETE FROM push_devices WHERE id=%s AND user_id=%s',(device_id,user_uuid(actor)))

    async def activity(self,actor,device_id,body):
        async with self.pool.connection() as c:
            await c.execute('''UPDATE push_devices SET foreground_until=CASE WHEN %s THEN now()+interval '60 seconds' ELSE NULL END,
                viewed_match=%s,timezone_offset=%s,locale=%s,updated_at=now() WHERE id=%s AND user_id=%s''',
                (body.foreground,body.viewed_match,body.timezone_offset,body.locale,device_id,user_uuid(actor)))
        return {'updated':True}
