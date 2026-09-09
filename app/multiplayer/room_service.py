import asyncio
from uuid import uuid4

from app.models.room import RoomSummary


class RoomService:
    """Membership only; no authentication or game-state validation."""

    def __init__(self) -> None:
        self._rooms: dict[str, set[str]] = {}
        self._lock = asyncio.Lock()
        self._catalog: dict[str, str] = {}

    async def join(self, room_id: str, user_id: str) -> None:
        async with self._lock:
            self._rooms.setdefault(room_id, set()).add(user_id)

    async def leave(self, room_id: str, user_id: str) -> None:
        async with self._lock:
            members = self._rooms.get(room_id)
            if members is not None:
                members.discard(user_id)
                if not members:
                    del self._rooms[room_id]

    async def members(self, room_id: str) -> list[str]:
        async with self._lock:
            return sorted(self._rooms.get(room_id, set()))

    async def create(self, name: str) -> RoomSummary:
        async with self._lock:
            room_id = uuid4().hex[:12]
            while room_id in self._catalog or room_id in self._rooms:
                room_id = uuid4().hex[:12]
            self._catalog[room_id] = name
            return RoomSummary(room_id=room_id, name=name, members=[])

    async def list_rooms(self) -> list[RoomSummary]:
        async with self._lock:
            ids = self._catalog.keys() | self._rooms.keys()
            return [RoomSummary(room_id=rid, name=self._catalog.get(rid, rid),
                                members=sorted(self._rooms.get(rid, set())))
                    for rid in sorted(ids)]
