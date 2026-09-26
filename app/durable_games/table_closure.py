"""Explicit table closure without advancing or replacing the historical engine."""
from uuid import UUID

from .checkpoint_store import user_uuid
from .store import DurableGameConflict


async def closure_rejection(connection, game, actor, command):
    if command == 'end':
        if not game.users or actor != game.users[0]:
            other = await (await connection.execute('''SELECT 1 FROM room_memberships
                WHERE room_id=%s AND user_id<>%s LIMIT 1''', (game.room_id, user_uuid(actor)))).fetchone()
            if other:
                return 'Only the game creator or the sole person in the room can end the game.'
        if not game.ended and game.finished:
            return 'This game has already finished.'
    else:
        if game.game_type != 'callbreak' or actor not in game.users:
            return 'You are not playing a match that supports abandonment.'
        if not game.ended and (not game.started or game.finished or game.table.phase != 'STARTED'):
            return 'Only an active Call Break match can be abandoned.'
    if not game.ended and game.started and game.flush_open:
        # Ending a completed round must not erase an outstanding settlement.
        intent = await (await connection.execute('''SELECT 1 FROM game_finalization_jobs
            WHERE game_id=%s AND round_number=%s AND job_type='hosted_settlement' ''',
            (game.durable_game_id, game.flush_target.adapter.checkpoint().get_state().round_number))).fetchone()
        if intent is None:
            raise DurableGameConflict('Completed Flush round is missing its finalization intent.')
    return None


def close_table(game, actor, command, invitations):
    if command == 'abandon':
        game.departed.add(actor)
        game.table.emit('PLAYER_LEFT_ACTIVE_MATCH', user_id=actor, match_id=game.match_id,
                        reason='ABANDON_MATCH', penalty_policy='DEFERRED')
    game.ended = True
    game.table.phase = 'ENDED'
    game.table.queue.clear()
    # Preserve engine roster/seat mappings, including pending Flush leavers, as
    # historical data. Ended checkpoints expose no occupied positions.
    game.pending_flush_departures.clear()
    for offer in game.table.pending():
        offer.status = 'CANCELLED'
        game.table.emit('SEAT_OFFER_CANCELLED', offer_id=offer.offer_id)
    game.table.emit('TABLE_ENDED', match_id=game.match_id, user_id=actor, reason=command)
    return [dict(item, status='cancelled') if item.get('status') == 'pending' else dict(item)
            for item in invitations]


async def cancel_pending_actions(connection, table_id):
    # Do not lock game lanes while holding the table row: game executors acquire
    # their lane before the table. Already-enqueued commands keep their receipts
    # and must validate the committed ended state when they execute.
    await connection.execute('''UPDATE scheduled_actions a
        SET status='cancelled',finished_at=clock_timestamp()
        FROM command_lanes l WHERE a.lane_id=l.lane_id AND l.table_id=%s
        AND a.status='pending' ''', (UUID(table_id),))
