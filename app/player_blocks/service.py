"""Shared block policy for distributed social effects, reads and account cleanup."""
from uuid import UUID
from psycopg.types.json import Jsonb

from app.durable_games.checkpoint_store import user_uuid
from app.durable_games.queries import QueryAccessDenied


async def policy_read_lock(connection):
    # Social effects hold a shared lock; block/unblock takes the exclusive lock
    # before changing relationships. Gameplay engine commands never acquire this lock.
    await connection.execute('SELECT revision FROM social_policy_revision FOR SHARE')


async def blocked(connection, first, second):
    return (await (await connection.execute('SELECT social_blocked(%s,%s)',
        (user_uuid(first),user_uuid(second)))).fetchone())[0]


async def require_contact(connection, first, second, *, lane=None, sequence=None):
    if lane is None:
        denied = await blocked(connection,first,second)
    else:
        denied = not (await (await connection.execute('''SELECT social_contact_allowed(%s,%s,
            (SELECT created_at FROM command_inbox WHERE lane_id=%s AND sequence=%s))''',
            (user_uuid(first),user_uuid(second),lane,sequence))).fetchone())[0]
    if denied:
        raise QueryAccessDenied('Contact with this player is unavailable.')


async def invitation_allowed(connection, item):
    # Hosted invitations store milliseconds; missing legacy timestamps fail closed
    # for a pair with any block history, while unrelated legacy invites still work.
    return (await (await connection.execute('SELECT social_contact_allowed(%s,%s,to_timestamp(%s::double precision/1000))',
        (user_uuid(item['inviter_id']),user_uuid(item['recipient_id']),item.get('created_at')))).fetchone())[0]


class BlockService:
    def __init__(self,pool):self.pool=pool

    async def list(self, actor, after=None, limit=50):
        uid=user_uuid(actor);boundary=UUID(after) if after else UUID(int=0)
        async with self.pool.connection() as c:
            rows=await (await c.execute('''SELECT b.blocked_id,p.display_name,a.username FROM player_blocks b
                JOIN users u ON u.id=b.blocked_id LEFT JOIN user_profiles p ON p.user_id=u.id
                LEFT JOIN account_credentials a ON a.user_id=u.id
                WHERE b.blocker_id=%s AND b.active AND b.blocked_id>%s AND NOT u.deletion_pending
                ORDER BY b.blocked_id LIMIT %s''',(uid,boundary,limit+1))).fetchall()
        return dict(items=[dict(user_id='user-'+str(r[0]),display_name=r[1] or '',username=r[2]) for r in rows[:limit]],
            next_id=str(rows[limit-1][0]) if len(rows)>limit else None)

    async def set(self, actor, other, active):
        uid,target=user_uuid(actor),user_uuid(other)
        if uid==target:raise ValueError('You cannot block yourself.')
        async with self.pool.connection() as c:
            async with c.transaction():
                await c.execute('SELECT revision FROM social_policy_revision FOR UPDATE')
                users=await (await c.execute('''SELECT id FROM users WHERE id=ANY(%s::uuid[])
                    AND NOT deletion_pending AND NOT erased ORDER BY id FOR SHARE''',([str(uid),str(target)],))).fetchall()
                if len(users)!=2:raise QueryAccessDenied('Player is unavailable.')
                if active:
                    await c.execute('''INSERT INTO player_blocks(blocker_id,blocked_id) VALUES (%s,%s)
                        ON CONFLICT(blocker_id,blocked_id) DO UPDATE SET active=true,
                        blocked_at=CASE WHEN player_blocks.active THEN player_blocks.blocked_at ELSE clock_timestamp() END,
                        updated_at=clock_timestamp()''',(uid,target))
                    low,high=sorted((uid,target))
                    await c.execute('DELETE FROM friendships WHERE user_low=%s AND user_high=%s',(low,high))
                    await c.execute("UPDATE room_invitations SET status='cancelled' WHERE status='pending' AND ((inviter_id=%s AND recipient_id=%s) OR (inviter_id=%s AND recipient_id=%s))",(actor,other,other,actor))
                else:
                    await c.execute('UPDATE player_blocks SET active=false,updated_at=clock_timestamp() WHERE blocker_id=%s AND blocked_id=%s AND active',(uid,target))
                await c.execute('UPDATE social_policy_revision SET revision=revision+1')
        return {'blocked':active}


async def event_allowed(connection, actor, payload, issued_at):
    """Filter social payloads without suppressing game state or command receipts."""
    kind = payload.get('type')
    if kind in ('CHAT_MESSAGE', 'DIRECT_MESSAGE', 'ROOM_POKE', 'TABLE_REACTION'):
        other = payload.get('sender_id')
        return not other or not await blocked(connection, actor, other)
    if kind == 'NOTIFICATION':
        source = payload.get('actor_id')
        return (await (await connection.execute(
            'SELECT social_notification_allowed(%s,%s,%s,%s,%s)',
            (user_uuid(actor), user_uuid(source) if source else None,
             payload.get('kind'), Jsonb(payload.get('payload', {})), issued_at))).fetchone())[0]
    if kind == 'TABLE_INVITATION_CREATED':
        row = await (await connection.execute(
            "SELECT state->'data'->'invitations' FROM table_recovery_state WHERE table_id=%s",
            (UUID(payload['table_id']),))).fetchone()
        item = next((i for i in row[0] if i.get('id') == payload.get('invitation_id') and i.get('recipient_id') == actor), None) if row else None
        return bool(item and item.get('status') == 'pending' and await invitation_allowed(connection, item))
    return True


async def seat_invitation_allowed(connection, lane_id, match_id, offer):
    """Recover manual-offer provenance from durable commands, including pre-A4 offers.

    Automatic FIFO offers are gameplay, not player invitations. Explicit offers
    have a deterministic ID derived from their original command and actor.
    """
    from uuid import NAMESPACE_URL, uuid5
    from app.durable_games.checkpoints import canonical_json
    rows = await (await connection.execute('''SELECT actor_id,command_id,created_at FROM command_inbox
        WHERE lane_id=%s AND command='invite-seat' AND status='accepted' AND match_id=%s
        AND payload->>'recipient'=%s AND payload->>'seat_id'=%s ORDER BY sequence DESC LIMIT 101''',
        (lane_id, UUID(match_id), offer.offered_to_player_id, str(offer.seat_id)))).fetchall()
    for sender, command, issued in rows[:100]:
        identity = uuid5(NAMESPACE_URL, canonical_json(['bhidne-ho:seat-offer:v1',
            str(lane_id), sender, command, match_id, offer.seat_id, offer.offered_to_player_id])).hex
        if identity == offer.offer_id:
            return (await (await connection.execute('SELECT social_contact_allowed(%s,%s,%s)',
                (user_uuid(sender), user_uuid(offer.offered_to_player_id), issued))).fetchone())[0]
    # Bound old provenance reads. A saturated history must not bypass blocking.
    return len(rows) <= 100
