from marriage import MarriageRules, ScoringRules
"""Normal-round contract: real engine transitions and conserved test-only deals."""
from dataclasses import asdict, replace
from random import Random

import pytest

from marriage import (ActionKind, CardConservationError, DrawSource, GameStatus,
                      InvalidActionError, InvalidMeldError, InvalidTurnError,
                      MarriageGameEngine, MarriageRules, Meld, MeldType,
                      PlayerState, create_deck, validate_game_state)
from marriage.completion import completion_meld, normal_finish

CARDS = {c.card_id: c for c in create_deck()}
INITIAL = tuple(Meld(MeldType.PURE_SEQUENCE, tuple(f'D0:{r}{s}' for r in ranks))
                for s, ranks in [('C', '234'), ('D', '567'), ('H', 'JQK')])
REMAINDER = ('D0:2S', 'D0:3S', 'D0:4S', 'D0:5C', 'D0:5H', 'D0:5S',
             'D0:9C', 'D0:9D', 'D0:9S', 'D0:10S', 'D0:JS', 'D0:QS', 'D0:AH')
WILDS = {'D0:3S': 'MAN:0', 'D0:5H': 'D0:8D', 'D0:9S': 'D0:7H', 'D0:JS': 'D0:9H'}


def normal_round(count=2, wild=False, remainder=None):
    game = MarriageGameEngine(tuple(str(i) for i in range(count)), rng=Random(27), rules=MarriageRules(scoring=ScoringRules(initial_tunnela_declaration=False)))
    game.start_game()
    ids = tuple(i for m in INITIAL for i in m.card_ids) + tuple(
        WILDS.get(i, i) if wild else i for i in (remainder or REMAINDER))
    hand = tuple(CARDS[i] for i in ids)
    tiplu = CARDS['D2:8H']
    remaining = tuple(c for c in create_deck() if c not in hand and c != tiplu)
    players = (PlayerState('0', hand[:-1]),) + tuple(
        PlayerState(str(i), remaining[(i - 1) * 21:i * 21]) for i in range(1, count))
    game._state = replace(game.get_state(), players=players,
                          discard=(), stock=remaining[(count - 1) * 21:] + (tiplu, hand[-1]))
    validate_game_state(game.get_state())
    return game


@pytest.mark.parametrize('count', [2, 3, 4, 5])
@pytest.mark.parametrize('wild', [False, True])
def test_normal_round_qualification_private_preview_finish_and_scores(count, wild):
    game = normal_round(count, wild)
    assert not game.can_finish_normal_hand('0').can_finish
    game.draw_card('0', DrawSource.STOCK)
    assert ActionKind.FINISH not in game.get_allowed_actions('0').kinds
    game.show_initial_melds('0', INITIAL)
    before, rng = game.get_state(), game._rng.getstate()
    witness = game.get_allowed_actions('0').normal_finish
    assert witness is not None and witness.melds[:3] == INITIAL
    assert witness.discard_card_id == 'D0:AH'
    used = tuple(i for m in witness.melds for i in m.card_ids)
    assert len(used) == len(set(used)) == 21 and witness.discard_card_id not in used
    assert game.can_finish_normal_hand('0').can_finish
    assert game.get_public_view().normal_finish is None
    assert game.get_player_view('1').actions.normal_finish is None
    hidden = {c.card_id for c in before.players[0].hand} - before.players[0].committed_card_ids
    assert not any(i in repr(asdict(game.get_public_view())) for i in hidden)
    assert not any(i in repr(asdict(game.get_player_view('1'))) for i in hidden)
    assert game.get_state() is before and game._rng.getstate() == rng
    with pytest.raises(InvalidTurnError):
        game.finish('1')
    result = game.finish('0')
    after = game.get_state()
    assert after.revision == before.revision + 1 and game._rng.getstate() == rng
    assert [e.kind for e in result.events] == ['CARD_DISCARDED', 'PLAYER_FINISHED']
    assert after.status is GameStatus.FINISHED and after.winner == '0'
    assert len(after.players[0].hand) == 21 and after.discard[-1].card_id == witness.discard_card_id
    assert after.normal_finish == game.get_public_view().normal_finish == witness
    public_finish = game.get_public_events()[-1]
    assert public_finish.card_groups == tuple(m.card_ids for m in witness.melds)
    assert public_finish.discard_card_id == 'D0:AH'
    assert CARDS['D2:8H'].card_id not in repr(asdict(game.get_public_view()))
    scores = game.get_scores()
    assert sum(p.net_points for p in scores.players) == 0
    assert all(p.winner_payment == -scores.rules.unseen_payment for p in scores.players[1:])
    assert scores.players[0].winner_payment == (count - 1) * scores.rules.unseen_payment
    assert game.get_allowed_actions('0').kinds == ()
    with pytest.raises(InvalidActionError):
        game.finish('0')
    validate_game_state(after)


