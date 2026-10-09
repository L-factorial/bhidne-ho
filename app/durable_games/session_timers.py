"""Fenced, revision-linked session ticks; effects and receipts commit with outbox.

Maintenance only submits trusted durable work. It never mutates an engine or
transfers a seat. Deadlines are checkpointed absolute times and survive restart.
"""
from uuid import UUID, uuid5, NAMESPACE_URL
from psycopg.types.json import Jsonb

from app.multiplayer import table_session as policy
from app.runtime.command_runtime import OutgoingEvent
from .checkpoints import capture_checkpoint, CheckpointError
from .checkpoint_store import user_uuid
from .executor import _DetachedHost, ExecutionResult, GameLaneExecutor
from .inbox import LaneTarget, PostgresInboxStore
from .offer_expiry import COLUMNS, OfferDeadline, SYSTEM_ACTOR
from .outbox import append_lane_events
from .recovery import rebuild_hosted_game
from .seat_offers import now as db_now
from .session_connections import evidence, watchers
from .store import DurableGameConflict
from app.models.action import ReliableActionCommand
from app.runtime.command_runtime import request_fingerprint

COMMANDS = {'accept-live-seat', 'decline-live-seat', 'reclaim-seat', 'pause-seat'}


def identity(table, match, revision):
    return uuid5(NAMESPACE_URL, f'bhidne:session:{UUID(str(table)).hex}:{UUID(str(match)).hex}:{revision}')


def validate_deadline(timer):
    p = timer.payload
    if (not isinstance(p, dict) or set(p) != {'table_id', 'revision'}
        or type(p['revision']) is not int or p['revision'] < 0
        or timer.generation != p['revision'] + 1 or timer.expected_revision is not None
        or timer.action_type != 'table_session' or timer.command != 'session-tick'
        or timer.action_id != identity(p['table_id'], timer.match_id, p['revision'])
        or timer.command_id != 'session_' + timer.action_id.hex):
        raise CheckpointError('Invalid session deadline identity.')


