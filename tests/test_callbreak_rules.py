from dataclasses import FrozenInstanceError

import pytest

from card_utils import Card, Rank, Suit
from callbreak import Play, Trick, current_winner, legal_cards, resolve_trick, validate_play


def cards(text):
    return tuple(Card.parse(value) for value in text.split())


def trick(text="", count=4, leader=1):
    return Trick(count, leader, tuple(
        Play((leader - 1 + i) % count + 1, card)
        for i, card in enumerate(cards(text))
    ))


@pytest.mark.parametrize("count", [4, 5])
@pytest.mark.parametrize("played,hand,expected", [
    ("", "2C AS QH", "2C AS QH"),
    ("10H", "2H QH AS", "QH"),
    ("KH", "2H QH AS", "2H QH"),
    ("10H 3S", "2H QH AS", "2H QH"),
    ("10H", "2C 3S AS", "3S AS"),
    ("10H 9S", "2C 3S JS", "JS"),
    ("10H KS", "2C 3S JS", "2C 3S JS"),
    ("9S", "2C 3S JS", "JS"),
    ("KS", "2C 3S JS", "3S JS"),
    ("10H", "AC KD", "AC KD"),
    ("QH", "KH AH 2C", "KH AH"),
    ("AH", "KH QH AS", "KH QH"),
])
def test_legal_choices_and_validation(count, played, hand, expected):
    state = trick(played, count)
    remaining = cards(hand)
    legal = cards(expected)
    assert legal_cards(remaining, state, state.current_player) == legal
    for card in remaining:
        result = validate_play(remaining, state, state.current_player, card)
        if card in legal:
            assert result is None
        else:
            assert result.code == "ILLEGAL_CARD"
    assert state == trick(played, count)
    assert remaining == cards(hand)


@pytest.mark.parametrize("played,count,leader,winner", [
    ("10H AH KH 2H", 4, 1, 2),
    ("10H AC KD 2H", 4, 1, 1),
    ("AH 2S KS QS", 4, 3, 1),
    ("AS KS QS JS 2S", 5, 5, 5),
    ("10H AH 2S AC 3S", 5, 2, 1),
])
def test_complete_trick_has_one_winner(played, count, leader, winner):
    state = trick(played, count, leader)
    assert state.complete and state.current_player is None
    assert resolve_trick(state) == winner
    assert current_winner(state).player_id == winner
    assert validate_play(cards("3C"), state, 1, Card.parse("3C")).code == "TRICK_COMPLETE"
    assert legal_cards(cards("3C"), state, 1) == ()


def test_turn_wraps_and_incomplete_trick_cannot_resolve():
    state = trick("2H", count=5, leader=5)
    assert state.current_player == 1
    assert current_winner(state).player_id == 5
    assert current_winner(trick()) is None
    with pytest.raises(ValueError):
        resolve_trick(state)


@pytest.mark.parametrize("player,card,code", [
    (1, "QH", "NOT_YOUR_TURN"),
    (0, "QH", "INVALID_PLAYER"),
    (5, "QH", "INVALID_PLAYER"),
    (True, "QH", "INVALID_PLAYER"),
    (2, "AH", "CARD_NOT_OWNED"),
])
def test_rejections(player, card, code):
    state = trick("10H")
    assert validate_play(cards("QH"), state, player, Card.parse(card)).code == code


def test_inactive_player_and_malformed_move():
    state = trick("10H")
    assert legal_cards(cards("QH"), state, 3) == ()
    assert validate_play(cards("QH"), state, 2, "QH").code == "INVALID_CARD"
    with pytest.raises(ValueError):
        legal_cards(cards("QH"), state, True)


@pytest.mark.parametrize("hand", ["QH QH", "10H", "2C 3C 4C 5C 6C 7C 8C 9C 10C JC QC KC AC 2D"])
def test_reject_inconsistent_hands(hand):
    with pytest.raises(ValueError):
        legal_cards(cards(hand), trick("10H"), 2)


@pytest.mark.parametrize("count,leader,plays", [
    (3, 1, ()), (True, 1, ()), (4, True, ()), (4, 5, ()),
    (4, 1, (Play(2, Card.parse("2H")),)),
    (4, 1, (Play(1, Card.parse("2H")), Play(2, Card.parse("2H")))),
])
def test_reject_invalid_trick_structure(count, leader, plays):
    with pytest.raises(ValueError):
        Trick(count, leader, plays)


def test_trick_defensively_freezes_input():
    source = [Play(1, Card.parse("2H"))]
    state = Trick(4, 1, source)
    source.clear()
    assert len(state.plays) == 1
    with pytest.raises(FrozenInstanceError):
        state.leader = 2


def test_higher_card_later_is_not_automatically_illegal():
    # A queen cannot beat a king now, but must beat a ten in a later trick.
    assert validate_play(cards("5H QH"), trick("KH"), 2, Card.parse("5H")) is None
    assert validate_play(cards("QH"), trick("10H"), 2, Card.parse("QH")) is None
    # The same low play against a ten while holding a queen rejects immediately.
    assert validate_play(cards("5H QH"), trick("10H"), 2, Card.parse("5H")).code == "ILLEGAL_CARD"


def test_card_round_trip_and_no_game_specific_ordering():
    deck = [Card(suit, rank) for suit in Suit for rank in Rank]
    assert len(set(deck)) == 52
    assert [Card.parse(str(card)) for card in deck] == deck
    with pytest.raises(TypeError):
        _ = deck[0] < deck[1]


@pytest.mark.parametrize("value", ["", "1H", "11H", "AHH", "as", " AS", "AS ", "0C", None, 12])
def test_invalid_card_ids(value):
    with pytest.raises(ValueError):
        Card.parse(value)


def test_card_requires_typed_values():
    with pytest.raises(ValueError):
        Card("S", Rank.ACE)
    with pytest.raises(ValueError):
        Card(Suit.SPADES, 14)
