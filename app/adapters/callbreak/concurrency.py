"""Independent hand-review responses are bound to one immutable deal attempt."""
from callbreak import Phase


def hand_review_phase_id(state, match_id):
    deal = state.current_deal
    if state.phase != Phase.HAND_REVIEW or deal is None:
        return None
    return f'{match_id}:{deal.number}:{deal.attempt}:hand-review'


def review_scope_matches(state, match_id, command, player_id):
    phase = hand_review_phase_id(state, match_id)
    return bool(phase and command.command in ('ACCEPT_HAND', 'CLAIM_REDEAL')
                and command.match_id == match_id
                and command.payload.get('hand_review_phase_id') == phase
                and 1 <= command.expected_revision <= state.revision
                and player_id in state.config.players
                and player_id not in state.current_deal.accepted_hands)
