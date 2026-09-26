"""Detached active-game departure; the caller commits the ORIGINAL game request.

FOLD_AND_LEAVE uses an engine revision and the game lane. Translating it to an
adapter fold is an implementation detail, never a second request or receipt.
"""
from app.games.base import GameCommandRejected


def fold_and_leave(game, actor, request):
    if game.game_type not in ('marriage', 'flush'):
        raise GameCommandRejected('DEPARTURE_NOT_SUPPORTED', 'Use table abandonment for Call Break.')
    if request.payload:
        raise GameCommandRejected('INVALID_PAYLOAD', 'Fold-and-leave does not accept a payload.')
    target = game.marriage_target or game.flush_target
    state = target.adapter.checkpoint().get_state()
    player = next(p for p in state.players if p.player_id == target.seat_by_user[actor])
    active = not player.folded if game.marriage_target else player.status.value == 'active'
    events = []
    if active:
        # Preserve ID/revision while adapting only the operation. The executor
        # records request, not this derived adapter envelope, in the game journal.
        events = target.apply(actor, request.model_copy(update={
            'command': 'FOLD' if game.marriage_target else 'FOLD_FOR_LEAVE'}))
    if game.marriage_target:
        # Fixed engine seats remain historical, preserving final settlement input.
        game.departed.add(actor)
    else:
        # Even an already-folded Flush player stays reserved until round completion.
        # The executor reconciles all pending leavers if this fold ends the round.
        game.pending_flush_departures.add(actor)
    game.marriage_queries.pop(actor, None)
    game.flush_queries.pop(actor, None)
    game.table.emit('SEAT_RELEASED' if game.marriage_target else 'DEPARTURE_PENDING',
                    user_id=actor, match_id=game.match_id, reason='FOLDED_AND_LEFT')
    return events
