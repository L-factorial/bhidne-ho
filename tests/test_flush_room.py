from contextlib import ExitStack
from dataclasses import replace
import asyncio

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from app.main import create_app
from app.test_games.http import FlushSettings
from app.test_games.service import TestGameService as Host
from app.multiplayer.room_service import RoomService


@pytest.mark.parametrize('capacity', [2, 3, 4, 5])
def test_flush_room_settings_lock_privacy_turns_and_retries(capacity):
    with TestClient(create_app()) as client, ExitStack() as stack:
        users = [client.post('/auth/guest').json() for _ in range(capacity + 1)]
        headers = [{'Authorization': f"Bearer {u['token']}"} for u in users]
        for user in users:
            stack.enter_context(client.websocket_connect(f"/ws/rooms/flush-room?token={user['token']}")).receive_json()
        root = '/test-games/flush-room'
        def post(path, who, body):
            return client.post(root + path, headers=headers[who], json=body)
        waiting = post('', 0, {'game_type': 'flush', 'player_count': capacity}).json()
        mid = waiting['match_id']
        settings = waiting['flush_settings']
        body = {'match_id': mid, 'rules_revision': 0, 'starting_chips': 1000,
                'rules': {**settings['rules'], 'minimum_bet_rounds_before_side_show': 0}}
        assert post('/flush-settings', 1, body).status_code == 403
        for invalid in ({'boot_amount': True}, {'unknown': 3}, {'show_only_when_two_players_remain': False},
                        {'maximum_players': capacity - 1}, {'boot_amount': 1001}):
            assert post('/flush-settings', 0, {**body, 'rules': {**body['rules'], **invalid}}).status_code == 422
        saved = post('/flush-settings', 0, body)
        assert saved.status_code == 200, saved.text
        assert saved.json()['flush_settings']['rules_revision'] == 1
        assert post('/flush-settings', 0, body).status_code == 409
        for i in range(1, capacity):
            assert post('/join', i, {'match_id': mid}).status_code == 200
        assert client.get(root, headers=headers[-1]).json()['flush_settings'] == saved.json()['flush_settings']
        assert post('/start', 0, {'match_id': mid}).status_code == 409
        assert post('/start', 0, {'match_id': mid, 'rules_revision': 0}).status_code == 409
        started = post('/start', 0, {'match_id': mid, 'rules_revision': 1})
        assert started.status_code == 200, started.text
        state = started.json()
        assert state['flush_settings']['locked']
        assert post('/flush-settings', 0, {**body, 'rules_revision': 1}).status_code == 409
        assert post('/settings', 0, {'match_id': mid}).status_code == 409
        assert client.get(root, headers=headers[-1]).json()['flush']['private'] is None
        for command_name in ('DEAL_CARDS', 'SKIP_CUT'):
            actor = state['game']['turn']['player_id'] - 1
            response = post('/action', actor, {'match_id': mid, 'command_id': command_name,
                'expected_revision': state['game']['revision'], 'command': command_name})
            assert response.json()['action_ack']['status'] == 'accepted', response.text
            state = response.json()
        actor = state['game']['turn']['player_id'] - 1
        command = {'match_id': mid, 'command_id': 'see', 'expected_revision': 3, 'command': 'SEE_CARDS'}
        assert post('/action', capacity, command).status_code == 403
        seen = post('/action', actor, command)
        assert seen.status_code == 200, seen.text
        assert seen.json()['action_ack']['status'] == 'accepted'
        assert len(seen.json()['flush']['private']['cards']) == 3
        assert post('/action', actor, command).json()['game']['revision'] == 4
        other = client.get(root, headers=headers[(actor + 1) % capacity]).json()
        assert other['flush']['private']['cards'] == []
        assert all('cards' not in p for p in other['flush']['public']['players'])
        stale = post('/action', actor, {**command, 'command_id': 'stale', 'command': 'BET', 'payload': {'amount': 20}})
        assert stale.json()['action_ack']['status'] == 'rejected'
        query = post('/action', actor, {**command, 'command_id': 'query', 'expected_revision': 4, 'command': 'GET_STATE'})
        assert query.json()['query_result']['result']['player_id'] == str(actor + 1)
        assert client.get(root, headers=headers[(actor + 1) % capacity]).json()['query_result'] is None
        game = client.app.state.test_games.games['flush-room']
        assert client.app.state.participation.is_playing('flush-room', users[actor]['user_id'])
        assert post('/end', 0, {'match_id': mid}).status_code == 200
        assert not client.app.state.participation.is_playing('flush-room', users[actor]['user_id'])
        assert post('/action', actor, command).status_code == 409
        assert post('', 0, {'game_type': 'flush', 'player_count': 2}).status_code == 201


class Delivery:
    async def broadcast(self, *args): pass
    async def send_to_room_user(self, *args): pass


