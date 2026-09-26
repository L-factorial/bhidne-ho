"""Explicit durable room/table/game chat, independent of gameplay command lanes.

Room ownership fences execution; lane serialization protects ordering/rate limits.
Read authorization shares the query snapshot. Deletion closes normal access; no
purge or application endpoint is installed here.
"""
import asyncio
from uuid import UUID, uuid5, NAMESPACE_URL

from pydantic import ValidationError

from app.models.chat import ChatInput
from app.runtime.command_runtime import OutgoingEvent
from .checkpoint_store import PostgresCheckpointStore, user_uuid
from .checkpoints import canonical_json
from .delivery_store import bound, sequence
from .executor import ExecutionResult
from .ingress import command_status
from .inbox import InboxRequest, LaneTarget, _fingerprint
from .outbox import append_lane_events
from .queries import QueryAccessDenied, require_member, _ProjectionHost
from .recovery import rebuild_hosted_game
from .store import DurableGameConflict


CHAT_KINDS = ('room_chat', 'table_chat', 'game_chat')


async def authorize_chat(connection, target, actor, *, write=False, checkpoints=None, lock=False):
    if target.kind not in CHAT_KINDS:
        raise ValueError('Expected a scoped chat lane.')
    user = user_uuid(actor)
    await require_member(connection, target.room_id, actor)
    if target.kind == 'room_chat':
        # Preserve the existing room chat pause, including the Call Break deal
        # review exception, by using its detached projection policy.
        tables = await (await connection.execute('''SELECT t.table_id FROM room_tables t
            JOIN table_positions p USING(table_id) WHERE t.room_id=%s AND t.status<>'closed'
            AND p.user_id=%s AND p.seat IS NOT NULL LIMIT 2''', (target.room_id, user))).fetchall()
        if len(tables) > 1:
            raise QueryAccessDenied('Chat participation requires reconciliation.')
        if tables:
            if lock:
                await connection.execute('SELECT table_id FROM room_tables WHERE table_id=%s FOR SHARE', (tables[0][0],))
                await require_member(connection, target.room_id, actor)
            saved = await checkpoints.load_in_snapshot(connection, tables[0][0])
            host = _ProjectionHost(None, None)
            game = rebuild_hosted_game(host, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
            host.tables.setdefault(target.room_id, {})[game.match_id] = game
            if host.chat_blocked(target.room_id, actor):
                raise QueryAccessDenied('Room chat is paused during active play.')
        return
    if lock:
        await connection.execute('SELECT table_id FROM room_tables WHERE table_id=%s FOR SHARE', (target.table_id,))
        await require_member(connection, target.room_id, actor)
    row = await (await connection.execute('''SELECT t.status,p.seat,p.queue_position,
        r.state->'data'->'host'->>'durable_game_id' FROM room_tables t
        JOIN table_recovery_state r USING(table_id)
        LEFT JOIN table_positions p ON p.table_id=t.table_id AND p.user_id=%s
        WHERE t.table_id=%s AND t.room_id=%s''', (user, target.table_id, target.room_id))).fetchone()
    if row is None or row[0] == 'closed':
        raise QueryAccessDenied('This table chat is closed.')
    if row[1] is None and (write or target.kind == 'game_chat' or row[2] is None):
        raise QueryAccessDenied('A seat is required; queued users may only read table chat.')
    if target.kind == 'game_chat':
        current = UUID(row[3]) if row[3] else None
        game = await (await connection.execute('''SELECT status,EXISTS(SELECT 1 FROM active_game_players
            WHERE game_id=g.id AND user_id=%s) FROM games g WHERE id=%s AND table_id=%s''',
            (user, target.game_id, target.table_id))).fetchone()
        if current != target.game_id or game is None or game[0] != 'active' or not game[1]:
            raise QueryAccessDenied('This game chat is closed.')


class ChatIngress:
    def __init__(self, inbox, *, wakeup=None):
        self.inbox, self.pool, self.wakeup = inbox, inbox.pool, wakeup
        self.checkpoints = PostgresCheckpointStore(self.pool)

    async def submit(self, actor, target, body):
        user_uuid(actor)
        target = LaneTarget.model_validate(target)
        request = InboxRequest.model_validate_json(canonical_json(body))
        if target.kind not in CHAT_KINDS or request.command != 'send-chat' or request.match_id is not None or request.expected_revision is not None:
            raise ValueError('Chat requires send-chat on an explicit chat target.')
        ChatInput.model_validate(request.payload)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
                lane = await self.inbox.ensure_lane_in_transaction(connection, target)
                previous = await self.inbox._lookup(connection, lane, actor, request.command_id)
                if previous is not None:
                    if previous.fingerprint != _fingerprint(request):
                        raise DurableGameConflict('Command ID already identifies another request.')
                    entry = previous  # Same request remains resolvable after departure/deletion.
                else:
                    await authorize_chat(connection, target, actor, write=True, checkpoints=self.checkpoints)
                    entry = await self.inbox.enqueue_in_transaction(connection, lane, actor, request.model_dump(mode='json'))
        if self.wakeup is not None and entry.status == 'pending':
            try:
                async with asyncio.timeout(1):
                    await self.wakeup(target.room_id, lane)
            except Exception:
                pass
        return command_status(entry)

    async def status(self, actor, lane_id, command_id):
        user_uuid(actor)
        async with self.pool.connection() as connection:
            target, _, _ = await self.inbox._lane(connection, UUID(str(lane_id)))
            if target.kind not in CHAT_KINDS:
                raise ValueError('Expected a chat lane.')
            entry = await self.inbox._lookup(connection, UUID(str(lane_id)), actor, command_id)
            if entry is None:
                raise QueryAccessDenied('Chat receipt is unavailable.')
            return command_status(entry)


class ChatLaneExecutor:
    def __init__(self, inbox):
        self.inbox, self.checkpoints = inbox, PostgresCheckpointStore(inbox.pool)

    async def execute_one(self, lane_id, fence):
        async with self.inbox.claim(lane_id, fence=fence) as claim:
            if claim is None:
                return None
            if claim.target.kind not in CHAT_KINDS:
                raise ValueError('Expected a chat lane.')
            request, actor, target = claim.entry.request, claim.entry.actor_id, claim.target
            user_uuid(actor)
            detail, text = None, None
            try:
                if request.command != 'send-chat' or request.match_id is not None or request.expected_revision is not None:
                    raise QueryAccessDenied('Unsupported chat command.')
                text = ChatInput.model_validate(request.payload).text
                await authorize_chat(claim.connection, target, actor, write=True, checkpoints=self.checkpoints, lock=True)
                recent = await (await claim.connection.execute('''SELECT 1 FROM room_chat_messages
                    WHERE lane_id=%s AND sender_id=%s AND sent_at>clock_timestamp()-interval '1 second'
                    ORDER BY sent_at DESC LIMIT 1''', (lane_id, user_uuid(actor)))).fetchone()
                if recent:
                    detail = 'Wait a moment before sending another message.'
            except QueryAccessDenied as error:
                detail = str(error)
            except ValidationError:
                detail = 'Invalid chat text.'
            sender = await (await claim.connection.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE',
                (user_uuid(actor),))).fetchone()
            if sender is None:
                detail = 'Chat sender is unavailable.'
            outcome = dict(command_id=request.command_id, status='rejected' if detail else 'accepted')
            if detail:
                outcome['detail'] = detail
            outgoing = []
            if detail is None:
                identity = uuid5(NAMESPACE_URL, canonical_json(['chat', str(lane_id), actor, request.command_id]))
                now = (await (await claim.connection.execute('SELECT clock_timestamp()')).fetchone())[0]
                message = dict(type='CHAT_MESSAGE', id=str(identity), scope=target.kind.removesuffix('_chat'),
                    room_id=target.room_id, table_id=str(target.table_id) if target.table_id else None,
                    game_id=str(target.game_id) if target.game_id else None, sender_id=actor,
                    text=text, sent_at=now.isoformat())
                outgoing.append(OutgoingEvent(message))
                # Allocate outbox sequence and write message in this same transaction.
                # The lane lock makes the message's first emitted sequence stable.
                before = (await (await claim.connection.execute('SELECT emitted_sequence FROM command_lanes WHERE lane_id=%s', (lane_id,))).fetchone())[0]
                message['sequence'] = before + 1
                await append_lane_events(claim, outgoing)
                await claim.connection.execute('''INSERT INTO room_chat_messages
                    (id,room_id,table_id,game_id,sender_id,lane_id,sequence,command_id,text,sent_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                    (identity,target.room_id,target.table_id,target.game_id,user_uuid(actor),lane_id,
                     before+1,request.command_id,text,now.isoformat()))
            if sender is not None:
                await append_lane_events(claim, [OutgoingEvent(dict(type='CHAT_COMMAND_ACK', **outcome), actor)])
            await claim.complete(outcome)
            return ExecutionResult(lane_id, claim.entry.sequence, outcome)


class ChatHistory:
    def __init__(self, pool):
        self.pool, self.checkpoints = pool, PostgresCheckpointStore(pool)

    async def page(self, actor, lane_id, *, after=0, limit=100):
        sequence(after)
        bound(limit)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                target, _, _ = await self._target(connection, lane_id)
                await authorize_chat(connection, target, actor, checkpoints=self.checkpoints)
                rows = await (await connection.execute('''SELECT id,sequence,sender_id,text,sent_at FROM room_chat_messages
                    WHERE lane_id=%s AND sequence>%s ORDER BY sequence LIMIT %s''', (lane_id,after,limit+1))).fetchall()
                return dict(items=[dict(id=str(r[0]),sequence=r[1],sender_id=f'user-{r[2]}',text=r[3],sent_at=r[4].isoformat())
                    for r in rows[:limit]], next_sequence=rows[limit-1][1] if len(rows)>limit else None)

    async def _target(self, connection, lane_id):
        from .inbox import PostgresInboxStore
        return await PostgresInboxStore(self.pool)._lane(connection, UUID(str(lane_id)))
