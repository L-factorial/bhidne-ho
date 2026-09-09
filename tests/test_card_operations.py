from collections import Counter
from random import Random

import pytest

from card_utils import combine, cut, deal, draw, mix, shuffle, split, standard_52


def test_standard_deck_and_operations_preserve_inputs():
    deck = standard_52()
    assert len(deck) == len(set(deck)) == 52
    assert str(deck[0]) == "2C" and str(deck[-1]) == "AS"
    shuffled = shuffle(deck, rng=Random(42))
    assert shuffled == shuffle(deck, rng=Random(42))
    assert shuffled != deck and Counter(shuffled) == Counter(deck)
    assert combine(*split(deck, (17, 17, 18))) == deck
    assert cut(deck, 17) == deck[17:] + deck[:17]
    assert cut(deck, 0) == cut(deck, 52) == deck
    assert draw(deck, 0) == ((), deck)
    assert draw(deck, 52) == (deck, ())


def test_generic_deal_and_duplicate_preservation():
    assert deal(tuple("ABCDEF"), 2, 2) == ((("A", "C"), ("B", "D")), ("E", "F"))
    assert deal((), 3, 0) == (((), (), ()), ())
    assert Counter(mix((1, 1), (2, 2), rng=Random(2))) == Counter((1, 1, 2, 2))
    assert split((), (0, 0)) == ((), ())
    assert shuffle((), rng=Random(2)) == ()
    for n in (4, 5):
        hands, remaining = deal(standard_52(), n, 52 // n)
        assert len(hands) == n and all(len(h) == 52 // n for h in hands)
        assert len(remaining) == 52 % n
        assert Counter(combine(*hands, remaining)) == Counter(standard_52())


@pytest.mark.parametrize("operation", [
    lambda: cut((1,), -1), lambda: cut((1,), 2), lambda: cut((1,), True),
    lambda: split((1,), (0,)), lambda: split((1,), (-1, 2)), lambda: split((1,), (True,)),
    lambda: draw((1,), 2), lambda: draw((1,), 1.0),
    lambda: deal((1,), 0, 1), lambda: deal((1,), True, 1),
    lambda: deal((1,), 2, 1), lambda: deal((1,), 1, -1),
])
def test_invalid_operations(operation):
    with pytest.raises(ValueError):
        operation()
