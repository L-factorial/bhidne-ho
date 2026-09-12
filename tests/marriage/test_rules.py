from dataclasses import asdict, replace
from random import Random

import pytest

from marriage import (
    ActionKind, CardConservationError, DrawSource, GameStatus, InvalidActionError,
    InvalidMeldError, InvalidTurnError, MarriageGameEngine, MarriageRules, Meld,
    MeldType, PlayerState, QualificationRoute, TipluUnavailableError, TurnPhase,
    UnsupportedRuleError, create_deck, validate_game_state,
)
from marriage.maal import select_tiplu

DECK = create_deck()
CARDS = {c.card_id: c for c in DECK}


def copies(face, count=2):
    return tuple(DECK[face + pack * 52].card_id for pack in range(count))


def pairs(first=0):
    return tuple(Meld(MeldType.DUBLEE, copies(face)) for face in range(first, first + 7))


def pair_hand(eighth=False):
    ids = tuple(i for m in pairs() for i in m.card_ids)
    return ids + (copies(7) + tuple(DECK[i].card_id for i in range(8, 14)) if eighth
                  else tuple(DECK[i].card_id for i in range(7, 15)))


def fixture(hand_ids, *, other_ids=(), rules=None):
    """Conserved trusted fixture; no arbitrary-state API is added to production."""
    game = MarriageGameEngine(("a", "b"), rng=Random(7), rules=rules)
    game.start_game()
    game.draw_card("a", DrawSource.STOCK)
    state = game.get_state()
    hand = tuple(CARDS[i] for i in hand_ids)
    other = tuple(CARDS[i] for i in other_ids)
    remaining = tuple(c for c in DECK if c not in hand + other)
    hand += remaining[:22 - len(hand)]
    remaining = remaining[22 - len(hand_ids):]
    other += remaining[:21 - len(other)]
    remaining = remaining[21 - len(other_ids):]
    game._state = replace(state, players=(PlayerState("a", hand), PlayerState("b", other)), stock=remaining)
    validate_game_state(game.get_state())
    return game


def unchanged(game, error, action):
    state, rng = game.get_state(), game._rng.getstate()
    with pytest.raises(error):
        action()
    assert game.get_state() is state and game._rng.getstate() == rng


@pytest.mark.parametrize("kind,ids,valid", [
    (MeldType.PURE_SEQUENCE, ("D0:AC", "D0:2C", "D0:3C"), True),
    (MeldType.PURE_SEQUENCE, ("D0:4C", "D0:2C", "D0:3C", "D0:5C"), True),
    (MeldType.PURE_SEQUENCE, ("D0:JC", "D0:QC", "D0:KC"), True),
    (MeldType.PURE_SEQUENCE, ("D0:QC", "D0:KC", "D0:AC"), False),
    (MeldType.PURE_SEQUENCE, ("D0:KC", "D0:AC", "D0:2C"), False),
    (MeldType.PURE_SEQUENCE, ("D0:2C", "D0:3C"), False),
    (MeldType.PURE_SEQUENCE, ("D0:2C", "D0:4C", "D0:5C"), False),
    (MeldType.PURE_SEQUENCE, ("D0:2C", "D0:3D", "D0:4C"), False),
    (MeldType.PURE_SEQUENCE, ("D0:2C", "D1:2C", "D0:3C"), False),
    (MeldType.PURE_SEQUENCE, ("D0:2C", "D0:3C", "MAN:0"), False),
    (MeldType.TUNNELA, copies(0, 3), True),
    (MeldType.TUNNELA, copies(0), False),
    (MeldType.TUNNELA, ("D0:2C", "D1:2C", "D2:2D"), False),
    (MeldType.DUBLEE, copies(0), True),
    (MeldType.DUBLEE, copies(0, 3), False),
    (MeldType.DUBLEE, ("MAN:0", "MAN:1"), False),
])
def test_natural_melds_through_facade(kind, ids, valid):
    game = fixture(ids)
    state, rng = game.get_state(), game._rng.getstate()
    meld = Meld(kind, ids)
    if valid:
        assert game.validate_meld("a", meld) == meld
    else:
        with pytest.raises(InvalidMeldError):
            game.validate_meld("a", meld)
    assert game.get_state() is state and game._rng.getstate() == rng


