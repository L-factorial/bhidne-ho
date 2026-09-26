"""Durable outbox claims and authorized hosted-lane catch-up; no live bindings.

Publication is not delivery acknowledgement. Reads include published/unpublished
rows alike. Authorizations and event pages share one read-only SQL snapshot.
"""
from dataclasses import dataclass
from uuid import UUID, uuid4

from .checkpoint_store import user_uuid
from .inbox import InboxOutcome, LaneTarget
from .queries import QueryAccessDenied, require_member


ACKS = frozenset(('ACTION_ACK', 'TABLE_COMMAND_ACK', 'TABLE_CREATION_ACK', 'ROOM_COMMAND_ACK', 'CHAT_COMMAND_ACK', 'SOCIAL_COMMAND_ACK'))


class DeliveryResetRequired(RuntimeError):
    pass


class UnsupportedDeliveryLane(ValueError):
    pass


@dataclass(frozen=True)
class OutboxClaim:
    event_id: UUID
    lane_id: UUID
    sequence: int
    token: UUID
    attempts: int
    room_id: str | None
    audience_user_id: UUID | None
    kind: str
    user_low: UUID | None = None
    user_high: UUID | None = None
    recipient_id: UUID | None = None


@dataclass(frozen=True)
class DeliveryPage:
    lane_id: UUID
    events: tuple[dict, ...]
    scanned_sequence: int
    has_more: bool


def bound(value, maximum=100):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError('Invalid delivery batch bound.')


def sequence(value):
    if type(value) is not int or not 0 <= value <= 2**63 - 1:
        raise ValueError('Invalid delivery sequence.')


