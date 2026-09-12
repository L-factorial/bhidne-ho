"""Common query for participation policies, implemented by each game host."""
from typing import Protocol


class ParticipationSource(Protocol):
    def is_playing(self, room_id: str, user_id: str) -> bool:
        """True for a seated player in an active, unfinished game in this room.

        Include between-deal review; exclude waiting lobbies and spectators.
        Read current authoritative state, without side effects or cached copies.
        """
        ...


class GameParticipation:
    def __init__(self, *sources: ParticipationSource):
        self.sources = sources

    def is_playing(self, room_id: str, user_id: str) -> bool:
        return any(source.is_playing(room_id, user_id) for source in self.sources)
