"""Exercise the complete wire-to-engine loop without a multiplayer host."""
from random import Random

import pytest
from pydantic import ValidationError

from app.adapters.callbreak import (
    AdapterResult, PlayerCommand, RoutedEvent, dispatch_control, dispatch_player,
)
from callbreak import (
    CompleteShuffle, GameConfig, Phase, PrepareDeal, RedealPolicy,
    available_cards, create_match,
)
from callbreak.audit import audit_match
from card_utils import shuffle, standard_52


def request(state, command, payload=None, **overrides):
    context = state.preparation or state.current_deal or state.completed_deals[-1].deal
    return PlayerCommand(match_id="m", command_id=f"c{state.revision}", command=command,
                         payload=payload or {}, **{
                             "expected_revision": state.revision,
                             "deal_number": context.number, "attempt": context.attempt, **overrides})


def play(state, command, payload=None, actor=None):
    return dispatch_player(state, request(state, command, payload), match_id="m",
                           player_id=state.current_player if actor is None else actor)


def checked(result):
    assert isinstance(result, AdapterResult), result
    audit_match(result.state)
    assert [m.message.index for m in result.messages] == list(range(len(result.messages)))
    for routed in result.messages:
        assert routed.message.revision == result.state.revision
        assert RoutedEvent.model_validate(routed.model_dump()) == routed
    return result.state


@pytest.mark.parametrize("n", [4, 5])
@pytest.mark.parametrize("review", [False, True])
def test_full_five_deal_adapter_game(n, review):
    state = create_match(GameConfig(n, redeal_policy=RedealPolicy(
        weak_hand_enabled=review, no_spades_enabled=review)))
    seen = set()
    finished = 0
    while state.phase != Phase.MATCH_COMPLETE:
        previous = state
        if state.phase in (Phase.AWAITING_DEAL, Phase.DEAL_COMPLETE):
            result = dispatch_control(state, PrepareDeal(), match_id="m")
        elif state.phase == Phase.SHUFFLING:
            result = dispatch_control(state, CompleteShuffle(shuffle(standard_52(), rng=Random(state.revision))), match_id="m")
        elif state.phase == Phase.HAND_REVIEW:
            actor = next(p for p in state.config.players if p not in state.current_deal.accepted_hands)
            result = play(state, "ACCEPT_HAND", actor=actor)
        elif state.phase == Phase.BIDDING:
            result = play(state, "PLACE_BID", {"amount": 1})
        elif state.phase == Phase.PLAYING:
            result = play(state, "PLAY_CARD", {"card": str(available_cards(state, state.current_player)[0])})
        else:
            name, payload = {
                Phase.AWAITING_SHUFFLE: ("SHUFFLE_DECK", {}),
                Phase.AWAITING_CUT: ("CUT_DECK", {"position": 17}),
                Phase.AWAITING_DISTRIBUTION: ("START_DISTRIBUTION", {}),
            }[state.phase]
            result = play(state, name, payload)
        state = checked(result)
        assert state.revision == previous.revision + 1
        seen.update(m.message.event.value for m in result.messages)
        events = {m.message.event.value: m for m in result.messages}
        if "DISTRIBUTION_COMPLETED" in events:
            cards = [m for m in result.messages if m.message.event == "CARD_DEALT"]
            receipts = [m for m in result.messages if m.message.event == "CARD_DISTRIBUTED"]
            assert len(cards) == len(receipts) == n * (52 // n)
            for index, (card, receipt) in enumerate(zip(cards, receipts), 1):
                owner = card.recipient_player_id
                assert card.message.payload["card"] in map(str, state.current_deal.players[owner - 1].hand)
                assert receipt.recipient_player_id is None and "card" not in receipt.message.payload
                assert receipt.message.payload["distribution_index"] == index
            prompts = [m for m in result.messages if m.message.event == "HAND_REVIEW_REQUESTED"]
            assert len(prompts) == (n if review else 0)
        if "BIDDING_STARTED" in events:
            order = events["BIDDING_STARTED"].message.payload["bidding_order"]
            assert order[0] == state.current_player and order[-1] == state.current_deal.dealer
            assert sorted(order) == list(state.config.players)
        if state.phase == Phase.BIDDING:
            assert events["BID_REQUESTED"].recipient_player_id == state.current_player
            assert events["BID_REQUESTED"].message.payload["maximum"] == 52 // n
        if "TRICK_COMPLETED" in events:
            payload = events["TRICK_COMPLETED"].message.payload
            assert len(payload["plays"]) == n
            assert sum(row["tricks_won"] for row in payload["tricks_won"]) == payload["trick_number"]
        if "DEAL_COMPLETED" in events:
            finished += 1
            assert all(m.message.deal_number == finished for m in result.messages)
            assert events["DEAL_COMPLETED"].message.payload["totals"] == [
                {"player_id": p, "score_tenths": total} for p, total in enumerate(state.score_tenths, 1)]
            assert events["TURN_CHANGED"].message.payload["player_id"] is None
    assert finished == 5
    assert events["MATCH_COMPLETED"].message.payload["winner_ids"] == list(state.winners)
    assert {"BIDDING_COMPLETED", "PLAY_STARTED", "CARD_PLAYED", "DEAL_COMPLETED"} <= seen


def test_redeal_privacy_and_stale_attempt_rejection():
    cards = standard_52()
    first, rest = iter(cards[:13]), iter(cards[13:])
    deck = tuple(next(first) if i % 4 == 0 else next(rest) for i in range(52))
    state = checked(dispatch_control(create_match(), PrepareDeal(), match_id="m"))
    state = checked(play(state, "SHUFFLE_DECK"))
    state = checked(dispatch_control(state, CompleteShuffle(deck), match_id="m"))
    state = checked(play(state, "SKIP_CUT"))
    state = checked(play(state, "START_DISTRIBUTION"))
    result = play(state, "CLAIM_REDEAL", actor=2)
    state = checked(result)
    public = [m.message for m in result.messages if m.recipient_player_id is None]
    assert all("reasons" not in m.payload for m in public)
    private = [m for m in result.messages if m.recipient_player_id is not None]
    assert len(private) == 1 and private[0].recipient_player_id == 2
    assert "NO_SPADES" in private[0].message.payload["reasons"]
    state = checked(dispatch_control(state, PrepareDeal(), match_id="m"))
    assert state.preparation.attempt == 2
    stale = request(state, "SHUFFLE_DECK", attempt=1)
    assert dispatch_player(state, stale, match_id="m", player_id=1).code == "STALE_DEAL"
    mutated = request(state, "SHUFFLE_DECK")
    mutated.payload["player_id"] = 2
    with pytest.raises(ValidationError):
        dispatch_player(state, mutated, match_id="m", player_id=1)
