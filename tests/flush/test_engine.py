import json
from dataclasses import FrozenInstanceError, replace
from random import Random

import pytest

from flush import (FlushGameEngine, FlushRulesConfig, GameStatus, Visibility, PlayerStatus,
                   Bet, SeeCards, Fold, Show, RevealCards, FlushError, InvalidActionError, InvalidTurnError,
                   InsufficientChipsError, UnsupportedRuleError, TiePolicy, TerminationReason,
                   validate_game_state, Card)
from card_utils import standard_52


def engine(n=2, chips=1000, seed=7, **rules):
    ids = tuple(f'p{i}' for i in range(n))
    e = FlushGameEngine(ids, initial_chips=dict.fromkeys(ids, chips),
                        rules=FlushRulesConfig(boot_amount=rules.pop('boot_amount', 10),
                                              initial_blind_bet=rules.pop('initial_blind_bet', 10), **rules), rng=Random(seed))
    e.start_game()
    e.deal_cards(e.get_state().current_player_id)
    e.skip_cut(e.get_state().current_player_id)
    return e


def bet(e):
    actor = e.get_state().current_player_id
    return e.apply_action(actor, Bet(e.get_allowed_actions(actor).required_bet))


def unchanged(e, fn, error=FlushError):
    state, rng = e.get_state(), e._rng.getstate()
    with pytest.raises(error):
        fn()
    assert e.get_state() is state
    assert e._rng.getstate() == rng


@pytest.mark.parametrize('n', [2, 3, 4, 5, 10])
def test_start_conservation_boot_turn_and_privacy(n):
    e = engine(n, maximum_players=max(n, 5))
    s = e.get_state()
    validate_game_state(s)
    assert s.current_player_id == 'p1' and s.revision == 3
    assert s.pot == 10 * n and len(s.stock) == 52 - 3 * n
    assert all(p.chips == 990 and p.blind_bet_count == p.turn_bet_count == 0
               and p.visibility is Visibility.BLIND and p.status is PlayerStatus.ACTIVE for p in s.players)
    assert all(e.get_player_view(p.player_id).cards == () for p in s.players)
    public = e.get_public_view().to_dict()
    assert 'stock' not in public and all('cards' not in p for p in public['players'])
    assert public['rules_locked']
    json.dumps(public)
    assert not any(event.shown_hands for event in e.get_visible_events())
    unchanged(e, e.start_game)


@pytest.mark.parametrize('threshold', [0, 1, 3, 5])
def test_seeing_is_immediate_regardless_of_side_show_threshold_and_retains_turn(threshold):
    e = engine(minimum_bet_rounds_before_side_show=threshold)
    unchanged(e, lambda: e.see_cards('p0'))
    result = e.apply_action('p1', SeeCards())
    assert result.events[0].kind == 'CARDS_SEEN'
    assert e.get_state().current_player_id == 'p1'
    own = e.get_player_view('p1')
    assert len(own.cards) == 3 and own.actions.required_bet == 20
    assert e.get_player_view('p0').cards == ()
    assert not e.get_visible_events()[-1].shown_hands
    unchanged(e, lambda: e.see_cards('p1'))
    unchanged(e, lambda: e.bet('p1', 10))
    before = e.get_state().pot
    e.bet('p1', 20)
    assert e.get_state().pot == before + 20
    assert e.get_state().players[1].blind_bet_count == 0
    assert e.get_state().players[1].turn_bet_count == 1


def test_custom_multiplier_zero_boot_insufficient_bets_and_turns():
    e = engine(chips=10, boot_amount=0, minimum_bet_rounds_before_side_show=0,
               blind_to_seen_bet_multiplier=3)
    e.see_cards('p1')
    assert e.get_allowed_actions('p1').required_bet == 30
    assert 'bet' not in e.get_allowed_actions('p1').kinds
    unchanged(e, lambda: e.bet('p1', 30), InsufficientChipsError)
    unchanged(e, lambda: e.bet('p0', 10), InvalidTurnError)
    e.fold('p1')
    assert e.get_state().settlement.winner_ids == ('p0',)
    assert e.get_state().pot == 0


@pytest.mark.parametrize('amount', [True, False, 0, -1, 9, 10.0, '10', None, float('nan'), float('inf')])
def test_invalid_bets_are_atomic(amount):
    e = engine()
    unchanged(e, lambda: e.bet('p1', amount))


