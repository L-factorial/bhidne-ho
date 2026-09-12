from dataclasses import FrozenInstanceError, asdict, replace
from random import Random
import random

import pytest

from marriage import (
    CardConservationError, GameStatus, InvalidActionError, MarriageGameEngine,
    TurnPhase, create_deck, validate_card_conservation,
)
from marriage.invariants import validate_initial_state


@pytest.mark.parametrize("count,remaining", [(2, 117), (3, 96), (4, 75), (5, 54)])
def test_start_deals_in_receipt_order_from_last_element(count, remaining):
    seats = tuple(f"p{i}" for i in range(count))
    engine = MarriageGameEngine(seats, rng=Random(1729), first_player_id=seats[-1])
    waiting = engine.get_state()
    assert waiting.status is GameStatus.WAITING
    assert waiting.current_player_id is None and waiting.phase is None
    assert waiting.stock == waiting.discard == waiting.history == ()
    assert all(not p.hand for p in waiting.players)
    assert engine.get_player_view(seats[0]).hand == ()
    validate_initial_state(waiting)

    result = engine.start_game()
    state = engine.get_state()
    assert state.status is GameStatus.IN_PROGRESS
    assert state.phase is TurnPhase.MUST_DRAW
    assert state.current_player_id == seats[-1]
    assert len(state.stock) == remaining and state.discard == ()
    assert state.tiplu is None and state.winner is None and not state.must_finish
    assert [len(p.hand) for p in state.players] == [21] * count
    assert [p.player_id for p in state.players] == list(seats)
    assert state.revision == result.revision == 1
    assert state.history == result.events
    assert [e.kind for e in result.events] == ["GAME_STARTED", "TURN_CHANGED"]
    assert [e.sequence for e in result.events] == [1, 2]
    assert [e.revision for e in result.events] == [1, 1]
    assert result.events[1].player_id == seats[-1]
    assert result.events[1].phase is TurnPhase.MUST_DRAW
    validate_card_conservation(state)
    validate_initial_state(state)

    shuffled = list(create_deck())
    Random(1729).shuffle(shuffled)
    receipt_order = tuple(reversed(shuffled))
    for index, player in enumerate(state.players):
        assert player.hand == receipt_order[index:21 * count:count]
    assert state.stock == tuple(shuffled[:remaining])
    assert state.stock[-1] == receipt_order[21 * count]
    assert waiting.status is GameStatus.WAITING and all(not p.hand for p in waiting.players)


def test_rng_is_cloned_and_queries_and_rejections_do_not_advance_it():
    rng = Random(82)
    original_rng_state = rng.getstate()
    global_state = random.getstate()
    left = MarriageGameEngine(["a", "b"], rng=rng)
    right = MarriageGameEngine(["a", "b"], rng=Random(82))
    assert rng.getstate() == original_rng_state
    rng.random()  # Caller activity cannot affect the engine's private stream.
    caller_state = rng.getstate()
    for _ in range(3):
        left.get_public_view()
        left.get_player_view("a")
        with pytest.raises(InvalidActionError):
            left.get_player_view("unknown")
    assert left.start_game() == right.start_game()
    assert left.get_state() == right.get_state()
    assert rng.getstate() == caller_state
    assert random.getstate() == global_state
    saved = left.get_state()
    rng_state = left._rng.getstate()
    with pytest.raises(InvalidActionError, match="already started"):
        left.start_game()
    assert left.get_state() is saved
    assert left._rng.getstate() == rng_state


def test_failed_start_audit_preserves_state_history_and_randomness(monkeypatch):
    import marriage.engine as module

    engine = MarriageGameEngine(["a", "b"], rng=Random(93))
    waiting = engine.get_state()
    rng_state = engine._rng.getstate()

    def reject(state):
        raise CardConservationError("injected audit failure")

    with monkeypatch.context() as patch:
        patch.setattr(module, "validate_initial_state", reject)
        with pytest.raises(CardConservationError):
            engine.start_game()
    assert engine.get_state() is waiting
    assert engine._rng.getstate() == rng_state
    reference = MarriageGameEngine(["a", "b"], rng=Random(93))
    assert engine.start_game() == reference.start_game()
    assert engine.get_state() == reference.get_state()


def test_configuration_is_frozen_and_validated_by_facade():
    seats = ["a", "b"]
    engine = MarriageGameEngine(seats, rng=Random(1))
    seats.append("c")
    engine.start_game()
    assert engine.get_state().config.player_ids == ("a", "b")
    assert engine.get_state().current_player_id == "a"
    for invalid in ([], ["a"], ["a", "a"], ["a", ""], list("abcdef")):
        with pytest.raises(ValueError):
            MarriageGameEngine(invalid)
    with pytest.raises(ValueError):
        MarriageGameEngine(["a", "b"], first_player_id="c")
    with pytest.raises(ValueError):
        MarriageGameEngine(["a", "b"], rng=123)


