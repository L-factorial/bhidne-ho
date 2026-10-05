"""Loss-tolerant in-game chat/reactions. SQL authorizes; Redis holds only TTL data."""
import asyncio
from dataclasses import dataclass
import hashlib
import time
from uuid import UUID

from app.models.chat import ChatInput
from app.models.table_social import TablePokePayload
from .pokes import Poke
from .checkpoint_store import PostgresCheckpointStore, user_uuid
from .inbox import LaneTarget, InboxRequest
from .queries import QueryAccessDenied, require_member, _ProjectionHost
from .recovery import rebuild_hosted_game


_LIMIT = '''
local nowParts=redis.call('TIME')
local now=tonumber(nowParts[1])*1000+math.floor(tonumber(nowParts[2])/1000)
local prior=redis.call('GET',KEYS[2])
if prior then if prior==ARGV[1] then return 2 else return -3 end end
local start=tonumber(redis.call('HGET',KEYS[1],'start') or now)
local count=tonumber(redis.call('HGET',KEYS[1],'count') or 0)
if now-start>=60000 then start=now;count=0 end
count=math.max(count,tonumber(ARGV[4]))
local last=tonumber(redis.call('HGET',KEYS[1],'last') or 0)
local hash=redis.call('HGET',KEYS[1],'hash') or ''
if tonumber(ARGV[5])>last then last=tonumber(ARGV[5]);hash=ARGV[6] end
local poke=tonumber(redis.call('HGET',KEYS[1],'poke') or 0)
if count>=20 then return -1 end
if ARGV[2]~='' and hash==ARGV[2] and now-last<30000 then return -2 end
if ARGV[3]=='poke' and now-poke<1500 then return -4 end
redis.call('HSET',KEYS[1],'start',start,'count',count+1,'last',now,'hash',ARGV[2])
if ARGV[3]=='poke' then redis.call('HSET',KEYS[1],'poke',now) end
redis.call('PEXPIRE',KEYS[1],120000)
redis.call('SET',KEYS[2],ARGV[1],'PX',120000)
return 1
'''


@dataclass(frozen=True)
class EphemeralNotice:
    instance_id: str
    content: dict


class EphemeralLimits:
    def __init__(self, redis, pool, *, namespace='bhidne-ho:runtime:v1'):
        self.redis, self.pool, self.namespace = redis, pool, namespace

    async def consume(self, actor, request, *, poke=False, durable=False, connection=None):
        from app.moderation.content import normalized
        from .checkpoints import canonical_json
        text = request.payload.get('text')
        digest = hashlib.sha256(normalized(text).encode()).hexdigest() if text is not None else ''
        fingerprint = hashlib.sha256(canonical_json(request.model_dump(mode='json')).encode()).hexdigest()
        async def history(c):
            return await (await c.execute('''SELECT CASE WHEN window_at>clock_timestamp()-interval '1 minute'
                THEN count ELSE 0 END,last_hash,last_at FROM social_abuse_limits
                WHERE user_id=%s AND category='message' ''', (user_uuid(actor),))).fetchone()
        if connection is not None:
            row = await history(connection)
        else:
            async with self.pool.connection() as c:
                row = await history(c)
        key = self.namespace + ':ephemeral-limit:' + hashlib.sha256(actor.encode()).hexdigest()
        request_key = key + ':' + hashlib.sha256(request.command_id.encode()).hexdigest()
        try:
            async with asyncio.timeout(1):
                result = await self.redis.eval(_LIMIT, 2, key, request_key, fingerprint, digest,
                    'poke' if poke else 'message', row[0] if row else 0,
                    int(row[2].timestamp()*1000) if row and row[2] else 0, row[1] if row and row[1] else '')
        except Exception:
            if durable:
                return  # Durable SQL policy remains available during Redis loss.
            raise QueryAccessDenied('Live chat is unavailable; try again later.') from None
        if result < 0:
            raise QueryAccessDenied({-1:'Too many messages. Please try again later.',
                -2:'Please wait before repeating the same message.',-3:'Request ID identifies another message.',
                -4:'Give that poke a moment before sending another.'}[result])
        return result == 2


