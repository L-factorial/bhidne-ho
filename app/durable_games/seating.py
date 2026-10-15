"""Physical seating and soft invitations, serialized on the durable table lane.

Physical positions never renumber engine players or transfer historical hands.
Invitation acceptance is access acknowledgement; join-seat claims a position.
"""
from pydantic import Field, ValidationError
from .checkpoints import Record, Identity, Positive
from . import invitations as hosted_invitations


class InvitePosition(Record):
    position_id: Positive
    recipient: Identity


class MovePlayer(Record):
    position_id: Positive
    user_id: Identity
    source_position: Positive
    target_user: Identity | None


def editable(game):
    return not game.ended and (not game.started or game.finished or game.flush_open)


def creator(game):
    return next((u for u in game.table.seats(game) if u is not None), None)


def reservations(invitations):
    return [i for i in invitations if i.get('status') in ('pending', 'accepted') and i.get('reserved_position')]


async def apply_seating(claim, game, invitations):
    actor, command = claim.entry.actor_id, claim.entry.request.command
    if not editable(game) or actor != creator(game):
        return 'Only the game creator can arrange seats between games.', []
    try:
        model = InvitePosition if command == 'invite-position' else MovePlayer
        body = model.model_validate(claim.entry.request.payload)
    except ValidationError:
        return 'Invalid seating request.', []
    if body.position_id > game.capacity:
        return 'Choose an existing table seat.', []
    game.table.ensure_positions(game)
    placements = game.table.seat_positions
    occupant = next((u for u, p in placements.items() if p == body.position_id), None)
    if command == 'move-player':
        return move_position(game, body, invitations), []
    if occupant:
        return 'That seat was just taken.', []
    if body.recipient in placements:
        return 'That player is already seated.', []
    existing = next((i for i in invitations if i['recipient_id'] == body.recipient and i['status'] in ('pending', 'accepted')), None)
    # General and specific invitations share one identity, avoiding duplicate delivery.
    if existing:
        eligible = await hosted_invitations.eligibility(claim.connection, game.room_id, actor, [body.recipient], lane=claim.entry.lane_id, sequence=claim.entry.sequence)
        if not eligible[0]['eligible']:
            return eligible[0]['reason'], []
        created = []
    else:
        detail, created = await hosted_invitations.send(claim, game, invitations,
            hosted_invitations.InviteTablePayload(recipients=[body.recipient]))
        if detail:
            return detail, []
        existing = next((i for i in invitations if i['recipient_id'] == body.recipient and i['status'] == 'pending'), None)
        if not existing:
            return 'This player cannot be invited.', []
    for invitation in reservations(invitations):
        if invitation['reserved_position'] == body.position_id or invitation['recipient_id'] == body.recipient:
            invitation['reserved_position'] = None
    existing['reserved_position'] = body.position_id
    existing['reservation_sequence'] = claim.entry.sequence
    game.table.emit('SEAT_INVITED', position_id=body.position_id, recipient=body.recipient)
    return None, created


def join_position(host, game, actor, invitations):
    table = game.table
    if actor in table.seats(game):
        return None
    if not editable(game) or table.phase not in ('OPEN', 'COMPLETED'):
        return 'The roster is locked.'
    table.ensure_positions(game)
    allocation = allocate_position(game, actor, invitations)
    if allocation is None:
        return 'The table is full. Join the waitlist.'
    position, pending = allocation
    # FIFO reserves only the vacancies needed by queued players. Other joins may
    # fill spare vacancies without taking an earlier waiter's position.
    if table.phase == 'OPEN' and table.queue:
        remaining = [p for p in range(1,game.capacity+1) if p not in table.seat_positions.values()]
        queued = {}
        for user in table.queue[:len(remaining)]:
            preferred = pick_position(remaining, user, invitations)
            queued[user] = preferred
            remaining.remove(preferred)
        if actor in table.queue:
            if actor not in queued:
                return 'A waitlisted player has priority for this seat.'
            position = queued[actor]
        else:
            if not remaining:
                return 'A waitlisted player has priority for this seat.'
            position = pick_position(remaining, actor, invitations)
    if table.phase == 'COMPLETED' and table.queue and actor != table.queue[0]:
        return 'A waitlisted player has priority for this seat.'
    if table.phase == 'COMPLETED':
        if table.pending():
            return 'A replacement offer is pending. Join the waitlist.'
        empty = next((i for i,u in enumerate(table.next_seats) if u is None), None)
        if empty is None:
            return 'The table is full. Join the waitlist.'
        table.next_seats[empty] = actor
        table.releases.pop(empty+1, None)
        if actor in table.queue:
            table.queue.remove(actor)
    else:
        host._seat_user(game, actor, position=position)
    table.seat_positions[actor] = position
    for invitation in pending:
        if invitation['reserved_position'] == position:
            invitation['reserved_position'] = None
    table.emit('SEAT_JOINED', user_id=actor, position_id=position)
    return None


def clockwise_roster(game, users):
    game.table.ensure_positions(game)
    users = list(users)
    if not users:
        return users
    anchor = game.table.seat_positions[users[0]]
    return sorted(users, key=lambda u:(game.table.seat_positions[u]-anchor)%game.capacity)


def move_position(game, body, invitations):
    placements = game.table.seat_positions
    occupant = next((u for u,p in placements.items() if p == body.position_id), None)
    if body.user_id not in placements:
        return 'That player has left the table.'
    if placements[body.user_id] != body.source_position or occupant != body.target_user:
        return 'The table changed. Refresh and try again.'
    previous = placements[body.user_id]
    if occupant == body.user_id:
        return None
    placements[body.user_id] = body.position_id

    if occupant:
        placements[occupant] = previous
    for invitation in reservations(invitations):
        if invitation['reserved_position'] == body.position_id:
            invitation['reserved_position'] = None
    if game.table.phase == 'LOCKED':
        game.table.phase = 'OPEN'
    game.table.emit('SEATS_MOVED', user_id=body.user_id, position_id=body.position_id,
                    previous_position=previous, swapped_user_id=occupant)
    return None


def allocate_position(game, actor, invitations):
    table = game.table
    table.ensure_positions(game)
    free = [p for p in range(1,game.capacity+1) if p not in table.seat_positions.values()]
    if not free:
        return None
    pending = [i for i in reservations(invitations) if i['reserved_position'] in free]
    return pick_position(free, actor, invitations), pending


def pick_position(free, actor, invitations):
    pending = [i for i in reservations(invitations) if i['reserved_position'] in free]
    own = next((i for i in pending if i['recipient_id'] == actor), None)
    unreserved = [p for p in free if not any(i['reserved_position'] == p for i in pending)]
    return own['reserved_position'] if own else unreserved[0] if unreserved else min(pending,key=lambda i:(i.get('reservation_sequence',0),i['reserved_position']))['reserved_position']
