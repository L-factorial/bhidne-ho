from random import Random

import pytest

from card_utils import shuffle, standard_52
from callbreak import (
    ClaimRedeal, CompleteShuffle, CutDeck, GameConfig, GameQuery, Phase, PlaceBid, PlayCard,
    PrepareDeal, Redeal, RedealPolicy, ShuffleDeck, SkipCut, StartDeal, StartDistribution, Transition,
    apply_control, apply_player, available_cards, create_match,
)
from callbreak.audit import audit_match
from callbreak.replay import Entry, Replay
from callbreak.views import public_view, player_view
from app.adapters.callbreak import parse_player_command
from app.adapters.callbreak.preparation import control_preparation, dispatch_preparation, PreparationResult


def ok(result):
    assert isinstance(result, (Transition, PreparationResult)), result
    audit_match(result.state)
    return result.state


@pytest.mark.parametrize("count", [4, 5])
@pytest.mark.parametrize("skip", [False, True])
def test_prepare_shuffle_cut_replay_and_privacy(count, skip):
    config = GameConfig(count)
    state = create_match(config, initial_dealer=count)
    deck = shuffle(standard_52(), rng=Random(7))
    entries = [Entry(None, PrepareDeal()), Entry(count, ShuffleDeck()),
               Entry(None, CompleteShuffle(deck)), Entry(1, SkipCut() if skip else CutDeck(17))]
    expected = [Phase.AWAITING_SHUFFLE, Phase.SHUFFLING, Phase.AWAITING_CUT, Phase.AWAITING_DISTRIBUTION]
    actors = [count, None, 1, count]
    for entry, phase, actor in zip(entries, expected, actors):
        old = state
        state = ok(apply_control(state, entry.command) if entry.actor is None else apply_player(state, entry.actor, entry.command))
        assert state.phase == phase and state.current_player == actor
        assert state.revision == old.revision + 1 and state.current_deal is None
        query = GameQuery(state)
        assert query.get_turn()["player_id"] == actor
        assert query.get_deal()["phase"] == phase.value
        assert query.get_deal()["deal_number"] == 1
        assert query.get_tricks() == [] and query.get_bids() == []
        assert len(query.get_deals()) == 1
        assert all(r["cards_remaining"] == 0 for r in query.get_deal_table())
        assert "deck" not in query.get_deal()
        assert public_view(state)["deal"] == 1
        assert all(player_view(state, p)["hand"] == () for p in config.players)
        assert apply_control(state, StartDeal(deck)).code == "INVALID_PHASE"
        assert apply_control(state, Redeal(deck)).code == "INVALID_PHASE"
        assert apply_player(state, count, PlaceBid(1)).code == "INVALID_PHASE"
    assert state.preparation.deck == (deck if skip else deck[17:] + deck[:17])
    assert Replay.loads(Replay(config, count, tuple(entries)).dumps()).restore() == state


def test_wrong_players_phases_and_bad_inputs_leave_state_unchanged():
    initial = create_match()
    deck = standard_52()
    assert apply_control(initial, CompleteShuffle(deck)).code == "INVALID_PHASE"
    assert apply_player(initial, 1, ShuffleDeck()).code == "INVALID_PHASE"
    state = ok(apply_control(initial, PrepareDeal()))
    assert apply_player(state, 2, ShuffleDeck()).code == "NOT_YOUR_TURN"
    assert apply_control(state, PrepareDeal()).code == "INVALID_PHASE"
    assert apply_player(state, 1, CompleteShuffle(deck)).code == "UNKNOWN_COMMAND"
    assert apply_player(state, 1, SkipCut()).code == "INVALID_PHASE"
    state = ok(apply_player(state, 1, ShuffleDeck()))
    assert apply_player(state, 1, ShuffleDeck()).code == "INVALID_PHASE"
    assert apply_control(state, CompleteShuffle(deck[:-1])).code == "INVALID_DECK"
    assert apply_control(state, CompleteShuffle(deck[:-1] + (deck[0],))).code == "INVALID_DECK"
    assert state.preparation.deck == ()
    state = ok(apply_control(state, CompleteShuffle(deck)))
    assert apply_player(state, 1, CutDeck(26)).code == "NOT_YOUR_TURN"
    for invalid in (0, 52, -1, True, "26", 26.0):
        assert apply_player(state, 2, CutDeck(invalid)).code == "INVALID_CUT"
    assert state.revision == 3 and state.preparation.deck == deck
    for position in (1, 51):
        cut = ok(apply_player(state, 2, CutDeck(position)))
        assert cut.preparation.deck == deck[position:] + deck[:position]
        assert apply_player(cut, 2, SkipCut()).code == "INVALID_PHASE"


def request(state, name, payload=None, **overrides):
    prep = state.preparation
    return parse_player_command({"match_id": "m", "command_id": f"c{state.revision}",
        "expected_revision": state.revision, "deal_number": prep.number,
        "attempt": prep.attempt, "command": name, "payload": payload or {}, **overrides})


