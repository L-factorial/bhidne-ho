"""A deal owns hands, bids, one current trick, and completed trick history."""

from dataclasses import dataclass

from card_utils import Card, Suit

from .models import Trick
from .rules import resolve_trick


@dataclass(frozen=True)
class PlayerDealState:
    player_id: int
    hand: tuple[Card, ...]
    bid: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "hand", tuple(self.hand))


@dataclass(frozen=True)
class DealState:
    number: int
    attempt: int
    dealer: int
    players: tuple[PlayerDealState, ...]
    undealt_cards: tuple[Card, ...]
    current_trick: Trick | None = None
    completed_tricks: tuple[Trick, ...] = ()
    accepted_hands: tuple[int, ...] = ()

    def __post_init__(self) -> None:
        for name in ("players", "undealt_cards", "completed_tricks", "accepted_hands"):
            object.__setattr__(self, name, tuple(getattr(self, name)))

    @property
    def tricks_won(self) -> tuple[int, ...]:
        winners = tuple(resolve_trick(trick) for trick in self.completed_tricks)
        return tuple(winners.count(player.player_id) for player in self.players)

    def void_suits(self, player_id: int) -> frozenset[Suit]:
        """Public deductions from accepted plays in this attempt only."""
        tricks = self.completed_tricks + ((self.current_trick,) if self.current_trick else ())
        return frozenset(
            trick.plays[0].card.suit
            for trick in tricks if trick.plays
            for play in trick.plays
            if play.player_id == player_id and play.card.suit != trick.plays[0].card.suit
        )


@dataclass(frozen=True)
class DealResult:
    bids: tuple[int, ...]
    tricks_won: tuple[int, ...]
    score_tenths: tuple[int, ...]

    def __post_init__(self) -> None:
        for name in ("bids", "tricks_won", "score_tenths"):
            object.__setattr__(self, name, tuple(getattr(self, name)))


@dataclass(frozen=True)
class CompletedDeal:
    deal: DealState
    result: DealResult
