from dataclasses import replace

import pytest
from card_utils import standard_52
from flush import FlushGameEngine, FlushRulesConfig, FlushError, GameStatus, validate_game_state


def game(**rules):
    engine = FlushGameEngine(['a', 'b', 'c'], rules=FlushRulesConfig(0, **rules))
    engine.start_game(); engine.deal_cards('a'); engine.skip_cut('b')
    return engine


def bet_round(engine):
    for _ in range(3):
        actor = engine.get_state().current_player_id
        engine.bet(actor, engine.get_allowed_actions(actor).required_bet)


def hands(engine, rank):
    # Preserve the complete deck while giving the requester a known winning Trial.
    deck = list(standard_52())
    trial = tuple(c for c in deck if c.rank == rank)[:3]
    rest = [c for c in deck if c not in trial]
    holdings = (tuple(rest[:3]), trial, tuple(rest[3:6]))
    engine._state = replace(engine.get_state(), players=tuple(
        replace(p, cards=cards) for p, cards in zip(engine.get_state().players, holdings)), stock=tuple(rest[6:]))
    validate_game_state(engine.get_state())


def test_multiplayer_blind_show_waits_three_complete_rounds_and_reveals_in_sequence():
    engine = game()
    for _ in range(2):
        bet_round(engine)
    assert not engine.can_show('b').allowed
    engine.bet('b', 1); engine.bet('c', 1)
    assert not engine.can_show('a').allowed  # The third cycle is still incomplete.
    engine.bet('a', 1)
    engine.show('b')
    assert [h.player_id for h in engine.get_state().revealed_hands] == ['b']
    assert engine.get_allowed_actions('a').kinds == ('reveal_cards', 'fold')
    engine.reveal_cards('a')
    assert engine.get_state().status is GameStatus.IN_PROGRESS
    assert [h.player_id for h in engine.get_state().revealed_hands] == ['b', 'a']
    assert engine.get_allowed_actions('c').kinds == ('reveal_cards', 'fold')
    engine.reveal_cards('c')
    state = engine.get_state()
    assert state.status is GameStatus.FINISHED
    assert {h.player_id for h in state.settlement.shown_hands} == {'a', 'b', 'c'}
    assert sum(p.amount for p in state.round_results[-1].net_changes) == 0
    assert any(e.kind == 'CARDS_REVEALED' and e.shown_hands for e in engine.get_visible_events())


def test_disabled_multiplayer_blind_show_and_seen_requester_cannot_show_with_three():
    engine = game(allow_multiplayer_blind_show=False)
    for _ in range(3): bet_round(engine)
    with pytest.raises(FlushError): engine.show('b')
    engine = game()
    for _ in range(3): bet_round(engine)
    engine.see_cards('b')
    with pytest.raises(FlushError): engine.show('b')


@pytest.mark.parametrize('rank,trial,ace,expected', [
    (13, 8, 0, 1),  # Trial is capped at the current blind bet.
    (13, 0, None, 0),
    (14, 1, None, 1),  # Ace replaces Trial, and defaults to minimum bet.
    (14, 1, 0, 0),
])
def test_salami_is_zero_sum_and_paid_by_every_other_player(rank, trial, ace, expected):
    engine = game(minimum_rounds_before_multiplayer_blind_show=0, trial_bonus=trial, ace_trial_bonus=ace)
    hands(engine, rank)
    engine.show('b'); engine.fold('a'); engine.reveal_cards('c')
    state = engine.get_state()
    assert state.settlement.winner_ids == ('b',)
    assert {p.player_id: p.amount for p in state.settlement.salami_transfers} == (
        {'a': -expected, 'b': expected * 2, 'c': -expected} if expected else {})
    assert sum(p.amount for p in state.settlement.payouts) == state.pot
    assert sum(p.amount for p in state.round_results[-1].net_changes) == 0
    validate_game_state(state)


def test_unrevealed_fold_win_does_not_pay_salami():
    engine = game(trial_bonus=1)
    hands(engine, 14)
    engine.fold('b'); engine.fold('c')
    assert not engine.get_state().settlement.salami_transfers


@pytest.mark.parametrize('leaving', ['a', 'b', 'c'])
def test_departure_during_multiplayer_show_keeps_the_remaining_response_actionable(leaving):
    engine = game(minimum_rounds_before_multiplayer_blind_show=0)
    engine.show('b'); engine.fold_for_leave(leaving)
    while engine.get_state().pending_show:
        validate_game_state(engine.get_state())
        engine.reveal_cards(engine.get_state().pending_show.target_id)
    assert engine.get_state().status is GameStatus.FINISHED
    assert leaving not in engine.get_state().settlement.winner_ids


@pytest.mark.parametrize('values', [{'trial_bonus': True}, {'trial_bonus': -1},
    {'ace_trial_bonus': -1}, {'allow_multiplayer_blind_show': 1}, {'minimum_rounds_before_multiplayer_blind_show': -1}])
def test_invalid_salami_and_multiplayer_settings_rejected(values):
    with pytest.raises(ValueError): FlushRulesConfig(0, **values)
