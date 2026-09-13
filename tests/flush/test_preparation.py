from random import Random
import json
import pytest
from card_utils import deal
from flush import (FlushGameEngine, FlushRulesConfig, GameStatus, FlushError,
                   DealCards, CutDeck, SkipCut, InvariantError)


def game():
    return FlushGameEngine(['a', 'b', 'c'], initial_chips=dict.fromkeys('abc', 100),
                           rules=FlushRulesConfig(5), rng=Random(4), dealer_id='c')


def reject(engine, fn):
    before, rng = engine.get_state(), engine._rng.getstate()
    with pytest.raises(FlushError): fn()
    assert engine.get_state() is before and engine._rng.getstate() == rng


@pytest.mark.parametrize('cut', [None, 1, 26, 51])
def test_manual_dealer_then_next_player_cut_or_skip(cut):
    e = game()
    e.start_game()
    assert e.get_state().status is GameStatus.AWAITING_DEAL
    assert e.get_allowed_actions('c').kinds == ('deal_cards',)
    assert e.get_allowed_actions('a').kinds == ()
    reject(e, lambda: e.deal_cards('a'))
    reject(e, lambda: e.skip_cut('a'))
    e.apply_action('c', DealCards())
    assert e.get_state().status is GameStatus.AWAITING_CUT
    assert e.get_allowed_actions('a').kinds == ('cut_deck', 'skip_cut')
    reject(e, lambda: e.deal_cards('c'))
    reject(e, lambda: e.skip_cut('c'))
    reject(e, lambda: e.see_cards('a'))
    reject(e, lambda: e.bet('a', 1))
    reject(e, lambda: e.fold('a'))
    for bad in (True, 0, 52, 2.5): reject(e, lambda: e.cut_deck('a', bad))
    state = e.get_state()
    assert state.pot == 0 and all(p.chips == 100 and not p.cards for p in state.players)
    for viewer in 'abc':
        safe = json.dumps(e.get_player_view(viewer).to_dict())
        assert 'stock' not in safe and e.get_player_view(viewer).cards == ()
    deck = state.stock if cut is None else state.stock[cut:] + state.stock[:cut]
    expected, stock = deal(deck, 3, 3)
    e.apply_action('a', SkipCut() if cut is None else CutDeck(cut))
    assert e.get_state().status is GameStatus.IN_PROGRESS
    assert tuple(p.cards for p in e.get_state().players) == tuple(expected)
    assert e.get_state().stock == stock
    assert e.get_state().current_player_id == 'a'
    assert e.get_state().pot == 15 and all(p.chips == 95 for p in e.get_state().players)
    reject(e, lambda: e.skip_cut('a'))
    reject(e, lambda: e.start_game())


def test_shuffle_failure_rolls_back_randomness(monkeypatch):
    import flush.engine as module
    e = game(); control = game()
    e.start_game(); control.start_game()
    before, rng = e.get_state(), e._rng.getstate()
    with monkeypatch.context() as patch:
        def fail(state): raise InvariantError('injected failure')
        patch.setattr(module, 'validate_game_state', fail)
        with pytest.raises(InvariantError): e.deal_cards('c')
    assert e.get_state() is before and e._rng.getstate() == rng
    e.deal_cards('c'); control.deal_cards('c')
    assert e.get_state() == control.get_state()


def test_winner_continues_same_table_with_carried_balances_and_net_history():
    e = game()
    e.start_game(); e.deal_cards('c'); e.skip_cut('a')
    e.bet('a', 3); e.fold('b'); e.fold('c')
    first = e.get_state()
    assert first.settlement.winner_ids == ('a',)
    assert [p.amount for p in first.round_results[0].net_changes] == [10, -5, -5]
    assert e.get_allowed_actions('a').kinds == ('start_next_round',)
    reject(e, lambda: e.start_next_round('c'))
    e.start_next_round('a')
    second = e.get_state()
    assert second.round_number == 2 and second.config.dealer_id == 'a'
    assert second.round_results == first.round_results
    assert [p.chips for p in second.players] == [110, 95, 95]
    assert second.pot == 0 and second.revision == first.revision + 1
    assert all(not p.cards and p.turn_bet_count == 0 for p in second.players)
    reject(e, lambda: e.start_next_round('a'))
    reject(e, lambda: e.deal_cards('c'))
    e.deal_cards('a'); e.cut_deck('b', 26)
    assert e.get_state().current_blind_bet == 1
    e.fold('b'); e.fold('c')
    assert len(e.get_public_view().round_results) == 2
    assert [sum(r.net_changes[i].amount for r in e.get_public_view().round_results)
            for i in range(3)] == [20, -10, -10]
    assert [p.chips for p in e.get_state().players] == [120, 90, 90]
