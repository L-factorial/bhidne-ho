"""Match-level state. It owns five scored deals, not sockets or users."""

from dataclasses import dataclass
from enum import Enum

from .config import GameConfig, advance
from .deals import CompletedDeal, DealState


class Phase(str, Enum):
    AWAITING_DEAL = "AWAITING_DEAL"
    HAND_REVIEW = "HAND_REVIEW"
    AWAITING_REDEAL = "AWAITING_REDEAL"
    BIDDING = "BIDDING"
    PLAYING = "PLAYING"
    DEAL_COMPLETE = "DEAL_COMPLETE"
    MATCH_COMPLETE = "MATCH_COMPLETE"


@dataclass(frozen=True)
class MatchState:
    config: GameConfig
    initial_dealer: int
    phase: Phase = Phase.AWAITING_DEAL
    revision: int = 0
    current_deal: DealState | None = None
    completed_deals: tuple[CompletedDeal, ...] = ()
    abandoned_attempts: tuple[DealState, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "completed_deals", tuple(self.completed_deals))
        object.__setattr__(self, "abandoned_attempts", tuple(self.abandoned_attempts))

    @property
    def current_player(self) -> int | None:
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
        return tuple(sum(d.result.score_tenths[i] for d in self.completed_deals)
                     for i in range(self.config.player_count))

    @property
    def winners(self) -> tuple[int, ...]:
        if self.phase != Phase.MATCH_COMPLETE:
            return ()
        scores = self.score_tenths
        return tuple(i + 1 for i, score in enumerate(scores) if score == max(scores))
