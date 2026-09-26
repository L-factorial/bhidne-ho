"""Explicit fenced offer deadline dispatch/execution. No polling or startup task."""
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.runtime.command_runtime import OutgoingEvent
from .checkpoint_store import user_uuid
from .checkpoints import CheckpointError, capture_checkpoint
from .executor import ExecutionResult, _DetachedHost
from .inbox import PostgresInboxStore
from .outbox import append_lane_events
from .recovery import rebuild_hosted_game
from .seat_offers import advance_offers, expiry_id, now
from .store import DurableGameConflict

SYSTEM_ACTOR = 'system:timer'
COLUMNS = 'action_id,lane_id,action_type,generation,due_at,command_id,command,match_id,expected_revision,payload,status,inbox_sequence'


@dataclass(frozen=True)
class OfferDeadline:
    action_id: UUID
    lane_id: UUID
    action_type: str
    generation: int
    due_at: datetime
    command_id: str
    command: str
    match_id: UUID
    expected_revision: int | None
    payload: dict
    status: str
    inbox_sequence: int | None

    def request(self):
        return dict(command_id=self.command_id, command=self.command, match_id=self.match_id.hex,
                    expected_revision=None, payload=self.payload)


def validate_deadline(timer, data=None):
    payload = timer.payload
    if not isinstance(payload, dict) or set(payload) != {'offer_id'}:
        raise CheckpointError('Invalid offer deadline payload.')
    identity = payload['offer_id']
    if (not isinstance(identity, str) or UUID(identity).hex != identity
            or timer.action_id != expiry_id(identity) or timer.action_type != 'seat_offer_expiry'
            or timer.command_id != 'seat_offer_expiry_' + identity or timer.command != 'expire-seat-offer'
            or timer.match_id is None or timer.expected_revision is not None or timer.generation < 1):
        raise CheckpointError('Invalid offer deadline identity.')
    if data is None:
        return
    offer = next((o for o in data['table']['offers'] if o['offer_id'] == identity), None)
    if (offer is None or UUID(offer['game_id']) != timer.match_id
            or abs(timer.due_at.timestamp() - offer['expires_at']) > 0.000002):
        raise CheckpointError('Offer deadline disagrees with checkpoint.')
    events = data['table']['events']
    if (timer.generation > len(events) or events[timer.generation-1]['event'] != 'SEAT_OFFERED'
            or events[timer.generation-1]['payload'] != offer | {'status': 'PENDING'}):
        raise CheckpointError('Offer deadline generation disagrees with creation event.')


class OfferExpiryDispatcher:
    def __init__(self, inbox):
        self.inbox = inbox

    async def dispatch_one(self, lane_id, fence):
        async with self.inbox.pool.connection() as connection:
            async with connection.transaction():
                target, _, _ = await self.inbox._lane(connection, lane_id)
                if target.kind != 'table':
                    raise DurableGameConflict('Offer deadlines require a table lane.')
                await self.inbox.checkpoints._fence(connection, fence, target.room_id)
                # Same order as lifecycle execution: fence -> lane -> timer.
                # Never hold a timer lock while waiting for its lane.
                if await self.inbox._lane(connection, lane_id, lock=True) is None:
                    return None
                row = await (await connection.execute('SELECT ' + COLUMNS + ''' FROM scheduled_actions
                    WHERE lane_id=%s AND action_type='seat_offer_expiry' AND status='pending'
                    AND due_at<=clock_timestamp() ORDER BY due_at,action_id LIMIT 1 FOR UPDATE''',
                    (lane_id,))).fetchone()
                if row is None:
                    return None
                timer = OfferDeadline(*row)
                validate_deadline(timer)
                entry = await self.inbox.enqueue_in_transaction(connection, lane_id, SYSTEM_ACTOR, timer.request())
                if entry.duplicate:
                    raise DurableGameConflict('Pending deadline already has inbox work without dispatch linkage.')
                await connection.execute('''UPDATE scheduled_actions SET status='enqueued',
                    inbox_sequence=%s,finished_at=clock_timestamp() WHERE action_id=%s''',
                    (entry.sequence, timer.action_id))
                await self.inbox.checkpoints._fence(connection, fence, target.room_id)
                return entry

    async def due_lanes(self, fence, *, limit=100, after_lane_id=None):
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise ValueError('Dispatch limit must be between 1 and 1000.')
        async with self.inbox.pool.connection() as connection:
            rows = await (await connection.execute('''SELECT a.lane_id FROM scheduled_actions a
                JOIN command_lanes l USING(lane_id) WHERE l.room_id=%s AND l.kind='table'
                AND a.action_type='seat_offer_expiry' AND a.status='pending' AND a.due_at<=clock_timestamp()
                AND (%s::uuid IS NULL OR a.lane_id>%s)
                GROUP BY a.lane_id ORDER BY ''' + ('a.lane_id' if after_lane_id is not None else 'min(a.due_at),a.lane_id')
                + ' LIMIT %s', (fence.room_id, after_lane_id, after_lane_id, limit))).fetchall()
        return tuple(row[0] for row in rows)

    async def dispatch_due(self, fence, *, limit=100):
        result = []
        for lane_id in await self.due_lanes(fence, limit=limit):
            entry = await self.dispatch_one(lane_id, fence)
            if entry is not None:
                result.append(entry)
        return tuple(result)


