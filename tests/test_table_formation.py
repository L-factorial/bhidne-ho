"""Table membership, queue rotation, explicit formation and spectator privacy."""
import asyncio
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.lifecycle import RoomLifecycle
from app.multiplayer.room_service import RoomService
from app.test_games.service import TestGameService as Host
from callbreak import Phase
from tests.test_multiplayer import FakeSocket
from tests.test_test_games import next_action


async def make(kind='callbreak', capacity=4, seated=None):
    rooms = RoomService()
    connections = ConnectionManager(rooms)
    host = Host(rooms, connections)
    for i in range(12):
        await rooms.join('r', f'u{i}')
    initial = await host.create('r', 'u0', capacity, kind)
    for i in range(1, seated if seated is not None else capacity):
        await host.join('r', f'u{i}', initial['match_id'])
    return host, host.games['r'], RoomLifecycle(rooms, connections, host)


async def cmd(host, game, user, command, **kwargs):
    return await host.table_command('r', user, game.match_id, command, **kwargs)


async def start(host, game):
    if game.game_type != 'callbreak':
        await cmd(host, game, 'u0', 'lock')
    return await host.start('r', 'u0', game.match_id, rules_revision=0)


_completed = {}


async def completed(capacity=4):
    host, game, lifecycle = await make(capacity=capacity)
    await start(host, game)
    if capacity not in _completed:
        while game.state.phase != Phase.MATCH_COMPLETE:
            actor, action = next_action(host, game)
            await host.action('r', actor, action)
        _completed[capacity] = game.state
    else:
        game.state = _completed[capacity]
    await host._publish(game)
    return host, game, lifecycle


@pytest.mark.parametrize('capacity', [4, 5])
@pytest.mark.parametrize('departure', ['leave-seat', 'room'])
async def test_first_n_seats_and_fifo_promotion_before_start(capacity, departure):
    host, game, life = await make(capacity=capacity)
    try:
        assert game.users == [f'u{i}' for i in range(capacity)]
        with pytest.raises(HTTPException) as full:
            await host.join('r', f'u{capacity}', game.match_id)
        assert full.value.detail['code'] == 'GAME_FULL'
        for user in [f'u{capacity}', f'u{capacity+1}']:
            await cmd(host, game, user, 'join-queue')
        if departure == 'room':
            await life.leave('r', 'u2')
            assert 'u2' not in await host.rooms.members('r')
        else:
            await cmd(host, game, 'u2', 'leave-seat')
            assert 'u2' in await host.rooms.members('r')
        assert game.users == [u for u in [f'u{i}' for i in range(capacity)] if u != 'u2'] + [f'u{capacity}']
        assert game.table.queue == [f'u{capacity+1}']
        assert (await host.snapshot('r', f'u{capacity}'))['table']['current_user']['is_seated']
        assert game.state is None
    finally:
        await host.close()


@pytest.mark.parametrize('kind,capacity', [('callbreak', 4), ('marriage', 3), ('flush', 3)])
async def test_queue_idempotency_room_departure_disconnect_and_reconnect(kind, capacity):
    host, game, life = await make(kind, capacity)
    try:
        for user in ['u6', 'u7', 'u6', 'u8']:
            await cmd(host, game, user, 'join-queue')
        assert game.table.queue == ['u6', 'u7', 'u8']
        with pytest.raises(HTTPException):
            await cmd(host, game, 'u0', 'join-queue')
        connection = await host.connections.connect('r', 'u7', FakeSocket())
        await host.connections.disconnect('r', connection)
        await host.connections.disconnect('r', connection)
        state = (await life.snapshot('r', 'u7'))['active_game']['table']['current_user']
        assert state['queue_position'] == 2 and not state['is_seated']
        await host.connections.connect('r', 'u7', FakeSocket(), resume=True)
        assert game.table.queue == ['u6', 'u7', 'u8']
        await life.leave('r', 'u6')
        assert game.table.queue == ['u7', 'u8']
        await cmd(host, game, 'u7', 'leave-queue')
        await cmd(host, game, 'u7', 'leave-queue')
        assert game.table.queue == ['u8']
    finally:
        await host.close()


