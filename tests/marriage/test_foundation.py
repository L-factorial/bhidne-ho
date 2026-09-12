from collections import Counter
from dataclasses import FrozenInstanceError, replace

import pytest

from marriage import (
    AceSequencePolicy, CardConservationError, CardIdentity, CardType, MarriageConfig,
    MarriageRules, Meld, MeldType, PhysicalCard, PlayerState, QualificationRoute,
    Rank, Suit, adjacent_maal_ranks, create_deck, sequence_rank_order, validate_deck,
)


def test_exact_deck_and_natural_vs_physical_identity():
    deck = create_deck()
    assert deck == create_deck() and isinstance(deck, tuple)
    assert len(deck) == len({card.card_id for card in deck}) == 159
    natural = [card for card in deck if card.card_type == CardType.STANDARD]
    counts = Counter(card.identity for card in natural)
    assert len(counts) == 52 and set(counts.values()) == {3}
    assert Counter(card.deck_index for card in natural) == {0: 52, 1: 52, 2: 52}
    man = [card for card in deck if card.card_type == CardType.MAN]
    assert [card.card_id for card in man] == ['MAN:0', 'MAN:1', 'MAN:2']
    assert all(card.identity is None and card.deck_index is None for card in man)
    sevens = [PhysicalCard.standard(Suit.HEARTS, Rank.SEVEN, index) for index in range(3)]
    assert len(set(sevens)) == 3 and len({card.identity for card in sevens}) == 1
    validate_deck(reversed(deck))


@pytest.mark.parametrize('index', [-1, 3, True, 1.0, '1'])
def test_invalid_copy_indices(index):
    with pytest.raises(ValueError):
        PhysicalCard.standard(Suit.HEARTS, Rank.SEVEN, index)
    with pytest.raises(ValueError):
        PhysicalCard.man(index)


@pytest.mark.parametrize('changes', [
    {'card_id': 'D1:7H'}, {'card_id': 'D0:07H'}, {'rank': Rank.EIGHT},
    {'suit': Suit.SPADES}, {'rank': 7}, {'suit': 'H'}, {'card_type': 'standard'},
    {'deck_index': None}, {'card_id': 'MAN:0', 'card_type': CardType.MAN},
])
def test_rejects_inconsistent_or_untyped_card_metadata(changes):
    with pytest.raises(ValueError):
        replace(PhysicalCard.standard(Suit.HEARTS, Rank.SEVEN, 0), **changes)


@pytest.mark.parametrize('changes', [{'rank': Rank.ACE}, {'suit': Suit.CLUBS}, {'deck_index': 0}, {'card_id': 'MAN:03'}])
def test_man_has_no_natural_face_or_pack(changes):
    with pytest.raises(ValueError):
        replace(PhysicalCard.man(0), **changes)


def test_deck_audit_detects_missing_duplicate_and_counterfeit():
    deck = create_deck()
    for broken in [deck[:-1], deck + (deck[0],), (deck[0],) + deck[1:-1] + (deck[0],), ('bad',) + deck[1:]]:
        with pytest.raises(CardConservationError):
            validate_deck(broken)
    forged = replace(deck[0])
    # Deliberately bypass the frozen constructor to exercise the audit's metadata check.
    object.__setattr__(forged, 'rank', Rank.ACE)
    with pytest.raises(CardConservationError):
        validate_deck((forged,) + deck[1:])


@pytest.mark.parametrize('count', [2, 3, 4, 5])
def test_configuration_freezes_seat_order(count):
    ids = [f'p{i}' for i in range(count)]
    config = MarriageConfig(ids)
    ids.reverse()
    assert config.player_ids == tuple(f'p{i}' for i in range(count))
    assert config.first_player_id == 'p0'
    assert replace(config, first_player_id=f'p{count - 1}').first_player_id == f'p{count - 1}'
    with pytest.raises(FrozenInstanceError):
        config.first_player_id = 'different'


