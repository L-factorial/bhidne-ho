from copy import deepcopy
from dataclasses import replace
from uuid import UUID, uuid4

import pytest

from card_utils import Card, standard_52
from callbreak import GameConfig, GameQuery, Phase, PickDealerCard, PlayRejection, PrepareDeal, Transition, apply_control, apply_player, create_match
from callbreak.audit import audit_match
from callbreak.replay import Replay, Entry
from app.durable_games.checkpoints import CheckpointError, capture_checkpoint, decode_checkpoint
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.inbox import LaneTarget, PostgresInboxStore
from app.durable_games.recovery import rebuild_hosted_game
from app.multiplayer.callbreak_dealer import create_callbreak_match
from test_checkpoint_store import database, host_game
from test_hosted_checkpoints import resign


def deck_with(*cards):
    first = tuple(Card.parse(c) for c in cards)
    return first + tuple(c for c in standard_52() if c not in first)


@pytest.mark.parametrize('cards,winner', [
    (('AS', '3H', '2D', 'KH'), 3),
    (('2S', 'AH', '2D', '2H'), 4),
    (('3S', '4H', '5D', '3H'), 4),
    (('AS', 'AH', 'AD', 'AC'), 4),
    (('2S', '3H', '4D', '5H', '2C'), 5),
])
def test_lowest_rank_and_last_picker_tie_rule_with_replay(cards, winner):
    deck = deck_with(*cards)
    state = create_match(GameConfig(len(cards)), dealer_selection_deck=deck)
    entries = []
    for player in range(1, len(cards) + 1):
        assert state.current_player == player
        command = PickDealerCard(player - 1)
        result = apply_player(state, player, command)
        assert isinstance(result, Transition)
        state = result.state
        entries.append(Entry(player, command))
        audit_match(state)
        view = GameQuery(state).get_state()['dealer_selection']
        assert 'deck' not in view and len(view['picks']) == player
        assert [p['card'] for p in view['picks']] == list(cards[:player])
    assert state.phase == Phase.AWAITING_DEAL and state.initial_dealer == winner
    assert GameQuery(state).get_state()['dealer_selection']['dealer'] == winner
    replay = Replay(state.config, 1, tuple(entries), deck)
    assert Replay.loads(replay.dumps()).restore() == state
    prepared = apply_control(state, PrepareDeal()).state
    assert prepared.phase == Phase.AWAITING_SHUFFLE and prepared.current_player == winner


def test_selection_rejects_wrong_turn_duplicate_and_invalid_positions_without_mutation():
    state = create_match(dealer_selection_deck=standard_52())
    assert apply_control(state, PrepareDeal()).code == 'INVALID_PHASE'
    assert apply_player(state, 2, PickDealerCard(0)).code == 'NOT_YOUR_TURN'
    for position in [True, '0', -1, 52]:
        assert apply_player(state, 1, PickDealerCard(position)).code == 'INVALID_POSITION'
    state = apply_player(state, 1, PickDealerCard(0)).state
    assert apply_player(state, 1, PickDealerCard(1)).code == 'NOT_YOUR_TURN'
    assert apply_player(state, 2, PickDealerCard(0)).code == 'CARD_ALREADY_PICKED'
    assert len(state.dealer_selection.picks) == 1
    assert isinstance(apply_player(create_match(), 1, PickDealerCard(0)), PlayRejection)


