"""Pre-bidding full-deal restart eligibility; no platform permissions here."""

from dataclasses import dataclass

from card_utils import Card, Rank, Suit


@dataclass(frozen=True)
class RedealPolicy:
    weak_hand_enabled: bool = True
    weak_hand_threshold: Rank = Rank.JACK
    no_spades_enabled: bool = True

    def __post_init__(self) -> None:
        if type(self.weak_hand_enabled) is not bool or type(self.no_spades_enabled) is not bool:
            raise ValueError("Redeal switches must be booleans.")
        if not isinstance(self.weak_hand_threshold, Rank) or self.weak_hand_threshold not in (Rank.JACK, Rank.QUEEN):
            raise ValueError("Weak-hand threshold must be Jack or Queen.")

    @property
    def enabled(self) -> bool:
        return self.weak_hand_enabled or self.no_spades_enabled


def redeal_reasons(hand: tuple[Card, ...], policy: RedealPolicy) -> tuple[str, ...]:
    if not hand or any(not isinstance(card, Card) for card in hand):
        raise ValueError("Eligibility requires a nonempty hand of cards.")
    reasons = []
    if policy.weak_hand_enabled and all(card.rank <= policy.weak_hand_threshold for card in hand):
        reasons.append("WEAK_HAND")
    if policy.no_spades_enabled and all(card.suit != Suit.SPADES for card in hand):
        reasons.append("NO_SPADES")
    return tuple(reasons)
