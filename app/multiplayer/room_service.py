import asyncio
from uuid import uuid4

from app.models.room import RoomSummary
from app.multiplayer.room_catalog import MemoryRoomCatalog


class RoomService:
    """Room catalog, audience checks, and runtime membership; no game rules."""

    def __init__(self, catalog=None) -> None:
        self._rooms: dict[str, set[str]] = {}
        self._lock = asyncio.Lock()
        self._catalog = catalog or MemoryRoomCatalog()

    async def join(self, room_id: str, user_id: str) -> None:
        async with self._lock:
            await self._catalog.join(room_id, user_id)
            self._rooms.setdefault(room_id, set()).add(user_id)

    async def leave(self, room_id: str, user_id: str) -> None:
        async with self._lock:
            members = self._rooms.get(room_id)
            if members is not None:
                members.discard(user_id)
                if not members:
                    del self._rooms[room_id]
            await self._catalog.leave(room_id, user_id)

    async def members(self, room_id: str) -> list[str]:
        async with self._lock:
            return sorted(self._rooms.get(room_id, set()))

    async def has_membership(self, room_id: str, user_id: str) -> bool:
        if user_id in await self.members(room_id):
            return True
        return room_id in await self._catalog.joined(user_id)

    async def create(self, name: str, creator_id: str, visibility: str = "public") -> RoomSummary:
        async with self._lock:
            room_id = uuid4().hex[:12]
            while await self._catalog.get(room_id) is not None or await self._catalog.deleted(room_id) or room_id in self._rooms:
                room_id = uuid4().hex[:12]
            record = await self._catalog.create(room_id, name, creator_id, visibility)
            # Feed source is viewer-relative and is assigned by list_rooms.
            return RoomSummary(**record, members=[])

    async def room(self, room_id):
        return await self._catalog.get(room_id)

    async def can_enter(self, room_id, user_id, are_friends) -> bool:
        if await self._catalog.deleted(room_id):
            return False
        room = await self.room(room_id)
        if room is None or room["visibility"] == "public" or room["creator_id"] == user_id:
            return True
        if room_id in await self._catalog.joined(user_id):
            return True
        return await are_friends(user_id, room["creator_id"])

    async def delete(self, room_id: str) -> bool:
        async with self._lock:
            deleted = await self._catalog.delete(room_id)
            self._rooms.pop(room_id, None)
            return deleted

    async def list_rooms(self, viewer_id=None, are_friends=None) -> list[RoomSummary]:
        async with self._lock:
            catalog = {room["room_id"]: room for room in await self._catalog.list()}
            joined = await self._catalog.joined(viewer_id) if viewer_id else set()
            owned = await self._catalog.owned(viewer_id) if viewer_id else set()
            for rid in (joined | owned) - catalog.keys():
                record = await self._catalog.get(rid)
                if record: catalog[rid] = record
            ids = catalog.keys() | self._rooms.keys()
            output = []
            for rid in ids:
                record = catalog.get(rid) or {"room_id": rid, "name": rid, "creator_id": None,
                                              "visibility": "public", "created_at": None}
                is_owner = bool(viewer_id and record["creator_id"] == viewer_id)
                is_joined = (rid in joined or viewer_id in self._rooms.get(rid, set())) and not is_owner
                if viewer_id and not is_owner and not is_joined:
                    continue
                source = "you" if is_owner else "joined" if is_joined else "public"
                output.append(RoomSummary(**record, members=sorted(self._rooms.get(rid, set())),
                                          feed_source=source))
            priority = {"you": 0, "joined": 1, "friend": 2, "public": 3}
            return sorted(output, key=lambda room: (priority[room.feed_source], -(room.created_at or 0), room.room_id))
