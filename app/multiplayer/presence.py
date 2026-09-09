from app.models.room import RoomPresence
from app.multiplayer.room_service import RoomService


class PresenceService:
    """A snapshot of online room members; membership is the source of truth."""

    def __init__(self, rooms: RoomService) -> None:
        self._rooms = rooms

    async def snapshot(self, room_id: str) -> RoomPresence:
        return RoomPresence(room_id=room_id, members=await self._rooms.members(room_id))
