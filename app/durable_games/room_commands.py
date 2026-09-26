"""Fenced room catalog/membership transitions on the room lane.

Roster departure locks bounded table lanes, then tables, then users. Ordinary
gameplay never takes the room lane. Notifications contain committed references;
connection presence is managed separately by the delivery/transport integration.
"""
from dataclasses import replace
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import Field, ValidationError
from app.runtime.command_runtime import OutgoingEvent
from .checkpoints import Record, Identity, canonical_json, capture_checkpoint
from .checkpoint_store import user_uuid
from .executor import ExecutionResult
from .inbox import LaneTarget
from .outbox import append_lane_events
from .recovery import rebuild_hosted_game
from .seat_offers import advance_offers, cancel_expiry
from .store import DurableGameConflict
from .table_closure import close_table, cancel_pending_actions
from .table_executor import _LobbyHost, TableLaneExecutor


class Empty(Record):
    pass


class Visibility(Record):
    visibility: Literal['public', 'private']


class Invite(Record):
    recipients: list[Identity] = Field(min_length=1, max_length=20)


class Answer(Record):
    invitation_id: Identity
    accept: bool


MODELS = {'enter-room': Empty, 'leave-room': Empty, 'delete-room': Empty,
          'room-visibility': Visibility, 'invite-room': Invite, 'answer-room-invitation': Answer}
COMMANDS = frozenset(MODELS)


async def can_enter(connection, room, actor):
    if room[1] == user_uuid(actor) or room[2] == 'public':
        return True
    return bool(await (await connection.execute('''SELECT 1 FROM room_memberships
        WHERE room_id=%s AND user_id=%s UNION ALL SELECT 1 FROM room_invitations
        WHERE room_id=%s AND recipient_id=%s AND status='pending' LIMIT 1''',
        (room[0], user_uuid(actor), room[0], actor))).fetchone())


async def departure(claim, inbox, fence, *, max_tables=5):
    connection, room, actor = claim.connection, claim.target.room_id, claim.entry.actor_id
    rows = await (await connection.execute('''SELECT table_id FROM room_tables
        WHERE room_id=%s AND status<>'closed' ORDER BY table_id LIMIT %s''',
        (room, max_tables + 1))).fetchall()
    if len(rows) > max_tables:
        raise DurableGameConflict('Departure exceeds bounded room inventory.')
    lanes = {}
    for (table,) in rows:
        lanes[table] = await inbox.ensure_lane_in_transaction(connection,
            LaneTarget(kind='table', room_id=room, table_id=table))
        await connection.execute('SELECT lane_id FROM command_lanes WHERE lane_id=%s FOR UPDATE', (lanes[table],))
    records, users = [], {user_uuid(actor)}
    for (table,) in rows:
        saved = await inbox.checkpoints.load_for_update(connection, table)
        host = _LobbyHost(8)
        game = host.game = rebuild_hosted_game(host, saved.checkpoint, receipt_snapshot=saved.receipt_snapshot).game
        if actor in game.table.seats(game) and game.table.phase in ('STARTED', 'LOCKED'):
            return 'Leave the active game or resolve the locked roster before leaving this room.'
        if actor in game.table.seats(game) and game.started:
            round_number = saved.checkpoint['data']['engine']['state']['round_number'] if game.game_type == 'flush' else 0
            intent = await (await connection.execute('''SELECT 1 FROM game_finalization_jobs
                WHERE game_id=%s AND round_number=%s AND job_type='hosted_settlement' ''', (game.durable_game_id, round_number))).fetchone()
            if intent is None or game.pending_flush_departures:
                raise DurableGameConflict('Completed game departure requires reconciled settlement/roster state.')
        users.update(user_uuid(p['user_id']) for p in saved.checkpoint['data']['positions'])
        records.append((table, saved, host, game))
    for user in sorted(users):
        await connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user,))
    for table, saved, host, game in records:
        if actor in game.table.seats(game) and game.table.phase == 'OPEN':
            for candidate in game.table.queue[:game.capacity - len(game.users) + 1]:
                if candidate != actor and await TableLaneExecutor._occupied(connection, candidate, table):
                    return 'A waitlisted player is seated elsewhere; resolve the waitlist before departure.'
    for table, saved, host, game in records:
        affected = actor in game.table.seats(game) or actor in game.table.queue or any(
            o.offered_to_player_id == actor for o in game.table.pending())
        if not affected:
            continue
        # Schedule replacement offers against the table lane, even though this
        # atomic multi-table mutation and its acknowledgement use the room lane.
        table_claim = replace(claim, target=LaneTarget(kind='table', room_id=room, table_id=table),
            entry=replace(claim.entry, lane_id=lanes[table],
                request=claim.entry.request.model_copy(update={'match_id': game.match_id})))
        if actor in game.table.queue:
            game.table.queue.remove(actor)
        for offer in game.table.pending():
            if offer.offered_to_player_id == actor:
                offer.status = 'CANCELLED'
                game.table.emit('SEAT_OFFER_CANCELLED', offer_id=offer.offer_id)
                await cancel_expiry(table_claim, offer)
        detail = TableLaneExecutor._apply(host, game, actor, 'leave-seat')
        if detail:
            # All rejection checks must precede writes across the room.
            raise DurableGameConflict(detail)
        await advance_offers(table_claim, game)
        host._sync_proposal(game)
        invitations = saved.checkpoint['data']['invitations']
        if game.ended:
            invitations = close_table(game, actor, 'room-departure', invitations)
            await cancel_pending_actions(connection, game.table.table_id)
        game.table.sync(game)
        events = [OutgoingEvent({'type': 'TABLE_EVENT', 'table_id': game.table.table_id, **event})
            for event in game.table.events[game.table.published_sequence:]]
        game.table.published_sequence = len(game.table.events)
        revision = saved.checkpoint['data']['table_revision']
        await inbox.checkpoints.save_in_transaction(connection,
            capture_checkpoint(game, table_revision=revision + 1, invitations=invitations),
            expected_revision=revision, fence=fence, receipt_limit=saved.receipt_snapshot['receipt_limit'])
        events.append(OutgoingEvent(dict(type='TABLE_STATE_CHANGED', table_id=game.table.table_id,
            match_id=game.match_id, table_revision=revision + 1)))
        await append_lane_events(claim, events)
    await connection.execute('DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s', (room, user_uuid(actor)))
    await connection.execute("UPDATE room_invitations SET status='declined' WHERE room_id=%s AND recipient_id=%s AND status='pending'", (room, actor))
    return None


