"""Automatic Maal selection retains the normal qualification/reveal flow."""
from dataclasses import replace
from random import Random
import pytest
from marriage import MarriageGameEngine, MarriageRules, ScoringRules, DrawSource, validate_game_state
from test_show_order import dealt, groups, pass_turn


def hosted(count=4):
    game=dealt(groups(),count)
    game._state=replace(game.get_state(),config=replace(game.get_state().config,rules=replace(game.get_state().config.rules,manual_maal_cut=True)))
    return game


@pytest.mark.parametrize('count',[2,3,4,5])
def test_small_game_selects_on_show_and_first_turn_uses_regular_private_reveal(count):
    game=hosted(count)
    assert game.get_state().tiplu is None
    result=game.show_initial_melds('0',groups())
    assert [e.kind for e in result.events]==['MELDS_SHOWN','TIPLU_REVEALED','PLAYER_SAW_MAAL']
    assert game.get_player_view('0').maal is not None
    assert game.get_player_view('1').maal is None
    assert all(k.value!='cut_maal' for k in game.get_allowed_actions('0').kinds)
    game.draw_card('0',DrawSource.STOCK)
    validate_game_state(game.get_state())


def test_later_show_reveals_after_discard_without_an_extra_action():
    game=hosted()
    for _ in range(4):pass_turn(game)
    game.draw_card('0',DrawSource.STOCK);game.show_initial_melds('0',groups())
    assert game.get_state().tiplu is not None and game.get_player_view('0').maal is None
    game.discard_card('0',game.get_allowed_actions('0').discardable_card_ids[-1])
    assert game.get_player_view('0').maal is not None
    assert game.get_state().current_player_id=='1'
    validate_game_state(game.get_state())


def test_six_player_deal_preselects_hidden_indicator_and_reuses_it(monkeypatch):
    source=dealt(groups(),6).get_state()
    monkeypatch.setattr('marriage.engine.deal_cards',lambda *_:(tuple(p.hand for p in source.players),source.stock+source.discard))
    game=MarriageGameEngine(tuple(str(i) for i in range(6)),rules=MarriageRules(manual_maal_cut=True,scoring=ScoringRules(initial_tunnela_declaration=False)),rng=Random(11))
    game.start_game();tiplu=game.get_state().tiplu
    assert tiplu is not None and len(game.get_state().stock)==31
    assert all(game.get_player_view(str(i)).maal is None for i in range(6))
    game.show_initial_melds('0',groups())
    assert game.get_player_view('0').maal.tiplu==tiplu.identity
    assert len([e for e in game.get_state().history if e.kind=='TIPLU_REVEALED'])==1
    validate_game_state(game.get_state())


@pytest.mark.parametrize('later',[False,True])
def test_saved_pending_cut_resumes_through_regular_draw_or_discard(later):
    game=hosted()
    if later:
        for _ in range(4):pass_turn(game)
        game.draw_card('0',DrawSource.STOCK)
    before=game.get_state();result=game.show_initial_melds('0',groups())
    shown=game.get_state()
    # Older local checkpoints could have committed showing without selecting Maal.
    players=tuple(replace(p,has_seen_maal=False) if p.player_id=='0' else p for p in shown.players)
    game._state=replace(before,players=players,revision=shown.revision,history=before.history+(result.events[0],))
    validate_game_state(game.get_state())
    if later:game.discard_card('0',game.get_allowed_actions('0').discardable_card_ids[-1])
    else:game.draw_card('0',DrawSource.STOCK)
    assert game.get_player_view('0').maal is not None
    validate_game_state(game.get_state())