def test_fold_skips_players_and_terminal_actions_are_rejected():
    e = engine(4)
    e.fold('p1')
    assert e.get_state().current_player_id == 'p2'
    for _ in range(3):
        bet(e)
    assert e.get_state().current_player_id == 'p2'
    unchanged(e, lambda: e.fold('p1'))
    e.fold('p2')
    e.fold('p3')
    s = e.get_state()
    assert s.status is GameStatus.FINISHED and s.current_player_id is None
    assert s.settlement.reason is TerminationReason.LAST_PLAYER_REMAINING
    assert s.settlement.winning_hand is None and not s.settlement.shown_hands
    assert s.held_pot == 0 and sum(p.chips for p in s.players) == 4000
    for action in (Bet(10), SeeCards(), Fold(), Show(), object()):
        unchanged(e, lambda: e.apply_action('p0', action))
    assert all(not e.get_player_view(p.player_id).cards for p in s.players)


@pytest.mark.parametrize('blind', [True, False])
def test_show_eligibility_cost_and_reveals_only_final_two(blind):
    e = engine(3, minimum_bet_rounds_before_side_show=0, minimum_blind_rounds_before_show=1,
               maximum_active_players_for_blind_show=5)
    unchanged(e, lambda: e.show('p1'))  # maximum never overrides exactly two
    e.fold('p1')
    unchanged(e, lambda: e.show('p2'))  # personal threshold
    bet(e)
    bet(e)
    if not blind:
        e.see_cards('p2')
    before = e.get_state()
    cost = 10 if blind else 20
    assert e.can_show('p2').allowed
    e.apply_action('p2', Show())
    e.reveal_cards('p0')
    after = e.get_state()
    assert after.pot == before.pot + cost
    assert after.players[2].blind_bet_count == 1  # show is not a qualifying bet
    assert sum(p.chips for p in after.players) == 3000
    shown = e.get_public_view().to_dict()['settlement']['shown_hands']
    assert {h['player_id'] for h in shown} == {'p0', 'p2'}
    assert 'p1' not in {p for p, cards in e.get_visible_events()[-1].shown_hands}
    assert all('cards' not in p for p in e.get_public_view().to_dict()['players'])
    json.dumps(e.get_player_view('p2').to_dict())


@pytest.mark.parametrize('rules,seen', [({'allow_blind_show': False}, False), ({'allow_seen_show': False}, True)])
def test_show_flags(rules, seen):
    e = engine(minimum_bet_rounds_before_side_show=0, minimum_blind_rounds_before_show=0, **rules)
    if seen:
        e.see_cards('p1')
    assert not e.can_show('p1').allowed
    unchanged(e, lambda: e.show('p1'))


def test_show_affordability_and_free_show():
    e = engine(chips=10, minimum_blind_rounds_before_show=0)
    unchanged(e, lambda: e.show('p1'), InsufficientChipsError)
    e = engine(chips=10, minimum_blind_rounds_before_show=0, show_cost_multiplier=0)
    e.show('p1')
    assert e.get_state().pot == 20


def fixture_hands(e, hands):
    # Test-only immutable fixture: preserve the exact canonical deck and accounting.
    cards = tuple(tuple(Card.parse(c) for c in hand.split()) for hand in hands)
    used = {c for hand in cards for c in hand}
    e._state = replace(e.get_state(), players=tuple(replace(p, cards=h) for p, h in zip(e.get_state().players, cards)),
                       stock=tuple(c for c in standard_52() if c not in used))
    validate_game_state(e.get_state())


@pytest.mark.parametrize('policy,winners,payouts', [
    (TiePolicy.REQUESTER_LOSES, ('p1',), (35,)),
    (TiePolicy.SPLIT, ('p1', 'p0'), (18, 17)),
])
def test_equal_hands_ties_and_odd_chips(policy, winners, payouts):
    e = engine(3, boot_amount=5, minimum_blind_rounds_before_show=0, tie_policy=policy)
    fixture_hands(e, ['AS KH 9C', 'AH KC 9D', '2S 3H 4C'])
    bet(e)  # p1 adds 10; p2 folds; p0 requests show and adds 10
    e.fold('p2')
    e.show('p0')
    e.reveal_cards('p1')
    result = e.get_state().settlement
    assert result.winner_ids == winners
    assert tuple(p.amount for p in result.payouts) == payouts
    validate_game_state(e.get_state())


