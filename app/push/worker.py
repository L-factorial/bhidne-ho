"""Bounded shared-database jobs, leased delivery retries and stale-action checks."""
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import logging
from uuid import uuid4
from app.durable_games.checkpoint_store import PostgresCheckpointStore, user_uuid
from app.durable_games.view_generation import _projection, _view
from .events import action, message
from .service import DEFAULTS, quiet

log=logging.getLogger(__name__)
class PushWorker:
    def __init__(self,pool,providers):
        self.pool,self.providers=pool,providers
        self.task=None;self.running=False;self.generating_table=None

    async def start(self):
        await self.providers.start()
        if self.providers.available:
            self.running=True
            self.task=asyncio.create_task(self.run(),name='native-push-delivery')
    async def stop(self):
        self.running=False
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task,return_exceptions=True)
            self.task=None
        await self.providers.close()
    async def run(self):
        while self.running:
            try:
                try:
                    await self.generate_one()
                except Exception:
                    if self.generating_table:
                        async with self.pool.connection() as c:
                            await c.execute("UPDATE push_game_jobs SET next_attempt_at=now()+interval '10 seconds' WHERE table_id=%s",(self.generating_table,))
                    log.warning('Native push projection deferred after a transient failure')
                for _ in range(16):
                    if not await self.send_one():break
                await self.prune()
            except asyncio.CancelledError:raise
            except Exception:
                # No exception text: providers/SQL errors can contain device tokens.
                log.warning('Native push worker retrying after a transient failure')
            await asyncio.sleep(2)

    async def generate_one(self):
        self.generating_table=None
        async with self.pool.connection() as c,c.transaction():
            job=await (await c.execute('''SELECT table_id,revision FROM push_game_jobs
                WHERE revision>processed_revision AND next_attempt_at<=now()
                ORDER BY next_attempt_at,table_id LIMIT 1 FOR UPDATE SKIP LOCKED''')).fetchone()
            if not job:return False
            table,revision=job;self.generating_table=table
            saved=await PostgresCheckpointStore(None)._load(c,table,missing_ok=True)
            if saved:
                checkpoint=saved.checkpoint;data=checkpoint['data']
                actors={u for u in data['host']['users'] if u}
                invitations=data.get('invitations',[])
                actors.update(i['recipient_id'] for i in invitations if i['status']=='pending')
                host,game=_projection(checkpoint,{})
                views={}
                now=datetime.now(timezone.utc)
                async for device,user in self.devices(c,actors):
                    actor=f'user-{user}'
                    if actor in data['host']['users']:
                        if actor not in views:views[actor]=_view(host,game,checkpoint,actor)
                        cue=action(views[actor])
                        if cue:
                            kind,key=cue
                            await self.enqueue(c,device,kind,data['room_id'],data['match_id'],table,
                                f'action:{key}',key,now+timedelta(seconds=90))
                    if not data['host']['ended']:
                        for invitation in invitations:
                            if invitation['recipient_id']==actor and invitation['status']=='pending':
                                expires=datetime.fromtimestamp(invitation['created_at']/1000,timezone.utc)+timedelta(days=1)
                                if expires>now:
                                    await self.enqueue(c,device,'game_invitation',data['room_id'],data['match_id'],table,
                                        'game_invitation:'+invitation['id'],None,expires,invitation['id'])
            await c.execute('UPDATE push_game_jobs SET processed_revision=%s WHERE table_id=%s',(revision,table))
            return True

    async def devices(self,c,actors):
        if not actors:return
        cursor=None
        while True:
            rows=await (await c.execute('''SELECT d.id,d.user_id FROM push_devices d
                JOIN auth_sessions s ON s.token_hash=d.session_hash
                WHERE d.user_id=ANY(%s::uuid[]) AND s.expires_at>now()
                  AND (%s::uuid IS NULL OR d.id>%s::uuid)
                ORDER BY d.id LIMIT 256''',([user_uuid(a) for a in sorted(actors)],cursor,cursor))).fetchall()
            for row in rows:yield row
            if len(rows)<256:return
            cursor=rows[-1][0]

    async def enqueue(self,c,device,kind,room,match,table,event,key,expires,source=None):
        await c.execute('''INSERT INTO push_deliveries(id,device_id,kind,room_id,match_id,table_id,source_id,event_key,action_key,expires_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(device_id,event_key) DO NOTHING''',
            (uuid4(),device,kind,room,match,table,source,event,key,expires))

    async def claim(self):
        token=uuid4()
        async with self.pool.connection() as c,c.transaction():
            row=await (await c.execute('''WITH selected AS (SELECT id FROM push_deliveries
                WHERE status='pending' AND next_attempt_at<=now() AND (claim_until IS NULL OR claim_until<now())
                ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
                UPDATE push_deliveries p SET claim_token=%s,claim_until=now()+interval '30 seconds',attempts=attempts+1
                FROM selected WHERE p.id=selected.id RETURNING p.id''',(token,))).fetchone()
        return (row[0],token) if row else None

    async def valid(self,identity,claim):
        async with self.pool.connection() as c,c.transaction():
            row=await (await c.execute('''SELECT p.device_id,p.kind,p.room_id,p.match_id,p.table_id,p.source_id,p.action_key,p.expires_at AS delivery_expires,p.attempts,p.created_at,
                d.user_id,d.provider,d.token,d.environment,d.locale,d.timezone_offset,d.foreground_until,d.viewed_match,
                s.expires_at AS session_expires,COALESCE(u.deletion_pending,false),COALESCE(u.erased,false),u.suspended_until,
                pref.actions,pref.invitations,pref.sound,pref.quiet_start,pref.quiet_end
                FROM push_deliveries p JOIN push_devices d ON d.id=p.device_id
                JOIN auth_sessions s ON s.token_hash=d.session_hash JOIN users u ON u.id=d.user_id
                LEFT JOIN push_preferences pref ON pref.user_id=d.user_id
                WHERE p.id=%s AND p.claim_token=%s AND p.status='pending' ''',(identity,claim))).fetchone()
            if not row:return None
            names=('device','kind','room','match','table','source','key','expires','attempts','created','user','provider','token','environment',
                'locale','offset','foreground_until','viewed_match','session_expires','deletion_pending','erased','suspended_until',*DEFAULTS)
            result=dict(zip(names,row));now=datetime.now(timezone.utc)
            prefs={k:result[k] if result[k] is not None else v for k,v in DEFAULTS.items()}
            if result['expires']<=now or result['session_expires']<=now or result['deletion_pending'] or result['erased'] or result['suspended_until'] and result['suspended_until']>now:return None
            category='invitations' if result['kind'].endswith('invitation') else 'actions'
            if not prefs[category] or quiet(prefs,result['offset'],now):return None
            if await (await c.execute('SELECT 1 FROM deleted_rooms WHERE id=%s',(result['room'],))).fetchone():return None
            actor=f"user-{result['user']}"
            if result['kind'] in ('chat','poke'):
                notice = await (await c.execute('''SELECT source_actor_id,payload,read_at FROM friend_notifications
                    WHERE id=%s AND user_id=%s AND kind=%s
                    AND social_notification_allowed(%s,source_actor_id,kind,payload,created_at)''',
                    (result['source'],result['user'],result['kind'],result['user']))).fetchone()
                if not notice or notice[0] is None or notice[2] is not None:return None
                sender=f'user-{notice[0]}'
                from app.player_blocks.service import require_contact
                from app.durable_games.queries import QueryAccessDenied
                try:
                    await require_contact(c,sender,actor)
                    scope=notice[1].get('scope')
                    if scope=='direct':
                        from app.durable_games.social import authorize_social,conversation
                        await authorize_social(c,conversation(sender,actor),actor)
                        result['other_user_id']=sender
                    elif result['table']:
                        saved=await PostgresCheckpointStore(None)._load(c,result['table'],missing_ok=True)
                        if not saved or saved.checkpoint['data']['match_id']!=result['match'] or saved.checkpoint['data']['host']['ended']:return None
                        from app.durable_games.chat import authorize_chat
                        from app.durable_games.inbox import LaneTarget
                        await authorize_chat(c,LaneTarget(kind='game_chat' if scope=='game' else 'table_chat',
                            room_id=result['room'],table_id=result['table'],
                            game_id=notice[1].get('game_id') if scope=='game' else None),actor,checkpoints=PostgresCheckpointStore(None))
                        if notice[1].get('ephemeral') or result['kind']=='poke':
                            seat=await (await c.execute('SELECT seat FROM table_positions WHERE table_id=%s AND user_id=%s',
                                (result['table'],result['user']))).fetchone()
                            if not seat or seat[0] is None:return None
                    else:
                        from app.durable_games.queries import require_member
                        await require_member(c,result['room'],actor)
                except QueryAccessDenied:return None
                if not await (await c.execute('''SELECT 1 FROM users WHERE id=%s AND NOT erased AND NOT deletion_pending
                    AND (suspended_until IS NULL OR suspended_until<=now())''',(notice[0],))).fetchone():return None
            elif result['table']:
                saved=await PostgresCheckpointStore(None)._load(c,result['table'],missing_ok=True)
                if not saved or saved.checkpoint['data']['match_id']!=result['match']:return None
                data=saved.checkpoint['data']
                if result['source']:
                    invitation=next((i for i in data.get('invitations',[]) if i['id']==result['source'] and i['recipient_id']==actor and i['status']=='pending'),None)
                    if not invitation or data['host']['ended']:return None
                    from app.player_blocks.service import invitation_allowed
                    if not await invitation_allowed(c,invitation):return None
                    sender=invitation['inviter_id']
                else:
                    if not await (await c.execute('SELECT 1 FROM room_memberships WHERE room_id=%s AND user_id=%s',(result['room'],result['user']))).fetchone():return None
                    cue=action(_view(*_projection(saved.checkpoint,{}),saved.checkpoint,actor))
                    if cue is None or cue[1]!=result['key']:return None
            else:
                invitation=await (await c.execute("SELECT inviter_id FROM room_invitations WHERE id=%s AND recipient_id=%s AND status='pending'",(result['source'],actor))).fetchone()
                if not invitation:return None
                sender=invitation[0]
                if not (await (await c.execute('SELECT social_contact_allowed(%s,%s,%s)',(user_uuid(sender),result['user'],result['created']))).fetchone())[0]:return None
            if result['source']:
                permitted=await (await c.execute('SELECT 1 FROM users WHERE id=%s AND NOT erased AND NOT deletion_pending AND (suspended_until IS NULL OR suspended_until<=now())',(user_uuid(sender),))).fetchone()
                if not permitted:return None
            context={}
            if result['source']:
                person=await (await c.execute("""SELECT COALESCE(NULLIF(p.display_name,''),a.username,'A player')
                    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
                    LEFT JOIN account_credentials a ON a.user_id=u.id WHERE u.id=%s""",(user_uuid(sender),))).fetchone()
                if person:context['actor']=person[0][:128]
            if result['room']:
                room_name=await (await c.execute('SELECT name FROM rooms WHERE id=%s',(result['room'],))).fetchone()
                if room_name:context['room']=room_name[0][:160]
            if result['table']:
                table_name=await (await c.execute('SELECT name,game_type FROM room_tables WHERE table_id=%s',(result['table'],))).fetchone()
                if table_name:context.update(table=table_name[0][:160],game=table_name[1])
                if result['kind']=='game_invitation':context['created']=bool(invitation.get('room_notification'))
            result['context']=context
            # Heartbeats expire, so a crashed foreground client cannot suppress
            # notifications indefinitely. Foreground elsewhere receives a banner.
            if result['foreground_until'] and result['foreground_until']>now and result['match'] and result['viewed_match']==result['match']:
                result['defer_until']=result['foreground_until']
            result['sound']=prefs['sound']
            return result

    async def send_one(self):
        claim=await self.claim()
        if not claim:return False
        identity,lease=claim;row=await self.valid(identity,lease)
        status='expired';delay=0
        deferred=bool(row and row.get('defer_until'))
        if deferred:
            status='pending';delay=max(1,int((row['defer_until']-datetime.now(timezone.utc)).total_seconds())+1)
        elif row:
            data=dict(type='bhidne_notification',notification_id=str(identity),user_id=f"user-{row['user']}",room_id=row['room'],kind=row['kind'])
            if row['match']:data['match_id']=row['match']
            if row.get('other_user_id'):data['other_user_id']=row['other_user_id']
            collapse=hashlib.sha256(f"{row['device']}:{row['table'] or row['source']}".encode()).hexdigest()[:48]
            result=await self.providers.send((row['provider'],row['token'],row['environment']),message(row['kind'],row['locale'],data,row.get('context')),
                expires_at=row['expires'].timestamp(),collapse_id=collapse,sound=row['sound'])
            status=result.status
            if status=='retry':
                delay=max(result.retry_after,min(300,2**min(row['attempts'],8)))
                status='pending' if row['attempts']<8 else 'failed'
            if status=='invalid':
                async with self.pool.connection() as c:
                    # Never remove a freshly rotated token in response to an old send.
                    await c.execute('DELETE FROM push_devices WHERE id=%s AND token=%s',(row['device'],row['token']))
                return True
        async with self.pool.connection() as c:
            await c.execute('''UPDATE push_deliveries SET status=%s,next_attempt_at=now()+%s*interval '1 second',
                attempts=attempts-CASE WHEN %s THEN 1 ELSE 0 END,
                claim_token=NULL,claim_until=NULL WHERE id=%s AND claim_token=%s''',(status,delay,deferred,identity,lease))
        return True

    async def prune(self):
        async with self.pool.connection() as c:
            await c.execute("DELETE FROM push_deliveries WHERE id IN (SELECT id FROM push_deliveries WHERE expires_at<now()-interval '1 day' LIMIT 100)")
            await c.execute("DELETE FROM push_devices WHERE id IN (SELECT d.id FROM push_devices d JOIN auth_sessions s ON s.token_hash=d.session_hash WHERE s.expires_at<=now() LIMIT 100)")
