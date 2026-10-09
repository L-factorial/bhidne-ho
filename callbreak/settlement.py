"""Shared zero-sum projection for local and durable match settlement."""
from .game import Phase
from .match_rules import MatchRules


def settlement_amounts(state, payments):
    if state.phase != Phase.MATCH_COMPLETE:
        raise ValueError('Settlement requires a completed match.')
    rules = state.config.match_rules or MatchRules()
    rules.validate_for(state.config.player_count, payments)
    winners = state.winners
    amounts = [0] * state.config.player_count
    losers = sorted((p for p in state.config.players if p not in winners),
                    key=lambda p: (-state.score_tenths[p - 1], p))
    if state.win_reason == 'instant_bid':
        payment = sum(payments[:state.config.player_count - 1]) // len(losers)
        for player in losers:
            amounts[player - 1] = -payment
        amounts[winners[0] - 1] = payment * len(losers)
        return tuple(amounts)
    # Preserve the established no-payment policy for ambiguous score ties.
    # Perfect-bid co-winners explicitly share the top places instead.
    if state.win_reason == 'score' and len(set(state.score_tenths)) != state.config.player_count:
        return None
    for index, player in enumerate(losers):
        payment = payments[len(winners) - 1 + index]
        tied = [p for p in losers if state.score_tenths[p - 1] == state.score_tenths[player - 1]]
        if len(tied) > 1:
            tied_payments = [payments[len(winners) - 1 + losers.index(p)] for p in tied]
            payment = sum(tied_payments) // len(tied)
        if state.win_reason == 'score':
            if rules.double_win_enabled and state.score_tenths[winners[0] - 1] >= rules.double_win_threshold * state.config.score_scale:
                payment *= rules.winner_multiplier
            if rules.negative_payment_enabled and state.score_tenths[player - 1] < rules.negative_threshold * state.config.score_scale:
                payment *= rules.negative_multiplier
        amounts[player - 1] = -payment
    total = -sum(amounts)
    if total % len(winners):
        raise ValueError('Winner payments do not divide equally.')
    for winner in winners:
        amounts[winner - 1] = total // len(winners)
    return tuple(amounts)
