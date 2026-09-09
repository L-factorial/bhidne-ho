"""Standard playing cards without game-specific ordering or trump rules."""

from dataclasses import dataclass
from enum import Enum, IntEnum


class Suit(str, Enum):
    CLUBS = "C"
    DIAMONDS = "D"
    HEARTS = "H"
    SPADES = "S"


class Rank(IntEnum):
    TWO = 2
    THREE = 3
    FOUR = 4
    FIVE = 5
    SIX = 6
    SEVEN = 7
    EIGHT = 8
    NINE = 9
    TEN = 10
    JACK = 11
    QUEEN = 12
    KING = 13
    ACE = 14


_RANK_LABELS = {rank: str(rank.value) for rank in Rank}
_RANK_LABELS.update({Rank.JACK: "J", Rank.QUEEN: "Q", Rank.KING: "K", Rank.ACE: "A"})
_PARSED_RANKS = {label: rank for rank, label in _RANK_LABELS.items()}


@dataclass(frozen=True)
class Card:
    suit: Suit
    rank: Rank

    def __post_init__(self) -> None:
        if not isinstance(self.suit, Suit) or not isinstance(self.rank, Rank):
            raise ValueError("Card requires a Suit and Rank enum value.")

    @classmethod
    def parse(cls, value: str) -> "Card":
        """Parse a canonical ID such as 10H or AS; no implicit normalization."""
        if not isinstance(value, str) or len(value) not in (2, 3):
            raise ValueError("Invalid card ID.")
        try:
            return cls(Suit(value[-1]), _PARSED_RANKS[value[:-1]])
        except (ValueError, KeyError) as error:
            raise ValueError("Invalid card ID.") from error

    def __str__(self) -> str:
        return _RANK_LABELS[self.rank] + self.suit.value