async def execute_expiry(claim, checkpoints, fence, *, max_events=512):
    request = claim.entry.request
    row = await (await claim.connection.execute('SELECT ' + COLUMNS + ''' FROM scheduled_actions
        WHERE lane_id=%s AND command_id=%s''', (claim.entry.lane_id, request.command_id))).fetchone()
    timer = OfferDeadline(*row) if row else None
    authorized = (claim.entry.actor_id == SYSTEM_ACTOR and timer is not None
                  and timer.status == 'enqueued' and timer.inbox_sequence == claim.entry.sequence
                  and timer.request() == request.model_dump(mode='json'))
    if not authorized:
        outcome = dict(command_id=request.command_id, status='rejected', detail='Expiry requires linked scheduled work.')
        await claim.complete(outcome)
        return ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
    validate_deadline(timer)
    if timer.due_at.timestamp() > await now(claim.connection):
        raise DurableGameConflict('Offer deadline has not elapsed.')
    stored = await checkpoints.load_for_update(claim.connection, claim.target.table_id)
    data = stored.checkpoint['data']
    revision = data['table_revision']
    events = []
    if UUID(data['match_id']) == timer.match_id:
        validate_deadline(timer, data)
        host = _DetachedHost(8)
        game = host.game = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot).game
        offer = game.table.offers[timer.payload['offer_id']]
        if offer.status == 'PENDING':
            if game.ended or game.game_type != 'callbreak' or game.table.phase != 'COMPLETED':
                raise CheckpointError('Pending offer is outside a completed Call Break roster.')
            intent = await (await claim.connection.execute('''SELECT 1 FROM game_finalization_jobs
                WHERE game_id=%s AND round_number=0 AND job_type='hosted_settlement' ''',
                (game.durable_game_id,))).fetchone()
            if intent is None:
                raise DurableGameConflict('Completed match is missing its finalization intent.')
            for user in sorted(user_uuid(p['user_id']) for p in data['positions']):
                await claim.connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user,))
            offer.status = 'EXPIRED'
            if offer.offered_to_player_id in game.table.queue:
                game.table.queue.remove(offer.offered_to_player_id)
            game.table.emit('SEAT_OFFER_EXPIRED', offer_id=offer.offer_id)
            await advance_offers(claim, game)
            events.extend(OutgoingEvent({'type': 'TABLE_EVENT', 'table_id': game.table.table_id, **event})
                          for event in game.table.events[game.table.published_sequence:])
            game.table.published_sequence = len(game.table.events)
            revision += 1
            await checkpoints.save_in_transaction(claim.connection,
                capture_checkpoint(game, table_revision=revision, invitations=data['invitations']),
                expected_revision=data['table_revision'], fence=fence,
                receipt_limit=stored.receipt_snapshot['receipt_limit'])
            events.append(OutgoingEvent({'type': 'TABLE_STATE_CHANGED', 'table_id': game.table.table_id,
                                        'match_id': game.match_id, 'table_revision': revision}))
    outcome = dict(command_id=request.command_id, status='accepted', revision=revision)
    await append_lane_events(claim, events, max_events=max_events)
    await claim.complete(outcome)
    return ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)


async def validate_recovery(connection, tables, lanes, rows):
    """Cross-check both pending deadlines and deadlines already dispatched to inbox."""
    by_table = {t.table_id: t.stored.checkpoint['data'] for t in tables}
    by_lane = {lane.lane_id: lane for lane in lanes}
    inbox = PostgresInboxStore(None)
    covered = set()
    for row in rows:
        timer = OfferDeadline(*row)
        validate_deadline(timer)
        lane = by_lane[timer.lane_id]
        if lane.kind != 'table':
            raise CheckpointError('Offer deadline belongs to a non-table lane.')
        data = by_table[lane.table_id]
        current = UUID(data['match_id']) == timer.match_id
        offer = None
        if current:
            validate_deadline(timer, data)
            offer = next(o for o in data['table']['offers'] if o['offer_id'] == timer.payload['offer_id'])
        if timer.status == 'pending':
            if not current or offer['status'] != 'PENDING':
                raise CheckpointError('Pending deadline has no current pending offer.')
        elif timer.status == 'enqueued':
            try:
                entry = await inbox._lookup(connection, timer.lane_id, SYSTEM_ACTOR, timer.command_id)
            except DurableGameConflict as error:
                raise CheckpointError('Dispatched offer inbox data is inconsistent.') from error
            if (entry is None or entry.sequence != timer.inbox_sequence
                    or entry.request.model_dump(mode='json') != timer.request()
                    or (offer and offer['status'] == 'PENDING' and entry.status != 'pending')):
                raise CheckpointError('Dispatched offer deadline has no matching inbox work.')
        if offer and offer['status'] == 'PENDING':
            if (data['host']['ended'] or data['game_type'] != 'callbreak' or data['phase'] != 'COMPLETED'
                    or data['table']['releases'].get(str(offer['seat_id'])) != offer['leaving_player_id']
                    or any(p['seat'] == offer['seat_id'] for p in data['positions'])):
                raise CheckpointError('Pending offer has no matching replacement vacancy.')
            covered.add((lane.table_id, offer['offer_id']))
    for table_id, data in by_table.items():
        pending = [o for o in data['table']['offers'] if o['status'] == 'PENDING']
        if (len({o['seat_id'] for o in pending}) != len(pending)
                or len({o['offered_to_player_id'] for o in pending}) != len(pending)):
            raise CheckpointError('Pending offers conflict on seats or recipients.')
        for offer in pending:
            if (table_id, offer['offer_id']) not in covered:
                raise CheckpointError('Pending offer is missing its durable deadline.')
