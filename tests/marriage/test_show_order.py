"""Per-player first turns, delayed private Maal access, and long qualification."""
from dataclasses import replace
from random import Random
import pytest
from marriage import (ActionKind, DrawSource, InvalidActionError, InvalidMeldError,
                      InvalidTurnError, MarriageGameEngine, MarriageRules, ScoringRules,
                      Meld, MeldType, PlayerState, TurnPhase, create_deck, validate_game_state)

CARDS = {c.card_id:c for c in create_deck()}

def groups(sizes=(5,5,3)):
    return tuple(Meld(MeldType.PURE_SEQUENCE, tuple(f'D0:{r}{s}' for r in range(2,2+size)))
                 for s,size in zip('CHS',sizes))

def dealt(melds, count=4, actor=0):
    game = MarriageGameEngine(tuple(str(i) for i in range(count)), rng=Random(33),
        rules=MarriageRules(scoring=ScoringRules(initial_tunnela_declaration=False)))
    game.start_game()
    chosen = tuple(CARDS[i] for g in melds for i in g.card_ids)
    remaining = tuple(c for c in CARDS.values() if c not in chosen)
    hand = chosen + remaining[:21-len(chosen)]
    remaining = remaining[21-len(chosen):]
    players = []
    for i in range(count):
        if i == actor: players.append(PlayerState(str(i),hand))
        else:
            players.append(PlayerState(str(i),remaining[:21]));remaining=remaining[21:]
    game._state = replace(game.get_state(),players=tuple(players),discard=remaining[:1],stock=remaining[1:])
    validate_game_state(game.get_state())
    return game

def pass_turn(game):
    actor = game.get_state().current_player_id
    game.draw_card(actor,DrawSource.STOCK)
    game.discard_card(actor,game.get_state().players[int(actor)].hand[-1].card_id)

@pytest.mark.parametrize('count',[2,3,4,5])
@pytest.mark.parametrize('actor',[0,1])
def test_each_players_first_turn_can_show_before_draw_and_survives_recovery(count,actor):
    melds=groups();game=dealt(melds,count,actor)
    if actor: pass_turn(game)
    player=str(actor)
    assert ActionKind.SHOW_INITIAL_MELDS in game.get_allowed_actions(player).kinds
    result=game.show_initial_melds(player,melds)
    assert result.events[-1].kind=='PLAYER_SAW_MAAL'
    assert game.get_state().phase is TurnPhase.MUST_DRAW
    assert game.get_player_view(player).maal is not None
    assert len(game.get_player_view(player).hand)==21
    recovered=MarriageGameEngine.from_state(game.get_state(),rng=game._rng)
    recovered.draw_card(player,DrawSource.STOCK)
    locked=set(i for g in melds for i in g.card_ids)
    assert not locked.intersection(recovered.get_allowed_actions(player).discardable_card_ids)
    recovered.discard_card(player,recovered.get_allowed_actions(player).discardable_card_ids[-1])
    validate_game_state(recovered.get_state())

@pytest.mark.parametrize('count',[2,3,4,5])
def test_later_turn_show_waits_for_discard_before_private_maal_access(count):
    melds=groups((4,5,3));game=dealt(melds,count)
    for _ in range(count):pass_turn(game)
    assert ActionKind.SHOW_INITIAL_MELDS not in game.get_allowed_actions('0').kinds
    before=game.get_state()
    with pytest.raises(InvalidActionError):game.show_initial_melds('0',melds)
    assert game.get_state() is before
    game.draw_card('0',DrawSource.STOCK)
    result=game.show_initial_melds('0',melds)
    assert not any(e.kind=='PLAYER_SAW_MAAL' for e in result.events)
    assert game.get_player_view('0').maal is None
    assert not game.get_state().players[0].has_seen_maal
    # A wholly natural winning hand may now finish before seeing Maal.
    assert (ActionKind.FINISH in game.get_allowed_actions('0').kinds)==(game.get_allowed_actions('0').normal_finish is not None)
    assert all(e.card is None for e in game.get_player_events('0') if e.kind=='TIPLU_REVEALED')
    with pytest.raises(InvalidTurnError):game.show_initial_melds('1',melds)
    game=MarriageGameEngine.from_state(game.get_state(),rng=game._rng)
    result=game.discard_card('0',game.get_allowed_actions('0').discardable_card_ids[-1])
    assert [e.kind for e in result.events]==['CARD_DISCARDED','PLAYER_SAW_MAAL','TURN_CHANGED']
    assert game.get_player_view('0').maal is not None
    assert all(game.get_player_view(str(i)).maal is None for i in range(1,count))
    assert game.get_state().current_player_id=='1'

@pytest.mark.parametrize('count',[2,3,4,5])
def test_dublee_requires_four_original_players_in_queries_and_commands(count):
    pairs=tuple(Meld(MeldType.DUBLEE,(f'D0:{r}C',f'D1:{r}C')) for r in range(2,9))
    game=dealt(pairs,count)
    assert (ActionKind.SHOW_DUBLEES in game.get_allowed_actions('0').kinds)==(count>=4)
    if count<4:
        before=game.get_state()
        with pytest.raises(InvalidActionError,match='four players'):game.show_dublees('0',pairs)
        assert game.get_state() is before
    else:
        game.show_dublees('0',pairs)
        assert game.get_player_view('0').maal is not None


def test_initial_sequences_longer_than_five_reject_atomically():
    melds=groups((6,3,3));game=dealt(melds)
    before,rng=game.get_state(),game._rng.getstate()
    with pytest.raises(InvalidMeldError,match='five'):game.show_initial_melds('0',melds)
    assert game.get_state() is before and game._rng.getstate()==rng

@pytest.mark.parametrize('sizes',[(5,5,3),(4,5,3)])
def test_long_shown_groups_finish_with_fewer_than_twelve_remaining_cards(sizes):
    melds=groups(sizes)
    # Use nonoverlapping long remaining Spades after the shown 2–4 Spades.
    needed=21-sum(sizes)
    remainder=tuple(f'D0:{r if r<11 else {11:"J",12:"Q",13:"K"}[r]}S' for r in range(5,5+needed))
    held=tuple(CARDS[i] for g in melds for i in g.card_ids)+tuple(CARDS[i] for i in remainder)
    tiplu,last=CARDS['D2:8D'],CARDS['MAN:0']
    rest=tuple(c for c in CARDS.values() if c not in held+(tiplu,last))
    game=dealt(melds,2)
    game._state=replace(game.get_state(),players=(PlayerState('0',held),PlayerState('1',rest[:21])),stock=rest[21:]+(last,tiplu),discard=())
    game.show_initial_melds('0',melds)
    game.draw_card('0',DrawSource.STOCK)
    assert game.get_allowed_actions('0').normal_finish is not None
    assert len(game.get_state().players[0].hand)-sum(sizes)==needed+1<12
    finish=melds+(Meld(MeldType.PURE_SEQUENCE,remainder),)
    game.finish('0',finish,last.card_id)
    assert len(game.get_state().players[0].hand)==21
    validate_game_state(game.get_state())
