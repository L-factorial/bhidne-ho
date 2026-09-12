"""Deterministic Dublee witnesses; normal completion is explicitly unsupported."""
from dataclasses import dataclass

from .cards import PhysicalCard
from .enums import QualificationRoute
from .models import PlayerState


@dataclass(frozen=True)
class Capability:
    supported: bool
    reason: str


NORMAL_COMPLETION = Capability(False, "Normal-hand completion and wildcard rules have not been specified.")


def eighth_pair(player: PlayerState) -> tuple[str, ...]:
    if player.route is not QualificationRoute.DUBLEE or len(player.shown_melds) != 7:
        return ()
    cards = sorted((c for c in player.hand if c.card_id not in player.committed_card_ids
                    and c.identity is not None), key=lambda c: c.card_id)
    for index, left in enumerate(cards):
        for right in cards[index + 1:]:
            if left.identity == right.identity:
                return left.card_id, right.card_id
    return ()


def winning_discard(player: PlayerState, card: PhysicalCard) -> bool:
    """The picked card itself must complete the additional pair."""
    return (player.route is QualificationRoute.DUBLEE and len(player.shown_melds) == 7
            and card.identity is not None
            and any(c.card_id not in player.committed_card_ids and c.identity == card.identity
                    and c.card_id != card.card_id for c in player.hand))