@pytest.mark.parametrize('ids,expected', [
    (('D0:2S', 'MAN:0', 'D0:4S'), MeldType.SEQUENCE),
    (('D0:2S', 'D0:8D', 'D0:4S'), MeldType.SEQUENCE),
    (('D0:2S', 'D0:7H', 'D0:4S'), MeldType.SEQUENCE),
    (('D0:2S', 'D0:9H', 'D0:4S'), MeldType.SEQUENCE),
    (('D0:2S', 'D0:7D', 'D0:4S'), None),
    (('D0:2S', 'D1:2S', 'MAN:0'), None),
    (('D0:2S', 'D1:2S', 'D2:2S'), MeldType.TUNNELA),
    (('D0:5S', 'D0:5C', 'MAN:0'), MeldType.SET),
    (('D0:5S', 'D0:5C', 'D0:5D', 'MAN:0'), MeldType.SET),
    (('D0:5S', 'D0:5C', 'D0:5D', 'MAN:0', 'MAN:1'), None),
    (('MAN:0', 'MAN:1', 'MAN:2'), MeldType.SEQUENCE),
    (('D0:AS', 'D0:2S', 'MAN:0'), MeldType.SEQUENCE),
    (('D0:QS', 'D0:KS', 'D0:AS'), MeldType.PURE_SEQUENCE),
    (('D0:KS', 'D0:AS', 'MAN:0'), MeldType.SEQUENCE),
    (('D0:JS', 'D0:QS', 'MAN:0'), MeldType.SEQUENCE),
    (('D0:2S', 'D0:2S', 'MAN:0'), None),
    (('D0:2S', 'MAN:0'), None),
])
def test_completion_meld_boundaries(ids, expected):
    assert completion_meld(tuple(CARDS[i] for i in ids), CARDS['D2:8H'], MarriageRules()) == expected


def test_invalid_hand_and_natural_qualification_cannot_use_wildcards():
    scattered = ('D0:2S', 'D0:4S', 'D0:6S', 'D0:10S', 'D0:QS', 'D0:AC',
                 'D0:6C', 'D0:10C', 'D0:KC', 'D0:2D', 'D0:QD', 'D0:3H', 'D0:AH')
    game = normal_round(remainder=scattered)
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', INITIAL)
    before, rng = game.get_state(), game._rng.getstate()
    assert not game.can_finish_normal_hand('0').can_finish
    assert game.get_allowed_actions('0').normal_finish is None
    with pytest.raises(InvalidActionError):
        game.finish('0')
    with pytest.raises(InvalidMeldError):
        game.validate_meld('0', Meld(MeldType.SET, ('D0:2S', 'D0:2D', 'D0:2C')))
    assert game.get_state() is before and game._rng.getstate() == rng
    wild_game = normal_round(wild=True)
    with pytest.raises(InvalidMeldError):
        wild_game.validate_meld('0', Meld(MeldType.PURE_SEQUENCE, ('D0:2S', 'MAN:0', 'D0:4S')))


def test_normal_finish_invariant_detects_reuse_and_rollback(monkeypatch):
    game = normal_round()
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', INITIAL)
    before, rng = game.get_state(), game._rng.getstate()
    def reject_audit(_):
        raise CardConservationError('audit')
    with monkeypatch.context() as patch:
        patch.setattr('marriage.engine.validate_game_state', reject_audit)
        with pytest.raises(CardConservationError):
            game.finish('0')
    assert game.get_state() is before and game._rng.getstate() == rng
    game.finish('0')
    state = game.get_state()
    bad = replace(state.normal_finish, melds=state.normal_finish.melds[:-1] + (INITIAL[0],))
    with pytest.raises(CardConservationError):
        validate_game_state(replace(state, normal_finish=bad))
    with pytest.raises(CardConservationError):
        validate_game_state(replace(state, normal_finish=replace(state.normal_finish, discard_card_id=INITIAL[0].card_ids[0])))


def test_deterministic_partition_independent_of_hand_order_and_cache():
    game = normal_round(wild=True)
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', INITIAL)
    state = game.get_state()
    witness = game.get_allowed_actions('0').normal_finish
    normal_finish.cache_clear()
    player = replace(state.players[0], hand=tuple(reversed(state.players[0].hand)))
    assert normal_finish(player, state.tiplu, state.config.rules) == witness


