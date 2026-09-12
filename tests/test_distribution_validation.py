from dataclasses import replace

import pytest

from card_utils import deal, standard_52
from callbreak import (GameConfig, Phase, StartDeal, Redeal, StartDistribution,
                       PrepareDeal, ShuffleDeck, CompleteShuffle, SkipCut,
                       Transition, apply_control, apply_player, create_match)
import callbreak.engine as engine


def ready(count, route):
    state = create_match(GameConfig(count))
    if route == "manual":
        state = apply_control(state, PrepareDeal()).state
        state = apply_player(state, state.current_player, ShuffleDeck()).state
        state = apply_control(state, CompleteShuffle(standard_52())).state
        state = apply_player(state, state.current_player, SkipCut()).state
        return state, lambda s: apply_player(s, s.current_player, StartDistribution())
    if route == "redeal":
        state = apply_control(state, StartDeal(standard_52())).state
        state = replace(state, phase=Phase.AWAITING_REDEAL)
        return state, lambda s: apply_control(s, Redeal(standard_52()))
    return state, lambda s: apply_control(s, StartDeal(standard_52()))


@pytest.mark.parametrize("count", [4, 5])
@pytest.mark.parametrize("route", ["direct", "manual", "redeal"])
@pytest.mark.parametrize("fault", ["duplicate_across_players", "duplicate_in_hand", "missing",
                                   "extra", "wrong_sizes", "missing_player", "wrong_undealt"])
def test_corrupt_distribution_is_rejected_before_state_or_events(monkeypatch, count, route, fault):
    state, dispatch = ready(count, route)
    original = repr(state)
    hands, unused = deal(standard_52(), count, 52 // count)
    hands = [list(hand) for hand in hands]
    unused = list(unused)
    if fault == "duplicate_across_players": hands[1][0] = hands[0][0]
    elif fault == "duplicate_in_hand": hands[0][1] = hands[0][0]
    elif fault == "missing": hands[0].pop()
    elif fault == "extra": hands[0].append(hands[1][0])
    elif fault == "wrong_sizes": hands[0].append(hands[1].pop())
    elif fault == "missing_player": hands.pop()
    elif fault == "wrong_undealt":
        if unused: unused[0] = hands[0][0]
        else: unused.append(hands[0].pop())
    monkeypatch.setattr(engine, "distribute", lambda *args: (hands, unused))
    result = dispatch(state)
    assert result.code == "INVALID_DISTRIBUTION"
    assert not isinstance(result, Transition)  # No state or private-card events published.
    assert repr(state) == original


@pytest.mark.parametrize("count", [4, 5])
@pytest.mark.parametrize("route", ["direct", "manual", "redeal"])
def test_valid_distribution_accounts_for_every_standard_card(count, route):
    state, dispatch = ready(count, route)
    result = dispatch(state)
    assert isinstance(result, Transition)
    current = result.state.current_deal
    assert [len(p.hand) for p in current.players] == [52 // count] * count
    assert len(current.undealt_cards) == 52 % count
    cards = [card for p in current.players for card in p.hand] + list(current.undealt_cards)
    assert len(cards) == len(set(cards)) == 52
    assert set(cards) == set(standard_52())