class SessionDispatcher:
    def __init__(self, inbox):
        self.inbox = inbox

    async def due_lanes(self, fence, *, limit=32, after_lane_id=None):
        # Scan bounded pages of every active table: presence transitions may
        # introduce a deadline even when no turn is currently awaited.
        async with self.inbox.pool.connection() as connection:
            rows = await (await connection.execute('''SELECT l.lane_id FROM command_lanes l
                JOIN table_recovery_state r ON r.table_id=l.table_id
                WHERE l.room_id=%s AND l.kind='table' AND r.phase<>'ENDED'
                AND (coalesce(r.state->'data'->'host'->'session', '{}'::jsonb)='{}'::jsonb
                    OR (r.state->'data'->'host'->'session'->>'idle_deadline')::double precision<=extract(epoch FROM clock_timestamp())
                    OR EXISTS(SELECT 1 FROM jsonb_each(r.state->'data'->'host'->'session'->'turns') t
                        WHERE (t.value->>'deadline')::double precision<=extract(epoch FROM clock_timestamp()))
                    OR (r.phase='STARTED' AND EXISTS(SELECT 1 FROM jsonb_each(r.state->'data'->'host'->'session'->'controls') c
                        LEFT JOIN LATERAL (SELECT bool_or(disconnected_at IS NULL AND expires_at>clock_timestamp()) live,
                            max(coalesce(disconnected_at,expires_at)) last_seen FROM game_connection_leases
                            WHERE room_id=l.room_id AND user_id=replace(c.value->>'user_id','user-','')::uuid) p ON true
                        WHERE ((c.value->>'disconnected_at') IS NULL AND p.live=false
                            AND extract(epoch FROM p.last_seen)>=(c.value->>'last_active_at')::double precision)
                        OR ((c.value->>'disconnected_at') IS NOT NULL AND p.live=true)
                        OR ((c.value->>'disconnected_at')::double precision+120<=extract(epoch FROM clock_timestamp()) AND c.value->>'mode'<>'auto')
                        OR ((c.value->'offer'->>'deadline')::double precision<=extract(epoch FROM clock_timestamp())))))
                AND (%s::uuid IS NULL OR l.lane_id>%s) ORDER BY l.lane_id LIMIT %s''',
                (fence.room_id, after_lane_id, after_lane_id, limit))).fetchall()
        return tuple(r[0] for r in rows)

    async def dispatch_one(self, lane_id, fence):
        async with self.inbox.pool.connection() as connection:
            async with connection.transaction():
                target, _, _ = await self.inbox._lane(connection, lane_id)
                await self.inbox.checkpoints._fence(connection, fence, target.room_id)
                await self.inbox._lane(connection, lane_id, lock=True)
                stored = await self.inbox.checkpoints.load_for_update(connection, target.table_id)
                d = stored.checkpoint['data']
                if d['host']['ended']:
                    return None
                now = await db_now(connection)
                host = _DetachedHost(8)
                game = host.game = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot).game
                due = policy.next_due(game)
                changed_presence = False
                if game.game_type == 'callbreak' and not policy.between_games(game):
                    observed = await evidence(connection, game.room_id, now=now)
                    for c in game.session.get('controls', {}).values():
                        value = observed.get(c['user_id'])
                        if value is not None and value is not True and value < c['last_active_at']:
                            value = None
                        if ((value is True and c['disconnected_at'] is not None)
                            or (value is not None and value is not True and c['disconnected_at'] is None)):
                            changed_presence = True
                if game.session and not changed_presence and (due is None or now < due):
                    return None
                token = identity(target.table_id, game.match_id, d['table_revision'])
                command_id = 'session_' + token.hex
                payload = dict(table_id=target.table_id.hex, revision=d['table_revision'])
                existing = await self.inbox._lookup(connection, lane_id, SYSTEM_ACTOR, command_id)
                if existing:
                    return existing if existing.status == 'pending' else None
                await connection.execute('''INSERT INTO scheduled_actions
                    (action_id,lane_id,action_type,generation,due_at,command_id,command,match_id,payload)
                    VALUES(%s,%s,'table_session',%s,to_timestamp(%s),%s,'session-tick',%s,%s)''',
                    (token, lane_id, d['table_revision'] + 1, now, command_id, UUID(game.match_id), Jsonb(payload)))
                request = dict(command_id=command_id, command='session-tick', match_id=game.match_id,
                    expected_revision=None, payload=payload)
                entry = await self.inbox.enqueue_in_transaction(connection, lane_id, SYSTEM_ACTOR, request)
                await connection.execute('''UPDATE scheduled_actions SET status='enqueued',
                    inbox_sequence=%s,finished_at=clock_timestamp() WHERE action_id=%s''', (entry.sequence, token))
                return entry