async def execute(claim, inbox, fence, *, max_events=512):
    request, actor, connection, room_id = claim.entry.request, claim.entry.actor_id, claim.connection, claim.target.room_id
    detail, payload, actor_id = None, None, None
    try:
        actor_id = user_uuid(actor)
        payload = MODELS[request.command].model_validate_json(canonical_json(request.payload))
        if request.match_id is not None or request.expected_revision is not None:
            detail = 'Room lifecycle commands do not identify a match or table revision.'
    except (ValueError, ValidationError, AttributeError):
        detail = 'Invalid room command.'
    user = await (await connection.execute('SELECT 1 FROM users WHERE id=%s', (actor_id,))).fetchone() if actor_id else None
    if not user:
        actor_id, detail = None, 'An authenticated player is required.'
    room = await (await connection.execute('''SELECT id,creator_id,visibility FROM rooms
        WHERE id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE id=%s)''', (room_id, room_id))).fetchone()
    if room is None:
        detail = 'Room is no longer available.'
    if detail is None:
        command = request.command
        if command in ('delete-room', 'room-visibility', 'invite-room') and room[1] != actor_id:
            detail = 'Only the room owner may perform this command.'
        elif command == 'leave-room' and room[1] == actor_id:
            detail = 'Room owners must delete their room after ending its tables.'
        elif command == 'enter-room':
            if not await can_enter(connection, room, actor):
                detail = 'This room is private. Ask its owner for an invitation.'
            else:
                await connection.execute('INSERT INTO room_memberships(room_id,user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING', (room_id, actor_id))
                await connection.execute("UPDATE room_invitations SET status='accepted' WHERE room_id=%s AND recipient_id=%s AND status='pending'", (room_id, actor))
        elif command == 'leave-room':
            detail = await departure(claim, inbox, fence)
        elif command == 'delete-room':
            active = await (await connection.execute("SELECT 1 FROM room_tables WHERE room_id=%s AND status<>'closed' LIMIT 1", (room_id,))).fetchone()
            if active:
                detail = 'End every active table before deleting the room.'
            else:
                await connection.execute('INSERT INTO deleted_rooms(id) VALUES (%s) ON CONFLICT DO NOTHING', (room_id,))
                await connection.execute('DELETE FROM room_memberships WHERE room_id=%s', (room_id,))
                await connection.execute("UPDATE room_invitations SET status='cancelled' WHERE room_id=%s AND status='pending'", (room_id,))
        elif command == 'room-visibility':
            await connection.execute('UPDATE rooms SET visibility=%s WHERE id=%s', (payload.visibility, room_id))
        elif command == 'invite-room':
            recipients = list(dict.fromkeys(payload.recipients))
            try:
                recipients_ids = [user_uuid(u) for u in recipients]
            except (ValueError, AttributeError):
                recipients_ids, detail = [], 'Invalid invitation recipient.'
            for recipient in recipients_ids:
                if not await (await connection.execute('SELECT 1 FROM users WHERE id=%s', (recipient,))).fetchone():
                    detail = 'Invitation recipient not found.'
            if detail is None:
                for recipient in recipients:
                    pending = await (await connection.execute("SELECT 1 FROM room_invitations WHERE room_id=%s AND recipient_id=%s AND status='pending'", (room_id, recipient))).fetchone()
                    if not pending:
                        identity = uuid5(NAMESPACE_URL, canonical_json(['room-invite', str(claim.entry.lane_id), actor, request.command_id, recipient])).hex
                        await connection.execute('INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id,status) VALUES (%s,%s,%s,%s,\'pending\')', (identity, room_id, actor, recipient))
        elif command == 'answer-room-invitation':
            invitation = await (await connection.execute('''SELECT status FROM room_invitations
                WHERE id=%s AND room_id=%s AND recipient_id=%s FOR UPDATE''', (payload.invitation_id, room_id, actor))).fetchone()
            if invitation is None or invitation[0] != 'pending':
                detail = 'Invitation is no longer available.'
            else:
                if payload.accept:
                    await connection.execute('INSERT INTO room_memberships(room_id,user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING', (room_id, actor_id))
                await connection.execute('UPDATE room_invitations SET status=%s WHERE id=%s', ('accepted' if payload.accept else 'declined', payload.invitation_id))
    outcome = dict(command_id=request.command_id, status='rejected' if detail else 'accepted')
    events = []
    if detail:
        outcome['detail'] = detail
    else:
        events.append(OutgoingEvent(dict(type='ROOM_STATE_CHANGED', room_id=room_id, command=request.command)))
    if actor_id is not None:
        events.append(OutgoingEvent(dict(type='ROOM_COMMAND_ACK', **outcome), actor))
    await append_lane_events(claim, events, max_events=max_events)
    await claim.complete(outcome)
    return ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