async def test_sql_draw_retries_recovery_and_private_deck_without_live_host_mutation(database):
    pool, store, fence, users = database
    host, game = await host_game(users, 'callbreak', select_dealer=False)
    try:
        assert game.state.phase == Phase.SELECTING_DEALER
        game.state = replace(game.state, dealer_selection=replace(game.state.dealer_selection,
            deck=deck_with('2S', 'AH', '2D', 'KH')))
        initial = capture_checkpoint(game, table_revision=0)
        await store.save(initial, expected_revision=None, fence=fence)
        inbox = PostgresInboxStore(pool)
        lane = await inbox.ensure_lane(LaneTarget(kind='game', room_id='room',
            table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
        executor = GameLaneExecutor(inbox)
        for actor, payload in [(users[1], {'position': 0}), (users[-1], {'position': 0}),
                               (users[0], {'position': 52}), (users[0], {'position': 0, 'card': '2S'})]:
            request = dict(command_id=uuid4().hex, match_id=game.match_id,
                command='PICK_DEALER_CARD', expected_revision=0, payload=payload)
            await inbox.enqueue(lane, actor, request)
            assert (await executor.execute_one(lane, fence)).outcome['status'] == 'rejected'
            assert (await store.load(game.table.table_id)).checkpoint == initial
        for player in range(4):
            stored = await store.load(game.table.table_id)
            request = dict(command_id=uuid4().hex, match_id=game.match_id,
                command='PICK_DEALER_CARD', expected_revision=stored.checkpoint['data']['engine']['revision'],
                payload={'position': player})
            await inbox.enqueue(lane, users[player], request)
            outcome = (await executor.execute_one(lane, fence)).outcome
            assert outcome['status'] == 'accepted'
            assert (await inbox.enqueue(lane, users[player], request)).outcome == outcome
            assert await executor.execute_one(lane, fence) is None
            stored = await store.load(game.table.table_id)
            detached = _DetachedHost(8)
            restored = detached.game = rebuild_hosted_game(detached, stored.checkpoint,
                receipt_snapshot=stored.receipt_snapshot).game
            selection = host._snapshot(restored, users[-1])['game']['dealer_selection']
            assert len(selection['picks']) == player + 1 and 'deck' not in selection
            if player < 3:
                assert selection['current_player'] == player + 2
            else:
                assert selection['complete']
        assert restored.state.initial_dealer == 3 and restored.state.phase == Phase.AWAITING_SHUFFLE
        assert host._snapshot(restored, users[2])['can_change_card_theme']
        assert capture_checkpoint(game, table_revision=0) == initial
        assert (await pool.execute('SELECT count(*) FROM game_commands')).rows == [(8,)]
        messages = (await pool.execute("SELECT payload FROM notification_outbox WHERE event_type='DEALER_CARD_PICKED'")).rows
        assert len(messages) == 4
        assert all(set(m[0]['payload']) == {'player_id', 'position', 'card'} for m in messages)
        corrupt = deepcopy(stored.checkpoint)
        corrupt['data']['engine']['state']['initial_dealer'] = 1
        with pytest.raises(CheckpointError):
            decode_checkpoint(resign(corrupt))
    finally:
        await host.close()


def test_previous_last_place_policy_and_replacement_fallback():
    from random import Random
    from app.test_games.service import HostedGame
    game = HostedGame('room', 4, ['a', 'b', 'c', 'd'], previous_match_id='previous',
        callbreak_previous_scores={'a': 40, 'b': -20, 'c': 50, 'd': 10})
    state = create_callbreak_match(game, Random(1))
    assert state.initial_dealer == 2 and state.dealer_selection is None
    game.users = ['a', 'new', 'c', 'd']
    assert create_callbreak_match(game, Random(1)).initial_dealer == 4
    game.users = ['w', 'x', 'y', 'z']
    assert create_callbreak_match(game, Random(1)).phase == Phase.SELECTING_DEALER
    game.users = ['a', 'b', 'c', 'd']
    game.callbreak_previous_scores['c'] = -20
    assert create_callbreak_match(game, Random(1)).initial_dealer == 2


async def test_old_checkpoint_without_selection_or_previous_scores_still_decodes():
    from test_hosted_checkpoints import make_host
    host, game = await make_host('callbreak')
    try:
        game.state = create_match()
        game.table.phase = 'STARTED'
        checkpoint = capture_checkpoint(game, table_revision=0)
        del checkpoint['data']['host']['callbreak_previous_scores']
        del checkpoint['data']['engine']['state']['dealer_selection']
        decoded = decode_checkpoint(resign(checkpoint))
        assert decoded.engine_state.dealer_selection is None
        assert decoded.record.data.host.callbreak_previous_scores == {}
        assert decoded.engine_state == game.state
    finally:
        await host.close()
