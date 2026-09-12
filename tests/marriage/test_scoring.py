from dataclasses import replace

import pytest

from marriage import (MarriageGameEngine, MarriageRules, PhysicalCard, Rank, Suit,
                      PlayerState, Meld, MeldType, QualificationRoute, GameStatus)
from marriage.maal import maal_view
from marriage.scoring import calculate_scores, score_items
from marriage.scoring_rules import ScoringRules, SCORING_PRESETS


def card(rank, pack=0, suit=Suit.HEARTS):
    return PhysicalCard.standard(suit, Rank(rank), pack)


def score(hand, rules=ScoringRules(), seen=True, melds=()):
    player = PlayerState('a', tuple(hand), shown_melds=melds,
                         committed_card_ids=frozenset(i for m in melds for i in m.card_ids), has_seen_maal=seen)
    return score_items(player, maal_view(card(8, 2), MarriageRules()), rules)


def test_best_disjoint_marriages_duplicates_and_man():
    hand = [card(r, p) for r in (7, 8, 9) for p in (0, 1)] + [PhysicalCard.man(0)]
    items = score(hand)
    assert [(i.label, i.count, i.points) for i in items] == [('Marriage', 2, 25), ('Man', 1, 2)]
    # If custom marriage totals are lower, individual Maal must win instead.
    items = score(hand, replace(ScoringRules(), marriage=(0, 0, 0)))
    assert sum(i.points for i in items) == 20
    assert all(i.label != 'Marriage' for i in items)
    assert sum(i.points for i in score(hand, SCORING_PRESETS['simple'])) == 16


def test_tunnela_scope_eligibility_and_additive_bonus():
    hand = [card(7, p) for p in range(3)]
    meld = Meld(MeldType.TUNNELA, tuple(c.card_id for c in hand))
    assert sum(i.points for i in score(hand)) == 10
    assert sum(i.points for i in score(hand, melds=(meld,))) == 15
    assert sum(i.points for i in score(hand, replace(ScoringRules(), tunnela_scope='hand'))) == 15
    assert sum(i.points for i in score(hand, replace(ScoringRules(), tunnela_scope='off'), melds=(meld,))) == 10
    assert score(hand, seen=False, melds=(meld,)) == ()
    assert sum(i.points for i in score(hand, replace(ScoringRules(), maal_requires_seen=False), seen=False, melds=(meld,))) == 15


@pytest.mark.parametrize('count', [2, 3, 4, 5])
@pytest.mark.parametrize('requires_seen', [True, False])
def test_settlement_is_zero_sum_and_uses_selected_policy(count, requires_seen):
    rules = replace(ScoringRules(), seen_payment=4, unseen_payment=12, dublee_win_bonus=6,
                    maal_requires_seen=requires_seen)
    engine = MarriageGameEngine(tuple(str(i) for i in range(count)), rules=MarriageRules(scoring=rules))
    assert engine.get_scores() is None
    assert engine.get_public_view().scores is None
    players = tuple(PlayerState(str(i), (PhysicalCard.man(i),) if i < 3 else (),
                                has_seen_maal=i % 2 == 0,
                                route=QualificationRoute.DUBLEE if i == 0 else QualificationRoute.UNQUALIFIED)
                    for i in range(count))
    # A small trusted valuation fixture; legal finish paths are tested through the adapter.
    state = replace(engine.get_state(), status=GameStatus.FINISHED, winner='0', tiplu=card(8, 2), players=players)
    result = calculate_scores(state)
    assert sum(p.net_points for p in result.players) == 0
    assert sum(p.maal_net for p in result.players) == 0
    assert sum(p.winner_payment for p in result.players) == 0
    for p in result.players[1:]:
        assert p.winner_payment == -(4 if p.has_seen_maal else 12) - 6
        assert p.net_points == count * p.maal_points - result.total_maal + p.winner_payment
    assert calculate_scores(replace(state, status=GameStatus.IN_PROGRESS)) is None


def test_ace_neighbors_and_suit_specific_maal():
    player = PlayerState('a', (card(13), card(14), card(2), card(14, 1, Suit.SPADES)), has_seen_maal=True)
    items = score_items(player, maal_view(card(14, 2), MarriageRules()), ScoringRules())
    assert [(i.label, i.points) for i in items] == [('Marriage', 10)]


@pytest.mark.parametrize('value', [{'tiplu': [1, 2]}, {'tiplu': [True, 2, 3]}, {'seen_payment': -1},
                                  {'man': [0, 0, 1001]}, {'tunnela_scope': 'secret'},
                                  {'maal_requires_seen': 1}, {'unseen_payment': '10'}, {'other': 3}])
def test_invalid_rules_rejected(value):
    with pytest.raises(ValueError):
        ScoringRules.from_dict(value)