def client_identity(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise ValueError('Invalid authenticated client identity.')


class PostgresDeliveryStore:
    def __init__(self, pool):
        self.pool = pool

    async def claim(self, *, limit=8, lease_seconds=10):
        bound(limit)
        bound(lease_seconds, 120)
        token = uuid4()
        async with self.pool.connection() as connection:
            async with connection.transaction():
                rows = await (await connection.execute('''WITH picked AS (
                    SELECT event_id FROM notification_outbox WHERE published_at IS NULL
                    AND next_attempt_at<=clock_timestamp()
                    AND (claim_expires_at IS NULL OR claim_expires_at<=clock_timestamp())
                    ORDER BY next_attempt_at,event_id LIMIT %s FOR UPDATE SKIP LOCKED
                ), claimed AS (
                    UPDATE notification_outbox o SET claim_token=%s,
                    claim_expires_at=clock_timestamp()+(%s * interval '1 second'),
                    attempts=o.attempts+1 FROM picked p WHERE o.event_id=p.event_id
                    RETURNING o.event_id,o.lane_id,o.sequence,o.claim_token,o.attempts,o.audience_user_id
                ) SELECT c.event_id,c.lane_id,c.sequence,c.claim_token,c.attempts,
                    l.room_id,c.audience_user_id,l.kind,l.user_low,l.user_high,l.recipient_id
                    FROM claimed c JOIN command_lanes l USING(lane_id)''',
                    (limit, token, lease_seconds))).fetchall()
        return tuple(OutboxClaim(*row) for row in rows)

    async def renew(self, claim, *, lease_seconds=10):
        bound(lease_seconds, 120)
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''UPDATE notification_outbox SET
                claim_expires_at=clock_timestamp()+(%s * interval '1 second')
                WHERE event_id=%s AND claim_token=%s AND claim_expires_at>clock_timestamp()
                AND published_at IS NULL RETURNING event_id''',
                (lease_seconds, claim.event_id, claim.token))).fetchone()
        return row is not None

    async def finish(self, claim, *, published, retry_seconds=1):
        if type(published) is not bool:
            raise ValueError('Publication status must be boolean.')
        bound(retry_seconds, 300)
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''UPDATE notification_outbox SET
                published_at=CASE WHEN %s THEN clock_timestamp() ELSE NULL END,
                next_attempt_at=clock_timestamp()+(%s * interval '1 second'),
                last_error=CASE WHEN %s THEN NULL ELSE 'signal_deferred' END,
                claim_token=NULL,claim_expires_at=NULL
                WHERE event_id=%s AND claim_token=%s AND claim_expires_at>clock_timestamp()
                AND published_at IS NULL RETURNING event_id''',
                (published, retry_seconds, published, claim.event_id, claim.token))).fetchone()
        return row is not None

    async def _access(self, connection, lane_id, actor):
        user = user_uuid(actor)
        row = await (await connection.execute('''SELECT kind,room_id,table_id,game_id,
            user_low,user_high,recipient_id,emitted_sequence FROM command_lanes WHERE lane_id=%s''',
            (UUID(str(lane_id)),))).fetchone()
        if row is None:
            raise QueryAccessDenied('Delivery lane is unavailable.')
        target = LaneTarget(**dict(zip(('kind','room_id','table_id','game_id','user_low','user_high','recipient_id'), row[:7])))
        if target.kind in ('conversation', 'recipient'):
            from .social import authorize_social
            try:
                await authorize_social(connection, target, actor)
                allowed = True
            except QueryAccessDenied:
                allowed = False
                if target.kind != 'conversation' or user not in (target.user_low,target.user_high):
                    raise
                submitted = await (await connection.execute('SELECT 1 FROM command_inbox WHERE lane_id=%s AND actor_id=%s LIMIT 1',
                    (lane_id,actor))).fetchone()
                if submitted is None:
                    raise
            return target,row[7],allowed,None,None
        if target.kind in ('room_chat', 'table_chat', 'game_chat'):
            from .chat import authorize_chat
            from .checkpoint_store import PostgresCheckpointStore
            try:
                await authorize_chat(connection, target, actor, checkpoints=PostgresCheckpointStore(self.pool))
                allowed = True
            except QueryAccessDenied:
                allowed = False
                submitted = await (await connection.execute('SELECT 1 FROM command_inbox WHERE lane_id=%s AND actor_id=%s LIMIT 1',
                    (lane_id, actor))).fetchone()
                if submitted is None:
                    raise
            return target, row[7], allowed, None, None
        if target.kind not in ('room', 'table', 'game'):
            raise UnsupportedDeliveryLane('Social lane authorization belongs to increment 6b.')
        try:
            await require_member(connection, target.room_id, actor)
            member = True
        except QueryAccessDenied:
            # Departed actors may still resolve their own command acknowledgements.
            member = False
            submitted = await (await connection.execute('''SELECT 1 FROM command_inbox
                WHERE lane_id=%s AND actor_id=%s LIMIT 1''', (lane_id, actor))).fetchone()
            if submitted is None:
                raise QueryAccessDenied('Delivery access is no longer authorized.')
        seat, match = None, None
        if member and target.table_id is not None:
            state = await (await connection.execute('''SELECT r.match_id,p.seat FROM table_recovery_state r
                LEFT JOIN table_positions p ON p.table_id=r.table_id AND p.user_id=%s
                WHERE r.table_id=%s''', (user, target.table_id))).fetchone()
            if state:
                match, seat = state
        return target, row[7], member, match, seat

    @staticmethod
    def _visible(row, user, target, member, match, seat):
        event_id, seq, kind, version, audience, payload = row
        if audience is not None and audience != user:
            return None
        if kind in ACKS:
            if audience != user:
                return None
            outcome = InboxOutcome.model_validate({k:v for k,v in payload.items() if k != 'type'})
            return dict(type=kind, **outcome.model_dump(mode='json', exclude_none=True))
        if not member:
            return None
        if target.kind in ('conversation', 'recipient'):
            return payload
        if audience is not None and kind not in ('TABLE_INVITATION_CREATED',):
            # Historical private engine messages require a current seat in the same
            # match. Room-level private metadata is denied unless explicitly supported.
            if target.table_id is None or seat is None or match is None:
                return None
            message_match = payload.get('match_id')
            if message_match is None and target.kind == 'game':
                message_match = target.game_id
            try:
                if UUID(str(message_match)) != match:
                    return None
            except (ValueError, TypeError):
                return None
            player = payload.get('payload', {}).get('player_id')
            if player is not None and str(player) != str(seat):
                return None
        return payload

    async def page(self, actor, lane_id, *, after=0, limit=100):
        sequence(after)
        bound(limit)
        lane_id, user = UUID(str(lane_id)), user_uuid(actor)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                target, emitted, member, match, seat = await self._access(connection, lane_id, actor)
                if after > emitted:
                    raise DeliveryResetRequired('Cursor is ahead of the stream.')
                rows = await (await connection.execute('''SELECT event_id,sequence,event_type,event_version,
                    audience_user_id,payload FROM notification_outbox WHERE lane_id=%s AND sequence>%s
                    ORDER BY sequence LIMIT %s''', (lane_id, after, limit + 1))).fetchall()
                events, scanned = [], after
                for row in rows[:limit]:
                    if row[1] != scanned + 1:
                        raise DeliveryResetRequired('Outbox history is incomplete; reconcile an authorized snapshot.')
                    if row[3] != 1:
                        raise DeliveryResetRequired('Unsupported delivery event version.')
                    payload = self._visible(row, user, target, member, match, seat)
                    if payload is not None:
                        events.append(dict(event_id=str(row[0]), lane_id=str(lane_id), sequence=row[1],
                            event_type=row[2], event_version=row[3], payload=payload))
                    scanned = row[1]
                if len(rows) <= limit and scanned < emitted:
                    raise DeliveryResetRequired('Outbox history is unavailable.')
                return DeliveryPage(lane_id, tuple(events), scanned, len(rows) > limit)

    async def presence_room(self, actor, lane_id):
        """Room hint only for current authorized readers, not ACK-only former members."""
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                target, _, allowed, _, _ = await self._access(connection, lane_id, actor)
                return target.room_id if allowed else None

    async def cursor(self, actor, client_id, lane_id):
        client_identity(client_id)
        lane_id = UUID(str(lane_id))
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                await self._access(connection, lane_id, actor)
                row = await (await connection.execute('''SELECT last_sequence FROM delivery_cursors
                    WHERE user_id=%s AND client_id=%s AND lane_id=%s''',
                    (user_uuid(actor), client_id, lane_id))).fetchone()
                return row[0] if row else 0

    async def acknowledge(self, actor, client_id, lane_id, scanned_sequence):
        """Gateway must first prove this cursor was offered on that client stream."""
        client_identity(client_id)
        sequence(scanned_sequence)
        lane_id = UUID(str(lane_id))
        async with self.pool.connection() as connection:
            async with connection.transaction():
                _, emitted, *_ = await self._access(connection, lane_id, actor)
                if scanned_sequence > emitted:
                    raise ValueError('Acknowledgement exceeds emitted stream.')
                row = await (await connection.execute('''INSERT INTO delivery_cursors
                    (user_id,client_id,lane_id,last_sequence) VALUES (%s,%s,%s,%s)
                    ON CONFLICT (user_id,client_id,lane_id) DO UPDATE SET
                    last_sequence=GREATEST(delivery_cursors.last_sequence,EXCLUDED.last_sequence),
                    updated_at=clock_timestamp() RETURNING last_sequence''',
                    (user_uuid(actor), client_id, lane_id, scanned_sequence))).fetchone()
                return row[0]
