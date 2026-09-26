"""Friendship transitions ordered with messages on the existing user-pair lane.

Notification intents, relationship effects and the command receipt commit together.
Recipient workers materialize notifications later; Redis is never required for this.
"""
from hashlib import sha256

from pydantic import ValidationError

from app.runtime.command_runtime import OutgoingEvent
from .checkpoint_store import user_uuid
from .checkpoints import Record, canonical_json
from .executor import ExecutionResult
from .outbox import append_lane_events
from .queries import QueryAccessDenied


FRIENDSHIP_COMMANDS = frozenset(('request-friend', 'accept-friend', 'remove-friend'))


class FriendshipPayload(Record):
    """The lane identifies the pair; authentication identifies the acting user."""


async def authorize_friendship(connection, target, actor):
    user = user_uuid(actor)
    if target.kind != 'conversation' or user not in (target.user_low, target.user_high):
        raise QueryAccessDenied('Friendship access requires a participant.')
    rows = await (await connection.execute('SELECT id FROM users WHERE id=ANY(%s::uuid[]) ORDER BY id',
        ([str(target.user_low), str(target.user_high)],))).fetchall()
    if len(rows) != 2:
        raise QueryAccessDenied('Friendship participant is unavailable.')
    return user


async def execute_friendship(claim, inbox, existing):
    from .social import NotificationProducer
    target, request, actor = claim.target, claim.entry.request, claim.entry.actor_id
    connection = claim.connection
    sender, detail, change = None, None, None
    # Only validation/state checks are converted to terminal rejection. Once an
    # effect begins, ANY failure escapes and rolls back the entire claimed command.
    try:
        if request.match_id is not None or request.expected_revision is not None:
            raise QueryAccessDenied('Friendship commands cannot target gameplay.')
        FriendshipPayload.model_validate_json(canonical_json(request.payload))
        sender = await authorize_friendship(connection, target, actor)
        row = await (await connection.execute('''SELECT status,requested_by FROM friendships
            WHERE user_low=%s AND user_high=%s FOR UPDATE''', (target.user_low, target.user_high))).fetchone()
        if request.command == 'request-friend':
            if row is not None:
                raise QueryAccessDenied('A friendship or request already exists.')
            state, requested_by, change = 'pending', sender, 'friend_requested'
        elif request.command == 'accept-friend':
            if row is None or row[0] != 'pending' or row[1] == sender:
                raise QueryAccessDenied('No incoming friend request from this player.')
            state, requested_by, change = 'accepted', row[1], 'friend_accepted'
        elif request.command == 'remove-friend':
            if row is None:
                raise QueryAccessDenied('Friendship or request not found.')
            state, requested_by = 'none', None
            change = ('friend_removed' if row[0] == 'accepted' else
                      'friend_cancelled' if row[1] == sender else 'friend_rejected')
        else:
            raise QueryAccessDenied('Unsupported friendship command.')
    except QueryAccessDenied as error:
        detail = str(error)
    except (ValueError, ValidationError):
        detail = 'Invalid friendship command payload or identity.'

    outcome = dict(command_id=request.command_id, status='rejected' if detail else 'accepted')
    if detail:
        outcome['detail'] = detail
    else:
        pair = (target.user_low, target.user_high)
        if request.command == 'request-friend':
            await connection.execute('''INSERT INTO friendships(user_low,user_high,requested_by,status)
                VALUES (%s,%s,%s,'pending')''', (*pair, sender))
        elif request.command == 'accept-friend':
            await connection.execute('''UPDATE friendships SET status='accepted',updated_at=clock_timestamp()
                WHERE user_low=%s AND user_high=%s''', pair)
        else:
            await connection.execute('DELETE FROM friendships WHERE user_low=%s AND user_high=%s', pair)
        # Both users receive a durable change, including the actor's other devices.
        # Fixed recipient lock order prevents cycles between overlapping pairs.
        producer = NotificationProducer(inbox)
        digest = sha256(canonical_json([actor, request.command_id]).encode()).hexdigest()
        for recipient in pair:
            other = target.user_high if recipient == target.user_low else target.user_low
            await producer.enqueue_in_transaction(connection, f'user-{recipient}',
                key=f'friendship:{claim.entry.lane_id}:{digest}:{recipient}',
                kind='friendship_changed' if recipient == sender else change, actor=actor,
                payload=dict(other_user_id=f'user-{other}', status=state,
                             requested_by=f'user-{requested_by}' if requested_by else None,
                             change=change, command_id=request.command_id))
    if sender in existing:
        await append_lane_events(claim, [OutgoingEvent(dict(type='SOCIAL_COMMAND_ACK', **outcome), actor)])
    await claim.complete(outcome)
    return ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
