"""Explicit durable conversation/recipient commands; never mounted public routes.

Any worker may claim a platform lane. PostgreSQL serialization, not room ownership,
orders its commands. Trusted notification producers compose enqueue with their own
business transaction; ordinary actors cannot submit notification creation.
"""
import asyncio
from hashlib import sha256
from uuid import UUID, uuid5, NAMESPACE_URL

from pydantic import Field, JsonValue, ValidationError
from psycopg.types.json import Jsonb

from app.models.chat import ChatInput
from app.runtime.command_runtime import OutgoingEvent
from .checkpoint_store import user_uuid
from .checkpoints import Record, canonical_json
from .executor import ExecutionResult
from .ingress import command_status
from .inbox import InboxRequest, LaneTarget, _fingerprint
from .outbox import append_lane_events
from .queries import QueryAccessDenied
from .store import DurableGameConflict
from .friendship import FRIENDSHIP_COMMANDS, FriendshipPayload, authorize_friendship, execute_friendship


SOCIAL_KINDS = ('conversation', 'recipient')
SYSTEM = 'system:notification'


class NotificationInput(Record):
    key: str = Field(min_length=1, max_length=256)
    kind: str = Field(min_length=1, max_length=128, pattern=r'\S')
    actor_id: UUID | None = None
    payload: dict[str, JsonValue] = Field(default_factory=dict)


class ReadNotifications(Record):
    ids: list[UUID] = Field(min_length=1, max_length=100)


def conversation(actor, other):
    pair = sorted((user_uuid(actor), user_uuid(other)))
    return LaneTarget(kind='conversation', user_low=pair[0], user_high=pair[1])


async def authorize_social(connection, target, actor, *, lock=False):
    user = user_uuid(actor)
    if target.kind == 'recipient':
        if user != target.recipient_id:
            raise QueryAccessDenied('Notifications belong to another recipient.')
        if not await (await connection.execute('SELECT 1 FROM users WHERE id=%s', (user,))).fetchone():
            raise QueryAccessDenied('Recipient is unavailable.')
    elif target.kind == 'conversation':
        if user not in (target.user_low, target.user_high):
            raise QueryAccessDenied('Conversation access is required.')
        row = await (await connection.execute('''SELECT 1 FROM friendships
            WHERE user_low=%s AND user_high=%s AND status='accepted' ''' + ('FOR SHARE' if lock else ''),
            (target.user_low, target.user_high))).fetchone()
        if row is None:
            raise QueryAccessDenied('Only friends can message each other.')
    else:
        raise ValueError('Expected a social lane.')


