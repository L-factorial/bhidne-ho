"""Sequence positions and Maal neighbors have deliberately separate policies."""
from card_utils import Rank
from .enums import AceSequencePolicy, MaalNeighborPolicy

_LOW_ORDER = (Rank.ACE, Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX,
              Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN, Rank.JACK, Rank.QUEEN, Rank.KING)


def sequence_rank_order(policy: AceSequencePolicy = AceSequencePolicy.LOW_ONLY) -> tuple[Rank, ...]:
    if not isinstance(policy, AceSequencePolicy):
        raise ValueError("Unsupported Ace sequence policy.")
    return _LOW_ORDER


def adjacent_maal_ranks(rank: Rank, policy: MaalNeighborPolicy = MaalNeighborPolicy.CYCLIC) -> tuple[Rank, Rank]:
    """Return the lower and upper Maal ranks; this does not validate a sequence."""
    if not isinstance(rank, Rank) or not isinstance(policy, MaalNeighborPolicy):
        raise ValueError("Maal neighbors require a Rank and supported policy.")
    index = _LOW_ORDER.index(rank)
    return _LOW_ORDER[(index - 1) % 13], _LOW_ORDER[(index + 1) % 13]
