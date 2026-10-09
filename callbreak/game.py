"""Match-level state. It owns five scored deals, not sockets or users."""

from dataclasses import dataclass
from enum import Enum
from card_utils import Card

from .config import GameConfig, advance
from .deals import CompletedDeal, DealState


class Phase(str, Enum):
    SELECTING_DEALER = "SELECTING_DEALER"
    AWAITING_DEAL = "AWAITING_DEAL"
    AWAITING_SHUFFLE = "AWAITING_SHUFFLE"
    SHUFFLING = "SHUFFLING"
    AWAITING_CUT = "AWAITING_CUT"
    AWAITING_DISTRIBUTION = "AWAITING_DISTRIBUTION"
    HAND_REVIEW = "HAND_REVIEW"
    AWAITING_REDEAL = "AWAITING_REDEAL"
    BIDDING = "BIDDING"
    PLAYING = "PLAYING"
    DEAL_COMPLETE = "DEAL_COMPLETE"
    MATCH_COMPLETE = "MATCH_COMPLETE"


@dataclass(frozen=True)
class DealPreparation:
    number: int
    attempt: int
    dealer: int
    deck: tuple[Card, ...] = ()
    cut_position: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "deck", tuple(self.deck))


@dataclass(frozen=True)
class DealerPick:
    player_id: int
    position: int


@dataclass(frozen=True)
class DealerSelection:
    deck: tuple[Card, ...]
    picks: tuple[DealerPick, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "deck", tuple(self.deck))
        object.__setattr__(self, "picks", tuple(self.picks))

    @property
    def winner(self) -> int | None:
        if not self.picks:
            return None
        # A later picker wins a rank tie; suits never decide the dealer.
        return min(enumerate(self.picks), key=lambda row: (self.deck[row[1].position].rank.value, -row[0]))[1].player_id


@dataclass(frozen=True)
class MatchState:
    config: GameConfig
    initial_dealer: int
    phase: Phase = Phase.AWAITING_DEAL
    revision: int = 0
    current_deal: DealState | None = None
    completed_deals: tuple[CompletedDeal, ...] = ()
    abandoned_attempts: tuple[DealState, ...] = ()
    preparation: DealPreparation | None = None
    dealer_selection: DealerSelection | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "completed_deals", tuple(self.completed_deals))
        object.__setattr__(self, "abandoned_attempts", tuple(self.abandoned_attempts))

    @property
    def current_player(self) -> int | None:
        if self.phase == Phase.SELECTING_DEALER:
            return len(self.dealer_selection.picks) + 1
        if self.preparation:
            if self.phase in (Phase.AWAITING_SHUFFLE, Phase.AWAITING_DISTRIBUTION):
                return self.preparation.dealer
            if self.phase == Phase.AWAITING_CUT:
                return advance(self.preparation.dealer, self.config.player_count)
            return None
        deal = self.current_deal
        if deal is None:
            return None
        if self.phase == Phase.BIDDING:
            return advance(deal.dealer, self.config.player_count, 1 + sum(p.bid is not None for p in deal.players))
        if self.phase == Phase.PLAYING and deal.current_trick:
            return deal.current_trick.current_player
        return None

    @property
    def score_tenths(self) -> tuple[int, ...]:
        """Historical field name; divide these integer units by config.score_scale."""
        return tuple(sum(d.result.score_tenths[i] for d in self.completed_deals)
                     for i in range(self.config.player_count))

    @property
    def winners(self) -> tuple[int, ...]:
        if self.phase != Phase.MATCH_COMPLETE:
            return ()
        if self.instant_winners:
            return self.instant_winners
        if self.perfect_winners:
            return self.perfect_winners
        scores = self.score_tenths
        return tuple(i + 1 for i, score in enumerate(scores) if score == max(scores))

    @property
    def instant_winners(self) -> tuple[int, ...]:
        rules, deal = self.config.match_rules, self.current_deal
        if not rules or not rules.instant_win_enabled or not deal:
            return ()
        return tuple(p.player_id for p in deal.players
                     if p.bid == rules.instant_win_bid and deal.tricks_won[p.player_id - 1] >= rules.instant_win_bid)

    @property
    def perfect_winners(self) -> tuple[int, ...]:
        rules = self.config.match_rules
        if not rules or not rules.perfect_bid_enabled or len(self.completed_deals) != self.config.deals_per_match:
            return ()
        return tuple(p for p in self.config.players if all(
            d.result.bids[p - 1] == d.result.tricks_won[p - 1] == rules.perfect_bid for d in self.completed_deals))

    @property
    def win_reason(self) -> str | None:
        if self.phase != Phase.MATCH_COMPLETE:
            return None
        return 'instant_bid' if self.instant_winners else 'perfect_bid' if self.perfect_winners else 'score'