class SocialIngress:
    def __init__(self, inbox, *, wakeup=None):
        self.inbox, self.pool, self.wakeup = inbox, inbox.pool, wakeup

    async def open_stream(self, actor, target):
        """Authorized bootstrap, including an empty recipient stream at connect."""
        target = LaneTarget.model_validate(target)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await authorize_social(connection,target,actor)
                return await self.inbox.ensure_lane_in_transaction(connection,target)

    async def submit(self, actor, target, body):
        user_uuid(actor)
        target = LaneTarget.model_validate(target)
        request = InboxRequest.model_validate_json(canonical_json(body))
        if request.match_id is not None or request.expected_revision is not None:
            raise ValueError('Social commands have no gameplay revision or match.')
        if target.kind == 'conversation' and request.command == 'send-message':
            ChatInput.model_validate(request.payload)
        elif target.kind == 'conversation' and request.command in FRIENDSHIP_COMMANDS:
            FriendshipPayload.model_validate_json(canonical_json(request.payload))
        elif target.kind == 'recipient' and request.command == 'read-notifications':
            ReadNotifications.model_validate_json(canonical_json(request.payload))
        else:
            raise ValueError('Unsupported public social command.')
        if (target.kind == 'conversation' and user_uuid(actor) not in (target.user_low,target.user_high)
                or target.kind == 'recipient' and user_uuid(actor) != target.recipient_id):
            raise QueryAccessDenied('This stream belongs to another actor.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                friendship = target.kind == 'conversation' and request.command in FRIENDSHIP_COMMANDS
                if friendship:
                    await authorize_friendship(connection, target, actor)
                lane = await self.inbox.ensure_lane_in_transaction(connection, target)
                previous = await self.inbox._lookup(connection, lane, actor, request.command_id)
                if previous:
                    if previous.fingerprint != _fingerprint(request):
                        raise DurableGameConflict('Request ID already identifies different contents.')
                    entry = previous
                else:
                    if not friendship:
                        await authorize_social(connection, target, actor)
                    entry = await self.inbox.enqueue_in_transaction(connection, lane, actor, request.model_dump(mode='json'))
        if self.wakeup and entry.status == 'pending':
            try:
                async with asyncio.timeout(1):
                    await self.wakeup(lane)
            except Exception:
                pass
        return command_status(entry)

    async def status(self, actor, lane, command_id):
        user = user_uuid(actor)
        async with self.pool.connection() as connection:
            target, _, _ = await self.inbox._lane(connection, UUID(str(lane)))
            if (target.kind not in SOCIAL_KINDS or target.kind == 'recipient' and target.recipient_id != user
                    or target.kind == 'conversation' and user not in (target.user_low,target.user_high)):
                raise QueryAccessDenied('Receipt is unavailable.')
            entry = await self.inbox._lookup(connection, UUID(str(lane)), actor, command_id)
            if entry is None:
                raise QueryAccessDenied('Receipt is unavailable.')
            return command_status(entry)


class NotificationProducer:
    def __init__(self, inbox):
        self.inbox = inbox

    async def enqueue_in_transaction(self, connection, recipient, *, key, kind, payload=None, actor=None):
        """Trusted service API only; never derive this authority from client JSON."""
        recipient = user_uuid(recipient)
        data = NotificationInput.model_validate(dict(key=key, kind=kind, payload=payload or {},
                                                    actor_id=user_uuid(actor) if actor else None))
        if len(canonical_json(data.model_dump(mode='json')).encode()) > 8192:
            raise ValueError('Notification payload exceeds the byte limit.')
        lane = await self.inbox.ensure_lane_in_transaction(connection, LaneTarget(kind='recipient', recipient_id=recipient))
        command_id = sha256(key.encode()).hexdigest()
        return await self.inbox.enqueue_in_transaction(connection, lane, SYSTEM,
            dict(command_id=command_id, command='create-notification', payload=data.model_dump(mode='json')))


class SocialLaneExecutor:
    def __init__(self, inbox):
        self.inbox = inbox

    async def execute_one(self, lane_id):
        async with self.inbox.claim(lane_id) as claim:
            if claim is None:
                return None
            target, request, actor = claim.target, claim.entry.request, claim.entry.actor_id
            if target.kind not in SOCIAL_KINDS:
                raise ValueError('Expected a platform social lane.')
            detail, sender, output = None, None, []
            # Lock existing user identities in a stable order before social row
            # checks; prevent deletion between authorization and FK writes.
            ids = [target.recipient_id] if target.kind == 'recipient' else [target.user_low,target.user_high]
            people = await (await claim.connection.execute('SELECT id FROM users WHERE id=ANY(%s::uuid[]) ORDER BY id FOR KEY SHARE',
                ([str(u) for u in ids],))).fetchall()
            existing = {r[0] for r in people}
            if target.kind == 'conversation' and request.command in FRIENDSHIP_COMMANDS:
                return await execute_friendship(claim, self.inbox, existing)
            try:
                if request.match_id is not None or request.expected_revision is not None:
                    raise QueryAccessDenied('Social commands cannot target gameplay.')
                if actor != SYSTEM:
                    sender = user_uuid(actor)
                    await authorize_social(claim.connection, target, actor, lock=True)
                if target.kind == 'conversation' and request.command == 'send-message' and actor != SYSTEM:
                    text = ChatInput.model_validate(request.payload).text
                    recent = await (await claim.connection.execute('''SELECT 1 FROM direct_messages
                        WHERE lane_id=%s AND sender_id=%s AND sent_at>clock_timestamp()-interval '1 second'
                        ORDER BY sent_at DESC LIMIT 1''', (lane_id,sender))).fetchone()
                    if recent:
                        raise QueryAccessDenied('Wait a moment before sending another message.')
                    other = target.user_high if sender == target.user_low else target.user_low
                    identity = uuid5(NAMESPACE_URL, canonical_json(['dm',str(lane_id),actor,request.command_id]))
                    now = (await (await claim.connection.execute('SELECT clock_timestamp()')).fetchone())[0]
                    seq = await self._next(claim)
                    message = dict(type='DIRECT_MESSAGE',id=str(identity),sender_id=actor,recipient_id=f'user-{other}',
                                   text=text,sent_at=now.isoformat(),sequence=seq)
                    await append_lane_events(claim, [OutgoingEvent(message)])
                    await claim.connection.execute('''INSERT INTO direct_messages
                        (id,sender_id,recipient_id,text,sent_at,lane_id,sequence,command_id)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                        (identity,sender,other,text,now.isoformat(),lane_id,seq,request.command_id))
                elif target.kind == 'recipient' and request.command == 'create-notification' and actor == SYSTEM:
                    data = NotificationInput.model_validate_json(canonical_json(request.payload))
                    if len(canonical_json(request.payload).encode()) > 8192 or target.recipient_id not in existing:
                        raise QueryAccessDenied('Notification recipient or payload is unavailable.')
                    # Actor metadata is optional; deletion must not erase a system
                    # notification or give its producer private-game read access.
                    origin = None
                    if data.actor_id is not None:
                        found = await (await claim.connection.execute('SELECT id FROM users WHERE id=%s', (data.actor_id,))).fetchone()
                        origin = found[0] if found else None
                    identity = uuid5(NAMESPACE_URL, canonical_json(['notification',str(target.recipient_id),data.key]))
                    seq = await self._next(claim)
                    now = (await (await claim.connection.execute('SELECT clock_timestamp()')).fetchone())[0]
                    message = dict(type='NOTIFICATION',id=str(identity),kind=data.kind,actor_id=f'user-{origin}' if origin else None,
                        payload=data.payload,created_at=now.isoformat(),sequence=seq)
                    await append_lane_events(claim, [OutgoingEvent(message, f'user-{target.recipient_id}')])
                    await claim.connection.execute('''INSERT INTO friend_notifications
                        (id,user_id,source_actor_id,kind,payload,created_at,lane_id,sequence,deduplication_key)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                        (identity,target.recipient_id,origin,data.kind,Jsonb(data.payload),now.isoformat(),lane_id,seq,data.key))
                elif target.kind == 'recipient' and request.command == 'read-notifications' and actor != SYSTEM:
                    data = ReadNotifications.model_validate_json(canonical_json(request.payload))
                    wanted = sorted(set(data.ids))
                    rows = await (await claim.connection.execute('''SELECT id FROM friend_notifications
                        WHERE user_id=%s AND id=ANY(%s::uuid[]) ORDER BY id FOR UPDATE''',
                        (sender,[str(i) for i in wanted]))).fetchall()
                    if len(rows) != len(wanted):
                        raise QueryAccessDenied('One or more notifications are unavailable.')
                    await claim.connection.execute('''UPDATE friend_notifications SET read_at=COALESCE(read_at,clock_timestamp())
                        WHERE user_id=%s AND id=ANY(%s::uuid[])''', (sender,[str(i) for i in wanted]))
                    output.append(OutgoingEvent(dict(type='NOTIFICATIONS_READ',ids=[str(i) for i in wanted]), actor))
                else:
                    raise QueryAccessDenied('Unsupported social command or producer.')
            except QueryAccessDenied as error:
                detail = str(error)
            except (ValidationError, ValueError):
                detail = 'Invalid social command payload or identity.'
            outcome = dict(command_id=request.command_id,status='rejected' if detail else 'accepted')
            if detail:
                outcome['detail'] = detail
            if sender in existing:
                output.append(OutgoingEvent(dict(type='SOCIAL_COMMAND_ACK',**outcome),actor))
            await append_lane_events(claim, output)
            await claim.complete(outcome)
            return ExecutionResult(lane_id,claim.entry.sequence,outcome)

    @staticmethod
    async def _next(claim):
        return (await (await claim.connection.execute('SELECT emitted_sequence FROM command_lanes WHERE lane_id=%s',
            (claim.entry.lane_id,))).fetchone())[0] + 1
