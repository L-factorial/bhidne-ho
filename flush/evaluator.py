"""Stateless three-card comparison. Suits never break a tie."""
from collections import Counter
from dataclasses import dataclass

from card_utils import Card
from .enums import AceSequencePolicy, FlushHandRank


@dataclass(frozen=True, order=True)
class FlushHandResult:
    rank: FlushHandRank
    tiebreak: tuple[int, ...]

    def __post_init__(self):
        object.__setattr__(self, 'tiebreak', tuple(self.tiebreak))


@dataclass(frozen=True)
class FlushHandEvaluator:
    ace_policy: AceSequencePolicy = AceSequencePolicy.AKQ_FIRST_A23_SECOND

    def __post_init__(self):
        if not isinstance(self.ace_policy, AceSequencePolicy):
            raise ValueError('Unsupported Ace sequence policy.')

    def evaluate(self, cards) -> FlushHandResult:
        cards = tuple(cards)
        if len(cards) != 3 or any(not isinstance(c, Card) for c in cards) or len(set(cards)) != 3:
            raise ValueError('Evaluate exactly three distinct standard cards.')
        ranks = tuple(sorted((int(c.rank) for c in cards), reverse=True))
        counts = Counter(ranks)
        if len(counts) == 1:
            return FlushHandResult(FlushHandRank.TRAIL, (ranks[0],))
        same_suit = len({c.suit for c in cards}) == 1
        sequence = None
        if ranks == (14, 3, 2):
            sequence = {AceSequencePolicy.AKQ_FIRST_A23_SECOND: 14,
                        AceSequencePolicy.A23_FIRST: 16,
                        AceSequencePolicy.A23_LOWEST: 3}[self.ace_policy]
        elif len(counts) == 3 and ranks[0] - ranks[2] == 2:
            sequence = 15 if ranks[0] == 14 else ranks[0]
        if sequence is not None:
            return FlushHandResult(FlushHandRank.PURE_SEQUENCE if same_suit else FlushHandRank.SEQUENCE,
                                   (sequence,))
        if same_suit:
            return FlushHandResult(FlushHandRank.COLOR, ranks)
        if len(counts) == 2:
            return FlushHandResult(FlushHandRank.PAIR,
                                   (next(r for r, n in counts.items() if n == 2),
                                    next(r for r, n in counts.items() if n == 1)))
        return FlushHandResult(FlushHandRank.HIGH_CARD, ranks)

    def compare(self, left, right) -> int:
        a, b = self.evaluate(left), self.evaluate(right)
        return (a > b) - (a < b)
