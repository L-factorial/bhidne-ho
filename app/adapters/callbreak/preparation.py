"""Compatibility entry points restricted to the original preparation increment."""

from callbreak import PlayRejection
from .adapter import AdapterResult as PreparationResult, dispatch_control, dispatch_player
from .contracts import CommandName


def dispatch_preparation(state, request, *, match_id, player_id):
    if request.command not in (CommandName.SHUFFLE_DECK, CommandName.CUT_DECK, CommandName.SKIP_CUT):
        return PlayRejection("UNSUPPORTED_COMMAND", "Use dispatch_player for full gameplay.")
    return dispatch_player(state, request, match_id=match_id, player_id=player_id)


def control_preparation(state, command, *, match_id):
    return dispatch_control(state, command, match_id=match_id)