class EphemeralService:
    def __init__(self, pool, presence, signals, gateway, limits):
        self.pool, self.presence, self.signals, self.gateway, self.limits = pool, presence, signals, gateway, limits
        self.checkpoints = PostgresCheckpointStore(pool)

    async def submit(self, actor, target, body):
        target, request = LaneTarget.model_validate(target), InboxRequest.model_validate(body)
        if target.kind != 'table' or request.command not in ('send-chat','send-poke','send-reaction'):
            raise ValueError('Live social messages require a table scope.')
        async with self.pool.connection() as c, c.transaction():
            # Authorization/reconstruction shares a read-only snapshot. No SQL
            # inbox, receipt, message, counter or outbox mutation is performed.
            await c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
            await require_member(c, target.room_id, actor)
            stored = await self.checkpoints.load_in_snapshot(c, target.table_id)
            host = _ProjectionHost(None, None)
            game = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot).game
            if game.room_id != target.room_id or game.ended or game.match_id != request.match_id:
                raise QueryAccessDenied('This table conversation is closed.')
            seats = {u:game.flush_seats[u] if game.game_type=='flush' else i+1
                for i,u in enumerate(game.table.seats(game)) if u is not None and u not in game.departed}
            if actor not in seats:
                raise QueryAccessDenied('Take a seat before posting to the game.')
            chat = request.command == 'send-chat'
            value = ChatInput.model_validate(request.payload) if chat else (
                TablePokePayload if request.command=='send-reaction' else Poke).model_validate(request.payload)
            if request.command=='send-reaction' and value.reaction is None:
                raise ValueError('Choose a reaction.')
            from app.moderation.policy import require_posting
            await require_posting(c, actor, text=getattr(value,'text',None), lock=False)
            recipient = None
            if not chat:
                if request.expected_revision != stored.checkpoint['data']['table_revision']:
                    raise QueryAccessDenied('The table changed. Reopen it before sending a poke.')
                recipient = next((u for u,seat in seats.items() if seat==value.recipient_player_id),None)
                if value.recipient_player_id is not None and (recipient is None or recipient==actor):
                    raise ValueError('Choose another occupied seat.')
                if recipient:
                    from app.player_blocks.service import require_contact
                    await require_contact(c,actor,recipient)
            row = await (await c.execute('''SELECT COALESCE(NULLIF(p.display_name,''),a.username)
                FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
                LEFT JOIN account_credentials a ON a.user_id=u.id WHERE u.id=%s''', (user_uuid(actor),))).fetchone()
        duplicate = await self.limits.consume(actor, request, poke=not chat)
        now = int(time.time()*1000)
        payload = dict(type='TABLE_CHAT_MESSAGE' if chat else 'ROOM_POKE',id=request.command_id,
            room_id=target.room_id,table_id=str(target.table_id),match_id=game.match_id,
            sender_id=actor,sender_player_id=seats[actor],sender_name=(row[0] if row else None) or actor,
            text=value.text,sent_at=now,expires_at=now+(30000 if chat else 5000))
        payload['ephemeral']=True
        if not chat:
            payload.update(recipient_id=recipient,recipient_player_id=value.recipient_player_id,
                scope='private' if recipient else 'table')
        if request.command=='send-reaction':
            payload.update(type='TABLE_REACTION',reaction=value.reaction,scope='table')
            if value.reaction!='punchline':payload.pop('text')
        if not duplicate:
            from .view_generation import view_scope
            observed = await self.presence.observe('room', view_scope(target.table_id))
            if observed.status == 'observed':
                destinations = sorted({p.instance_id for p in observed.connections})
                if len(destinations)<=128:
                    content = dict(target=target.model_dump(mode='json',exclude_none=True),payload=payload)
                    async def send(destination):
                        try:
                            await self.signals.send_ephemeral(destination, EphemeralNotice(destination, content))
                        except Exception:
                            pass  # Lost delivery is explicitly acceptable.
                    for start in range(0,len(destinations),4):
                        await asyncio.gather(*(send(d) for d in destinations[start:start+4]))
        return dict(status='accepted',ephemeral=True,message=payload if chat else None)

    async def receive(self, notice):
        if notice.instance_id != self.gateway.instance_id:
            return
        from .checkpoints import canonical_json
        target = LaneTarget.model_validate_json(canonical_json(notice.content['target']))
        payload = notice.content['payload']
        if target.kind!='table' or payload.get('type') not in ('TABLE_CHAT_MESSAGE','ROOM_POKE','TABLE_REACTION'):
            raise ValueError('Invalid ephemeral delivery.')
        if (payload.get('expires_at',0)<=int(time.time()*1000) or payload.get('room_id')!=target.room_id
                or UUID(payload['table_id'])!=target.table_id):
            return
        for handle,stream in tuple(self.gateway._streams.items()):
            if not stream.deltas or handle in self.gateway._paused:
                continue
            async with self.pool.connection() as c:
                try:
                    current,_,member,match,seat = await self.gateway.store._access(c,stream.lane_id,stream.actor)
                    if (not member or current.kind!='table' or current.table_id!=target.table_id
                            or match is None or UUID(payload['match_id'])!=match):
                        continue
                    if payload['type']=='TABLE_CHAT_MESSAGE' and seat is None:
                        continue
                    if payload.get('scope')=='private' and payload['recipient_id']!=stream.actor:
                        continue
                    from app.player_blocks.service import blocked
                    if await blocked(c,stream.actor,payload['sender_id']):
                        continue
                    await require_member(c,target.room_id,payload['sender_id'])
                    sender=await (await c.execute('''SELECT p.seat FROM table_positions p JOIN room_tables t USING(table_id)
                        WHERE p.table_id=%s AND p.user_id=%s AND t.status<>'closed' ''',
                        (target.table_id,user_uuid(payload['sender_id'])))).fetchone()
                    if not sender or sender[0]!=payload['sender_player_id']:
                        continue
                    from app.moderation.policy import require_posting
                    await require_posting(c,payload['sender_id'],text=payload.get('text'),lock=False)
                except QueryAccessDenied:
                    continue
            try:
                async with stream.lock:
                    async with asyncio.timeout(self.gateway.timeout):
                        if self.gateway._streams.get(handle) is stream:
                            await stream.send(dict(type='EPHEMERAL',payload=payload))
            except Exception:
                pass