async def execute_tick(claim, checkpoints, fence, *, max_events=512, round_summary_seconds=8):
    request = claim.entry.request
    row = await (await claim.connection.execute('SELECT ' + COLUMNS + ''' FROM scheduled_actions
        WHERE lane_id=%s AND command_id=%s''', (claim.entry.lane_id, request.command_id))).fetchone()
    timer = OfferDeadline(*row) if row else None
    if not (claim.entry.actor_id == SYSTEM_ACTOR and timer and timer.status == 'enqueued'
        and timer.inbox_sequence == claim.entry.sequence and timer.request() == request.model_dump(mode='json')):
        outcome = dict(command_id=request.command_id, status='rejected', detail='Session ticks require linked scheduled work.')
        await claim.complete(outcome)
        return ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
    validate_deadline(timer)
    stored = await checkpoints.load_for_update(claim.connection, claim.target.table_id)
    d = stored.checkpoint['data']
    revision = d['table_revision']
    events = []
    if UUID(d['match_id']) == timer.match_id and revision == timer.payload['revision'] and not d['host']['ended']:
        if UUID(timer.payload['table_id']) != claim.target.table_id:
            raise CheckpointError('Session timer targets a different table.')
        now = await db_now(claim.connection)
        if now < timer.due_at.timestamp():
            raise DurableGameConflict('Session deadline has not elapsed.')
        host = _DetachedHost(round_summary_seconds)
        game = host.game = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot).game
        # Same order as table actions, before reservations can be released.
        for user in sorted({user_uuid(p['user_id']) for p in d['positions']}):
            await claim.connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user,))
        observed = await evidence(claim.connection, game.room_id, now=now)
        watching = await watchers(claim.connection, game.room_id, claim.target.table_id, now=now)
        members = {f'user-{r[0]}' for r in await (await claim.connection.execute(
            'SELECT user_id FROM room_memberships WHERE room_id=%s', (game.room_id,))).fetchall()}
        candidates = [u for u in game.table.queue if u in members] + [u for u in watching if u not in game.table.queue]
        # Do not offer a seat whose acceptance could never acquire a reservation.
        available = []
        for user in candidates:
            occupied = await (await claim.connection.execute('SELECT 1 FROM active_table_players WHERE user_id=%s', (user_uuid(user),))).fetchone()
            if occupied is None:
                available.append(user)
        events, changed = policy.tick(host, game, now, connections=observed, candidates=available)
        if changed:
            revision += 1
            invitations = [dict(i, status='cancelled') if game.ended and i.get('status') == 'pending' else i for i in d['invitations']]
            for event in game.table.events[game.table.published_sequence:]:
                events.append(OutgoingEvent({'type':'TABLE_EVENT', 'table_id':game.table.table_id, **event}))
            game.table.published_sequence = len(game.table.events)
            candidate = capture_checkpoint(game, table_revision=revision, invitations=invitations)
            receipt = None
            if candidate['data']['engine'] != d['engine']:
                # Journal the trusted timer intention, never impersonate a player.
                # The chosen effect is the immutable committed engine checkpoint.
                automatic = ReliableActionCommand(command_id=request.command_id, command='SESSION_TICK',
                    match_id=game.match_id, expected_revision=d['engine']['revision'],
                    payload=dict(scheduled_action_id=str(timer.action_id), scheduled_request=request.model_dump(mode='json')))
                receipt = dict(actor_id=SYSTEM_ACTOR, request=automatic.model_dump(mode='json'),
                    fingerprint=request_fingerprint(automatic), outcome=dict(command_id=automatic.command_id,
                        status='accepted', revision=candidate['data']['engine']['revision']))
            await checkpoints.save_in_transaction(claim.connection, candidate, expected_revision=d['table_revision'],
                fence=fence, receipt=receipt, receipt_limit=stored.receipt_snapshot['receipt_limit'])
            events.append(OutgoingEvent(dict(type='TABLE_STATE_CHANGED', table_id=game.table.table_id,
                match_id=game.match_id, table_revision=revision)))
            if game.started:
                events.append(OutgoingEvent(dict(type='GAME_STATE_CHANGED', table_id=game.table.table_id,
                    match_id=game.match_id, table_revision=revision, revision=candidate['data']['engine']['revision'])))
                # A table-lane timer has no game_id on its lane target.
                from types import SimpleNamespace
                finalizer_claim = SimpleNamespace(connection=claim.connection, target=SimpleNamespace(game_id=game.durable_game_id))
                await GameLaneExecutor._finalization(None, finalizer_claim, candidate)
            if game.ended:
                from .lobby_events import changed as lobby_changed
                from .table_closure import cancel_pending_actions
                await cancel_pending_actions(claim.connection, game.table.table_id)
                await lobby_changed(claim.connection, claim._store, game.room_id,
                    message=dict(type='TABLE_EXPIRED', room_id=game.room_id, table_id=game.table.table_id,
                        match_id=game.match_id, reason='INACTIVITY', expired_at=now),
                    extra=[i['recipient_id'] for i in d['invitations']])
    outcome = dict(command_id=request.command_id, status='accepted', revision=revision)
    await append_lane_events(claim, events, max_events=max_events)
    await claim.complete(outcome)
    return ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)


async def validate_recovery(connection, tables, lanes, rows):
    by_lane = {l.lane_id:l for l in lanes}
    inbox = PostgresInboxStore(None)
    for row in rows:
        timer = OfferDeadline(*row)
        validate_deadline(timer)
        lane = by_lane[timer.lane_id]
        if lane.kind != 'table' or lane.table_id != UUID(timer.payload['table_id']):
            raise CheckpointError('Session timer has an invalid lane.')
        entry = await inbox._lookup(connection, timer.lane_id, SYSTEM_ACTOR, timer.command_id)
        if (timer.status != 'enqueued' or entry is None or entry.sequence != timer.inbox_sequence
            or entry.request.model_dump(mode='json') != timer.request()):
            raise CheckpointError('Session timer is missing linked inbox work.')


