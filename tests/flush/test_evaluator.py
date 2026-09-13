from collections import Counter
from itertools import combinations, permutations

import pytest
from card_utils import Card, standard_52
from flush import FlushHandEvaluator, FlushHandRank, AceSequencePolicy


def cards(text):
    return tuple(Card.parse(c) for c in text.split())


def test_category_order_and_permutation_invariance():
    e = FlushHandEvaluator()
    hands = ['AS AH AC', 'AS KS QS', 'AS KH QD', 'AS JS 8S', 'AS AH KC', 'AS KH JD']
    results = [e.evaluate(cards(h)) for h in hands]
    assert results == sorted(results, reverse=True)
    for hand, result in zip(hands, results):
        assert all(e.evaluate(p) == result for p in permutations(cards(hand)))


@pytest.mark.parametrize('a,b', [('AS AH KC', 'KS KH AC'), ('AS AH KC', 'AC AD QH'),
    ('AS JS 8S', 'AH JH 7H'), ('AS KH JD', 'AC KD 10H'), ('AS AH AC', 'KS KH KC'),
    ('KS QH JC', 'QS JH 10C')])
def test_tiebreakers(a, b):
    e = FlushHandEvaluator()
    assert e.compare(cards(a), cards(b)) == 1
    assert e.compare(cards(b), cards(a)) == -1
    assert e.compare(cards(a), cards(a)) == 0


@pytest.mark.parametrize('policy,order', [
    (AceSequencePolicy.AKQ_FIRST_A23_SECOND, ['AS KH QD', 'AS 2H 3D', 'KS QH JD', '2S 3H 4D']),
    (AceSequencePolicy.A23_FIRST, ['AS 2H 3D', 'AS KH QD', 'KS QH JD', '2S 3H 4D']),
    (AceSequencePolicy.A23_LOWEST, ['AS KH QD', 'KS QH JD', '2S 3H 4D', 'AS 2H 3D']),
])
def test_ace_policies_for_both_sequence_types(policy, order):
    e = FlushHandEvaluator(policy)
    for pure in (False, True):
        hands = [tuple(Card(c.suit if not pure else cards('AS')[0].suit, c.rank) for c in cards(h)) for h in order]
        results = [e.evaluate(h) for h in hands]
        assert results == sorted(results, reverse=True)
    assert e.evaluate(cards('KS AH 2D')).rank is FlushHandRank.HIGH_CARD


def test_exhaustive_category_counts_and_suit_equality():
    e = FlushHandEvaluator()
    counts = Counter(e.evaluate(hand).rank for hand in combinations(standard_52(), 3))
    assert counts == {FlushHandRank.TRAIL: 52, FlushHandRank.PURE_SEQUENCE: 48,
                      FlushHandRank.SEQUENCE: 720, FlushHandRank.COLOR: 1096,
                      FlushHandRank.PAIR: 3744, FlushHandRank.HIGH_CARD: 16440}
    assert e.compare(cards('AS KH 9D'), cards('AH KC 9S')) == 0


@pytest.mark.parametrize('hand', [(), cards('AS KH'), cards('AS AS KH'), ('AS', 'KH', 'QD')])
def test_malformed_hands(hand):
    with pytest.raises(ValueError):
        FlushHandEvaluator().evaluate(hand)