@pytest.mark.parametrize('capacity', [4, 5])
async def test_active_callbreak_never_promotes_on_navigation_disconnect_or_reconnect(capacity):
    host, game, life = await make(capacity=capacity)
    try:
        await start(host, game)
        await cmd(host, game, 'u9', 'join-queue')
        before = await host.snapshot('r', 'u2')
        connection = await host.connections.connect('r', 'u2', FakeSocket())
        await host.connections.disconnect('r', connection)
        room = await life.snapshot('r', 'u2')
        assert room['active_game']['seat'] == 3
        assert game.table.queue == ['u9'] and 'u9' not in game.users
        await host.connections.connect('r', 'u2', FakeSocket(), resume=True)
        assert (await host.snapshot('r', 'u2'))['private'] == before['private']
        assert (await host.join('r', 'u2', game.match_id))['your_player_id'] == 3
        with pytest.raises(HTTPException):
            await cmd(host, game, 'u2', 'leave-seat')
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
@pytest.mark.parametrize('players', [2, 3])
async def test_explicit_lock_then_start_freezes_roster_without_dealing(kind, players):
    host, game, life = await make(kind, 5, seated=players)
    try:
        with pytest.raises(HTTPException) as error:
            await host.start('r', 'u0', game.match_id, rules_revision=0)
        assert error.value.detail['code'] == 'LOCK_REQUIRED'
        with pytest.raises(HTTPException):
            await cmd(host, game, 'u1', 'lock')
        for _ in range(2):
            locked = await cmd(host, game, 'u0', 'lock')
            assert locked['table']['phase'] == 'LOCKED'
            assert locked['table']['current_user']['can_start']
            assert not game.started and 'game' not in locked
        with pytest.raises(HTTPException) as error:
            await host.join('r', 'u8', game.match_id)
        assert error.value.detail['code'] == 'GAME_LOCKED'
        await cmd(host, game, 'u8', 'join-queue')
        played = await host.start('r', 'u0', game.match_id, rules_revision=0)
        assert played['table']['phase'] == 'STARTED' and len(played['players']) == players
        assert game.table.queue == ['u8']
        assert (await host.start('r', 'u0', game.match_id, rules_revision=0))['game'] == played['game']
    finally:
        await host.close()


@pytest.mark.parametrize('kind', ['marriage', 'flush'])
async def test_lock_minimum_start_membership_validation_and_leave_reopens(kind):
    host, game, life = await make(kind, 4, seated=1)
    try:
        with pytest.raises(HTTPException) as error:
            await cmd(host, game, 'u0', 'lock')
        assert error.value.detail['code'] == 'NOT_ENOUGH_PLAYERS'
        assert game.table.phase == 'OPEN'
        await host.join('r', 'u1', game.match_id)
        await cmd(host, game, 'u0', 'lock')
        await host.rooms.leave('r', 'u1')  # Defense in depth against an invalid internal roster.
        with pytest.raises(HTTPException) as error:
            await host.start('r', 'u0', game.match_id, rules_revision=0)
        assert error.value.detail['code'] == 'INVALID_ROSTER'
        assert not game.started
        await host.rooms.join('r', 'u1')
        await cmd(host, game, 'u2', 'join-queue')
        await cmd(host, game, 'u1', 'leave-seat')
        assert game.table.phase == 'OPEN' and game.users == ['u0', 'u2']
        with pytest.raises(HTTPException):
            await host.start('r', 'u0', game.match_id, rules_revision=0)
        await cmd(host, game, 'u2', 'leave-seat')
        assert not (await host.snapshot('r', 'u0'))['table']['current_user']['can_lock']
    finally:
        await host.close()


