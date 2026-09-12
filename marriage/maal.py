"""One round indicator, natural Maal faces, and internal staged selection."""
from dataclasses import dataclass
from random import Random

from .cards import CardIdentity, PhysicalCard
from .errors import TipluUnavailableError
from .rank_policy import adjacent_maal_ranks
from .rules import MarriageRules


@dataclass(frozen=True)
class MaalView:
    tiplu: CardIdentity
    jhiplu: CardIdentity
    poplu: CardIdentity


def maal_view(tiplu: PhysicalCard, rules: MarriageRules) -> MaalView:
    lower, upper = adjacent_maal_ranks(tiplu.rank, rules.maal_neighbors)
    return MaalView(tiplu.identity, CardIdentity(tiplu.suit, lower), CardIdentity(tiplu.suit, upper))


def select_tiplu(stock: tuple[PhysicalCard, ...], discard: tuple[PhysicalCard, ...], rng: Random
                 ) -> tuple[PhysicalCard, tuple[PhysicalCard, ...], tuple[PhysicalCard, ...], int]:
    """Return indicator, remaining piles, refill count. Caller commits RNG only on success."""
    recycled = 0
    if not any(c.identity is not None for c in stock) and len(discard) >= 2:
        older = list(discard[:-1])
        rng.shuffle(older)
        recycled = len(older)
        stock = tuple(older) + stock  # Existing Man cards stay above the refill block.
        discard = discard[-1:]
    for index in range(len(stock) - 1, -1, -1):
        if stock[index].identity is not None:
            return stock[index], stock[:index] + stock[index + 1:], discard, recycled
    raise TipluUnavailableError("No standard card is available for Tiplu.")
