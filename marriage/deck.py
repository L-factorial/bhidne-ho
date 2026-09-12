"""Canonical deck construction and last-element-top dealing."""
from collections.abc import Iterable

from card_utils import Rank, Suit
from .cards import PhysicalCard
from .errors import CardConservationError


def create_deck() -> tuple[PhysicalCard, ...]:
    return tuple(PhysicalCard.standard(suit, rank, pack)
                 for pack in range(3) for suit in Suit for rank in Rank) + tuple(
                     PhysicalCard.man(index) for index in range(3))


def validate_deck(cards: Iterable[PhysicalCard]) -> None:
    """Require exactly the canonical physical deck, regardless of ordering."""
    supplied = tuple(cards)
    if any(not isinstance(card, PhysicalCard) for card in supplied):
        raise CardConservationError("Deck entries must be physical cards.")
    if len(supplied) != 159 or len({card.card_id for card in supplied}) != 159:
        raise CardConservationError("Deck must contain 159 distinct physical card IDs.")
    if set(supplied) != set(create_deck()):
        raise CardConservationError("Deck does not match the canonical Marriage deck.")


def deal_cards(cards: tuple[PhysicalCard, ...], player_count: int,
               cards_per_player: int) -> tuple[tuple[tuple[PhysicalCard, ...], ...], tuple[PhysicalCard, ...]]:
    """Internal startup helper: preserve seat order and each hand's receipt order."""
    stock = list(cards)
    hands = [[] for _ in range(player_count)]
    for _ in range(cards_per_player):
        for hand in hands:
            hand.append(stock.pop())
    return tuple(tuple(hand) for hand in hands), tuple(stock)
