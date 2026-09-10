from dataclasses import dataclass

from card_utils import Card


@dataclass(frozen=True)
class StartDeal:
    deck: tuple[Card, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "deck", tuple(self.deck))


@dataclass(frozen=True)
class Redeal(StartDeal):
    pass


@dataclass(frozen=True)
class PlaceBid:
    amount: int


@dataclass(frozen=True)
class PlayCard:
    card: Card


@dataclass(frozen=True)
class AcceptHand:
    pass


@dataclass(frozen=True)
class ClaimRedeal:
    pass


@dataclass(frozen=True)
class PrepareDeal:
    """Controller begins dealer-led preparation of a deal or redeal."""


@dataclass(frozen=True)
class ShuffleDeck:
    """Dealer requests a shuffle; the controller supplies its result separately."""


@dataclass(frozen=True)
class CompleteShuffle(StartDeal):
    """Trusted ordered result of shuffling; never accepted from a player."""


@dataclass(frozen=True)
class CutDeck:
    position: int


@dataclass(frozen=True)
class SkipCut:
    pass


@dataclass(frozen=True)
class StartDistribution:
    """Dealer distributes the prepared deck, producing ordered per-card outcomes."""
