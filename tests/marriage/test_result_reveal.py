"""Result projections reveal played hands only after a completed round."""
from dataclasses import asdict
import runpy

from marriage import DrawSource


def test_result_cards_and_indicator_are_public_only_after_finish():
    setup = runpy.run_path('tests/marriage/test_normal_completion.py')
    game = setup['normal_round'](count=4, wild=True)
    for query in (game.get_public_view, lambda: game.get_player_view('1').public):
        assert query().final_hands == ()
        assert query().result_maal is None
    game.draw_card('0', DrawSource.STOCK)
    game.show_initial_melds('0', setup['INITIAL'])
    assert game.get_public_view().final_hands == ()
    assert game.get_public_view().result_maal is None
    game.finish('0')
    state = game.get_state()
    result = game.get_public_view()
    assert result.result_maal.tiplu.rank == state.tiplu.rank
    assert result.result_maal.tiplu.suit == state.tiplu.suit
    assert {p.player_id:p.cards for p in result.final_hands} == {p.player_id:p.hand for p in state.players}
    assert game.get_player_view('1').public == result
    assert not {c.card_id for c in state.stock} & {c.card_id for p in result.final_hands for c in p.cards}
    assert 'stock' not in asdict(result)
