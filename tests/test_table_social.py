import asyncio
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.models.table_social import TableSocialCommand
from app.multiplayer.table_social import TableSocialService
from app.multiplayer.player_profiles import PlayerProfileService
from test_room_pokes import social_table


def command(kind='TABLE_CHAT_SEND', mid='', cid='one', **payload):
    return TableSocialCommand(type=kind, match_id=mid, command_id=cid, payload=payload)


async def fixture(kind='callbreak'):
    host, pokes, connections, sockets, ids = await social_table(kind)
    service = TableSocialService(host, host.rooms, connections, PlayerProfileService(), pokes)
    game = host.games['room']
    game.table.queue.append('u4')
    return host, service, game, sockets, connections, ids


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_table_chat_seated_send_waiting_read_dedup_and_game_isolation(kind):
    host, service, game, sockets, _, _ = await fixture(kind)
    state, log = game.state, list(game.log)
    cmd = command(mid=game.match_id, text='Nice hand')
    first, retry = await asyncio.gather(service.handle('room','u0',cmd), service.handle('room','u0',cmd))
    assert first == retry and first['status'] == 'accepted'
    assert [len(s.messages) for s in sockets] == [1,1,1,1,1,1,0]
    history = await service.handle('room','u4',command('TABLE_CHAT_HISTORY',game.match_id))
    assert len(history['messages']) == 1
    assert (await service.handle('room','u4',command(mid=game.match_id,text='No')))['status'] == 'rejected'
    assert game.state is state and game.log == log and not game.commands.receipts
    game.table.queue.clear()
    assert (await service.handle('room','u4',command('TABLE_CHAT_HISTORY',game.match_id)))['status'] == 'rejected'
    assert (await service.handle('room','u0',command(mid='old-match',text='No')))['status'] == 'rejected'
    assert (await service.handle('room','u0',command(mid=game.match_id,text='changed')))['status'] == 'rejected'
    await host.close()


@pytest.mark.parametrize('kind', ['callbreak','marriage','flush'])
async def test_targeted_poke_private_deduplicated_and_rejects_self_queue_offline(kind):
    host, service, game, sockets, connections, ids = await fixture(kind)
    cmd = command('TABLE_POKE_SEND',game.match_id,recipient_player_id=2)
    ack = await service.handle('room','u0',cmd)
    assert ack['status'] == 'accepted'
    assert await service.handle('room','u0',cmd) == ack
    assert [len(s.messages) for s in sockets] == [0,1,0,0,0,1,0]
    assert (await service.handle('room','u4',cmd))['status'] == 'rejected'
    assert (await service.handle('room','u0',command('TABLE_POKE_SEND',game.match_id,'self',recipient_player_id=1)))['status'] == 'rejected'
    await connections.disconnect('room',ids[2])
    assert (await service.handle('room','u0',command('TABLE_POKE_SEND',game.match_id,'offline',recipient_player_id=3)))['status'] == 'rejected'
    await host.close()


async def test_other_table_viewers_cannot_read_or_receive_and_flush_uses_seat_map():
    host, service, game, sockets, _, _ = await fixture('flush')
    game.table.queue.clear()
    other = await host.create('room','u4',2,'flush',name='Other')
    for socket in sockets: socket.messages.clear()
    result = await service.handle('room','u0',command(mid=game.match_id,text='Private to table'))
    assert result['status'] == 'accepted'
    assert not sockets[4].messages
    assert (await service.handle('room','u4',command('TABLE_CHAT_HISTORY',game.match_id)))['status'] == 'rejected'
    assert (await service.handle('room','u4',command('TABLE_CHAT_HISTORY',other['match_id'])))['messages'] == []
    game.flush_seats['u1'] = 19
    result = await service.handle('room','u0',command('TABLE_POKE_SEND',game.match_id,'poke19',recipient_player_id=19))
    assert result['status'] == 'accepted'
    assert sockets[1].messages[-1]['recipient_player_id'] == 19
    await host.close()


def test_websocket_social_commands_acknowledge_validation_and_keep_socket_usable():
    with TestClient(create_app()) as client:
        token = client.post('/auth/guest').json()['token']
        headers = {'Authorization':f'Bearer {token}'}
        with client.websocket_connect(f'/ws/rooms/social?token={token}') as socket:
            socket.receive_json()
            game = client.post('/test-games/social',headers=headers,json={'player_count':4,'game_type':'callbreak'}).json()
            cmd = dict(type='TABLE_CHAT_SEND',match_id=game['match_id'],command_id='one',payload={'text':'hello'})
            socket.send_json(cmd)
            event = socket.receive_json()
            while event['type'] != 'TABLE_CHAT_MESSAGE':
                event = socket.receive_json()
            ack = socket.receive_json()
            assert event['type'] == 'TABLE_CHAT_MESSAGE'
            assert ack['status'] == 'accepted'
            socket.send_json(cmd)
            assert socket.receive_json() == ack
            socket.send_json({**cmd,'command_id':'bad','payload':{'text':'bad','sender_id':'spoof'}})
            assert socket.receive_json()['status'] == 'rejected'
            socket.send_json({'type':'HEARTBEAT'})
            assert socket.receive_json()['type'] == 'HEARTBEAT_ACK'


async def test_history_is_bounded_ephemeral_and_departed_seats_lose_access():
    host, service, game, _, _, _ = await fixture()
    for index in range(105):
        state = service.state('room', game.match_id)
        state['last'].clear()
        result = await service.handle('room', 'u0', command(mid=game.match_id,cid=str(index),text=f'Message {index}'))
        assert result['status'] == 'accepted'
    history = await service.handle('room','u4',command('TABLE_CHAT_HISTORY',game.match_id))
    assert len(history['messages']) == 100 and history['messages'][0]['text'] == 'Message 5'
    retry = command(mid=game.match_id,cid='104',text='Message 104')
    game.departed.add('u0')
    assert (await service.handle('room','u0',retry))['status'] == 'rejected'
    game.ended = True
    assert (await service.handle('room','u4',command('TABLE_CHAT_HISTORY',game.match_id)))['status'] == 'rejected'
    await host.close()


async def test_poke_rechecks_seats_after_connectivity_await():
    host, service, game, sockets, connections, _ = await fixture()
    original = connections.connected_members
    async def leave_during_check(room):
        online = await original(room)
        game.departed.add('u1')
        return online
    connections.connected_members = leave_during_check
    result = await service.handle('room','u0',command('TABLE_POKE_SEND',game.match_id,recipient_player_id=2))
    assert result['status'] == 'rejected'
    assert all(not s.messages for s in sockets)
    await host.close()


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_table_chat_uses_account_identity_and_repairs_legacy_guest_history(kind):
    host, service, game, sockets, _, _ = await fixture(kind)
    try:
        service.profiles.remember_username('u0', 'alice-account')
        response = await service.handle('room', 'u0', command(mid=game.match_id, text='Hello'))
        assert response['message']['sender_name'] == 'alice-account'
        assert sockets[1].messages[-1]['sender_name'] == 'alice-account'
        state = service.state('room', game.match_id)
        state['messages'][0] = {**state['messages'][0], 'sender_name': 'Guest'}
        service.profiles.update('u0', 'Alice Profile')
        history = await service.handle('room', 'u1', command('TABLE_CHAT_HISTORY', game.match_id))
        assert history['messages'][0]['sender_name'] == 'Alice Profile'
        assert history['messages'][0]['id'] == response['message']['id']
    finally:
        await host.close()
