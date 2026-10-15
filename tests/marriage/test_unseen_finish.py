"""Natural direct finishes draw/discard atomically and never expose Maal."""
from dataclasses import replace
from random import Random
import pytest
from marriage import (ActionKind, CardConservationError, DrawSource, GameStatus,
    InvalidActionError, InvalidTurnError, MarriageGameEngine, MarriageRules,
    ScoringRules, Meld, MeldType, PlayerState, QualificationRoute, create_deck,validate_game_state)

CARDS={c.card_id:c for c in create_deck()}
NORMAL=tuple(Meld(MeldType.PURE_SEQUENCE,tuple(f'D0:{r}{s}' for r in range(2,2+n))) for s,n in zip('CHS',(5,5,3)))
REST=Meld(MeldType.PURE_SEQUENCE,tuple(f'D0:{r if r<11 else {11:"J",12:"Q"}[r]}S' for r in range(5,13)))
PAIRS=tuple(Meld(MeldType.DUBLEE,(f'D0:{r}C',f'D1:{r}C')) for r in range(2,10))


def setup(count=2,dublee=False,wild=False):
    game=MarriageGameEngine(tuple(str(i) for i in range(count)),rng=Random(42),rules=MarriageRules(scoring=ScoringRules(initial_tunnela_declaration=False)))
    game.start_game()
    ids=(tuple(i for g in PAIRS for i in g.card_ids)+tuple(f'D0:{r}D' for r in (2,4,6,8,10))) if dublee else tuple(i for g in NORMAL+(REST,) for i in g.card_ids)
    if wild:ids=tuple('MAN:1' if i=='D0:9S' else i for i in ids)
    hand=tuple(CARDS[i] for i in ids);draw=CARDS['MAN:0']
    remaining=tuple(c for c in CARDS.values() if c not in hand+(draw,))
    others=tuple(PlayerState(str(i),remaining[(i-1)*21:i*21]) for i in range(1,count))
    remaining=remaining[(count-1)*21:]
    game._state=replace(game.get_state(),players=(PlayerState('0',hand),)+others,stock=remaining[1:]+(draw,),discard=remaining[:1])
    validate_game_state(game.get_state())
    return game

@pytest.mark.parametrize('count',[2,3,4,5])
@pytest.mark.parametrize('selected',[False,True])
def test_unseen_normal_finish_without_initial_show_or_indicator(count,selected):
    game=setup(count)
    assert ActionKind.FINISH not in game.get_allowed_actions('0').kinds
    before=game.get_state()
    with pytest.raises(InvalidActionError):game.finish('0')
    assert game.get_state() is before
    game.draw_card('0',DrawSource.STOCK)
    assert ActionKind.FINISH in game.get_allowed_actions('0').kinds
    assert game.get_allowed_actions('0').normal_finish is not None
    assert game.get_player_view('0').maal is None
    with pytest.raises(InvalidTurnError):game.finish('1')
    rng=game._rng.getstate()
    result=game.finish('0',NORMAL+(REST,),'MAN:0') if selected else game.finish('0')
    state=game.get_state()
    assert state.status is GameStatus.FINISHED and state.winner=='0'
    assert state.players[0].route is QualificationRoute.NORMAL
    assert not state.players[0].has_seen_maal and state.tiplu is None
    assert len(state.players[0].hand)==21 and state.discard[-1].card_id=='MAN:0'
    assert [e.kind for e in result.events]==['CARD_DISCARDED','PLAYER_FINISHED']
    assert game._rng.getstate()==rng
    assert game.get_scores().players[0].maal_points==0
    assert sum(p.net_points for p in game.get_scores().players)==0
    recovered=MarriageGameEngine.from_state(state,rng=game._rng)
    assert recovered.get_state()==state and recovered.get_maal('0') is None

@pytest.mark.parametrize('count',[2,3,4,5])
@pytest.mark.parametrize('selected',[False,True])
def test_unseen_eight_dublees_require_four_players_and_a_final_discard(count,selected):
    game=setup(count,dublee=True)
    game.draw_card('0',DrawSource.STOCK)
    assert (ActionKind.FINISH in game.get_allowed_actions('0').kinds)==(count>=4)
    before,rng=game.get_state(),game._rng.getstate()
    action=lambda:game.finish('0',pairs=PAIRS,discard_card_id='MAN:0') if selected else game.finish('0')
    if count<4:
        with pytest.raises(InvalidActionError):action()
        assert game.get_state() is before and game._rng.getstate()==rng
        return
    result=action();state=game.get_state()
    assert state.players[0].route is QualificationRoute.DUBLEE
    assert len(state.players[0].hand)==21 and not state.players[0].has_seen_maal
    assert len(state.players[0].committed_card_ids)==14 and len(state.winning_pair)==2
    assert state.tiplu is None and len(result.events[-1].card_groups)==8
    assert state.discard[-1].card_id==result.events[-1].discard_card_id
    assert game._rng.getstate()==rng
    assert sum(p.net_points for p in game.get_scores().players)==0
    assert game.get_scores().players[0].winner_payment==(count-1)*(game.get_state().config.rules.scoring.unseen_payment+game.get_state().config.rules.scoring.dublee_win_bonus)
    assert MarriageGameEngine.from_state(state).get_state()==state


def test_unseen_natural_rejects_wildcards_reuse_and_invalid_discard_atomically():
    game=setup(wild=True);game.draw_card('0',DrawSource.STOCK)
    assert ActionKind.FINISH not in game.get_allowed_actions('0').kinds
    before,rng=game.get_state(),game._rng.getstate()
    wild=Meld(MeldType.SEQUENCE,tuple('MAN:1' if i=='D0:9S' else i for i in REST.card_ids))
    for groups,discard in [(NORMAL+(wild,),'MAN:0'),(NORMAL+(NORMAL[0],),'MAN:0'),(NORMAL+(REST,),NORMAL[0].card_ids[0])]:
        with pytest.raises(InvalidActionError):game.finish('0',groups,discard)
        assert game.get_state() is before and game._rng.getstate()==rng


def test_pending_qualification_can_finish_naturally_without_seeing_maal():
    game=setup()
    for player in ['0','1']:
        game.draw_card(player,DrawSource.STOCK)
        game.discard_card(player,game.get_player_view(player).hand[-1].card_id)
    game.draw_card('0',DrawSource.STOCK)
    game.show_initial_melds('0',NORMAL)
    assert not game.get_state().players[0].has_seen_maal
    indicator=game.get_state().tiplu;rng=game._rng.getstate()
    game.finish('0')
    assert game.get_state().tiplu==indicator and game._rng.getstate()==rng
    assert not game.get_state().players[0].has_seen_maal
    assert game.get_maal('0') is None
    assert all(e.card is None for e in game.get_player_events('0') if e.kind=='TIPLU_REVEALED')


def test_unseen_finish_rolls_back_and_terminal_corruption_rejects(monkeypatch):
    game=setup(4,dublee=True);game.draw_card('0',DrawSource.STOCK)
    before=game.get_state()
    def fail(_):raise CardConservationError('injected')
    with monkeypatch.context() as patch:
        patch.setattr('marriage.engine.validate_game_state',fail)
        with pytest.raises(CardConservationError):game.finish('0',pairs=PAIRS,discard_card_id='MAN:0')
    assert game.get_state() is before
    game.finish('0',pairs=PAIRS,discard_card_id='MAN:0')
    state=game.get_state()
    for corrupted in [replace(state,winning_pair=()),replace(state,history=state.history[:-1]+(replace(state.history[-1],discard_card_id='missing'),))]:
        with pytest.raises(CardConservationError):validate_game_state(corrupted)
