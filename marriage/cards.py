"""Physical copies are distinct; natural identities compare only rank and suit."""
from dataclasses import dataclass

from card_utils import Card, Rank, Suit
from .enums import CardType


@dataclass(frozen=True)
class CardIdentity:
    suit: Suit
    rank: Rank

    def __post_init__(self):
        if not isinstance(self.suit, Suit) or not isinstance(self.rank, Rank):
            raise ValueError("A natural identity requires Suit and Rank enum values.")


@dataclass(frozen=True)
class PhysicalCard:
    card_id: str
    card_type: CardType
    rank: Rank | None = None
    suit: Suit | None = None
    deck_index: int | None = None

    def __post_init__(self):
        if not isinstance(self.card_id, str) or not isinstance(self.card_type, CardType):
            raise ValueError("Card requires a string ID and CardType enum value.")
        if self.card_type == CardType.STANDARD:
            CardIdentity(self.suit, self.rank)
            if type(self.deck_index) is not int or not 0 <= self.deck_index < 3:
                raise ValueError("Standard cards require pack index 0, 1, or 2.")
            expected = f"D{self.deck_index}:{Card(self.suit, self.rank)}"
            if self.card_id != expected:
                raise ValueError("Card ID does not match its face and pack.")
        elif (self.rank is not None or self.suit is not None or self.deck_index is not None
              or self.card_id not in ("MAN:0", "MAN:1", "MAN:2")):
            raise ValueError("Man cards require MAN:0..2 and no natural face or pack.")

    @classmethod
    def standard(cls, suit: Suit, rank: Rank, deck_index: int):
        return cls(f"D{deck_index}:{Card(suit, rank)}", CardType.STANDARD, rank, suit, deck_index)

    @classmethod
    def man(cls, index: int):
        if type(index) is not int or not 0 <= index < 3:
            raise ValueError("Man index must be 0, 1, or 2.")
        return cls(f"MAN:{index}", CardType.MAN)

    @property
    def identity(self) -> CardIdentity | None:
        return CardIdentity(self.suit, self.rank) if self.card_type == CardType.STANDARD else None
