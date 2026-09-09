import json
from random import Random

import pytest

from card_utils import Rank, shuffle, standard_52
from callbreak import (
    AcceptHand, ClaimRedeal, GameConfig, GameQuery, Phase, PlaceBid, PlayCard, Redeal, RedealPolicy,
    StartDeal, Transition, apply_control, apply_player, available_cards, create_match,
)


def next_state(result):
    assert isinstance(result, Transition), result
    return result.state


@pytest.fixture(params=[4, 5])
def match_states(request):
    n = request.param
    state = create_match(GameConfig(n))
    rng = Random(24)
    states = [state]
    while state.phase != Phase.MATCH_COMPLETE:
        if state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
            result = apply_control(state, StartDeal(shuffle(standard_52(), rng=rng)))
        elif state.phase == Phase.HAND_REVIEW:
            player = next(p for p in state.config.players if p not in state.current_deal.accepted_hands)
            result = apply_player(state, player, AcceptHand())
        elif state.phase == Phase.BIDDING:
            result = apply_player(state, state.current_player, PlaceBid(1))
        else:
            player = state.current_player
            result = apply_player(state, player, PlayCard(available_cards(state, player)[0]))
        state = next_state(result)
        states.append(state)
    return states


def test_initial_queries_and_invalid_lookups():
    q = GameQuery(create_match())
    assert q.get_state()["deal_number"] is None
    assert q.get_deal() is None and q.get_current_trick() is None
    assert q.get_bids() == q.get_deal_table() == q.get_tricks() == []
    assert q.get_deals() == []
    assert q.get_turn() == {"player_id": None, "action": None,
                            "pending_players": [], "controller_action": "START_DEAL"}
    assert all(row["deal_scores_tenths"] == [None] * 5 for row in q.get_scoreboard())
    assert q.get_player(1)["total_tricks_won"] == 0
    for value in (True, 0, 6, "1"):
        with pytest.raises(ValueError):
            q.get_deal(value)
        with pytest.raises(ValueError):
            q.get_trick(value if value != 6 else 14)
    for value in (True, 0, 5, "1"):
        with pytest.raises(ValueError):
            q.get_player(value)
        with pytest.raises(ValueError):
            q.get_player_view(value)
    with pytest.raises(LookupError):
        q.get_deal(1)
    with pytest.raises(LookupError):
        q.get_trick(1)


def test_rules_show_effective_configuration():
    config = GameConfig(5, redeal_policy=RedealPolicy(False, Rank.QUEEN, True))
    rules = GameQuery(create_match(config)).get_rules()
    assert (rules["cards_per_player"], rules["tricks_per_deal"], rules["plays_per_trick"]) == (10, 10, 5)
    assert rules["undealt_count"] == 2
    assert rules["redeal"]["weak_hand_threshold"] == "QUEEN"
    assert rules["redeal"]["weak_hand_enabled"] is False
    assert rules["redeal"]["no_spades_enabled"] is True
    assert rules["trump"] == "S" and rules["bid_max"] == 10
    assert rules["scoring"]["unit"] == "tenths"


def test_live_queries_across_phases(match_states):
    for state in match_states:
        q = GameQuery(state)
        status = q.get_state()
        turn = q.get_turn()
        assert status["revision"] == state.revision
        assert turn["player_id"] == state.current_player
        if state.phase == Phase.HAND_REVIEW:
            assert turn["action"] == "REVIEW_HAND"
            assert turn["pending_players"] == [p for p in state.config.players if p not in state.current_deal.accepted_hands]
            assert q.get_current_trick() is None
        elif state.phase == Phase.BIDDING:
            assert turn["action"] == "PLACE_BID"
            assert q.get_bids() == [{"player_id": p.player_id, "bid": p.bid} for p in state.current_deal.players]
        elif state.phase == Phase.PLAYING:
            trick = q.get_current_trick()
            assert trick["current_player"] == state.current_player
            assert trick["winner"] is None and not trick["complete"]
            assert trick["plays_required"] == state.config.player_count
            assert q.get_trick(trick["trick_number"]) == trick
            if trick["plays_completed"]:
                assert trick["winning_player"] is not None
                assert trick["led_suit"] is not None
            assert all(row["score_tenths"] is None for row in q.get_deal_table())
        elif state.phase in (Phase.DEAL_COMPLETE, Phase.MATCH_COMPLETE):
            assert q.get_current_trick() is None
            assert q.get_deal()["complete"]
            assert sum(row["tricks_won"] for row in q.get_deal_table()) == state.config.tricks_per_deal
            assert all(row["cards_remaining"] == 0 for row in q.get_deal_table())
        # Every public result is directly JSON serializable without a custom encoder.
        json.dumps([status, turn, q.get_rules(), q.get_deal(), q.get_scoreboard()])


