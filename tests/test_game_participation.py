import pytest

from app.multiplayer.participation import GameParticipation
from app.multiplayer.player_profiles import PlayerProfileService
from app.multiplayer.room_chat import RoomChatService, ChatAccessDenied


class GameSource:
    def __init__(self):
        self.active = set()

    def is_playing(self, room_id, user_id):
        return (room_id, user_id) in self.active


class Rooms:
    async def members(self, room_id):
        return ['player', 'spectator'] if room_id == 'room' else []


def test_participation_aggregates_multiple_games_without_cached_state():
    first, second = GameSource(), GameSource()
    policy = GameParticipation(first, second)
    assert not policy.is_playing('room', 'player')
    second.active.add(('room', 'player'))
    assert policy.is_playing('room', 'player')
    assert not policy.is_playing('elsewhere', 'player')
    assert not policy.is_playing('room', 'spectator')
    first.active.add(('room', 'player'))
    second.active.clear()
    assert policy.is_playing('room', 'player')
    first.active.clear()
    assert not policy.is_playing('room', 'player')


async def test_chat_policy_works_with_a_non_callbreak_source():
    source = GameSource()
    service = RoomChatService(Rooms(), PlayerProfileService(), GameParticipation(source))
    assert await service.history('room', 'player') == []
    source.active.add(('room', 'player'))
    with pytest.raises(ChatAccessDenied, match='paused'):
        await service.send('room', 'player', 'Not during play')
    with pytest.raises(ChatAccessDenied, match='paused'):
        await service.history('room', 'player')
    sent = await service.send('room', 'spectator', 'Watching')
    source.active.clear()
    assert await service.history('room', 'player') == [sent]
    with pytest.raises(ChatAccessDenied, match='Connect'):
        await service.history('elsewhere', 'player')
