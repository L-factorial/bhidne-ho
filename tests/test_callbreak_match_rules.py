from dataclasses import asdict, replace
from random import Random

import pytest
from pydantic import ValidationError

from card_utils import shuffle, standard_52
from callbreak import GameConfig, Phase, PlaceBid, PlayCard, RedealPolicy, StartDeal, apply_control, apply_player, available_cards, create_match
from callbreak.audit import audit_match
from callbreak.deals import CompletedDeal, DealResult, DealState
from callbreak.match_rules import MatchRules, rules_from_settings
from callbreak.scoring import score_deal
from callbreak.settlement import settlement_amounts
from app.test_games.http import GameSettings


def play_deal(n, rules, seed=0, bids=None):
    rng = Random(seed)
    state = create_match(GameConfig(n, redeal_policy=RedealPolicy(weak_hand_enabled=False, no_spades_enabled=False), match_rules=rules))
    state = apply_control(state, StartDeal(shuffle(standard_52(), rng=rng))).state
    while state.phase == Phase.BIDDING:
        player = state.current_player
        state = apply_player(state, player, PlaceBid(bids[player - 1] if bids else rules.instant_win_bid)).state
    while state.phase == Phase.PLAYING:
        player = state.current_player
        state = apply_player(state, player, PlayCard(rng.choice(available_cards(state, player)))).state
    audit_match(state)
    return state


@pytest.mark.parametrize('n,target', [(4, 8), (5, 6)])
def test_exact_high_bid_stops_on_target_trick_and_pays_equal_shares(n, target):
    rules = MatchRules(instant_win_enabled=True, instant_win_bid=target)
    states = [play_deal(n, rules, seed) for seed in range(35)]
    wins = [state for state in states if state.phase == Phase.MATCH_COMPLETE]
    assert wins, 'Exercise the configured default high bid with legal play.'
    for state in wins:
        assert state.win_reason == 'instant_bid'
        assert state.current_deal.tricks_won[state.winners[0] - 1] == target
        assert not state.completed_deals
        assert available_cards(state, state.winners[0]) == ()
        values = settlement_amounts(state, [6, 12, 18, 24])
        assert sum(values) == 0
        assert len(set(v for v in values if v < 0)) == 1
        assert apply_player(state, 1, PlaceBid(1)).code == 'MATCH_FINISHED'
    failures = [state for state in states if state.phase == Phase.DEAL_COMPLETE]
    assert failures
    assert all(state.score_tenths == (-target * 10,) * n for state in failures)


def scored_match(scores, rules, bids=None, tricks=None):
    """Arithmetic fixture; legal history/auditing is covered by play_deal tests."""
    n = len(scores)
    result = DealResult(bids or (2,) * n, tricks or (2,) * n, tuple(scores))
    deals = tuple(CompletedDeal(DealState(i, 1, 1, (), ()),
                  result if i == 5 else replace(result, score_tenths=(0,) * n)) for i in range(1, 6))
    return replace(create_match(GameConfig(n, match_rules=rules)), phase=Phase.MATCH_COMPLETE, completed_deals=deals)


@pytest.mark.parametrize('n,scale,threshold', [(4, 10, 20), (5, 8, 15)])
def test_inclusive_winner_threshold_strict_negative_and_stacking(n, scale, threshold):
    rules = MatchRules(bonus_conversion_enabled=True, bonus_per_point=scale, double_win_enabled=True,
                      double_win_threshold=threshold, negative_payment_enabled=True)
    scores = [threshold * scale, 0, -1, -scale] + ([-2 * scale] if n == 5 else [])
    state = scored_match(scores, rules)
    amounts = settlement_amounts(state, [6, 12, 18, 24])
    assert amounts[1] == -12  # Zero is not negative.
    assert amounts[2] == -48  # Winner x2 and negative opponent x2.
    assert sum(amounts) == 0
    below = scored_match([scores[0] - 1, *scores[1:]], rules)
    assert settlement_amounts(below, [6, 12, 18, 24])[2] == -24