def test_declaration_validation_count_overlap_ownership_and_route_types():
    game = fixture(pair_hand())
    for groups in (pairs()[:6], pairs() + pairs()[:1], (pairs()[0],) * 7,
                   (Meld(MeldType.TUNNELA, copies(0)),) + pairs()[1:]):
        unchanged(game, InvalidMeldError, lambda: game.show_dublees("a", groups))
    unchanged(game, InvalidMeldError, lambda: game.validate_meld("a", Meld(MeldType.DUBLEE, copies(50))))
    unchanged(game, InvalidMeldError, lambda: game.show_dublees("a", None))
    unchanged(game, InvalidMeldError, lambda: game.show_initial_melds("a", pairs()[:3]))
    unchanged(game, InvalidTurnError, lambda: game.show_dublees("b", pairs()))
    assert game.validate_dublees("a", pairs()) == pairs()
    assert not game.has_eighth_dublee("a")  # Pairs alone do not establish the route.


def test_qualification_maal_permissions_one_indicator_and_committed_ownership():
    other_pairs = pairs(20)
    game = fixture(pair_hand(), other_ids=tuple(i for p in other_pairs for i in p.card_ids))
    before = game.get_state()
    assert game.get_maal("a") is None and not game.can_see_maal("a")
    result = game.show_dublees("a", pairs())
    after = game.get_state()
    assert [e.kind for e in result.events] == ["SEVEN_DUBLEES_SHOWN", "TIPLU_REVEALED", "PLAYER_SAW_MAAL"]
    assert all(e.revision == result.revision for e in result.events)
    assert after.players[0].hand == before.players[0].hand
    assert len(after.players[0].committed_card_ids) == 14
    assert after.tiplu is not None and after.tiplu not in after.stock
    assert game.get_maal("a") == game.get_player_view("a").maal
    assert game.get_maal("b") is None and game.get_player_view("b").maal is None
    indicator = after.tiplu
    assert indicator.card_id not in repr(asdict(game.get_public_view()))
    assert indicator.card_id not in repr(asdict(game.get_player_view("b")))
    public_event = next(e for e in game.get_public_events() if e.kind == "TIPLU_REVEALED")
    assert public_event.card is None
    assert next(e for e in game.get_player_events("a") if e.kind == "TIPLU_REVEALED").card == indicator
    assert next(e for e in game.get_player_events("b") if e.kind == "TIPLU_REVEALED").card is None
    unchanged(game, InvalidActionError, lambda: game.show_dublees("a", pairs()))
    unchanged(game, InvalidActionError, lambda: game.show_initial_melds("a", ()))
    unchanged(game, InvalidMeldError, lambda: game.validate_meld("a", pairs()[0]))
    unchanged(game, InvalidActionError, lambda: game.discard_card("a", pairs()[0].card_ids[0]))
    game.discard_card("a", game.get_allowed_actions("a").discardable_card_ids[0])
    game.draw_card("b", DrawSource.STOCK)
    result = game.show_dublees("b", other_pairs)
    assert [e.kind for e in result.events] == ["SEVEN_DUBLEES_SHOWN", "PLAYER_SAW_MAAL"]
    assert game.get_state().tiplu == indicator
    assert game.get_maal("a") == game.get_maal("b")
    assert next(e for e in game.get_player_events("b") if e.kind == "TIPLU_REVEALED").card == indicator
    validate_game_state(game.get_state())


def test_normal_qualification_accepts_mixed_natural_melds_and_rejects_normal_finish():
    sequence = Meld(MeldType.PURE_SEQUENCE, ("D0:AC", "D0:2C", "D0:3C"))
    groups = (sequence, Meld(MeldType.TUNNELA, copies(5, 3)), Meld(MeldType.TUNNELA, copies(6, 3)))
    game = fixture(tuple(i for m in groups for i in m.card_ids))
    assert game.validate_initial_melds("a", groups) == groups
    game.show_initial_melds("a", groups)
    assert game.can_see_maal("a") and not game.can_finish_normal_hand("a").supported
    unchanged(game, UnsupportedRuleError, lambda: game.finish("a"))
    assert ActionKind.FINISH not in game.get_allowed_actions("a").kinds
    validate_game_state(game.get_state())


def test_normal_declaration_cannot_commit_all_22_cards():
    groups = (Meld(MeldType.PURE_SEQUENCE, tuple(f"D0:{r}C" for r in (2,3,4,5,6,7,8,9))),
              Meld(MeldType.PURE_SEQUENCE, tuple(f"D0:{r}D" for r in (2,3,4,5,6,7,8))),
              Meld(MeldType.PURE_SEQUENCE, tuple(f"D0:{r}H" for r in (2,3,4,5,6,7,8))))
    game = fixture(tuple(i for m in groups for i in m.card_ids))
    unchanged(game, InvalidMeldError, lambda: game.show_initial_melds("a", groups))


