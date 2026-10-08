from dataclasses import replace
from random import Random
import json
import pytest
from card_utils import Card, standard_52
from flush import (FlushGameEngine, FlushRulesConfig, RequestSideShow, AcceptSideShow, DeclineSideShow,
                   Bet, SeeCards, Fold, Show, FlushError, PlayerStatus, GameStatus, validate_game_state)


def game():
    e = FlushGameEngine(['a', 'b', 'c', 'd'],
        rules=FlushRulesConfig(5, 10, allow_side_show=True, minimum_bet_rounds_before_side_show=0), rng=Random(2))
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    for p in 'bcda':
        e.see_cards(p)
        e.bet(p, 20)
    return e  # b's turn; previous active seen is a


def test_request_pauses_turns_decline_returns_requester_without_charge():
    e = game()
    pot_before = e.get_state().pot
    e.apply_action('b', RequestSideShow())
    request = e.get_state().pending_side_show
    assert (request.requester_id, request.target_id) == ('b', 'a')
    assert e.get_state().pot == pot_before
    assert e.get_state().current_player_id == 'a'
    assert e.get_allowed_actions('a').kinds == ('accept_side_show', 'decline_side_show')
    assert e.get_allowed_actions('b').kinds == ()
    for p in 'abcd':
        for action in (Bet(20), SeeCards(), Fold(), Show(), RequestSideShow()):
            before = e.get_state()
            with pytest.raises(FlushError): e.apply_action(p, action)
            assert e.get_state() is before
    with pytest.raises(FlushError): e.accept_side_show('b')
    e.apply_action('a', DeclineSideShow())
    assert e.get_state().current_player_id == 'b'
    assert e.get_state().pot == pot_before
    assert e.get_allowed_actions('b').kinds == ('fold', 'bet')
    e.bet('b', 20)
    assert e.get_state().current_player_id == 'c'
    assert e.get_state().pending_side_show is None
    assert not e.get_state().side_shows
    assert all(e.get_player_view(p).side_show is None for p in 'abcd')


def test_side_show_records_large_contribution_without_a_balance():
    e = game()
    e.bet('b', 1000000)
    before = e.get_state().pot
    assert 'request_side_show' in e.get_allowed_actions('c').kinds
    e.request_side_show('c')
    assert e.get_state().pot == before
    e.decline_side_show('b')
    assert e.get_state().current_player_id == 'c'
    e.bet('c', 1000000)
    assert e.get_state().current_player_id == 'd'
    validate_game_state(e.get_state())


def test_accept_privacy_loser_folds_and_round_continues():
    e = game()
    e.request_side_show('b')
    before = e.get_state().pot
    e.apply_action('a', AcceptSideShow())
    assert e.get_state().pot == before
    assert e.get_allowed_actions('b').kinds == ('reveal_side_show',)
    assert all(e.get_player_view(p).side_show is None for p in 'abcd')
    e.reveal_side_show('b')
    s = e.get_state(); result = s.side_shows[-1]
    assert s.status is GameStatus.IN_PROGRESS and s.settlement is None
    assert s.current_player_id == 'c' and s.pot == before + 20
    assert next(p for p in s.players if p.player_id == result.loser_id).status is PlayerStatus.FOLDED
    for p, opponent in [('a', 'b'), ('b', 'a')]:
        view = e.get_player_view(p)
        assert view.side_show.opponent_id == opponent
        assert view.side_show.opponent_cards == tuple(str(c) for c in next(x for x in s.players if x.player_id == opponent).cards)
        assert view.side_show.won == (result.winner_id == p)
    assert e.get_player_view('c').side_show is None and e.get_player_view('d').side_show is None
    public = json.dumps(e.get_public_view().to_dict())
    events = json.dumps([event.to_dict() for event in e.get_visible_events()])
    for p in s.players:
        assert all(f'"{c}"' not in public + events for c in p.cards)
    assert not any(event.shown_hands for event in e.get_visible_events())
    validate_game_state(s)


def test_tie_requester_loses_even_when_terminal_tie_policy_is_split():
    from flush import TiePolicy
    e = game()
    hands = [tuple(Card.parse(c) for c in h.split()) for h in ['AS KH 9C', 'AH KC 9D', '2S 3H 4C', '5S 6H 7C']]
    used = {c for h in hands for c in h}
    e._state = replace(e.get_state(), config=replace(e.get_state().config, rules=replace(e.get_state().config.rules, tie_policy=TiePolicy.SPLIT)),
        players=tuple(replace(p, cards=h) for p, h in zip(e.get_state().players, hands)), stock=tuple(c for c in standard_52() if c not in used))
    e.request_side_show('b'); e.accept_side_show('a'); e.reveal_side_show('b')
    assert e.get_state().side_shows[-1].loser_id == 'b'


