from dataclasses import replace
from random import Random
import pytest
from flush import FlushGameEngine, FlushRulesConfig, FlushError
from flush.turns import raises_used


def dealt(rules):
    engine = FlushGameEngine(['a','b','c'],rules=rules,rng=Random(4),dealer_id='a')
    engine.start_game();engine.deal_cards('a');engine.skip_cut('b')
    return engine


@pytest.mark.parametrize('bad',[0,6,-1,True,1.5,'2','',None])
def test_bad_max_raise_defaults_to_one(bad):
    assert FlushRulesConfig(5,max_raise=bad).max_raise==1


@pytest.mark.parametrize('count',[1,2,3,4,5])
def test_table_wide_double_cap_and_reset(count):
    engine=dealt(FlushRulesConfig(5,5,allow_raise=True,max_raise=count))
    for index in range(count):
        actor=engine.get_state().current_player_id
        view=engine.get_player_view(actor)
        assert view.actions.raises_remaining==count-index
        assert view.actions.maximum_bet==view.actions.required_bet*2
        engine.bet(actor,view.actions.maximum_bet)
    actor=engine.get_state().current_player_id
    view=engine.get_player_view(actor)
    before=engine.get_state()
    assert raises_used(before)==count and view.actions.raises_remaining==0
    with pytest.raises(FlushError):engine.bet(actor,view.actions.required_bet*2)
    assert engine.get_state() is before
    engine.see_cards(actor)
    assert engine.get_player_view(actor).actions.raises_remaining==0
    engine.bet(actor,engine.get_player_view(actor).actions.required_bet)
    while engine.get_state().settlement is None:engine.fold(engine.get_state().current_player_id)
    winner=engine.get_state().settlement.winner_ids[0]
    engine.prepare_next_round(winner);engine.deal_cards(winner);engine.skip_cut(engine.get_state().current_player_id)
    assert raises_used(engine.get_state())==0
    assert engine.get_player_view(engine.get_state().current_player_id).actions.raises_remaining==count


def test_disabled_raise_rejects_double_without_mutation():
    engine=dealt(FlushRulesConfig(5,5,allow_raise=False))
    actor=engine.get_state().current_player_id
    before=engine.get_state()
    with pytest.raises(FlushError):engine.bet(actor,10)
    assert engine.get_state() is before
    engine.bet(actor,5)
