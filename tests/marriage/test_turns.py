from dataclasses import FrozenInstanceError, asdict, replace
from random import Random

import pytest

from marriage import (
    ActionKind, CardConservationError, DrawSource, GameStatus, InvalidActionError,
    InvalidTurnError, MarriageGameEngine, MarriageRules, Meld, MeldType,
    NoDrawableCardError, QualificationRoute, TurnPhase, create_deck,
    validate_game_state,
)


def started(count=2, seed=12):
    engine = MarriageGameEngine(tuple(f"p{i}" for i in range(count)), rng=Random(seed))
    engine.start_game()
    return engine


def assert_rejected(engine, error, action):
    state, rng = engine.get_state(), engine._rng.getstate()
    with pytest.raises(error):
        action()
    assert engine.get_state() is state
    assert engine._rng.getstate() == rng


def test_draw_discard_and_visible_pickup_preserve_order_and_events():
    engine = started()
    state = engine.get_state()
    card = state.stock[-1]
    result = engine.draw_card("p0", DrawSource.STOCK)
    drawn = engine.get_state()
    assert drawn.players[0].hand == state.players[0].hand + (card,)
    assert drawn.stock == state.stock[:-1] and drawn.discard == ()
    assert drawn.current_player_id == "p0" and drawn.phase is TurnPhase.MUST_DISCARD
    assert result.revision == 2
    assert [(e.kind, e.sequence, e.revision) for e in result.events] == [("CARD_DRAWN", 3, 2)]
    assert result.events[0].card == card and result.events[0].source is DrawSource.STOCK
    actions = engine.get_allowed_actions("p0")
    assert actions.kinds == (ActionKind.DISCARD, ActionKind.SHOW_INITIAL_MELDS, ActionKind.SHOW_DUBLEES)
    assert actions.discardable_card_ids == tuple(c.card_id for c in drawn.players[0].hand)

    result = engine.discard_card("p0", card.card_id)
    discarded = engine.get_state()
    assert discarded.players[0].hand == state.players[0].hand
    assert discarded.discard == (card,)
    assert discarded.current_player_id == "p1" and discarded.phase is TurnPhase.MUST_DRAW
    assert [(e.kind, e.sequence, e.revision) for e in result.events] == [
        ("CARD_DISCARDED", 4, 3), ("TURN_CHANGED", 5, 3)]
    assert engine.get_public_view().top_discard == card
    assert engine.get_allowed_actions("p1").drawable_sources == (DrawSource.STOCK, DrawSource.DISCARD)
    result = engine.draw_card("p1", DrawSource.DISCARD)
    assert result.events[0].card == card
    assert engine.get_state().stock == discarded.stock
    assert engine.get_state().discard == ()
    assert engine.get_state().players[1].hand[-1] == card
    engine.discard_card("p1", card.card_id)
    assert engine.get_state().current_player_id == "p0"
    validate_game_state(engine.get_state())


def test_invalid_commands_are_atomic_in_every_turn_phase():
    engine = MarriageGameEngine(["p0", "p1"], rng=Random(1))
    assert engine.get_allowed_actions("p0").kinds == ()
    assert_rejected(engine, InvalidActionError, lambda: engine.draw_card("p0", DrawSource.STOCK))
    assert_rejected(engine, InvalidActionError, lambda: engine.discard_card("p0", "fake"))
    engine.start_game()
    for actor in ("missing", None):
        assert_rejected(engine, InvalidActionError, lambda: engine.draw_card(actor, DrawSource.STOCK))
        assert_rejected(engine, InvalidActionError, lambda: engine.get_allowed_actions(actor))
    assert_rejected(engine, InvalidTurnError, lambda: engine.draw_card("p1", DrawSource.STOCK))
    assert_rejected(engine, InvalidTurnError, lambda: engine.discard_card("p1", "fake"))
    assert_rejected(engine, InvalidActionError, lambda: engine.discard_card("p0", "fake"))
    for source in ("stock", "invalid", None, 1):
        assert_rejected(engine, InvalidActionError, lambda: engine.draw_card("p0", source))
    assert_rejected(engine, NoDrawableCardError, lambda: engine.draw_card("p0", DrawSource.DISCARD))
    engine.draw_card("p0", DrawSource.STOCK)
    assert_rejected(engine, InvalidActionError, lambda: engine.draw_card("p0", DrawSource.STOCK))
    for card_id in ("fake", None, 12, engine.get_state().players[1].hand[0].card_id):
        assert_rejected(engine, InvalidActionError, lambda: engine.discard_card("p0", card_id))
    # Terminal transitions arrive later; rejection must already guard terminal state.
    engine._state = replace(engine.get_state(), status=GameStatus.FINISHED)
    assert engine.get_allowed_actions("p0").kinds == ()
    assert_rejected(engine, InvalidActionError, lambda: engine.draw_card("p0", DrawSource.STOCK))
    assert_rejected(engine, InvalidActionError, lambda: engine.discard_card("p0", "fake"))


