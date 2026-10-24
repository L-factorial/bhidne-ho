"""Narrow concurrency scopes for independent reveals and unchanged bets."""
from flush.enums import GameStatus


def bet_scope_matches(state, match_id, command, player_id):
    """An old bet may cross only other players' card reveals, never a turn."""
    revision = command.expected_revision
    if (command.command != 'BET' or command.match_id != match_id
            or state.status is not GameStatus.IN_PROGRESS
            or player_id != state.current_player_id
            or state.pending_show is not None or state.pending_side_show is not None
            or revision is None or not state.round_start_revision <= revision < state.revision
            or state.revision - revision > len(state.config.player_ids) - 1):
        return False
    events = [event for event in state.history if event.revision > revision]
    # Prove complete revision coverage rather than trusting a client scope or
    # allowing an old command to follow the same player into a later turn.
    return (len(events) == state.revision - revision
            and all(event.revision == revision + offset
                    and event.kind == 'CARDS_SEEN'
                    and event.player_id in state.config.player_ids
                    and event.player_id != player_id
                    for offset, event in enumerate(events, 1)))


def reveal_scope_matches(state, match_id, command, player_id=None):
    return bool(command.command == 'SEE_CARDS' and command.match_id == match_id
                and command.payload.get('round_number') == state.round_number
                and state.status is GameStatus.IN_PROGRESS
                and command.expected_revision is not None and command.expected_revision <= state.revision
                and (player_id is None or player_id in state.config.player_ids))
