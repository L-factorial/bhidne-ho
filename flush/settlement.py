from dataclasses import replace
from .enums import GameStatus, TerminationReason, TiePolicy
from .models import Payout, RoundSettlement
from .events import ShownHand
from .evaluator import FlushHandEvaluator
from .turns import active_players


def settle(state, requester=None):
    active = active_players(state)
    shown, rank = (), None
    if requester is None:
        winners = (active[0].player_id,)
        reason = TerminationReason.SHOW_FOLD if state.pending_show else TerminationReason.LAST_PLAYER_REMAINING
        if state.pending_show: shown = state.revealed_hands
    else:
        evaluator = FlushHandEvaluator(state.config.rules.sequence_ace_policy)
        ranks = tuple(evaluator.evaluate(p.cards) for p in active)
        rank = max(ranks)
        winners = tuple(p.player_id for p, value in zip(active, ranks) if value == rank)
        if len(winners) > 1 and state.config.rules.tie_policy is TiePolicy.REQUESTER_LOSES:
            winners = tuple(p for p in winners if p != requester)
        shown = tuple(ShownHand(p.player_id, p.cards) for p in active)
        reason = TerminationReason.SHOW
    # Stable clockwise order also determines the recipient of an odd chip.
    ids = state.config.player_ids
    dealer = ids.index(state.config.dealer_id)
    ordered = tuple(ids[(dealer + i) % len(ids)] for i in range(1, len(ids) + 1))
    winners = tuple(p for p in ordered if p in winners)
    share, remainder = divmod(state.pot, len(winners))
    payouts = tuple(Payout(p, share + (i < remainder)) for i, p in enumerate(winners))
    amounts = {p.player_id: p.amount for p in payouts}
    result = RoundSettlement(reason, winners, payouts, shown, rank)
    return replace(state, pending_show=None, revealed_hands=shown, status=GameStatus.FINISHED, current_seat=None, settlement=result,
                   players=tuple(replace(p, chips=p.chips + amounts.get(p.player_id, 0)) for p in state.players))