def exhausted_stock_fixture():
    """Trusted test-only redistribution; production has no state injection API."""
    engine = started()
    state = engine.get_state()
    engine._state = replace(state, stock=(), discard=state.stock)
    validate_game_state(engine.get_state())
    return engine


def test_recycle_shuffles_only_older_discards_and_preserves_visible_top():
    engine = exhausted_stock_fixture()
    state = engine.get_state()
    expected = list(state.discard[:-1])
    rng = Random(0)
    rng.setstate(engine._rng.getstate())
    rng.shuffle(expected)
    result = engine.draw_card("p0", DrawSource.STOCK)
    after = engine.get_state()
    assert after.discard == state.discard[-1:]
    assert after.stock == tuple(expected[:-1])
    assert after.players[0].hand[-1] == expected[-1]
    assert after.players[0].hand[-1] != state.discard[-1]
    assert [(e.kind, e.sequence, e.revision) for e in result.events] == [
        ("DISCARD_PILE_RECYCLED", 3, 2), ("CARD_DRAWN", 4, 2)]
    assert result.events[0].card_count == len(expected)
    assert engine._rng.getstate() == rng.getstate()
    validate_game_state(after)


@pytest.mark.parametrize("operation", ["draw", "discard", "recycle"])
def test_candidate_audit_failure_rolls_back_state_and_rng(monkeypatch, operation):
    import marriage.engine as module

    engine = exhausted_stock_fixture() if operation == "recycle" else started()
    if operation == "discard":
        engine.draw_card("p0", DrawSource.STOCK)
        action = lambda: engine.discard_card("p0", engine.get_state().players[0].hand[0].card_id)
    else:
        action = lambda: engine.draw_card("p0", DrawSource.STOCK)
    saved_state, saved_rng = engine.get_state(), engine._rng.getstate()
    reference = started()
    reference._state = saved_state
    reference._rng.setstate(saved_rng)

    def fail(state):
        raise CardConservationError("injected failure after staging")

    with monkeypatch.context() as patch:
        patch.setattr(module, "validate_game_state", fail)
        assert_rejected(engine, CardConservationError, action)
    action()
    if operation == "discard":
        reference.discard_card("p0", saved_state.players[0].hand[0].card_id)
    else:
        reference.draw_card("p0", DrawSource.STOCK)
    assert engine.get_state() == reference.get_state()
    assert engine._rng.getstate() == reference._rng.getstate()


@pytest.mark.parametrize("discard_count", [0, 1])
def test_no_recyclable_stock_reports_block_and_does_not_invent_winner(discard_count):
    # These boundary pile shapes cannot arise with 2-5 full 21-card hands today.
    # Exercise rejection before auditing; do not pretend they are conserved rounds.
    engine = started()
    state = engine.get_state()
    engine._state = replace(state, stock=(), discard=state.stock[:discard_count])
    actions = engine.get_allowed_actions("p0")
    assert DrawSource.STOCK not in actions.drawable_sources
    assert any(b.source is DrawSource.STOCK and "recyclable" in b.reason for b in actions.blocked_sources)
    assert actions.drawable_sources == ((DrawSource.DISCARD,) if discard_count else ())
    assert_rejected(engine, NoDrawableCardError, lambda: engine.draw_card("p0", DrawSource.STOCK))
    assert engine.get_state().winner is None


def qualified_fixture(route, *, unrestricted=False):
    """Future qualification fixture for turn policy; not a public declaration API."""
    engine = MarriageGameEngine(["p0", "p1"], rng=Random(1),
                                rules=MarriageRules(dublee_player_can_draw_discard=unrestricted))
    engine.start_game()
    state = engine.get_state()
    deck = create_deck()
    # Same face from three packs for a Tunnela, two for a Dublee.
    count = 3 if route is QualificationRoute.NORMAL else 2
    groups = tuple(tuple(deck[index * 52 + face] for index in range(count))
                   for face in range(3 if count == 3 else 7))
    cards = tuple(c for group in groups for c in group)
    remaining = tuple(c for c in deck if c not in cards)
    hand = cards + remaining[:21 - len(cards)]
    remaining = remaining[21 - len(cards):]
    melds = tuple(Meld(MeldType.TUNNELA if count == 3 else MeldType.DUBLEE,
                       tuple(c.card_id for c in group)) for group in groups)
    players = (replace(state.players[0], hand=hand, route=route, shown_melds=melds,
                       committed_card_ids=frozenset(c.card_id for c in cards), has_seen_maal=True),
               replace(state.players[1], hand=remaining[:21]))
    engine._state = replace(state, players=players, tiplu=remaining[21],
                            stock=remaining[22:-1], discard=remaining[-1:])
    validate_game_state(engine.get_state())
    return engine