def test_history_and_deal_table_remain_accessible_after_match(match_states):
    state = match_states[-1]
    q = GameQuery(state)
    assert q.get_state()["finished"] and q.get_state()["active_deal_number"] is None
    assert [d["deal_number"] for d in q.get_deals()] == [1, 2, 3, 4, 5]
    assert q.get_turn()["pending_players"] == [] and q.get_turn()["controller_action"] is None
    for number, completed in enumerate(state.completed_deals, 1):
        deal = q.get_deal(number)
        assert deal["tricks_completed"] == state.config.tricks_per_deal
        table = q.get_deal_table(number)
        for i, row in enumerate(table):
            assert row["player_id"] == i + 1
            assert row["tricks_won"] == completed.result.tricks_won[i]
            assert row["score_tenths"] == completed.result.score_tenths[i]
        for trick in q.get_tricks(number):
            assert trick["complete"] and trick["winner"] == trick["winning_player"]
            assert q.get_trick(trick["trick_number"], deal_number=number) == trick
    for row in q.get_scoreboard():
        assert sum(row["deal_scores_tenths"]) == row["total_score_tenths"]
        assert row["is_winner"] == (row["player_id"] in state.winners)
        assert q.get_player(row["player_id"])["total_tricks_won"] == sum(
            d.result.tricks_won[row["player_id"] - 1] for d in state.completed_deals)


def test_private_queries_and_detached_snapshot(match_states):
    state = next(s for s in match_states if s.phase == Phase.HAND_REVIEW)
    q = GameQuery(state)
    public_outputs = [q.get_state(), q.get_deal(), q.get_rules(), q.get_scoreboard(),
                      *(q.get_player(p) for p in state.config.players)]
    def check_keys(value):
        if isinstance(value, dict):
            assert not set(value) & {"hand", "undealt_cards", "abandoned_attempts", "redeal_reasons", "legal_cards"}
            for child in value.values():
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)
    check_keys(public_outputs)
    for p in state.config.players:
        private = q.get_player_view(p)
        assert private["hand"] == list(map(str, state.current_deal.players[p - 1].hand))
        assert private["legal_cards"] == [] and private["can_accept_hand"]
        json.dumps(private)
        private["hand"].clear()
        assert q.get_player_view(p)["hand"]
    output = q.get_deal()
    output["players"][0]["bid"] = 99
    assert q.get_bids()[0]["bid"] is None
    updated = next_state(apply_player(state, 1, AcceptHand()))
    assert q.get_state()["revision"] == state.revision
    assert GameQuery(updated).get_state()["revision"] == state.revision + 1
    assert q.get_player_view(1)["can_accept_hand"]
    assert not GameQuery(updated).get_player_view(1)["can_accept_hand"]


def test_queries_during_redeal_hide_abandoned_hands():
    cards = standard_52()
    desired = iter(cards[:13])
    others = iter(cards[13:])
    # Deal player 2 only clubs; dealer 1 deals to player 2 first.
    deck = tuple(next(desired) if i % 4 == 0 else next(others) for i in range(52))
    state = next_state(apply_control(create_match(), StartDeal(deck)))
    assert GameQuery(state).get_player_view(2)["can_claim_redeal"]
    state = next_state(apply_player(state, 2, ClaimRedeal()))
    q = GameQuery(state)
    assert q.get_turn() == {"player_id": None, "action": None,
                            "pending_players": [], "controller_action": "REDEAL"}
    assert q.get_player_view(2)["hand"] == []
    assert q.get_player_view(2)["redeal_reasons"] == []
    state = next_state(apply_control(state, Redeal(cards)))
    q = GameQuery(state)
    assert len(q.get_deals()) == 1 and q.get_deal()["attempt"] == 2
    assert q.get_tricks() == [] and q.get_current_trick() is None
