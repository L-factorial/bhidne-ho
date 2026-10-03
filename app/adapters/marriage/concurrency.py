"""Concurrency scope for independent declarations from one immutable deal.

Each Marriage adapter owns exactly one deal. Its persisted match identity thus
identifies the declaration window without new random state or schema changes.
"""
from marriage.turns import tunnela_declarations_pending


def declaration_phase_id(match_id):
    return f'{match_id}:initial-tunnelas'


def declaration_scope_matches(state, match_id, command, player_id=None):
    if (command.command != 'DECLARE_TUNNELAS' or command.match_id != match_id
            or command.payload.get('declaration_phase_id') != declaration_phase_id(match_id)
            or not tunnela_declarations_pending(state)
            or not 1 <= command.expected_revision <= state.revision):
        return False
    return player_id is None or any(
        p.player_id == player_id and not p.folded and not p.tunnela_declared
        for p in state.players)
