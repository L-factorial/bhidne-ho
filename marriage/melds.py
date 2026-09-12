"""Natural meld validation using canonical physical cards, never client faces."""
from collections.abc import Iterable

from .deck import create_deck
from .enums import MeldType, QualificationRoute
from .errors import InvalidMeldError
from .models import Meld, PlayerState
from .rank_policy import sequence_rank_order
from .rules import MarriageRules

_CARDS = {card.card_id: card for card in create_deck()}


def validate_meld(player: PlayerState, meld: Meld, rules: MarriageRules,
                  *, allow_committed: bool = False) -> Meld:
    if not isinstance(meld, Meld):
        raise InvalidMeldError("Supply a Meld with physical card IDs.")
    owned = {c.card_id for c in player.hand}
    ids = meld.card_ids
    if len(ids) != len(set(ids)) or any(i not in owned or i not in _CARDS for i in ids):
        raise InvalidMeldError("Meld cards must be distinct, canonical, and owned.")
    if not allow_committed and set(ids) & player.committed_card_ids:
        raise InvalidMeldError("Meld cannot reuse committed cards.")
    cards = tuple(_CARDS[i] for i in ids)
    if any(c.identity is None for c in cards):
        raise InvalidMeldError("Man cards cannot form natural melds.")
    if meld.meld_type is MeldType.PURE_SEQUENCE:
        order = sequence_rank_order(rules.ace_sequence)
        positions = sorted(order.index(c.rank) for c in cards)
        if (len(cards) < 3 or len({c.suit for c in cards}) != 1
                or positions != list(range(positions[0], positions[0] + len(cards)))):
            raise InvalidMeldError("Sequence requires at least three consecutive distinct ranks in one suit.")
    elif meld.meld_type in (MeldType.TUNNELA, MeldType.DUBLEE):
        size = 3 if meld.meld_type is MeldType.TUNNELA else 2
        if len(cards) != size or len({c.identity for c in cards}) != 1:
            raise InvalidMeldError(f"{meld.meld_type.value} requires exactly {size} physical copies of one face.")
    else:
        raise InvalidMeldError("Unsupported meld type.")
    return meld


def validate_declaration(player: PlayerState, melds: Iterable[Meld], route: QualificationRoute,
                         rules: MarriageRules, *, allow_committed: bool = False) -> tuple[Meld, ...]:
    try:
        values = tuple(melds)
    except TypeError as error:
        raise InvalidMeldError("Supply a collection of melds.") from error
    count = 7 if route is QualificationRoute.DUBLEE else 3
    permitted = (MeldType.DUBLEE,) if count == 7 else (MeldType.PURE_SEQUENCE, MeldType.TUNNELA)
    if len(values) != count:
        raise InvalidMeldError(f"This qualification requires exactly {count} melds.")
    used = set()
    for meld in values:
        validate_meld(player, meld, rules, allow_committed=allow_committed)
        if meld.meld_type not in permitted or used.intersection(meld.card_ids):
            raise InvalidMeldError("Wrong meld type or overlapping physical cards in declaration.")
        used.update(meld.card_ids)
    if not allow_committed and route is QualificationRoute.NORMAL and len(used) >= len(player.hand):
        raise InvalidMeldError("Normal qualification must leave a card available to discard.")
    return values
