"""Pure trick validation for mandatory beating and free discard when unable.

The caller supplies the authoritative remaining hand, never a client's claimed
hand. Match phase, identity mapping and full-history auditing belong to callers.
Invalid domain snapshots raise ValueError; rejected moves return PlayRejection.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from card_utils import Card, Suit

from .models import Play, Trick


@dataclass(frozen=True)
class PlayRejection:
    code: str
    detail: str


def _strength(card: Card, led_suit: Suit) -> tuple[int, int]:
    category = 2 if card.suit == Suit.SPADES else 1 if card.suit == led_suit else 0
    return category, card.rank.value


def current_winner(trick: Trick) -> Play | None:
    """Winning play so far, or None before the leader plays."""
    if not trick.plays:
        return None
    led_suit = trick.plays[0].card.suit
    return max(trick.plays, key=lambda play: _strength(play.card, led_suit))


def resolve_trick(trick: Trick) -> int:
    """Return the winner's ID only after everyone has played exactly once."""
    if not trick.complete:
        raise ValueError("Cannot resolve an incomplete trick.")
    winner = current_winner(trick)
    assert winner is not None
    return winner.player_id


def _checked_hand(hand: Sequence[Card], trick: Trick) -> tuple[Card, ...]:
    cards = tuple(hand)
    if any(not isinstance(card, Card) for card in cards):
        raise ValueError("Hand entries must be Card values.")
    if len(cards) != len(set(cards)):
        raise ValueError("A hand cannot contain duplicate cards.")
    if set(cards).intersection(play.card for play in trick.plays):
        raise ValueError("A remaining hand cannot contain a card already played.")
    if len(cards) > 52 // trick.player_count:
        raise ValueError("Hand exceeds the cards per player for this game.")
    return cards


def legal_cards(hand: Sequence[Card], trick: Trick, player_id: int) -> tuple[Card, ...]:
    """Legal choices in hand order; empty for an inactive player/completed trick."""
    if type(player_id) is not int or not 1 <= player_id <= trick.player_count:
        raise ValueError("Player ID is outside this game.")
    cards = _checked_hand(hand, trick)
    if trick.current_player != player_id:
        return ()
    if not trick.plays:
        return cards

    led_suit = trick.plays[0].card.suit
    winner = current_winner(trick)
    assert winner is not None
    winning_strength = _strength(winner.card, led_suit)
    following = tuple(card for card in cards if card.suit == led_suit)
    if following:
        beating = tuple(card for card in following if _strength(card, led_suit) > winning_strength)
        return beating or following

    winning_spades = tuple(
        card for card in cards
        if card.suit == Suit.SPADES and _strength(card, led_suit) > winning_strength
    )
    return winning_spades or cards


def validate_play(
    hand: Sequence[Card], trick: Trick, player_id: int, card: Card,
) -> PlayRejection | None:
    """Return None for a legal play; never remove cards or mutate the trick."""
    if type(player_id) is not int or not 1 <= player_id <= trick.player_count:
        return PlayRejection("INVALID_PLAYER", "Player is not in this game.")
    if trick.complete:
        return PlayRejection("TRICK_COMPLETE", "Everyone has already played.")
    if player_id != trick.current_player:
        return PlayRejection("NOT_YOUR_TURN", "Wait for your turn.")
    if not isinstance(card, Card):
        return PlayRejection("INVALID_CARD", "A valid Card is required.")
    cards = _checked_hand(hand, trick)
    if card not in cards:
        return PlayRejection("CARD_NOT_OWNED", "Card is not in your hand.")
    if card not in legal_cards(cards, trick, player_id):
        return PlayRejection("ILLEGAL_CARD", "Follow suit and beat the winning card when required.")
    return None
