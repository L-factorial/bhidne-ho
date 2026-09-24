from dataclasses import replace
from random import Random

import pytest

from marriage import (ActionKind, DrawSource, InvalidActionError, InvalidMeldError,
                      MarriageGameEngine, MarriageRules, Meld, MeldType, PlayerState,
                      ScoringRules, create_deck, validate_game_state)
from marriage.maal import maal_view
from marriage.scoring import score_items


def dealt():
    engine = MarriageGameEngine(('a', 'b', 'c'), rng=Random(6))
    engine.start_game()
    deck = create_deck()
    groups = tuple(Meld(MeldType.TUNNELA, tuple(f'D{p}:{face}' for p in range(3)))
                   for face in ('8H', '4C'))
    ids = {i for m in groups for i in m.card_ids}
    selected = tuple(c for c in deck if c.card_id in ids)
    rest = tuple(c for c in deck if c.card_id not in ids)
    hands = (selected + rest[:15], rest[15:36], rest[36:57])
    engine._state = replace(engine.get_state(), players=tuple(PlayerState(p, h) for p, h in zip(('a','b','c'), hands)),
                            stock=rest[57:-1], discard=rest[-1:])
    validate_game_state(engine.get_state())
    return engine, groups


def test_default_gate_allows_out_of_turn_declarations_and_blocks_play_until_every_response():
    engine, groups = dealt()
    assert engine.get_public_view().tunnela_declaration_pending
    for actor in ('a','b','c'):
        assert engine.get_allowed_actions(actor).kinds == (ActionKind.DECLARE_TUNNELAS,)
    with pytest.raises(InvalidActionError):
        engine.draw_card('a', DrawSource.STOCK)
    engine.declare_tunnelas('b', ())
    assert engine.get_allowed_actions('b').kinds == ()
    engine.declare_tunnelas('a', groups[:1])
    assert not engine.get_player_view('a').maal
    assert not engine.get_public_view().players[0].shown_melds
    assert engine.get_public_view().players[0].initial_tunnelas == groups[:1]
    assert engine.get_public_view().tunnela_declaration_pending
    engine.declare_tunnelas('c', ())
    assert not engine.get_public_view().tunnela_declaration_pending
    engine.draw_card('a', DrawSource.STOCK)
    assert not set(groups[0].card_ids).intersection(engine.get_allowed_actions('a').discardable_card_ids)
    with pytest.raises(InvalidActionError):
        engine.discard_card('a', groups[0].card_ids[0])
    engine.discard_card('a', engine.get_allowed_actions('a').discardable_card_ids[0])
    validate_game_state(engine.get_state())


def test_invalid_duplicate_and_late_declarations_do_not_mutate_state():
    engine, groups = dealt()
    for melds in ((groups[0], groups[0]), (Meld(MeldType.DUBLEE, groups[0].card_ids[:2]),),
                  (Meld(MeldType.TUNNELA, ('D0:KH','D1:KH','D2:KH')),)):
        before = engine.get_state()
        with pytest.raises((InvalidActionError, InvalidMeldError)):
            engine.declare_tunnelas('a', melds)
        assert engine.get_state() is before
    # Declaring none is an explicit choice, even if a Tunnela was dealt.
    engine.declare_tunnelas('a', ())
    with pytest.raises(InvalidActionError):
        engine.declare_tunnelas('a', groups)
    engine.declare_tunnelas('b', ())
    engine.declare_tunnelas('c', ())
    with pytest.raises(InvalidActionError):
        engine.declare_tunnelas('a', groups)


def test_only_selected_initial_cards_are_exposed_and_earn_initial_bonus():
    engine, groups = dealt()
    engine.declare_tunnelas('a', groups[:1])
    pub = repr(engine.get_public_view())
    assert all(i in pub for i in groups[0].card_ids)
    assert all(i not in pub for i in groups[1].card_ids)
    event = engine.get_public_events()[-1]
    assert event.kind == 'TUNNELAS_DECLARED' and event.card_groups == (groups[0].card_ids,)
    p = replace(engine.get_state().players[0], has_seen_maal=True)
    tiplu = next(c for c in create_deck() if c.card_id == 'D2:QS')
    items = score_items(p, maal_view(tiplu, MarriageRules()), ScoringRules())
    bonus = next(i for i in items if i.label == 'Tunnela bonus')
    assert bonus.count == 1 and bonus.points == 5 and bonus.card_ids == groups[0].card_ids
    later = replace(p, initial_tunnelas=(), shown_melds=groups,
                    committed_card_ids=frozenset(i for m in groups for i in m.card_ids))
    assert not any(i.label == 'Tunnela bonus' for i in score_items(later, maal_view(tiplu, MarriageRules()), ScoringRules()))


def test_disabling_rule_skips_gate_and_departure_does_not_block_other_players():
    engine = MarriageGameEngine(('a','b'), rules=MarriageRules(scoring=ScoringRules(initial_tunnela_declaration=False)))
    engine.start_game()
    assert not engine.get_public_view().tunnela_declaration_pending
    with pytest.raises(InvalidActionError):
        engine.declare_tunnelas('a', ())
    engine.draw_card('a', DrawSource.STOCK)
    engine, _ = dealt()
    engine.declare_tunnelas('a', ())
    engine.declare_tunnelas('b', ())
    engine.fold('c')
    assert not engine.get_public_view().tunnela_declaration_pending
    engine.draw_card('a', DrawSource.STOCK)
