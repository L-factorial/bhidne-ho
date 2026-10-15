from app.test_games.flush_stats import flush_action_history
from test_hosted_checkpoints import make_host, start, action, engine_state
from app.durable_games.checkpoints import capture_checkpoint, decode_checkpoint
from flush.visibility import visible_events


def test_flush_stats_history_tracks_rounds_and_only_public_action_fields():
    events = [
        {"sequence": 1, "revision": 1, "kind": "GAME_STARTED"},
        {"sequence": 2, "revision": 2, "kind": "BOOT_COLLECTED", "player_id": "1", "amount": 5},
        {"sequence": 3, "revision": 3, "kind": "CARDS_SEEN", "player_id": "1", "cards": ["AS", "KH", "QD"]},
        {"sequence": 4, "revision": 4, "kind": "SIDE_SHOW_RESOLVED", "player_id": "1", "target_player_id": "2", "loser_player_id": "2", "shown_hands": [("1", ["AS"])]},
        {"sequence": 5, "revision": 5, "kind": "ROUND_FINISHED", "winner_ids": ["1"]},
        {"sequence": 6, "revision": 6, "kind": "ROUND_STARTED", "player_id": "1"},
        {"sequence": 7, "revision": 7, "kind": "TURN_CHANGED", "player_id": "2"},
        {"sequence": 8, "revision": 8, "kind": "BET_PLACED", "player_id": "2", "amount": 10},
    ]
    history = flush_action_history(events)
    assert [row["sequence"] for row in history] == [2, 3, 4, 5, 8]
    assert [row["round_number"] for row in history] == [1, 1, 1, 1, 2]
    assert history[2]["target_player_id"] == "2"
    assert history[2]["loser_player_id"] == "2"
    assert history[3]["winner_ids"] == ["1"]
    assert history[-1]["amount"] == 10
    assert history[0]["visibility"] == 'blind'
    assert history[1]["visibility"] == 'seen'
    assert history[2]["visibility"] == 'seen'
    assert history[-1]["visibility"] == 'blind'
    assert history[-1]["bet_number"] == 1
    assert all("cards" not in row and "shown_hands" not in row for row in history)
    assert events[2]["cards"] == ["AS", "KH", "QD"]


def test_flush_stats_empty_history_is_safe():
    assert flush_action_history([]) == []


async def test_flush_snapshot_history_survives_round_change_and_checkpoint_without_private_cards():
    host, game = await make_host('flush', 2)
    try:
        await start(host, game)
        await action(host, game, 'DEAL_CARDS')
        await action(host, game, 'SKIP_CUT')
        await action(host, game, 'SEE_CARDS')
        spectator = await host.snapshot('room', 'u2')
        timeline = spectator['flush']['history']
        assert spectator['flush']['private'] is None
        assert timeline[-1]['kind'] == 'CARDS_SEEN'
        assert timeline[-1]['round_number'] == 1
        assert timeline == (await host.snapshot('room', 'u0'))['flush']['history']
        assert timeline == (await host.snapshot('room', 'u1'))['flush']['history']
        await action(host, game, 'FOLD')
        engine = game.flush_target.adapter.checkpoint()
        engine.prepare_next_round(engine_state(game).settlement.winner_ids[0])
        engine.deal_cards(engine.get_state().current_player_id)
        engine.skip_cut(engine.get_state().current_player_id)
        snapshot = await host.snapshot('room', 'u2')
        assert snapshot['flush']['history'][:len(timeline)] == timeline
        assert snapshot['flush']['history'][-1]['round_number'] == 2
        restored = decode_checkpoint(capture_checkpoint(game, table_revision=1)).engine_state
        assert flush_action_history([event.to_dict() for event in visible_events(restored)]) == snapshot['flush']['history']
        assert all('cards' not in event and 'shown_hands' not in event for event in snapshot['flush']['history'])
    finally:
        await host.close()


def test_betting_cycle_counts_paid_side_show_without_double_counting_legacy_prepayment():
    events=[]
    def add(kind,player=None,amount=0,**extra):
        events.append(dict(sequence=len(events)+1,revision=len(events)+1,kind=kind,player_id=player,amount=amount,**extra))
    for player in ['1','2','3']:add('BOOT_COLLECTED',player,5)
    for player in ['1','2','3']:add('BET_PLACED',player,10)
    add('SIDE_SHOW_REQUESTED','1',0,target_player_id='3')
    add('SIDE_SHOW_RESOLVED','1',10,target_player_id='3',loser_player_id='3',winner_ids=['1'])
    add('BET_PLACED','2',10)
    add('PLAYER_FOLDED','1')
    assert flush_action_history(events)[-1]['betting_round']==3
    # Legacy prepayment is counted at request; its zero-cost resolution adds none.
    events[-4]['amount']=10
    events[-3]['amount']=0
    assert flush_action_history(events)[-1]['betting_round']==3
