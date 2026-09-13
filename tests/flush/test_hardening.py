import ast
import json
from dataclasses import replace
from pathlib import Path
from random import Random
import subprocess
import sys

import pytest
from flush import (FlushGameEngine, FlushRulesConfig, InvalidActionError, InvariantError,
                   validate_game_state, Visibility, FlushHandEvaluator)

ROOT = Path(__file__).resolve().parents[2]


def new():
    return FlushGameEngine(['a', 'b'], initial_chips={'a': 100, 'b': 100},
                           rules=FlushRulesConfig(5, 10, minimum_bet_rounds_before_side_show=0,
                                                  minimum_blind_rounds_before_show=0), rng=Random(12))


def test_no_platform_imports_and_standard_library_only_scenario():
    for path in (ROOT / 'flush').glob('*.py'):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                assert all(a.name.split('.')[0] in sys.stdlib_module_names | {'card_utils', 'flush'} for a in node.names)
            if isinstance(node, ast.ImportFrom) and node.level == 0:
                assert node.module.split('.')[0] in sys.stdlib_module_names | {'card_utils', 'flush'}
    script = '''
import sys
sys.path.insert(0, sys.argv[1])
from flush import FlushGameEngine, FlushRulesConfig
from random import Random
engine = FlushGameEngine(['a', 'b'], initial_chips={'a': 100, 'b': 100}, rules=FlushRulesConfig(5, 10), rng=Random(1))
engine.start_game()
engine.deal_cards(engine.get_state().current_player_id)
engine.skip_cut(engine.get_state().current_player_id)
engine.fold('b')
assert engine.get_state().settlement.winner_ids == ('a',)
assert not any(name.split('.')[0] in {'app', 'callbreak', 'marriage', 'pydantic', 'fastapi'} for name in sys.modules)
'''
    result = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(ROOT)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_failed_start_audit_rolls_back_randomness_and_state(monkeypatch):
    import flush.engine as module
    e, control = new(), new()
    original = module.validate_game_state
    def fail(state):
        raise InvariantError('injected audit failure')
    before, rng = e.get_state(), e._rng.getstate()
    monkeypatch.setattr(module, 'validate_game_state', fail)
    with pytest.raises(InvariantError):
        e.start_game()
        e.deal_cards(e.get_state().current_player_id)
        e.skip_cut(e.get_state().current_player_id)
    assert e.get_state() is before and e._rng.getstate() == rng
    monkeypatch.setattr(module, 'validate_game_state', original)
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    control.start_game()
    control.deal_cards(control.get_state().current_player_id)
    control.skip_cut(control.get_state().current_player_id)
    assert e.get_state() == control.get_state()


def test_failed_show_evaluation_does_not_charge_or_publish(monkeypatch):
    e = new()
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    e.show('b')
    before = e.get_state()
    def fail(*args):
        raise RuntimeError('injected evaluator failure')
    monkeypatch.setattr(FlushHandEvaluator, 'evaluate', fail)
    with pytest.raises(RuntimeError):
        e.reveal_cards('a')
    assert e.get_state() is before


def test_audit_detects_card_accounting_and_turn_corruption():
    e = new()
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    s = e.get_state()
    for broken in (replace(s, stock=s.stock[:-1]), replace(s, pot=s.pot + 1),
                   replace(s, current_seat=8), replace(s, current_blind_bet=20),
                   replace(s, players=(replace(s.players[0], chips=96), replace(s.players[1], chips=94)))):
        with pytest.raises(InvariantError):
            validate_game_state(broken)


def test_privacy_matrix_fold_win_and_event_cursors():
    e = new()
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    own = tuple(str(c) for c in e.get_state().players[1].cards)
    other = tuple(str(c) for c in e.get_state().players[0].cards)
    e.see_cards('b')
    assert e.get_player_view('b').cards == own
    for view in (e.get_public_view().to_dict(), e.get_player_view('a').to_dict()):
        serialized = json.dumps(view)
        assert all(f'"{c}"' not in serialized for c in (*own, *other))
    assert not any(c in json.dumps([event.to_dict() for event in e.get_visible_events()]) for c in (*own, *other))
    cursor = e.get_visible_events()[-1].sequence
    assert e.get_visible_events(after=cursor) == ()
    e.fold('b')
    assert e.get_player_view('b').cards == own  # previously seen cards remain private
    assert e.get_player_view('a').cards == ()  # blind winner is not revealed
    assert e.get_public_view().settlement.shown_hands == ()
    assert all(event.sequence > cursor for event in e.get_visible_events(after=cursor))
    for bad in (-1, True, 1.5):
        with pytest.raises(InvalidActionError):
            e.get_visible_events(after=bad)
    for query in (e.get_player_view, e.get_allowed_actions, e.get_visible_events):
        with pytest.raises(InvalidActionError):
            query('unknown')
    e._state = replace(e.get_state(), history=(replace(e.get_state().history[0], kind='UNPROJECTED'),))
    with pytest.raises(InvalidActionError):
        e.get_visible_events()


@pytest.mark.parametrize('ids,balances', [(['a'], {'a': 100}), (['a', 'a'], {'a': 100}),
    (['a', 'b'], {'a': 100}), (['a', 'b'], {'a': 100, 'b': True}),
    (['a', 'b'], {'a': 100, 'b': -1}), (['a', ''], {'a': 100, '': 100})])
def test_bad_rosters_and_balances(ids, balances):
    with pytest.raises(ValueError):
        FlushGameEngine(ids, initial_chips=balances, rules=FlushRulesConfig(5, 10))