def test_tiplu_skips_man_without_changing_their_order_and_can_refill():
    man0, man1 = CARDS["MAN:0"], CARDS["MAN:1"]
    standard = CARDS["D0:2C"]
    other = CARDS["D0:3C"]
    tiplu, stock, discard, recycled = select_tiplu((other, standard, man0, man1), (), Random(1))
    assert tiplu == standard and stock == (other, man0, man1) and not discard and recycled == 0
    tiplu, stock, discard, recycled = select_tiplu((man0, man1), (standard, other), Random(1))
    assert tiplu == standard and stock == (man0, man1) and discard == (other,) and recycled == 1
    for stock, discard in (((), ()), ((man0,), (other,)), ((man0,), (man1, other))):
        with pytest.raises(TipluUnavailableError):
            select_tiplu(stock, discard, Random(1))


def test_tiplu_refill_is_atomic_and_preserves_existing_man_cards(monkeypatch):
    import marriage.engine as module
    game = fixture(pair_hand())
    state = game.get_state()
    mans = tuple(c for c in state.stock if c.identity is None)
    standards = tuple(c for c in state.stock if c.identity is not None)
    game._state = replace(state, stock=mans, discard=standards)
    before, rng = game.get_state(), game._rng.getstate()
    validate_game_state(before)

    def fail(state):
        raise CardConservationError("staged qualification failure")

    with monkeypatch.context() as patch:
        patch.setattr(module, "validate_game_state", fail)
        unchanged(game, CardConservationError, lambda: game.show_dublees("a", pairs()))
    result = game.show_dublees("a", pairs())
    assert [e.kind for e in result.events] == ["DISCARD_PILE_RECYCLED", "SEVEN_DUBLEES_SHOWN",
                                              "TIPLU_REVEALED", "PLAYER_SAW_MAAL"]
    assert game.get_state().stock[-len(mans):] == mans
    assert game.get_state().discard == before.discard[-1:]
    assert game._rng.getstate() != rng
    validate_game_state(game.get_state())


def test_missing_tiplu_rejects_entire_declaration():
    game = fixture(pair_hand())
    # Deliberately exhausted defensive boundary; not a reachable conserved round.
    game._state = replace(game.get_state(), stock=(CARDS["MAN:0"],), discard=())
    unchanged(game, TipluUnavailableError, lambda: game.show_dublees("a", pairs()))
    assert not game.can_see_maal("a") and game.get_state().players[0].shown_melds == ()


def test_eighth_pair_finish_and_all_later_mutations_rejected():
    game = fixture(pair_hand(eighth=True))
    game.show_dublees("a", pairs())
    assert game.has_eighth_dublee("a") and ActionKind.FINISH in game.get_allowed_actions("a").kinds
    before = game.get_state()
    result = game.finish("a")
    state = game.get_state()
    assert state.status is GameStatus.FINISHED and state.winner == "a"
    assert state.winning_pair == copies(7)
    assert state.players[0].hand == before.players[0].hand and len(state.players[0].hand) == 22
    assert len(set(c.card_id for c in state.players[0].hand) - state.players[0].committed_card_ids
               - set(state.winning_pair)) == 6
    assert result.events[0].kind == "PLAYER_FINISHED"
    assert game.get_allowed_actions("a").kinds == game.get_allowed_actions("b").kinds == ()
    validate_game_state(state)
    for action in (game.start_game, lambda: game.draw_card("a", DrawSource.STOCK),
                   lambda: game.discard_card("a", state.players[0].hand[-1].card_id),
                   lambda: game.show_dublees("a", pairs()), lambda: game.show_initial_melds("a", ()),
                   lambda: game.finish("a")):
        unchanged(game, InvalidActionError, action)


def test_seven_pairs_and_third_copy_do_not_supply_eighth_pair():
    ids = pair_hand()[:-1] + (copies(0, 3)[-1],)
    game = fixture(ids)
    game.show_dublees("a", pairs())
    assert not game.has_eighth_dublee("a")
    unchanged(game, InvalidActionError, lambda: game.finish("a"))