@pytest.mark.parametrize("route,unrestricted,allowed", [
    (QualificationRoute.NORMAL, False, True),
    (QualificationRoute.DUBLEE, False, False),
    (QualificationRoute.DUBLEE, True, True),
])
def test_discard_source_policy_and_queries_agree(route, unrestricted, allowed):
    engine = qualified_fixture(route, unrestricted=unrestricted)
    assert (DrawSource.DISCARD in engine.get_allowed_actions("p0").drawable_sources) is allowed
    if allowed:
        engine.draw_card("p0", DrawSource.DISCARD)
        validate_game_state(engine.get_state())
    else:
        assert_rejected(engine, InvalidActionError, lambda: engine.draw_card("p0", DrawSource.DISCARD))


def test_committed_cards_cannot_be_discarded_and_tiplu_cannot_be_recycled():
    engine = qualified_fixture(QualificationRoute.NORMAL)
    state = engine.get_state()
    engine._state = replace(state, stock=(), discard=state.stock + state.discard)
    engine.draw_card("p0", DrawSource.STOCK)
    after = engine.get_state()
    assert after.tiplu == state.tiplu and after.tiplu not in after.stock
    assert after.tiplu not in after.players[0].hand
    committed = after.players[0].shown_melds[0].card_ids
    actions = engine.get_allowed_actions("p0")
    assert not set(committed) & set(actions.discardable_card_ids)
    assert_rejected(engine, InvalidActionError, lambda: engine.discard_card("p0", committed[0]))
    engine.discard_card("p0", actions.discardable_card_ids[0])
    assert engine.get_state().players[0].committed_card_ids == after.players[0].committed_card_ids


def test_actions_are_private_immutable_and_queries_are_pure():
    engine = started()
    engine.draw_card("p0", DrawSource.STOCK)
    state, rng = engine.get_state(), engine._rng.getstate()
    actions = engine.get_allowed_actions("p0")
    for _ in range(3):
        assert engine.get_player_view("p0").actions == actions
        assert engine.get_player_view("p1").actions.kinds == ()
        public = repr(asdict(engine.get_public_view()))
        assert not any(card.card_id in public for card in state.players[0].hand)
        private = repr(asdict(engine.get_player_view("p1")))
        assert not any(card.card_id in private for card in state.players[0].hand)
    with pytest.raises(FrozenInstanceError):
        actions.kinds = ()
    with pytest.raises(TypeError):
        actions.discardable_card_ids[0] = "fake"
    assert engine.get_state() is state and engine._rng.getstate() == rng


@pytest.mark.parametrize("count", [2, 3, 4, 5])
def test_seeded_turn_simulation_recycling_conservation_and_replay(count):
    left, right = started(count, 713), started(count, 713)
    choice = Random(26)
    recycled = 0
    for turn in range(180):
        actor = left.get_state().current_player_id
        assert actor == f"p{turn % count}"
        offered = left.get_allowed_actions(actor)
        # Prefer stock often enough to exercise recycling in every player count.
        source = DrawSource.DISCARD if turn % 7 == 0 and DrawSource.DISCARD in offered.drawable_sources else DrawSource.STOCK
        assert source in offered.drawable_sources
        draw = left.draw_card(actor, source)
        assert draw == right.draw_card(actor, source)
        recycled += sum(e.kind == "DISCARD_PILE_RECYCLED" for e in draw.events)
        validate_game_state(left.get_state())
        assert len(left.get_player_view(actor).hand) == 22
        card_id = choice.choice(left.get_allowed_actions(actor).discardable_card_ids)
        assert left.discard_card(actor, card_id) == right.discard_card(actor, card_id)
        assert left.get_state() == right.get_state()
        assert all(len(p.hand) == 21 for p in left.get_state().players)
        validate_game_state(left.get_state())
    assert recycled >= 1
