from dataclasses import replace
from random import Random
import json
import pytest
from card_utils import Card, standard_52
from flush import (FlushGameEngine, FlushRulesConfig, RequestSideShow, AcceptSideShow, DeclineSideShow,
                   Bet, SeeCards, Fold, Show, FlushError, PlayerStatus, GameStatus, validate_game_state)


def game():
    e = FlushGameEngine(['a', 'b', 'c', 'd'], initial_chips=dict.fromkeys('abcd', 1000),
        rules=FlushRulesConfig(5, 10, allow_side_show=True, minimum_bet_rounds_before_side_show=0), rng=Random(2))
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    for p in 'bcda':
        e.see_cards(p)
        e.bet(p, 20)
    return e  # b's turn; previous active seen is a


def test_request_pauses_turns_decline_advances_without_revealing():
    e = game()
    before = e.get_state().pot
    e.apply_action('b', RequestSideShow())
    request = e.get_state().pending_side_show
    assert (request.requester_id, request.target_id) == ('b', 'a')
    assert e.get_state().pot == before + 20
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
    assert e.get_state().current_player_id == 'c'
    assert e.get_state().pending_side_show is None
    assert not e.get_state().side_shows
    assert all(e.get_player_view(p).side_show is None for p in 'abcd')


def test_accept_privacy_loser_folds_and_round_continues():
    e = game()
    e.request_side_show('b')
    before = e.get_state().pot
    e.apply_action('a', AcceptSideShow())
    s = e.get_state(); result = s.side_shows[-1]
    assert s.status is GameStatus.IN_PROGRESS and s.settlement is None
    assert s.current_player_id == 'c' and s.pot == before
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
    e.request_side_show('b'); e.accept_side_show('a')
    assert e.get_state().side_shows[-1].loser_id == 'b'


def test_previous_seen_skips_blind_and_folded_and_needs_three_active():
    e = game()
    # a is the prior seat but blind in this validated fixture; d is next prior seen.
    from flush import Visibility
    e._state = replace(e.get_state(), players=tuple(replace(p, visibility=Visibility.BLIND) if p.player_id == 'a' else p for p in e.get_state().players))
    e.request_side_show('b')
    assert e.get_state().pending_side_show.target_id == 'd'
    e.decline_side_show('d')
    e.fold('c'); e.fold('d')
    assert not e.can_side_show('a').allowed


def test_side_show_is_opt_in_and_blind_cannot_request():
    e = FlushGameEngine(['a','b','c'], initial_chips=dict.fromkeys('abc', 100), rules=FlushRulesConfig(5,10))
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    assert not e.can_side_show('b').allowed
    with pytest.raises(FlushError): e.request_side_show('b')


@pytest.mark.parametrize('threshold', [0, 1, 3, 5])
@pytest.mark.parametrize('blind_first', [False, True])
def test_side_show_requires_completed_personal_bets(threshold, blind_first):
    e = FlushGameEngine(['a', 'b', 'c'], initial_chips=dict.fromkeys('abc', 1000),
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