def test_previous_seen_skips_blind_and_folded_and_needs_three_active():
    e = game()
    # a is the prior seat but blind in this validated fixture; d is next prior seen.
    from flush import Visibility
    e._state = replace(e.get_state(), players=tuple(replace(p, visibility=Visibility.BLIND) if p.player_id == 'a' else p for p in e.get_state().players))
    e.request_side_show('b')
    assert e.get_state().pending_side_show.target_id == 'd'
    e.decline_side_show('d')
    e.bet('b', 20); e.fold('c'); e.fold('d')
    assert not e.can_side_show('a').allowed


def test_side_show_defaults_on_but_blind_cannot_request():
    assert FlushRulesConfig(5,10).allow_side_show
    assert FlushRulesConfig(5,10).minimum_bet_rounds_before_side_show == 3
    e = FlushGameEngine(['a','b','c'], rules=FlushRulesConfig(5,10))
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    assert not e.can_side_show('b').allowed
    with pytest.raises(FlushError): e.request_side_show('b')


@pytest.mark.parametrize('threshold', [0, 1, 3, 5])
@pytest.mark.parametrize('blind_first', [False, True])
def test_side_show_requires_completed_personal_bets(threshold, blind_first):
    e = FlushGameEngine(['a', 'b', 'c'],
        dealer_id='b', rules=FlushRulesConfig(5, 10, allow_side_show=True,
                              minimum_bet_rounds_before_side_show=threshold))
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    for player in 'ca':
        e.see_cards(player)
        e.bet(player, 20)
    # Boot never qualifies; seen bets and blind bets both qualify.
    if not blind_first:
        e.see_cards('b')
    for count in range(threshold):
        assert e.get_state().current_player_id == 'b'
        assert not e.can_side_show('b').allowed
        before = e.get_state()
        with pytest.raises(FlushError):
            e.request_side_show('b')
        assert e.get_state() is before
        for player in 'bca':
            e.bet(player, e.get_allowed_actions(player).required_bet)
    if blind_first:
        e.see_cards('b')
    assert e.get_state().players[1].turn_bet_count == threshold
    assert e.can_side_show('b').allowed
    e.request_side_show('b')
    assert e.get_state().pending_side_show.target_id == 'a'


@pytest.mark.parametrize('leaving', ['a', 'b', 'c'])
def test_departure_fold_handles_pending_side_show(leaving):
    e = game()
    e.request_side_show('b')
    before = e.get_state()
    e.fold_for_leave(leaving)
    state = e.get_state()
    assert next(p for p in state.players if p.player_id == leaving).status is PlayerStatus.FOLDED
    assert state.pot == before.pot
    assert bool(state.pending_side_show) == (leaving == 'c')
    assert not state.side_shows
    assert not any(event.shown_hands for event in e.get_visible_events())
    validate_game_state(state)


def test_accepted_request_cannot_reveal_off_turn_or_charge_twice():
    e = game(); before = e.get_state().pot
    e.request_side_show('b'); e.accept_side_show('a')
    accepted = e.get_state()
    for actor in 'acd':
        with pytest.raises(FlushError): e.reveal_side_show(actor)
        assert e.get_state() is accepted
    with pytest.raises(FlushError): e.bet('b', 20)
    e.reveal_side_show('b')
    assert e.get_state().pot == before + 20
    resolved = e.get_state()
    with pytest.raises(FlushError): e.reveal_side_show('b')
    assert e.get_state() is resolved


def test_every_remaining_player_minimum_bets_gate_final_show():
    e = game()
    e._state = replace(e.get_state(), config=replace(e.get_state().config,
        rules=replace(e.get_state().config.rules, require_minimum_bets_by_everyone=True, minimum_bets_before_show=2)))
    e.fold('b'); e.fold('c')
    assert not e.can_show('d').allowed
    e.bet('d', 20); e.bet('a', 20)
    assert e.can_show('d').allowed


def test_rejected_request_is_available_on_the_next_regular_turn():
    e = game()
    e.request_side_show('b'); e.decline_side_show('a')
    assert not e.can_side_show('b').allowed
    for player in 'bcda':
        e.bet(player, 20)
    assert e.can_side_show('b').allowed
    before = e.get_state().pot
    e.request_side_show('b')
    assert e.get_state().pot == before


def test_side_show_threshold_includes_every_remaining_players_bets():
    e = game()
    state = e.get_state()
    e._state = replace(state, config=replace(state.config,
        rules=replace(state.config.rules, minimum_bet_rounds_before_side_show=3)),
        players=tuple(replace(p, turn_bet_count=3) if p.player_id == 'b' else p for p in state.players))
    assert not e.can_side_show('b').allowed, 'Requester alone cannot complete three cycles'
    for player in 'bcdabcda':
        e.bet(player, 20)
    assert e.can_side_show('b').allowed