@pytest.mark.parametrize('capacity', [4, 5])
async def test_completed_match_clean_leave_offer_accept_and_next_match(capacity):
    host, game, life = await completed(capacity)
    try:
        assert len(game.state.completed_deals) == 5
        before = await host.snapshot('r', 'u1')
        assert before['table']['phase'] == 'COMPLETED'
        assert before['table']['current_user']['can_leave_seat']
        assert not before['table']['current_user']['can_abandon_match']
        await cmd(host, game, 'u9', 'join-queue')
        for _ in range(2):
            await cmd(host, game, 'u1', 'leave-seat')
        assert game.table.next_seats[1] is None
        assert game.users[1] == 'u1'  # The completed match is immutable history.
        offer = (await host.snapshot('r', 'u9'))['table']['current_user']['replacement_offer']
        assert offer['seat_id'] == 2 and offer['status'] == 'PENDING'
        with pytest.raises(HTTPException):
            await cmd(host, game, 'u0', 'next-match')
        for _ in range(2):
            await cmd(host, game, 'u9', 'accept-seat', offer_id=offer['offer_id'])
        assert game.table.next_seats[1] == 'u9' and game.table.queue == []
        assert 'u1' in await host.rooms.members('r')
        newcomer = await host.snapshot('r', 'u9')
        assert newcomer['private'] is None and newcomer['your_player_id'] is None
        assert newcomer['table']['current_user']['seat_id'] == 2
        assert newcomer['scoreboard'] == before['scoreboard']
        assert not any('ABANDON' in str(e) or 'PENALTY' in str(e) for e in game.table.events)
        replacement = await cmd(host, game, 'u0', 'next-match')
        assert replacement['match_id'] != game.match_id
        assert replacement['table']['table_id'] == game.table.table_id
        assert replacement['table']['seated_players'][1]['user_id'] == 'u9'
        assert replacement['players'][0]['user_id'] == 'u0'
        assert (await cmd(host, game, 'u0', 'next-match'))['match_id'] == replacement['match_id']
    finally:
        await host.close()


async def test_offer_decline_expiry_invitation_authorization_and_concurrent_accept(monkeypatch):
    host, game, life = await completed()
    try:
        for user in ['u6', 'u7', 'u8']:
            await cmd(host, game, user, 'join-queue')
        await cmd(host, game, 'u1', 'leave-seat')
        first = game.table.pending()[0]
        await cmd(host, game, 'u6', 'decline-seat', offer_id=first.offer_id)
        assert first.status == 'DECLINED'
        second = game.table.pending()[0]
        assert second.offered_to_player_id == 'u7'
        monkeypatch.setattr('app.multiplayer.table.time', lambda: second.expires_at + 1)
        await host.snapshot('r', 'u7')
        assert second.status == 'EXPIRED'
        third = game.table.pending()[0]
        assert third.offered_to_player_id == 'u8'
        await cmd(host, game, 'u8', 'decline-seat', offer_id=third.offer_id)
        monkeypatch.undo()
        assert game.table.queue == [] and not game.table.pending()
        with pytest.raises(HTTPException):
            await cmd(host, game, 'u2', 'invite-seat', seat_id=2, recipient='u10')
        await cmd(host, game, 'u1', 'invite-seat', seat_id=2, recipient='u10')
        invitation = game.table.pending()[0]
        with pytest.raises(HTTPException):
            await cmd(host, game, 'u11', 'accept-seat', offer_id=invitation.offer_id)
        results = await asyncio.gather(*(cmd(host, game, 'u10', 'accept-seat', offer_id=invitation.offer_id) for _ in range(2)))
        assert all(r['table']['current_user']['seat_id'] == 2 for r in results)
        assert game.table.next_seats.count('u10') == 1
        assert sum(e['event'] == 'SEAT_OFFER_ACCEPTED' for e in game.table.events) == 1
    finally:
        await host.close()