@pytest.mark.parametrize("unrestricted,exception,winning,permitted,forced", [
    (False, False, True, False, False), (False, True, True, True, True),
    (False, True, False, False, False), (True, False, True, True, False),
    (True, True, False, True, False),
])
def test_winning_discard_policy_matrix(unrestricted, exception, winning, permitted, forced):
    rules = MarriageRules(dublee_player_can_draw_discard=unrestricted,
                          dublee_player_can_take_winning_discard=exception)
    game = fixture(pair_hand(), rules=rules)
    game.show_dublees("a", pairs())
    game.discard_card("a", DECK[14].card_id)
    game.draw_card("b", DrawSource.STOCK)
    # Select a controlled discard while preserving every physical ownership location.
    target = CARDS[copies(7)[1] if winning else copies(40)[1]]
    state = game.get_state()
    if target not in state.players[1].hand:
        replacement = state.players[1].hand[-1]
        hand = state.players[1].hand[:-1] + (target,)
        stock = tuple(replacement if c == target else c for c in state.stock)
        game._state = replace(state, players=(state.players[0], replace(state.players[1], hand=hand)), stock=stock)
    game.discard_card("b", target.card_id)
    assert (DrawSource.DISCARD in game.get_allowed_actions("a").drawable_sources) is permitted
    if not permitted:
        unchanged(game, InvalidActionError, lambda: game.draw_card("a", DrawSource.DISCARD))
        return
    game.draw_card("a", DrawSource.DISCARD)
    assert game.get_state().must_finish is forced
    if forced:
        assert game.get_allowed_actions("a").kinds == (ActionKind.FINISH,)
        unchanged(game, InvalidActionError, lambda: game.discard_card("a", DECK[8].card_id))
        game.finish("a")
    else:
        assert ActionKind.DISCARD in game.get_allowed_actions("a").kinds
    validate_game_state(game.get_state())


def test_event_privacy_cursor_and_pure_reads():
    game = MarriageGameEngine(("a", "b"), rng=Random(1))
    game.start_game()
    result = game.draw_card("a", DrawSource.STOCK)
    card = result.events[0].card
    before, rng = game.get_state(), game._rng.getstate()
    for _ in range(3):
        assert game.get_public_events(2)[0].card is None
        assert game.get_player_events("a", 2)[0].card == card
        assert game.get_player_events("b", 2)[0].card is None
        assert game.get_public_events(1000) == ()
        assert game.get_maal("a") is None
        assert game.read_last_card() is None
    assert game.get_state() is before and game._rng.getstate() == rng
    for cursor in (-1, True, "0"):
        unchanged(game, InvalidActionError, lambda: game.get_public_events(cursor))
    unchanged(game, InvalidActionError, lambda: game.get_player_events("unknown"))
    game.discard_card("a", card.card_id)
    assert game.read_last_card() == card
    assert game.get_public_events()[-2].card == card
    game.draw_card("b", DrawSource.DISCARD)
    assert game.get_public_events()[-1].card == card


@pytest.mark.parametrize("seed", [0, 1, 7, 42, 99])
def test_full_public_api_example_is_repeatable(seed):
    from examples.marriage_round import run_demo
    left, right = run_demo(seed), run_demo(seed)
    assert left.get_state() == right.get_state()
    assert left.get_public_view().status is GameStatus.FINISHED
    validate_game_state(left.get_state())


def test_finish_rolls_back_on_audit_failure_and_rejects_corrupt_winner(monkeypatch):
    import marriage.engine as module
    game = fixture(pair_hand(eighth=True))
    game.show_dublees("a", pairs())

    def fail(state):
        raise CardConservationError("staged finish failure")

    with monkeypatch.context() as patch:
        patch.setattr(module, "validate_game_state", fail)
        unchanged(game, CardConservationError, lambda: game.finish("a"))
    game.finish("a")
    state = game.get_state()
    for changes in ({"winner": "b"}, {"winning_pair": copies(0)}, {"must_finish": True},
                    {"phase": TurnPhase.MUST_DRAW}, {"history": state.history[:-1]},
                    {"players": (state.players[0], replace(state.players[1], finished=True))}):
        with pytest.raises(CardConservationError):
            validate_game_state(replace(state, **changes))


@pytest.mark.parametrize("tiplu,lower,upper", [("AC", "KC", "2C"), ("KC", "QC", "AC"),
                                               ("2H", "AH", "3H"), ("7S", "6S", "8S")])
def test_maal_faces_use_cyclic_neighbors(tiplu, lower, upper):
    from marriage.maal import maal_view
    view = maal_view(CARDS[f"D0:{tiplu}"], MarriageRules())
    assert view.tiplu == CARDS[f"D0:{tiplu}"].identity
    assert view.jhiplu == CARDS[f"D0:{lower}"].identity
    assert view.poplu == CARDS[f"D0:{upper}"].identity


def test_queries_and_safe_events_are_deeply_immutable():
    from dataclasses import FrozenInstanceError
    game = fixture(pair_hand())
    game.show_dublees("a", pairs())
    event = next(e for e in game.get_player_events("a") if e.kind == "SEVEN_DUBLEES_SHOWN")
    with pytest.raises(TypeError):
        event.card_groups[0][0] = "fake"
    with pytest.raises(FrozenInstanceError):
        event.kind = "fake"
    with pytest.raises(FrozenInstanceError):
        game.get_maal("a").tiplu = None
    with pytest.raises(FrozenInstanceError):
        game.can_finish_normal_hand("a").supported = True
