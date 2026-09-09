import asyncio
from dataclasses import dataclass, field

from app.games.base import GameEngine


@dataclass
class RoomGame:
    engine: GameEngine
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class GameRegistry:
    """Owns engines and their locks for one application lifespan/event loop.

    Registration is synchronous and cannot replace an existing room or share an
    engine across rooms. Entries survive disconnects. Clear only at shutdown,
    after active command handlers stop; room deletion is outside this milestone.
    """

    def __init__(self) -> None:
        self._games: dict[str, RoomGame] = {}

    def register(self, room_id: str, engine: GameEngine) -> None:
        if room_id in self._games:
            raise ValueError("Room already has an engine")
        if any(game.engine is engine for game in self._games.values()):
            raise ValueError("Each room must own a separate engine instance")
        self._games[room_id] = RoomGame(engine)

    def get_room(self, room_id: str) -> RoomGame | None:
        return self._games.get(room_id)

    def get_engine(self, room_id: str) -> GameEngine | None:
        game = self.get_room(room_id)
        return game.engine if game else None

    def engine_for(self, room_id: str) -> GameEngine | None:
        return self.get_engine(room_id)

    def clear(self) -> None:
        self._games.clear()