async def test_offer_reconnect_room_departure_and_multiple_vacancies():
    host, game, life = await completed()
    try:
        for user in ['u6', 'u7', 'u8']:
            await cmd(host, game, user, 'join-queue')
        await cmd(host, game, 'u1', 'leave-seat')
        await cmd(host, game, 'u2', 'leave-seat')
        assert {o.offered_to_player_id for o in game.table.pending()} == {'u6', 'u7'}
        connection = await host.connections.connect('r', 'u6', FakeSocket())
        before = (await life.snapshot('r', 'u6'))['active_game']['table']['current_user']['replacement_offer']
        await host.connections.disconnect('r', connection)
        await host.connections.connect('r', 'u6', FakeSocket(), resume=True)
        assert (await life.snapshot('r', 'u6'))['active_game']['table']['current_user']['replacement_offer'] == before
        await life.leave('r', 'u6')
        assert game.table.offers[before['offer_id']].status == 'CANCELLED'
        assert {o.offered_to_player_id for o in game.table.pending()} == {'u7', 'u8'}
    finally:
        await host.close()


async def test_active_abandonment_is_explicit_once_and_never_a_penalty():
    host, game, life = await make()
    try:
        await start(host, game)
        state = game.state
        for _ in range(2):
            await cmd(host, game, 'u1', 'abandon')
        assert game.ended and game.state is state  # No invented scoring or engine replacement.
        events = [e for e in game.table.events if e['event'] == 'PLAYER_LEFT_ACTIVE_MATCH']
        assert len(events) == 1 and events[0]['payload']['penalty_policy'] == 'DEFERRED'
        assert not any(e['event'] == 'SEAT_RELEASED' for e in game.table.events)
        assert 'u1' in await host.rooms.members('r')
        await life.leave('r', 'u1')
    finally:
        await host.close()


@pytest.mark.parametrize('kind,capacity', [('callbreak', 4), ('marriage', 3), ('flush', 3)])
async def test_waiters_and_observers_get_only_public_state(kind, capacity):
    host, game, life = await make(kind, capacity)
    try:
        await start(host, game)
        await cmd(host, game, 'u8', 'join-queue')
        if kind == 'flush':
            engine = game.flush_target.adapter.checkpoint()
            engine.deal_cards(engine.get_state().current_player_id)
            engine.skip_cut(engine.get_state().current_player_id)
            engine.see_cards(engine.get_state().current_player_id)
        for user in ['u8', 'u9']:
            snapshot = await host.snapshot('r', user)
            assert snapshot['your_player_id'] is None
            if kind == 'callbreak':
                assert snapshot['private'] is None
            else:
                assert snapshot[kind]['private'] is None
                if kind == 'flush':
                    assert all('cards' not in p for p in snapshot[kind]['public']['players'])
                else:
                    assert all('hand' not in p for p in snapshot[kind]['public']['players'])
            assert snapshot['query_result'] is None if 'query_result' in snapshot else True
    finally:
        await host.close()


async def test_offer_expiry_advances_without_client_polling():
    host, game, life = await completed()
    try:
        game.table.offer_seconds = 0.1
        for user in ['u6', 'u7']:
            await cmd(host, game, user, 'join-queue')
        await cmd(host, game, 'u1', 'leave-seat')
        original = game.table.pending()[0]
        async def expired():
            while original.status == 'PENDING':
                await asyncio.sleep(0.02)
        await asyncio.wait_for(expired(), 3)
        assert original.status == 'EXPIRED'
        assert any(o.offered_to_player_id == 'u7' for o in game.table.offers.values())
        assert not game.table.next_seats[1]
    finally:
        await host.close()


@pytest.mark.parametrize('kind,capacity', [('callbreak', 4), ('marriage', 3), ('flush', 3)])
async def test_join_queue_and_room_departure_race_cannot_leave_orphaned_waiter(kind, capacity):
    host, game, life = await make(kind, capacity)
    try:
        await asyncio.gather(cmd(host, game, 'u8', 'join-queue'), life.leave('r', 'u8'), return_exceptions=True)
        assert 'u8' not in await host.rooms.members('r') and 'u8' not in game.table.queue
    finally:
        await host.close()
