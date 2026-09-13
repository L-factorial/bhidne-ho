import json
import pytest
from flush import FlushGameEngine, FlushRulesConfig, GameStatus, FlushError, TerminationReason


@pytest.mark.parametrize('reveal', [False, True])
def test_final_show_broadcasts_requester_only_then_waits_for_response(reveal):
    e = FlushGameEngine(['a','b','c'], initial_chips=dict.fromkeys('abc', 100),
        rules=FlushRulesConfig(5, minimum_blind_rounds_before_show=0))
    e.start_game(); e.deal_cards('a'); e.skip_cut('b'); e.fold('b')
    before = e.get_state()
    result = e.show('c')
    state = e.get_state()
    assert state.status is GameStatus.IN_PROGRESS and state.settlement is None
    assert state.pot == before.pot + 1 and not state.round_results
    assert state.pending_show.target_id == 'a'
    assert e.get_allowed_actions('a').kinds == ('reveal_cards', 'fold')
    assert e.get_allowed_actions('c').kinds == ()
    assert result.events[0].shown_hands[0].cards == state.players[2].cards
    assert [h.player_id for h in state.revealed_hands] == ['c']
    for viewer in 'abc':
        public = e.get_player_view(viewer).public
        assert [h.player_id for h in public.revealed_hands] == ['c']
    for p, action in [('c', e.fold), ('b', e.reveal_cards), ('c', e.reveal_cards), ('a', e.see_cards), ('a', e.show)]:
        with pytest.raises(FlushError): action(p)
        assert e.get_state() is state
    with pytest.raises(FlushError): e.bet('a', 1)
    (e.reveal_cards if reveal else e.fold)('a')
    final = e.get_state()
    assert final.pending_show is None and final.status is GameStatus.FINISHED
    assert final.pot == state.pot and len(final.round_results) == 1
    assert [h.player_id for h in final.settlement.shown_hands] == (['a','c'] if reveal else ['c'])
    if not reveal:
        assert final.settlement.winner_ids == ('c',)
        assert final.settlement.reason is TerminationReason.SHOW_FOLD
        events = json.dumps([event.to_dict() for event in e.get_visible_events()])
        assert all(f'"{card}"' not in events for card in final.players[0].cards)
    with pytest.raises(FlushError): e.reveal_cards('a')
    assert e.get_state() is final
