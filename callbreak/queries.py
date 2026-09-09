"""Read-only, JSON-ready queries over one immutable match revision.

Create a fresh GameQuery after accepting a transition. General methods expose
public information only. get_player_view requires a trusted viewer ID supplied
by the caller; this domain API does not authenticate users.
"""

from dataclasses import dataclass
from typing import Any

from .deals import DealState
from .engine import available_cards
from .game import MatchState, Phase
from .house_rules import redeal_reasons
from .models import Trick
from .rules import current_winner, resolve_trick

JSON = dict[str, Any]


@dataclass(frozen=True)
class GameQuery:
    _state: MatchState

    def __post_init__(self) -> None:
        if not isinstance(self._state, MatchState):
            raise ValueError("GameQuery requires a MatchState.")

    def _player(self, player_id: int) -> None:
        if type(player_id) is not int or player_id not in self._state.config.players:
            raise ValueError("Player ID is outside this game.")

    def _deal(self, deal_number: int | None = None) -> DealState | None:
        state = self._state
        if deal_number is None:
            return state.current_deal or (state.completed_deals[-1].deal if state.completed_deals else None)
        if type(deal_number) is not int or not 1 <= deal_number <= state.config.deals_per_match:
            raise ValueError("Deal number must be an integer from 1 to 5.")
        if state.current_deal and state.current_deal.number == deal_number:
            return state.current_deal
        for completed in state.completed_deals:
            if completed.deal.number == deal_number:
                return completed.deal
        raise LookupError("That deal has not started.")

    def get_state(self) -> JSON:
        """Match status and progress; never returns the authoritative state."""
        state = self._state
        deal = self._deal()
        return {
            "revision": state.revision, "phase": state.phase.value,
            "player_count": state.config.player_count, "players": list(state.config.players),
            "deals_per_match": state.config.deals_per_match,
            "completed_deals": len(state.completed_deals),
            "deal_number": deal.number if deal else None,
            "active_deal_number": state.current_deal.number if state.current_deal else None,
            "current_trick": self.get_current_trick(), "turn": self.get_turn(),
            "scores_tenths": list(state.score_tenths), "winners": list(state.winners),
            "finished": state.phase == Phase.MATCH_COMPLETE,
        }

    def get_rules(self) -> JSON:
        """Effective trick, scoring, deal and house rules for this match."""
        config = self._state.config
        policy = config.redeal_policy
        return {
            "ruleset": config.ruleset, "player_count": config.player_count,
            "deals_per_match": config.deals_per_match,
            "cards_per_player": config.tricks_per_deal, "tricks_per_deal": config.tricks_per_deal,
            "plays_per_trick": config.player_count, "deck_size": 52,
            "undealt_count": 52 % config.player_count, "undealt_policy": config.undealt_policy,
            "trump": "S", "rank_order": ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"],
            "leader_can_play_any_suit": True, "must_follow_suit": True,
            "must_beat_when_following_if_possible": True,
            "must_play_winning_trump_when_void": True,
            "free_discard_when_void_and_no_winning_trump": True,
            "trick_winner_leads_next": True,
            "bid_min": 1, "bid_max": config.tricks_per_deal,
            "scoring": {"unit": "tenths", "made_bid_multiplier": 10,
                        "overtrick_bonus": 1, "missed_bid_multiplier": -10, "ties": "shared_winners"},
            "redeal": {"weak_hand_enabled": policy.weak_hand_enabled,
                       "weak_hand_threshold": policy.weak_hand_threshold.name,
                       "no_spades_enabled": policy.no_spades_enabled,
                       "eligibility": "either_enabled_condition", "scope": "whole_deal_before_bidding"},
        }

    def get_turn(self) -> JSON:
        """Whose action is awaited, including simultaneous hand review/control."""
        state = self._state
        deal = state.current_deal
        pending: list[int] = []
        action = None
        control = None
        if state.phase == Phase.HAND_REVIEW:
            pending = [p for p in state.config.players if p not in deal.accepted_hands]
            action = "REVIEW_HAND"
        elif state.phase in (Phase.BIDDING, Phase.PLAYING):
            pending = [state.current_player]
            action = "PLACE_BID" if state.phase == Phase.BIDDING else "PLAY_CARD"
        elif state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
            control = "START_DEAL"
        elif state.phase == Phase.AWAITING_REDEAL:
            control = "REDEAL"
        return {"player_id": state.current_player, "action": action,
                "pending_players": pending, "controller_action": control}

    def _trick_view(self, deal: DealState, trick: Trick, number: int) -> JSON:
        winning = current_winner(trick)
        return {
            "deal_number": deal.number, "attempt": deal.attempt, "trick_number": number,
            "leader": trick.leader, "led_suit": trick.plays[0].card.suit.value if trick.plays else None,
            "plays": [{"player_id": p.player_id, "card": str(p.card)} for p in trick.plays],
            "plays_completed": len(trick.plays), "plays_required": trick.player_count,
            "current_player": trick.current_player, "complete": trick.complete,
            "winning_player": winning.player_id if winning else None,
            "winning_card": str(winning.card) if winning else None,
            "winner": resolve_trick(trick) if trick.complete else None,
        }

    def get_current_trick(self) -> JSON | None:
        """Only the active trick. None before play and between deals."""
        deal = self._state.current_deal
        if not deal or not deal.current_trick:
            return None
        return self._trick_view(deal, deal.current_trick, len(deal.completed_tricks) + 1)

    def get_trick(self, trick_number: int, *, deal_number: int | None = None) -> JSON:
        """Read a completed or active trick by its one-based number."""
        if type(trick_number) is not int or not 1 <= trick_number <= self._state.config.tricks_per_deal:
            raise ValueError("Invalid trick number.")
        deal = self._deal(deal_number)
        if deal:
            if trick_number <= len(deal.completed_tricks):
                return self._trick_view(deal, deal.completed_tricks[trick_number - 1], trick_number)
            if deal.current_trick and trick_number == len(deal.completed_tricks) + 1:
                return self._trick_view(deal, deal.current_trick, trick_number)
        raise LookupError("That trick has not started.")

    def get_tricks(self, deal_number: int | None = None) -> list[JSON]:
        deal = self._deal(deal_number)
        if deal is None:
            return []
        tricks = deal.completed_tricks + ((deal.current_trick,) if deal.current_trick else ())
        return [self._trick_view(deal, t, i + 1) for i, t in enumerate(tricks)]

    def get_deal(self, deal_number: int | None = None) -> JSON | None:
        """Current deal, or latest completed deal at a boundary; explicit lookup supported."""
        deal = self._deal(deal_number)
        if deal is None:
            return None
        completed = deal.number <= len(self._state.completed_deals)
        return {
            "deal_number": deal.number, "attempt": deal.attempt, "dealer": deal.dealer,
            "complete": completed,
            "phase": "DEAL_COMPLETE" if completed else self._state.phase.value,
            "tricks_required": self._state.config.tricks_per_deal,
            "tricks_completed": len(deal.completed_tricks),
            "accepted_hands": list(deal.accepted_hands),
            "players": self.get_deal_table(deal.number), "tricks": self.get_tricks(deal.number),
        }

    def get_bids(self, deal_number: int | None = None) -> list[JSON]:
        deal = self._deal(deal_number)
        return [{"player_id": p.player_id, "bid": p.bid} for p in deal.players] if deal else []

    def get_deals(self) -> list[JSON]:
        """All started deals in order; redeal attempts are not extra deals."""
        count = len(self._state.completed_deals) + (self._state.current_deal is not None)
        return [self.get_deal(number) for number in range(1, count + 1)]

    def get_deal_table(self, deal_number: int | None = None) -> list[JSON]:
        """One row per player: bid, tricks won, cards left and finalized deal score."""
        deal = self._deal(deal_number)
        if deal is None:
            return []
        completed = next((d for d in self._state.completed_deals if d.deal.number == deal.number), None)
        won = deal.tricks_won
        return [{"player_id": p.player_id, "bid": p.bid, "tricks_won": won[i],
                 "cards_remaining": len(p.hand),
                 "score_tenths": completed.result.score_tenths[i] if completed else None}
                for i, p in enumerate(deal.players)]

    def get_scoreboard(self) -> list[JSON]:
        """Five deal-score columns per player; unscored deals are None, not zero."""
        state = self._state
        return [{"player_id": p,
                 "deal_scores_tenths": [state.completed_deals[i].result.score_tenths[p - 1]
                                        if i < len(state.completed_deals) else None for i in range(5)],
                 "total_score_tenths": state.score_tenths[p - 1], "is_winner": p in state.winners}
                for p in state.config.players]

    def get_player(self, player_id: int) -> JSON:
        """Public summary for any player; includes no private hand or eligibility."""
        self._player(player_id)
        deal = self._deal()
        row = self.get_deal_table()[player_id - 1] if deal else None
        state = self._state
        return {"player_id": player_id, "is_current_player": state.current_player == player_id,
                "deal": row, "total_score_tenths": state.score_tenths[player_id - 1],
                "total_tricks_won": sum(d.deal.tricks_won[player_id - 1] for d in state.completed_deals)
                + (state.current_deal.tricks_won[player_id - 1] if state.current_deal else 0),
                "is_winner": player_id in state.winners}

    def get_player_view(self, player_id: int) -> JSON:
        """Private view: caller must authorize this viewer before invoking."""
        self._player(player_id)
        state = self._state
        deal = state.current_deal
        hand = deal.players[player_id - 1].hand if deal and state.phase != Phase.AWAITING_REDEAL else ()
        review = state.phase == Phase.HAND_REVIEW and player_id not in deal.accepted_hands
        reasons = redeal_reasons(hand, state.config.redeal_policy) if review else ()
        return {"game": self.get_state(), "player": self.get_player(player_id),
                "hand": list(map(str, hand)),
                "legal_cards": list(map(str, available_cards(state, player_id))),
                "can_accept_hand": review, "can_claim_redeal": bool(reasons),
                "redeal_reasons": list(reasons)}
