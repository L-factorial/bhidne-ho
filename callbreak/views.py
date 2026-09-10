"""Explicit projections. Full state and abandoned hands are never client views."""

from .engine import available_cards
from .game import MatchState, Phase
from .house_rules import redeal_reasons


def _plays(trick):
    return tuple({"player": p.player_id, "card": str(p.card)} for p in trick.plays) if trick else ()


def public_view(state: MatchState) -> dict:
    deal = state.current_deal or (state.completed_deals[-1].deal if state.completed_deals else None)
    if state.preparation:
        deal = None
    policy = state.config.redeal_policy
    return {
        "revision": state.revision, "phase": state.phase.value,
        "players": state.config.players, "deals_per_match": 5,
        "rules": {"ruleset": state.config.ruleset, "undealt_policy": state.config.undealt_policy,
                  "weak_hand_enabled": policy.weak_hand_enabled,
                  "weak_hand_threshold": policy.weak_hand_threshold.name,
                  "no_spades_enabled": policy.no_spades_enabled},
        "current_player": state.current_player, "deal": state.preparation.number if state.preparation else deal.number if deal else 0,
        "attempt": state.preparation.attempt if state.preparation else deal.attempt if deal else 0,
        "dealer": state.preparation.dealer if state.preparation else deal.dealer if deal else state.initial_dealer,
        "bids": tuple(p.bid for p in deal.players) if deal else (),
        "hand_counts": tuple(len(p.hand) for p in deal.players) if deal else (),
        "accepted_hands": deal.accepted_hands if deal else (),
        "current_trick": _plays(deal.current_trick) if deal else (),
        "completed_tricks": len(deal.completed_tricks) if deal else 0,
        "last_trick": _plays(deal.completed_tricks[-1]) if deal and deal.completed_tricks else (),
        "tricks_won": deal.tricks_won if deal else (),
        "scores_tenths": state.score_tenths, "winners": state.winners,
        "scoreboard": tuple({"deal": d.deal.number, "bids": d.result.bids,
                             "tricks_won": d.result.tricks_won, "scores_tenths": d.result.score_tenths}
                            for d in state.completed_deals),
    }


def player_view(state: MatchState, player_id: int) -> dict:
    if type(player_id) is not int or player_id not in state.config.players:
        raise ValueError("Invalid player.")
    view = public_view(state)
    deal = state.current_deal
    # An abandoned hand is cleared as soon as a redeal is claimed.
    hand = deal.players[player_id - 1].hand if deal and state.phase != Phase.AWAITING_REDEAL else ()
    can_review = state.phase == Phase.HAND_REVIEW and player_id not in deal.accepted_hands
    reasons = redeal_reasons(hand, state.config.redeal_policy) if can_review else ()
    view.update(player=player_id, hand=tuple(map(str, hand)),
                legal_cards=tuple(map(str, available_cards(state, player_id))),
                can_accept_hand=can_review, redeal_reasons=reasons)
    return view
