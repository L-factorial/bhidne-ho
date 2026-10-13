"""Pending ledger discovery: membership, per-table obligations and settlement lifecycle."""
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.ledger import GameLedgerAmount, GameLedgerResult, InMemoryLedgerStore, LedgerService
from app.ledger.models import CreateSettlement
from app.ledger.store import PostgresLedgerStore
from app.durable_games.ledger_queries import PostgresLedgerQueries
from test_checkpoint_store import database


class Rooms:
    def __init__(self, users):
        self.rows = {'room': SimpleNamespace(room_id='room', name='Room', members=users)}

    async def members(self, room):
        return self.rows[room].members

    async def room(self, room):
        return {'name': self.rows[room].name}

    async def list_rooms(self, user):
        return list(self.rows.values())


@pytest.fixture(params=['memory', 'postgres'])
async def ledger(request, database):
    pool, _, _, users = database
    rooms = Rooms(users)
    store = InMemoryLedgerStore() if request.param == 'memory' else PostgresLedgerStore(pool)
    service = LedgerService(store, rooms)
    reads = service if request.param == 'memory' else PostgresLedgerQueries(pool)
    return service, reads, rooms, pool, users, request.param


def result(users, game=1, table=1, amount=20, room='room'):
    return GameLedgerResult(room_id=room, game_id=UUID(int=game).hex, table_id=UUID(int=table).hex,
        table_name=f'Table-{table}', game_type='flush', amounts=[
            GameLedgerAmount(player_id=users[0], amount=amount),
            GameLedgerAmount(player_id=users[1], amount=-amount)])


async def test_pending_rooms_remain_until_both_parties_confirm(ledger):
    service, reads, _, _, users, _ = ledger
    assert (await reads.pending_rooms(users[0]))['items'] == []
    game = result(users)
    await service.record_game(game)
    original = (await service.store.room_games('room'))[0]['created_at']
    await service.record_game(game)
    assert (await service.store.room_games('room'))[0]['created_at'] == original
    pending = await reads.pending_rooms(users[0])
    assert pending['items'] == [dict(room_id='room', name='Room', latest_game_at=original)]
    # A room member with no personal debt can still discover its pending ledger.
    assert (await reads.pending_rooms(users[2]))['items'] == pending['items']
    snapshot = await service.snapshot('room', users[0])
    assert snapshot['tables'][0]['game_type'] == 'flush'
    assert snapshot['tables'][0]['latest_game_at'] == original
    batch = await service.create_settlement('room', users[0], CreateSettlement(
        scope='table', table_id=game.table_id, idempotency_key='start'))
    transfer = batch['transfers'][0]
    await service.act('room', batch['batch_id'], transfer['transfer_id'], users[1], 'mark-paid', 'paid')
    assert (await reads.pending_rooms(users[0]))['items']
    await service.act('room', batch['batch_id'], transfer['transfer_id'], users[0], 'confirm', 'confirmed')
    assert (await reads.pending_rooms(users[0]))['items'] == []
    # A later game at the same table reopens the room entry.
    await service.record_game(result(users, game=2))
    assert (await reads.pending_rooms(users[0]))['items']


async def test_pending_rooms_use_per_table_unallocated_balances(ledger):
    service, reads, _, _, users, _ = ledger
    await service.record_game(result(users, amount=0))
    assert (await reads.pending_rooms(users[0]))['items'] == []
    await service.record_game(result(users, game=2, amount=20))
    await service.record_game(result(users, game=3, amount=-20))
    assert (await reads.pending_rooms(users[0]))['items'] == []
    await service.record_game(result(users, game=4, table=2, amount=20))
    await service.record_game(result(users, game=5, table=3, amount=-20))
    assert (await service.snapshot('room', users[0]))['balances'] == []
    assert (await reads.pending_rooms(users[0]))['items']


async def test_pending_rooms_paginate_and_exclude_nonmembers_and_deleted_rooms(ledger):
    service, reads, rooms, pool, users, kind = ledger
    for index, room in enumerate(['a', 'b', 'c', 'deleted', 'outsider'], 10):
        members = users if room != 'outsider' else [users[1]]
        rooms.rows[room] = SimpleNamespace(room_id=room, name=room, members=members)
        if kind == 'postgres':
            await pool.execute("INSERT INTO rooms(id,creator_id,name,visibility) VALUES (%s,%s,%s,'public')",
                (room, UUID(users[1][5:]), room))
            for member in members:
                await pool.execute('INSERT INTO room_memberships(room_id,user_id) VALUES (%s,%s)',
                    (room, UUID(member[5:])))
        await service.record_game(result(users, game=index, table=index, room=room))
    if kind == 'postgres':
        await pool.execute('INSERT INTO deleted_rooms(id) VALUES (%s)', ('deleted',))
    else:
        del rooms.rows['deleted']
    first = await reads.pending_rooms(users[0], limit=2)
    assert [r['room_id'] for r in first['items']] == ['a', 'b']
    assert first['next_room_id'] == 'b'
    last = await reads.pending_rooms(users[0], after_room_id=first['next_room_id'], limit=2)
    assert [r['room_id'] for r in last['items']] == ['c']
    assert last['next_room_id'] is None


def test_pending_ledger_http_requires_authentication_and_membership():
    from app.main import create_app
    from tests.test_players import account
    app = create_app()
    with TestClient(app) as client:
        owner, headers = account(client, 'pending-owner', 'Owner')
        friend, outsider = account(client, 'pending-outsider', 'Outsider')
        room = client.post('/rooms', headers=headers, json={'name': 'Ledger room'}).json()
        game = result([owner['user_id'], friend['user_id']], room=room['room_id'])
        client.portal.call(app.state.ledger.record_game, game)
        assert client.get('/ledger/rooms').status_code == 401
        assert client.get('/ledger/rooms', headers=outsider).json()['items'] == []
        assert client.get('/ledger/rooms', headers=headers).json()['items'][0]['room_id'] == room['room_id']
        assert client.get('/ledger/rooms?limit=0', headers=headers).status_code == 422