def test_perfect_one_joint_winners_override_scores_and_split_remaining_placements():
    rules = MatchRules(perfect_bid_enabled=True, double_win_enabled=True, negative_payment_enabled=True)
    state = scored_match([50, 50, 300, -50], rules, (1, 1, 4, 2), (1, 1, 8, 3))
    assert state.winners == (1, 2)
    assert state.win_reason == 'perfect_bid'
    assert settlement_amounts(state, [6, 12, 18, 0]) == (15, 15, -12, -18)
    broken = replace(state.completed_deals[0], result=replace(state.completed_deals[0].result, tricks_won=(2, 1, 7, 3)))
    assert replace(state, completed_deals=(broken, *state.completed_deals[1:])).winners == (2,)
    assert scored_match([50, 50, 300, -50], replace(rules, perfect_bid_enabled=False), (1, 1, 4, 2), (1, 1, 8, 3)).winners == (3,)


def test_editable_perfect_target_and_multiplier_values():
    state = scored_match([100, 250, -5, 50], MatchRules(perfect_bid_enabled=True, perfect_bid=2),
                         (2, 4, 3, 1), (2, 7, 3, 1))
    assert state.winners == (1,)
    state = scored_match([100, 90, 0, -5], MatchRules(double_win_enabled=True, double_win_threshold=10,
                         winner_multiplier=3, negative_payment_enabled=True, negative_threshold=-1, negative_multiplier=4))
    assert settlement_amounts(state, [6, 12, 18, 0]) == (108, -18, -36, -54)


def test_perfect_co_winners_still_share_payout_when_opponents_tie():
    state = scored_match([50, 50, 100, 100], MatchRules(perfect_bid_enabled=True),
                         (1, 1, 4, 2), (1, 1, 8, 3))
    assert settlement_amounts(state, [6, 12, 18, 0]) == (15, 15, -15, -15)


def test_bonus_units_accumulate_without_rounding_and_disabled_keeps_legacy():
    rules = MatchRules(bonus_conversion_enabled=True, bonus_per_point=8)
    points = score_deal((1, 1, 1, 1, 1), (3, 2, 2, 2, 1), rules.score_scale)
    assert points == (10, 9, 9, 9, 8)
    assert rules.score_scale == 8
    assert replace(rules, bonus_conversion_enabled=False).score_scale == 10
    assert score_deal((1, 1, 1, 1, 1), (3, 2, 2, 2, 1)) == (12, 11, 11, 11, 10)


@pytest.mark.parametrize('values', [dict(instant_win_enabled='yes'), dict(bonus_per_point=True),
    dict(bonus_per_point=0), dict(instant_win_bid=14), dict(winner_multiplier=1), dict(unknown=True)])
def test_http_rejects_invalid_or_coerced_rule_values(values):
    with pytest.raises(ValidationError):
        GameSettings(match_id='m', match_rules=values)


def test_payment_validation_and_capacity_defaults():
    assert rules_from_settings({}, 5).instant_win_bid == 6
    assert rules_from_settings({}, 5).bonus_per_point == 8
    assert rules_from_settings({}, 5).double_win_threshold == 15
    with pytest.raises(ValueError, match='multiple'):
        MatchRules(instant_win_enabled=True).validate_for(4, [1, 2, 4, 0])
    with pytest.raises(ValueError, match='equally'):
        MatchRules(perfect_bid_enabled=True).validate_for(4, [6, 12, 19, 0])
    with pytest.raises(ValueError, match='trick count'):
        MatchRules(instant_win_bid=11).validate_for(5)