def test_long_qualification_can_finish_and_final_discard_is_not_scored():
    game = normal_round()
    state = game.get_state()
    groups = tuple(Meld(MeldType.PURE_SEQUENCE, tuple(f'D0:{r}{s}' for r in range(2, 9))) for s in 'CDH')
    hand = tuple(CARDS[i] for m in groups for i in m.card_ids)
    tiplu, discard = CARDS['D2:8H'], CARDS['MAN:0']
    rest = tuple(c for c in create_deck() if c not in hand + (tiplu, discard))
    game._state = replace(state, players=(PlayerState('0', hand), PlayerState('1', rest[:21])),
                          discard=(), stock=rest[21:] + (tiplu, discard))
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', groups)
    assert game.get_allowed_actions('0').normal_finish.discard_card_id == 'MAN:0'
    game.finish('0')
    assert all(item.label != 'Man' for item in game.get_scores().players[0].items)
    validate_game_state(game.get_state())


def test_qualified_player_can_finish_after_later_discard_pickup():
    game = normal_round(wild=True)
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', INITIAL)
    game.discard_card('0', 'D0:AH')
    assert game.get_allowed_actions('0').normal_finish is None
    assert not game.can_finish_normal_hand('0').can_finish
    game.draw_card('1', DrawSource.DISCARD)
    game.discard_card('1', 'D0:AH')
    assert ActionKind.FINISH not in game.get_allowed_actions('0').kinds
    game.draw_card('0', DrawSource.DISCARD)
    assert game.get_allowed_actions('0').normal_finish is not None
    game.finish('0')
    assert game.get_scores().winner == '0'


def test_selected_partition_is_validated_and_broadcast_exactly():
    game = normal_round(wild=True)
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', INITIAL)
    witness = game.get_allowed_actions('0').normal_finish
    alternative = witness.melds[:3] + tuple(reversed(witness.melds[3:]))
    before = game.get_state()
    for groups, discard in [(alternative, INITIAL[0].card_ids[0]),
                            (alternative[:-1] + (INITIAL[0],), witness.discard_card_id),
                            (alternative[1:], witness.discard_card_id),
                            (alternative, 'not-owned')]:
        with pytest.raises(InvalidActionError):
            game.finish('0', groups, discard)
        assert game.get_state() is before
    with pytest.raises(InvalidTurnError):
        game.finish('1', alternative, witness.discard_card_id)
    game.finish('0', alternative, witness.discard_card_id)
    assert game.get_public_view().normal_finish.melds == alternative
    assert game.get_public_events()[-1].card_groups == tuple(m.card_ids for m in alternative)
    validate_game_state(game.get_state())


def test_selected_eighth_pair_validates_ownership_and_preserves_other_cards():
    game = MarriageGameEngine(('0', '1'), rng=Random(27), rules=MarriageRules(scoring=ScoringRules(initial_tunnela_declaration=False)))
    game.start_game()
    pairs = tuple(Meld(MeldType.DUBLEE, (f'D0:{rank}C', f'D1:{rank}C')) for rank in range(2, 9))
    ids = tuple(i for m in pairs for i in m.card_ids) + (
        'D0:10H', 'D1:10H', 'D2:10H', 'D0:QH', 'D1:QH', 'D0:2S', 'D0:4S', 'MAN:0')
    hand = tuple(CARDS[i] for i in ids)
    remaining = tuple(c for c in create_deck() if c not in hand)
    game._state = replace(game.get_state(), players=(PlayerState('0', hand[:-1]), PlayerState('1', remaining[:21])),
                          discard=(), stock=remaining[21:] + (hand[-1],))
    game.draw_card('0', DrawSource.STOCK)
    game.show_dublees('0', pairs)
    before = game.get_state()
    for pair in [('D0:2C', 'D1:2C'), ('D0:10H', 'D0:10H'), ('D0:10H', 'D0:QH'), ('missing', 'D0:QH')]:
        with pytest.raises(InvalidActionError):
            game.finish('0', winning_pair=pair)
        assert game.get_state() is before
    selected = ('D0:QH', 'D1:QH')
    game.finish('0', winning_pair=selected)
    assert game.get_public_view().winning_pair == selected
    assert game.get_public_events()[-1].winning_pair == selected
    assert game.get_state().players[0].hand == before.players[0].hand
    validate_game_state(game.get_state())


def test_folded_qualified_player_keeps_maal_and_seen_settlement():
    from marriage.scoring import score_items
    game = normal_round(3, wild=True)
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', INITIAL)
    player = game.get_state().players[0]
    before_points = sum(i.points for i in score_items(player, game.get_maal('0'), game.get_state().config.rules.scoring))
    game.fold('0')
    game.fold('1')
    result = next(p for p in game.get_scores().players if p.player_id == '0')
    assert result.maal_points == before_points
    assert result.winner_payment == -game.get_state().config.rules.scoring.seen_payment
    assert game.get_state().players[0].hand == player.hand
    validate_game_state(game.get_state())
