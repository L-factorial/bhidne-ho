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