def test_rules_and_inputs_are_frozen_deterministic_and_queries_pure():
    ids = ['a', 'b']
    chips = dict.fromkeys(ids, 100)
    rng = Random(9)
    rules = FlushRulesConfig(1, 2)
    a = FlushGameEngine(ids, initial_chips=chips, rules=rules, rng=rng)
    b = FlushGameEngine(ids, initial_chips=chips, rules=rules, rng=Random(9))
    ids.reverse()
    chips['a'] = 0
    rng.random()
    with pytest.raises(FrozenInstanceError):
        rules.boot_amount = 99
    a.start_game()
    a.deal_cards(a.get_state().current_player_id)
    a.skip_cut(a.get_state().current_player_id)
    b.start_game()
    b.deal_cards(b.get_state().current_player_id)
    b.skip_cut(b.get_state().current_player_id)
    for _ in range(10):
        unchanged(a, lambda: a.bet('unknown', 2))
        a.get_player_view('a').to_dict()['public']['players'][0]['chips'] = -1
        a.get_public_view()
        a.get_visible_events()
        bet(a)
        bet(b)
        assert a.get_state() == b.get_state()


def test_rejected_start_and_all_waiting_commands_leave_rng_untouched():
    e = FlushGameEngine(['a', 'b'], initial_chips={'a': 2, 'b': 20}, rules=FlushRulesConfig(10, 10), rng=Random(0))
    unchanged(e, e.start_game, InsufficientChipsError)
    for action in (Bet(10), SeeCards(), Fold(), Show()):
        unchanged(e, lambda: e.apply_action('a', action))
    assert not e.get_public_view().rules_locked


@pytest.mark.parametrize('kwargs', [{'boot_amount': True}, {'initial_blind_bet': 0},
    {'minimum_bet_rounds_before_side_show': -1}, {'minimum_blind_rounds_before_show': 1.5},
    {'blind_to_seen_bet_multiplier': False}, {'maximum_active_players_for_blind_show': 1},
    {'maximum_players': 18}, {'minimum_players': 1}, {'allow_blind_show': 1},
    {'sequence_ace_policy': 'bogus'}, {'tie_policy': 'bogus'}, {'show_cost_multiplier': -1}])
def test_invalid_rules(kwargs):
    with pytest.raises(ValueError):
        FlushRulesConfig(**{'boot_amount': 10, 'initial_blind_bet': 10, **kwargs})


def test_unsupported_multiplayer_show_configuration():
    with pytest.raises(UnsupportedRuleError):
        FlushRulesConfig(10, 10, show_only_when_two_players_remain=False)


@pytest.mark.parametrize('n', [2, 3, 4, 5])
def test_seeded_rounds_conserve_state_and_legal_actions_agree(n):
    for seed in range(10):
        e = engine(n, seed=seed)
        rng = Random(seed)
        for step in range(150):
            if e.get_state().status is GameStatus.FINISHED:
                break
            actor = e.get_state().current_player_id
            actions = e.get_allowed_actions(actor)
            kind = rng.choice(actions.kinds) if step < 100 else 'fold'
            action = {'bet': Bet(actions.required_bet), 'see_cards': SeeCards(), 'fold': Fold(), 'show': Show(), 'reveal_cards': RevealCards()}[kind]
            e.apply_action(actor, action)
            validate_game_state(e.get_state())
        assert e.get_state().status is GameStatus.FINISHED


@pytest.mark.parametrize('multiplier', [2, 3])
def test_raises_update_both_minimums_without_lowering_stake(multiplier):
    e = engine(3, initial_blind_bet=1, blind_to_seen_bet_multiplier=multiplier)
    e.bet('p1', 4)
    assert e.get_public_view().current_blind_bet == 4
    assert e.get_public_view().current_seen_bet == 4 * multiplier
    e.see_cards('p2')
    assert e.get_allowed_actions('p2').required_bet == 4 * multiplier
    unchanged(e, lambda: e.bet('p2', 4 * multiplier - 1))
    raised = 4 * multiplier + 1
    e.bet('p2', raised)
    assert e.get_public_view().current_seen_bet == raised
    assert e.get_allowed_actions('p0').required_bet == 5
    unchanged(e, lambda: e.bet('p0', 4))
    unchanged(e, lambda: e.bet('p0', 10000))
    e.see_cards('p0')
    assert e.get_allowed_actions('p0').required_bet == raised
    e.bet('p0', raised)
    assert e.get_public_view().current_seen_bet == raised
    e.bet('p1', 6)
    assert e.get_allowed_actions('p2').required_bet == 6 * multiplier
    assert e.get_allowed_actions('p2').show_cost == 6 * multiplier
    validate_game_state(e.get_state())


def test_initial_blind_bet_defaults_to_one():
    assert FlushRulesConfig(boot_amount=0).initial_blind_bet == 1
