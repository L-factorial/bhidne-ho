"""Replacement offers and durable deadlines; dispatch lives in offer_expiry."""
from dataclasses import asdict
from uuid import NAMESPACE_URL, UUID, uuid5

from psycopg.types.json import Jsonb

from app.multiplayer.table import SeatOffer
from .checkpoints import Record, Identity, Positive, canonical_json
from .checkpoint_store import user_uuid


class InviteSeatPayload(Record):
    seat_id: Positive
    recipient: Identity


class ResolveSeatPayload(Record):
    offer_id: Identity


OFFER_COMMANDS = frozenset({'invite-seat', 'accept-seat', 'decline-seat'})


def offer_id(claim, seat, recipient):
    return uuid5(NAMESPACE_URL, canonical_json(['bhidne-ho:seat-offer:v1',
        str(claim.entry.lane_id), claim.entry.actor_id, claim.entry.request.command_id,
        claim.entry.request.match_id, seat, recipient])).hex


def expiry_id(identity):
    return uuid5(NAMESPACE_URL, 'bhidne-ho:seat-offer-expiry:v1:' + identity)


async def now(connection):
    row = await (await connection.execute('SELECT extract(epoch FROM clock_timestamp())')).fetchone()
    return float(row[0])


async def create_offer(claim, game, seat, recipient, observed_at):
    table = game.table
    identity = offer_id(claim, seat, recipient)
    offer = SeatOffer(identity, game.match_id, seat, table.releases[seat], recipient,
                      observed_at, observed_at + table.offer_seconds)
    table.offers[identity] = offer
    table.emit('SEAT_OFFERED', **asdict(offer))
    # Event sequences are monotonic across rematches and uniquely identify each
    # deadline generation on this table lane. Never reset an existing deadline.
    await claim.connection.execute('''INSERT INTO scheduled_actions
        (action_id,lane_id,action_type,generation,due_at,command_id,command,match_id,payload)
        VALUES (%s,%s,'seat_offer_expiry',%s,to_timestamp(%s),%s,'expire-seat-offer',%s,%s)''',
        (expiry_id(identity), claim.entry.lane_id, len(table.events), offer.expires_at,
         'seat_offer_expiry_' + identity, UUID(game.match_id), Jsonb({'offer_id': identity})))


async def cancel_expiry(claim, offer):
    await claim.connection.execute('''UPDATE scheduled_actions
        SET status='cancelled',finished_at=clock_timestamp()
        WHERE action_id=%s AND lane_id=%s AND status='pending' ''',
        (expiry_id(offer.offer_id), claim.entry.lane_id))


async def apply_offer(claim, game, payload, occupied):
    table, actor = game.table, claim.entry.actor_id
    command = claim.entry.request.command
    if game.game_type != 'callbreak' or table.phase != 'COMPLETED':
        return 'Seat replacement requires a completed Call Break match.'
    observed_at = await now(claim.connection)
    if command == 'invite-seat':
        seat, recipient = payload.seat_id, payload.recipient
        host = next((u for u in table.seats(game) if u is not None), None)
        if seat not in table.releases or table.queue or actor not in (host, table.releases[seat]):
            return 'The host or leaving player may invite for a released seat after the queue is empty.'
        pending = table.pending(seat)
        if pending:
            return None if pending[0].offered_to_player_id == recipient else 'A seat offer is already pending.'
        member = await (await claim.connection.execute('''SELECT 1 FROM room_memberships
            WHERE room_id=%s AND user_id=%s FOR KEY SHARE''',
            (game.room_id, user_uuid(recipient)))).fetchone()
        if (not member or recipient == table.releases[seat] or recipient in table.seats(game)
                or any(o.offered_to_player_id == recipient for o in table.pending())):
            return 'Choose an eligible unseated room member without another pending offer.'
        await create_offer(claim, game, seat, recipient, observed_at)
        return None
    offer = table.offers.get(payload.offer_id)
    if not offer or offer.game_id != game.match_id or offer.offered_to_player_id != actor:
        return 'This seat offer does not belong to you.'
    expected = 'ACCEPTED' if command == 'accept-seat' else 'DECLINED'
    if offer.status == expected:
        return None
    if offer.status != 'PENDING' or observed_at >= offer.expires_at:
        return 'This offer is no longer available.'
    if command == 'accept-seat':
        if (actor in table.seats(game) or table.next_seats[offer.seat_id - 1] is not None
                or table.releases.get(offer.seat_id) != offer.leaving_player_id):
            return 'This seat is no longer transferable.'
        if await occupied(claim.connection, actor, claim.target.table_id):
            return 'A player is already seated at another table.'
        table.next_seats[offer.seat_id - 1] = actor
        del table.releases[offer.seat_id]
    if actor in table.queue:
        table.queue.remove(actor)
    offer.status = expected
    table.emit('SEAT_OFFER_' + expected, offer_id=offer.offer_id, seat_id=offer.seat_id,
               leaving_player_id=offer.leaving_player_id, user_id=actor)
    await cancel_expiry(claim, offer)
    return None


async def advance_offers(claim, game):
    table = game.table
    if game.game_type != 'callbreak' or table.phase != 'COMPLETED':
        return
    if claim.entry.request.command == 'leave-queue':
        for offer in table.pending():
            if offer.offered_to_player_id == claim.entry.actor_id:
                offer.status = 'CANCELLED'
                table.emit('SEAT_OFFER_CANCELLED', offer_id=offer.offer_id)
                await cancel_expiry(claim, offer)
    reserved = {o.offered_to_player_id for o in table.pending()}
    observed_at = await now(claim.connection)
    for seat, leaving in sorted(table.releases.items()):
        if table.next_seats[seat - 1] is not None or table.pending(seat):
            continue
        recipient = next((u for u in table.queue
                          if u not in reserved and u != leaving and u not in table.seats(game)), None)
        if recipient:
            await create_offer(claim, game, seat, recipient, observed_at)
            reserved.add(recipient)
