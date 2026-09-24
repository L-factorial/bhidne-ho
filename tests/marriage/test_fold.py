from marriage import MarriageRules, ScoringRules
from dataclasses import asdict
from random import Random

import pytest
from marriage import MarriageGameEngine, DrawSource, InvalidActionError, validate_game_state


def game(count=3):
    engine = MarriageGameEngine(tuple(str(i) for i in range(count)), rng=Random(8), rules=MarriageRules(scoring=ScoringRules(initial_tunnela_declaration=False)))
    engine.start_game()
    return engine


def test_fold_off_turn_is_private_idempotent_rejected_and_skips_turns():
    engine = game()
    hand = engine.get_state().players[1].hand
    engine.fold('1')
    assert engine.get_state().current_player_id == '0'
    assert engine.get_player_view('1').actions.kinds == ()
    assert engine.get_public_view().players[1].folded
    assert engine.get_state().players[1].hand == hand
    assert not any(c.card_id in repr(asdict(engine.get_public_view())) for c in hand)
    before = engine.get_state()
    with pytest.raises(InvalidActionError):
        engine.fold('1')
    with pytest.raises(InvalidActionError):
        engine.draw_card('1', DrawSource.STOCK)
    assert engine.get_state() is before
    engine.draw_card('0', DrawSource.STOCK)
    engine.discard_card('0', engine.get_allowed_actions('0').discardable_card_ids[0])
    assert engine.get_state().current_player_id == '2'
    validate_game_state(engine.get_state())


@pytest.mark.parametrize('drawn', [False, True])
def test_current_player_fold_advances_without_discarding_or_losing_cards(drawn):
    engine = game()
    if drawn:
        engine.draw_card('0', DrawSource.STOCK)
    before = engine.get_state()
    engine.fold('0')
    assert engine.get_state().players[0].hand == before.players[0].hand
    assert engine.get_state().current_player_id == '1'
    assert engine.get_state().phase.value == 'must_draw'
    assert not engine.get_state().must_finish
    validate_game_state(engine.get_state())


@pytest.mark.parametrize('actor', ['0', '1'])
def test_last_player_wins_without_declaring_or_exposing_hand(actor):
    engine = game(2)
    engine.fold(actor)
    state = engine.get_state()
    assert state.won_by_fold and state.status.value == 'finished'
    assert state.winner != actor
    assert state.normal_finish is None and not state.winning_pair
    scores = engine.get_scores()
    assert sorted(p.net_points for p in scores.players) == [-10, 10]
    assert sum(p.net_points for p in scores.players) == 0
    assert scores.total_maal == 0
    for player in state.players:
        assert not any(c.card_id in repr(asdict(engine.get_public_view())) for c in player.hand)
    validate_game_state(state)
