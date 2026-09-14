import pytest
from fastapi import HTTPException

from app.multiplayer.room_service import RoomService
from app.test_games.service import TestGameService as Host


class Delivery:
    async def broadcast(self, *args): pass
    async def send_to_room_user(self, *args): pass


@pytest.mark.parametrize('game_type,capacity', [('flush', 3), ('marriage', 3), ('callbreak', 4)])
@pytest.mark.parametrize('started', [False, True])
async def test_sole_newcomer_can_end_abandoned_game(game_type, capacity, started):
    rooms = RoomService(); host = Host(rooms, Delivery())
    users = [f'u{i}' for i in range(capacity)]
    for user in users: await rooms.join('room', user)
    game = await host.create('room', users[0], capacity, game_type)
    mid = game['match_id']
    for user in users[1:]: await host.join('room', user, mid)
    if started:
        if game_type != 'callbreak': await host.table_command('room', users[0], mid, 'lock')
        await host.start('room', users[0], mid, rules_revision=0)
    for user in users: await rooms.leave('room', user)
    await rooms.join('room', 'newcomer')
    snapshot = await host.snapshot('room', 'newcomer')
    assert not snapshot['is_creator'] and snapshot['your_player_id'] is None

    # Membership must still allow ending when the request reaches the server.
    await rooms.join('room', 'other')
    with pytest.raises(HTTPException) as denied:
        await host.end('room', 'newcomer', mid)
    assert denied.value.status_code == 403
    assert not host.games['room'].ended
    await rooms.leave('room', 'other')
    with pytest.raises(HTTPException) as stale:
        await host.end('room', 'newcomer', 'old-match')
    assert stale.value.status_code == 409
    with pytest.raises(HTTPException) as outsider:
        await host.end('room', 'other', mid)
    assert outsider.value.status_code == 403

    ended = await host.end('room', 'newcomer', mid)
    assert ended['status'] == 'ended'
    assert (await host.end('room', 'newcomer', mid))['status'] == 'ended'
    replacement = await host.create('room', 'newcomer', capacity, game_type)
    assert replacement['match_id'] != mid and replacement['is_creator']
    await host.close()
