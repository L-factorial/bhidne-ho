"""Turn-bound reveals require the current revision and dealt round."""
from flush.enums import GameStatus


def reveal_scope_matches(state, match_id, command, player_id=None):
    return bool(command.command == 'SEE_CARDS' and command.match_id == match_id
                and command.payload.get('round_number') == state.round_number
                and state.status is GameStatus.IN_PROGRESS
                and command.expected_revision is not None and command.expected_revision <= state.revision
                and (player_id is None or player_id in state.config.player_ids))
