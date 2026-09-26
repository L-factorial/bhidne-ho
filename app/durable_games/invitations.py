"""Hosted invitation eligibility and creation inside the room transaction."""
from uuid import NAMESPACE_URL, uuid5
from .checkpoints import canonical_json
from .checkpoint_store import user_uuid


async def eligibility(connection, room_id, actor, recipients):
    room = await (await connection.execute('SELECT creator_id,visibility FROM rooms WHERE id=%s', (room_id,))).fetchone()
    result = []
    for target in dict.fromkeys(recipients):
        reason = None
        try:
            target_id = user_uuid(target)
        except (ValueError, AttributeError):
            target_id, reason = None, 'Player not found.'
        if reason is None and target == actor:
            reason = 'You cannot invite yourself.'
        if reason is None and not await (await connection.execute('SELECT 1 FROM users WHERE id=%s', (target_id,))).fetchone():
            reason = 'Player not found.'
        if reason is None and room[1] != 'public' and room[0] != user_uuid(actor):
            permitted = await (await connection.execute('''SELECT 1 FROM room_memberships WHERE room_id=%s AND user_id=%s
                UNION ALL SELECT 1 FROM room_invitations WHERE room_id=%s AND recipient_id=%s AND status='pending' LIMIT 1''',
                (room_id, target_id, room_id, target))).fetchone()
            if not permitted:
                reason = 'Ask the room owner to invite this player first.'
        if reason is None and await (await connection.execute('''SELECT 1 FROM active_table_players WHERE user_id=%s
            UNION ALL SELECT 1 FROM active_game_players WHERE user_id=%s LIMIT 1''', (target_id, target_id))).fetchone():
            reason = 'Already seated at another active table.'
        result.append(dict(user_id=target, eligible=reason is None, reason=reason))
    return result


async def reserve_rate(connection, actor, count):
    if not count:
        return None
    user = user_uuid(actor)
    await connection.execute('INSERT INTO hosted_invitation_limits(user_id) VALUES (%s) ON CONFLICT DO NOTHING', (user,))
    await connection.execute('SELECT user_id FROM hosted_invitation_limits WHERE user_id=%s FOR UPDATE', (user,))
    row = await (await connection.execute('''UPDATE hosted_invitation_limits
        SET attempts=ARRAY(SELECT t FROM unnest(attempts) t WHERE t>extract(epoch FROM clock_timestamp())-60)
        WHERE user_id=%s RETURNING cardinality(attempts)''', (user,))).fetchone()
    if row[0] + count > 30:
        return 'Too many invitations. Wait a minute before inviting more players.'
    await connection.execute('''UPDATE hosted_invitation_limits SET attempts=attempts ||
        array_fill(extract(epoch FROM clock_timestamp())::double precision, ARRAY[%s::integer]) WHERE user_id=%s''', (count, user))
    return None


async def create(claim, game, recipients):
    if not recipients:
        return []
    connection, actor = claim.connection, claim.entry.actor_id
    room = await (await connection.execute('SELECT creator_id,visibility FROM rooms WHERE id=%s', (game.room_id,))).fetchone()
    observed = int((await (await connection.execute('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint')).fetchone())[0])
    invitations = []
    for recipient in dict.fromkeys(recipients):
        identity = uuid5(NAMESPACE_URL, canonical_json(['hosted-invite', str(claim.entry.lane_id), actor,
            claim.entry.request.command_id, recipient])).hex
        invitations.append(dict(id=identity, room_id=game.room_id, match_id=game.match_id,
            table_name=game.name, game_type=game.game_type, inviter_id=actor, recipient_id=recipient,
            status='pending', created_at=observed))
        if room[0] == user_uuid(actor) and room[1] != 'public':
            prior = await (await connection.execute("SELECT 1 FROM room_invitations WHERE room_id=%s AND recipient_id=%s AND status='pending'", (game.room_id, recipient))).fetchone()
            if not prior:
                await connection.execute('''INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id,status)
                    VALUES (%s,%s,%s,%s,'pending')''', (identity, game.room_id, actor, recipient))
    return invitations


async def answer(claim, game, invitations, payload):
    actor = claim.entry.actor_id
    item = next((i for i in invitations if i.get('id') == payload.invitation_id and i.get('recipient_id') == actor), None)
    if item is None or item.get('status') != 'pending':
        return 'Table invitation is no longer available.'
    if game.ended:
        return 'This table has ended.'
    if payload.accept:
        from .room_commands import can_enter
        room = await (await claim.connection.execute('''SELECT id,creator_id,visibility FROM rooms
            WHERE id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE id=%s)''', (game.room_id, game.room_id))).fetchone()
        if room is None or not await can_enter(claim.connection, room, actor):
            return 'Room access is no longer available.'
        await claim.connection.execute('INSERT INTO room_memberships(room_id,user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING', (game.room_id, user_uuid(actor)))
        await claim.connection.execute("UPDATE room_invitations SET status='accepted' WHERE room_id=%s AND recipient_id=%s AND status='pending'", (game.room_id, actor))
    item['status'] = 'accepted' if payload.accept else 'declined'
    game.table.emit('TABLE_INVITATION_ANSWERED', invitation_id=payload.invitation_id, status=item['status'])
    return None


def reconcile(game, invitations):
    return [dict(item, status='cancelled' if game.ended else 'accepted')
        if item.get('status') == 'pending' and (game.ended or item.get('recipient_id') in game.table.seats(game)
                                              or item.get('recipient_id') in game.table.queue)
        else dict(item) for item in invitations]