@pytest.mark.parametrize('start_first', [False, True])
async def test_concurrent_save_start_and_failed_start_are_atomic(start_first):
    rooms = RoomService()
    for user in ('a', 'b'):
        await rooms.join('r', user)
    host = Host(rooms, Delivery())
    state = await host.create('r', 'a', 2, 'flush')
    mid = state['match_id']
    await host.join('r', 'b', mid)
    body = FlushSettings(match_id=mid, rules_revision=0, rules=state['flush_settings']['rules'], starting_chips=200)
    operations = [host.configure_flush('r', 'a', body), host.start('r', 'a', mid, rules_revision=0)]
    results = await asyncio.gather(*(reversed(operations) if start_first else operations), return_exceptions=True)
    assert sum(isinstance(r, dict) for r in results) == 1
    assert sum(isinstance(r, HTTPException) and r.status_code == 409 for r in results) == 1
    game = host.games['r']
    if not game.started:
        # Defense in depth: corrupt an internal bankroll, then verify startup installs nothing.
        game.flush_starting_chips = 0
        with pytest.raises(HTTPException):
            await host.start('r', 'a', mid, rules_revision=1)
        assert game.flush_target is None and not game.started
        game.flush_starting_chips = 200
        await host.start('r', 'a', mid, rules_revision=1)
    before = game.flush_target.adapter.revision
    assert (await host.snapshot('r', 'a'))['flush_settings']['locked']
    with pytest.raises(HTTPException):
        await host.configure_flush('r', 'a', body)
    assert game.flush_target.adapter.revision == before


@pytest.mark.parametrize('count', [2, 6, 10])
async def test_flush_locks_current_quorum_and_rejects_late_joiners(count):
    rooms = RoomService()
    host = Host(rooms, Delivery())
    for i in range(11): await rooms.join('quorum', f'u{i}')
    waiting = await host.create('quorum', 'u0', 10, 'flush')
    mid = waiting['match_id']
    assert not waiting['ready']
    with pytest.raises(HTTPException): await host.start('quorum', 'u0', mid, rules_revision=0)
    for i in range(1, count): await host.join('quorum', f'u{i}', mid)
    assert (await host.snapshot('quorum', 'u0'))['ready']
    with pytest.raises(HTTPException): await host.start('quorum', 'u1', mid, rules_revision=0)
    locked = await host.start('quorum', 'u0', mid, rules_revision=0)
    assert len(locked['flush']['public']['players']) == count
    assert not (await host.snapshot('quorum', 'u10'))['can_join']
    with pytest.raises(HTTPException): await host.join('quorum', 'u10', mid)
    assert len(host.games['quorum'].users) == count
    await host.close()


@pytest.mark.parametrize('join_first', [True, False])
async def test_flush_join_and_lock_race_freezes_one_roster(join_first):
    rooms = RoomService(); host = Host(rooms, Delivery())
    for user in ['a', 'b', 'c']: await rooms.join('race', user)
    waiting = await host.create('race', 'a', 10, 'flush')
    mid = waiting['match_id']
    await host.join('race', 'b', mid)
    game = host.games['race']
    async with game.lock:
        operations = [lambda: host.join('race', 'c', mid), lambda: host.start('race', 'a', mid, rules_revision=0)]
        if not join_first: operations.reverse()
        tasks = [asyncio.create_task(operation()) for operation in operations]
        await asyncio.sleep(0)
    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert len(game.users) == (3 if join_first else 2)
    assert len(game.flush_target.adapter.seat_ids) == len(game.users)
    if not join_first: assert isinstance(results[1], HTTPException)
    await host.close()


async def test_between_round_seating_creator_transfer_and_balance_history():
    rooms = RoomService(); host = Host(rooms, Delivery())
    for user in ['a', 'b', 'c']: await rooms.join('changing', user)
    waiting = await host.create('changing', 'a', 10, 'flush'); mid = waiting['match_id']
    await host.join('changing', 'b', mid)
    await host.start('changing', 'a', mid, rules_revision=0)
    game = host.games['changing']
    e = game.flush_target.adapter.checkpoint()
    e.deal_cards(e.get_state().current_player_id); e.skip_cut(e.get_state().current_player_id)
    e.fold(e.get_state().current_player_id)
    balances = {p.player_id: p.chips for p in e.get_state().players}
    before = e.get_state().round_results
    assert (await host.snapshot('changing', 'a'))['roster_open']
    await host.leave('changing', 'a', mid)
    assert (await host.snapshot('changing', 'b'))['is_creator']
    await host.join('changing', 'c', mid)
    newcomer = await host.snapshot('changing', 'c')
    assert newcomer['your_player_id'] == 3 and newcomer['flush']['private'] is None
    with pytest.raises(HTTPException): await host.start('changing', 'c', mid, rules_revision=0)
    locked = await host.start('changing', 'b', mid, rules_revision=0)
    assert not locked['roster_open']
    current = game.flush_target.adapter.checkpoint()
    assert current.get_state().config.player_ids == ('2', '3')
    assert current.get_state().players[0].chips == balances['2']
    assert current.get_state().players[1].chips == 1000
    assert current.get_state().round_results == before
    assert current.get_state().round_number == 2
    with pytest.raises(HTTPException): await host.join('changing', 'a', mid)
    current.deal_cards(current.get_state().current_player_id); current.skip_cut(current.get_state().current_player_id)
    current.fold(current.get_state().current_player_id)
    await host.join('changing', 'a', mid)
    await host.start('changing', 'b', mid, rules_revision=0)
    final = game.flush_target.adapter.checkpoint().get_state()
    assert final.players[-1].player_id == '1' and final.players[-1].chips == balances['1']
    assert len(final.round_results) == 2
    await host.close()