async def test_configured_terminal_checkpoint_roundtrip_and_legacy_defaults():
    from tests.test_hosted_checkpoints import make_host, resign
    from app.durable_games.checkpoints import capture_checkpoint, decode_checkpoint
    host, game = await make_host('callbreak')
    try:
        rules = MatchRules(instant_win_enabled=True, instant_win_bid=1)
        game.settings['match_rules'] = asdict(rules)
        game.state = play_deal(4, rules)
        record = capture_checkpoint(game, table_revision=1)
        restored = decode_checkpoint(record).engine_state
        assert restored == game.state and restored.win_reason == 'instant_bid'
        game.state = create_match(GameConfig())
        game.settings.pop('match_rules')
        record = capture_checkpoint(game, table_revision=2)
        record['data']['engine']['state']['config'].pop('match_rules')
        restored = decode_checkpoint(resign(record)).engine_state
        assert restored.config.match_rules is None and restored.config.score_scale == 10
    finally:
        await host.close()


@pytest.mark.parametrize('n', [4, 5])
def test_custom_bonus_full_match_replays_losslessly(n):
    from callbreak.replay import Replay, Entry
    config = GameConfig(n, redeal_policy=RedealPolicy(weak_hand_enabled=False, no_spades_enabled=False),
                        match_rules=MatchRules(bonus_conversion_enabled=True, bonus_per_point=8, perfect_bid_enabled=True))
    state, entries = create_match(config), []
    rng = Random(41)
    while state.phase != Phase.MATCH_COMPLETE:
        if state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
            actor, command = None, StartDeal(shuffle(standard_52(), rng=rng))
            transition = apply_control(state, command)
        else:
            actor = state.current_player
            command = PlaceBid(1) if state.phase == Phase.BIDDING else PlayCard(rng.choice(available_cards(state, actor)))
            transition = apply_player(state, actor, command)
        entries.append(Entry(actor, command))
        state = transition.state
    audit_match(state)
    assert Replay.loads(Replay(config, 1, tuple(entries)).dumps()).restore() == state
    for p in config.players:
        bonus = sum(max(0, d.result.tricks_won[p - 1] - d.result.bids[p - 1]) for d in state.completed_deals)
        base = sum(d.result.bids[p - 1] * (1 if d.result.tricks_won[p - 1] >= d.result.bids[p - 1] else -1) for d in state.completed_deals)
        assert state.score_tenths[p - 1] == base * 8 + bonus


async def test_rules_require_unanimous_approval_and_freeze_at_start():
    from tests.test_rule_proposals import make, vote
    from fastapi import HTTPException
    host, game, _ = await make('callbreak', capacity=4)
    try:
        rules = MatchRules(instant_win_enabled=True)
        await host.configure('r', 'u0', GameSettings(match_id=game.match_id, match_rules=rules, payments=[6, 12, 18, 0]))
        assert 'match_rules' not in game.settings
        for user in ['u1', 'u2', 'u3']:
            await vote(host, game, user, True)
        await host.start('r', 'u0', game.match_id)
        assert game.state.config.match_rules == rules
        with pytest.raises(HTTPException):
            await host.configure('r', 'u0', GameSettings(match_id=game.match_id))
    finally:
        await host.close()


async def test_durable_proposal_rejects_indivisible_payments_without_mutation():
    from types import SimpleNamespace
    from tests.test_hosted_checkpoints import make_host
    from app.durable_games.rules_commands import apply_rules
    host, game = await make_host('callbreak')
    try:
        request = SimpleNamespace(command='settings', match_id=game.match_id, command_id='rules-1',
            payload={'payments': [1, 2, 4, 0], 'match_rules': asdict(MatchRules(instant_win_enabled=True))})
        assert 'multiple' in apply_rules(game, 'u0', request, 'lane')
        assert game.rule_proposal is None
        request.payload['payments'] = [6, 12, 18, 0]
        assert apply_rules(game, 'u0', request, 'lane') is None
        assert game.rule_proposal['proposed']['match_rules']['instant_win_enabled'] is True
        assert 'match_rules' not in game.settings
    finally:
        await host.close()