@pytest.mark.parametrize('ids', [[], ['p'], list('abcdef'), ['p', 'p'], ['', 'q'], ['  ', 'q'], ['p\n', 'q'], [1, 'q'], 'pq'])
def test_bad_seats_rejected(ids):
    with pytest.raises(ValueError):
        MarriageConfig(ids)


def test_bad_first_seat_and_rules():
    with pytest.raises(ValueError):
        MarriageConfig(['p', 'q'], first_player_id='absent')
    with pytest.raises(ValueError):
        MarriageConfig(['p', 'q'], rules={})
    for changes in [{'ace_sequence': 'low_only'}, {'maal_neighbors': 'cyclic'},
                    {'dublee_player_can_draw_discard': 1}, {'dublee_player_can_take_winning_discard': 'yes'}]:
        with pytest.raises(ValueError):
            MarriageRules(**changes)
    with pytest.raises(TypeError):
        MarriageRules(printed_jokers=0)
    rules = MarriageRules()
    assert not rules.dublee_player_can_draw_discard and rules.dublee_player_can_take_winning_discard
    with pytest.raises(FrozenInstanceError):
        rules.dublee_player_can_draw_discard = True


def test_nested_player_and_meld_values_do_not_alias_input_containers():
    cards = [PhysicalCard.standard(Suit.HEARTS, Rank.SEVEN, index) for index in range(3)]
    ids = [card.card_id for card in cards]
    meld = Meld(MeldType.TUNNELA, ids)
    committed, shown = set(ids), [meld]
    player = PlayerState('p', cards, QualificationRoute.NORMAL, shown, committed, True)
    ids.clear(); cards.clear(); committed.clear(); shown.clear()
    assert len(player.hand) == len(player.committed_card_ids) == len(meld.card_ids) == 3
    assert player.shown_melds == (meld,) and player.initial_melds_shown and not player.dublee_mode
    with pytest.raises(FrozenInstanceError):
        player.hand[0].rank = Rank.ACE
    with pytest.raises(FrozenInstanceError):
        meld.card_ids = ()
    with pytest.raises(AttributeError):
        player.committed_card_ids.add('x')
    with pytest.raises(ValueError):
        replace(player, hand=player.hand[:-1])
    with pytest.raises(ValueError):
        replace(player, shown_melds=(meld, meld))
    with pytest.raises(ValueError):
        replace(player, committed_card_ids=frozenset())


def test_structural_meld_and_hand_validation():
    with pytest.raises(ValueError):
        Meld(MeldType.DUBLEE, ['D0:7H', 'D0:7H'])
    with pytest.raises(ValueError):
        Meld(MeldType.DUBLEE, 'D0:7H')
    with pytest.raises(ValueError):
        Meld('dublee', ['D0:7H'])
    with pytest.raises(ValueError):
        PlayerState('p', [PhysicalCard.man(0)] * 2)
    with pytest.raises(ValueError):
        CardIdentity('H', Rank.SEVEN)


def test_ace_sequence_and_maal_policies_are_separate_from_shared_rank_value():
    order = sequence_rank_order()
    assert Rank.ACE.value == 14
    assert order[:3] == (Rank.ACE, Rank.TWO, Rank.THREE)
    assert order[-1] == Rank.KING and len(set(order)) == 13
    assert adjacent_maal_ranks(Rank.ACE) == (Rank.KING, Rank.TWO)
    assert adjacent_maal_ranks(Rank.KING) == (Rank.QUEEN, Rank.ACE)
    assert adjacent_maal_ranks(Rank.TWO) == (Rank.ACE, Rank.THREE)
    assert adjacent_maal_ranks(Rank.SEVEN) == (Rank.SIX, Rank.EIGHT)
    with pytest.raises(ValueError):
        sequence_rank_order('low_only')
    with pytest.raises(ValueError):
        adjacent_maal_ranks(7)
    with pytest.raises(ValueError):
        adjacent_maal_ranks(Rank.ACE, AceSequencePolicy.LOW_ONLY)
