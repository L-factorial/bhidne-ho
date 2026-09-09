"""Non-mutating sequence operations. Index zero is the top of the deck."""

from collections.abc import Sequence
from typing import Protocol, TypeVar

from .cards import Card, Rank, Suit

T = TypeVar("T")


class RandomSource(Protocol):
    def randrange(self, stop: int) -> int: ...


def _count(value: int, name: str) -> None:
    if type(value) is not int or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer.")


def standard_52() -> tuple[Card, ...]:
    return tuple(Card(suit, rank) for suit in Suit for rank in Rank)


def shuffle(items: Sequence[T], *, rng: RandomSource) -> tuple[T, ...]:
    result = list(items)
    for i in range(len(result) - 1, 0, -1):
        j = rng.randrange(i + 1)
        result[i], result[j] = result[j], result[i]
    return tuple(result)


def combine(*piles: Sequence[T]) -> tuple[T, ...]:
    return tuple(item for pile in piles for item in pile)


def mix(*piles: Sequence[T], rng: RandomSource) -> tuple[T, ...]:
    return shuffle(combine(*piles), rng=rng)


def cut(items: Sequence[T], index: int) -> tuple[T, ...]:
    _count(index, "index")
    if index > len(items):
        raise ValueError("Cut exceeds deck length.")
    return tuple(items[index:]) + tuple(items[:index])


def split(items: Sequence[T], sizes: Sequence[int]) -> tuple[tuple[T, ...], ...]:
    sizes = tuple(sizes)
    for size in sizes:
        _count(size, "size")
    if sum(sizes) != len(items):
        raise ValueError("Pile sizes must sum to deck length.")
    offset = 0
    piles = []
    for size in sizes:
        piles.append(tuple(items[offset:offset + size]))
        offset += size
    return tuple(piles)


def draw(items: Sequence[T], count: int) -> tuple[tuple[T, ...], tuple[T, ...]]:
    _count(count, "count")
    if count > len(items):
        raise ValueError("Not enough cards.")
    return tuple(items[:count]), tuple(items[count:])


def deal(
    items: Sequence[T], players: int, cards_each: int,
) -> tuple[tuple[tuple[T, ...], ...], tuple[T, ...]]:
    _count(players, "players")
    _count(cards_each, "cards_each")
    if not players:
        raise ValueError("At least one recipient is required.")
    dealt, remainder = draw(items, players * cards_each)
    return tuple(dealt[i::players] for i in range(players)), remainder