def test_views_omit_hidden_cards_history_rng_and_indicator():
    engine = MarriageGameEngine(["a", "b", "c"], rng=Random(9))
    result = engine.start_game()
    state = engine.get_state()
    public = engine.get_public_view()
    assert public.stock_count == 96 and public.top_discard is None
    assert [p.hand_count for p in public.players] == [21, 21, 21]
    assert public.current_player_id == "a"
    public_text = repr(asdict(public))
    assert not any(card.card_id in public_text for card in create_deck())
    for index, seat in enumerate(("a", "b", "c")):
        view = engine.get_player_view(seat)
        assert view.public == public and view.hand == state.players[index].hand
        data = asdict(view)
        assert set(data) == {"public", "player_id", "hand", "actions", "maal"}
        assert set(data["public"]) == {
            "revision", "status", "players", "current_player_id", "phase",
            "stock_count", "top_discard", "winner",
        }
        hidden = state.stock + tuple(card for p in state.players if p.player_id != seat for card in p.hand)
        assert not any(card.card_id in repr(data) for card in hidden)
        for p in data["public"]["players"]:
            assert set(p) == {"player_id", "hand_count", "route", "shown_melds", "has_seen_maal", "finished"}
    assert not any(card.card_id in repr(result) for card in create_deck())
    with pytest.raises(InvalidActionError):
        engine.get_player_view("spectator")


def test_nested_snapshots_events_and_views_cannot_mutate_engine():
    engine = MarriageGameEngine(["a", "b"], rng=Random(9))
    result = engine.start_game()
    state = engine.get_state()
    view = engine.get_player_view("a")
    for obj, field, value in (
        (state, "revision", 10), (state.config, "first_player_id", "b"),
        (state.players[0], "hand", ()), (view.hand[0], "card_id", "fake"),
        (view, "hand", ()), (view.public, "stock_count", 0),
        (view.public.players[0], "hand_count", 0), (result, "events", ()),
        (result.events[0], "player_ids", ()), (result.events[1], "player_id", "b"),
    ):
        with pytest.raises(FrozenInstanceError):
            setattr(obj, field, value)
    with pytest.raises(TypeError):
        state.stock[0] = state.stock[1]
    with pytest.raises(TypeError):
        result.events[0].player_ids[0] = "x"
    assert engine.get_state() is state
    validate_initial_state(state)


def test_conservation_rejects_duplicate_missing_and_counterfeit_cards():
    engine = MarriageGameEngine(["a", "b"], rng=Random(41))
    engine.start_game()
    state = engine.get_state()
    for corrupt in (
        replace(state, stock=state.stock[:-1]),
        replace(state, stock=state.stock[:-1] + (state.players[0].hand[0],)),
        replace(state, tiplu=state.stock[-1]),
        replace(state, discard=(state.players[0].hand[0],)),
    ):
        with pytest.raises(CardConservationError):
            validate_card_conservation(corrupt)
    fake = replace(state.stock[0])
    object.__setattr__(fake, "card_id", "COUNTERFEIT")
    with pytest.raises(CardConservationError):
        validate_card_conservation(replace(state, stock=(fake,) + state.stock[1:]))
    # Moving a card to an indicator is conserved; duplicating it is not.
    validate_card_conservation(replace(state, stock=state.stock[:-1], tiplu=state.stock[-1]))


def test_start_audit_rejects_invalid_turn_hand_sizes_and_metadata():
    engine = MarriageGameEngine(["a", "b"], rng=Random(2))
    waiting = engine.get_state()
    with pytest.raises(CardConservationError):
        validate_initial_state(replace(waiting, stock=create_deck()))
    engine.start_game()
    state = engine.get_state()
    for changes in (
        {"current_seat": -1}, {"current_seat": 2}, {"current_seat": True},
        {"current_seat": 1}, {"phase": TurnPhase.MUST_DISCARD}, {"revision": 2},
        {"history": state.history[:1]}, {"winner": "a"}, {"must_finish": True},
        {"players": tuple(reversed(state.players))},
        {"players": (replace(state.players[0], has_seen_maal=True), state.players[1])},
        {"players": (replace(state.players[0], hand=state.players[0].hand[:-1]), state.players[1]),
         "stock": state.stock + state.players[0].hand[-1:]},
    ):
        with pytest.raises(CardConservationError):
            validate_initial_state(replace(state, **changes))