def test_adapter_notifications_and_context_checks():
    result = control_preparation(create_match(), PrepareDeal(), match_id="m")
    state = ok(result)
    assert [(m.message.event.value, m.recipient_player_id) for m in result.messages] == [
        ("DEALER_ASSIGNED", None), ("SHUFFLE_REQUESTED", 1), ("TURN_CHANGED", None)]
    cmd = request(state, "SHUFFLE_DECK")
    assert dispatch_preparation(state, cmd, match_id="other", player_id=1).code == "MATCH_MISMATCH"
    assert dispatch_preparation(state, request(state, "SHUFFLE_DECK", expected_revision=0), match_id="m", player_id=1).code == "STALE_REVISION"
    assert dispatch_preparation(state, request(state, "SHUFFLE_DECK", attempt=2), match_id="m", player_id=1).code == "STALE_DEAL"
    assert dispatch_preparation(state, cmd, match_id="m", player_id=2).code == "NOT_YOUR_TURN"
    result = dispatch_preparation(state, cmd, match_id="m", player_id=1)
    state = ok(result)
    assert [m.message.event.value for m in result.messages] == ["TURN_CHANGED"]
    assert GameQuery(state).get_turn()["controller_action"] == "COMPLETE_SHUFFLE"
    result = control_preparation(state, CompleteShuffle(standard_52()), match_id="m")
    state = ok(result)
    assert [(m.message.event.value, m.recipient_player_id) for m in result.messages] == [
        ("DECK_SHUFFLED", None), ("CUT_REQUESTED", 2), ("TURN_CHANGED", None)]
    result = dispatch_preparation(state, request(state, "SKIP_CUT"), match_id="m", player_id=2)
    state = ok(result)
    assert [(m.message.event.value, m.recipient_player_id) for m in result.messages] == [
        ("CUT_COMPLETED", None), ("DISTRIBUTION_REQUESTED", 1), ("TURN_CHANGED", None)]
    assert [m.message.index for m in result.messages] == [0, 1, 2]
    assert all(m.message.revision == state.revision and "deck" not in m.message.payload for m in result.messages)
    assert dispatch_preparation(state, request(state, "START_DISTRIBUTION"), match_id="m", player_id=1).code == "UNSUPPORTED_COMMAND"


def test_preparation_after_completed_deal_rotates_dealer_and_keeps_history():
    state = create_match(GameConfig(redeal_policy=RedealPolicy(weak_hand_enabled=False, no_spades_enabled=False)))
    state = ok(apply_control(state, StartDeal(shuffle(standard_52(), rng=Random(1)))))
    while state.phase != Phase.DEAL_COMPLETE:
        p = state.current_player
        command = PlaceBid(1) if state.phase == Phase.BIDDING else PlayCard(available_cards(state, p)[0])
        result = apply_player(state, p, command)
        assert isinstance(result, Transition)
        state = result.state
    before = state
    state = ok(apply_control(state, PrepareDeal()))
    assert state.preparation.number == 2 and state.preparation.dealer == 2
    assert state.score_tenths == before.score_tenths
    q = GameQuery(state)
    assert q.get_deal()["deal_number"] == 2 and q.get_tricks() == []
    assert q.get_bids() == [] and q.get_deal(1)["complete"]
    assert len(q.get_deals()) == 2


def test_claimed_redeal_restarts_preparation_without_new_scored_deal():
    cards = standard_52()
    first, rest = iter(cards[:13]), iter(cards[13:])
    deck = tuple(next(first) if i % 4 == 0 else next(rest) for i in range(52))
    entries = [Entry(None, StartDeal(deck)), Entry(2, ClaimRedeal()),
               Entry(None, PrepareDeal()), Entry(1, ShuffleDeck()),
               Entry(None, CompleteShuffle(cards)), Entry(2, SkipCut())]
    state = create_match()
    abandoned = None
    for entry in entries:
        state = ok(apply_control(state, entry.command) if entry.actor is None else apply_player(state, entry.actor, entry.command))
        if state.phase == Phase.HAND_REVIEW:
            abandoned = state.current_deal
    assert state.preparation.number == 1 and state.preparation.attempt == 2
    assert state.preparation.dealer == 1 and state.completed_deals == ()
    assert state.score_tenths == (0, 0, 0, 0)
    assert state.abandoned_attempts == (abandoned,)
    assert Replay.loads(Replay(state.config, 1, tuple(entries)).dumps()).restore() == state


@pytest.mark.parametrize("n", [4, 5])
def test_dealer_distribution_private_cards_public_counts_and_replay(n):
    config = GameConfig(n)
    entries = [Entry(None, PrepareDeal()), Entry(1, ShuffleDeck()),
               Entry(None, CompleteShuffle(standard_52())), Entry(2, CutDeck(7))]
    state = create_match(config)
    for entry in entries:
        assert apply_player(state, 1, StartDistribution()).code == "INVALID_PHASE"
        state = ok(apply_control(state, entry.command) if entry.actor is None else apply_player(state, entry.actor, entry.command))
    assert apply_player(state, 2, StartDistribution()).code == "NOT_YOUR_TURN"
    result = apply_player(state, 1, StartDistribution())
    state = ok(result)
    assert state.phase == Phase.HAND_REVIEW and state.preparation is None
    private = [e for e in result.events if e.name == "CardDealt"]
    public = [e for e in result.events if e.name == "CardDistributed"]
    assert len(private) == len(public) == n * (52 // n)
    for index, (own, receipt) in enumerate(zip(private, public)):
        player = (index + 1) % n + 1
        assert own.recipient == player and receipt.recipient is None
        assert dict(own.data)["card"] in state.current_deal.players[player - 1].hand
        assert "card" not in dict(receipt.data)
        assert dict(receipt.data)["distribution_index"] == index + 1
    entries.append(Entry(1, StartDistribution()))
    assert Replay.loads(Replay(config, 1, tuple(entries)).dumps()).restore() == state
