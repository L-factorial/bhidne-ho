import asyncio
from uuid import uuid4

from fastapi import HTTPException

from app.models.room import RoomSummary
from app.multiplayer.room_catalog import MemoryRoomCatalog


class RoomService:
    """Room catalog and durable membership; no presence or game rules.

    ``_rooms`` only supports legacy ad-hoc room IDs which have no catalog row.
    Membership for persisted rooms is read from the catalog so it survives a
    process restart. Socket connectivity remains owned by ConnectionManager.
    """

    def __init__(self, catalog=None) -> None:
        self._rooms: dict[str, set[str]] = {}
        self._lock = asyncio.Lock()
        self._catalog = catalog or MemoryRoomCatalog()
        self._invitations: dict[str, dict] = {}

    async def join(self, room_id: str, user_id: str) -> None:
        async with self._lock:
            if await self._catalog.deleted(room_id):
                raise HTTPException(404, "This room has been deleted.")
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
            if await self._catalog.deleted(room_id):
                return []
            durable = await self._catalog.members(room_id)
            return sorted(durable | self._rooms.get(room_id, set()))

    async def has_membership(self, room_id: str, user_id: str) -> bool:
        return user_id in await self.members(room_id)

    async def create(self, name: str, creator_id: str, visibility: str = "public") -> RoomSummary:
        async with self._lock:
            room_id = uuid4().hex[:12]
            while await self._catalog.get(room_id) is not None or await self._catalog.deleted(room_id) or room_id in self._rooms:
                room_id = uuid4().hex[:12]
            record = await self._catalog.create(room_id, name, creator_id, visibility)
            await self._catalog.join(room_id, creator_id)
            self._rooms.setdefault(room_id, set()).add(creator_id)
            # Feed source is viewer-relative and is assigned by list_rooms.
            return RoomSummary(**record, members=[creator_id])

    async def invite(self, room_id, creator_id, recipient_ids):
        room = await self.room(room_id)
        if not room or room["creator_id"] != creator_id:
            raise ValueError("Only the room creator can invite people.")
        output = []
        for recipient_id in dict.fromkeys(recipient_ids):
            existing = next((item for item in self._invitations.values()
                             if item["room_id"] == room_id and item["recipient_id"] == recipient_id
                             and item["status"] == "pending"), None)
            if existing: output.append(existing); continue
            invitation_id = uuid4().hex
            item = {"id": invitation_id, "room_id": room_id, "room_name": room["name"],
                    "inviter_id": creator_id, "recipient_id": recipient_id, "status": "pending"}
            self._invitations[invitation_id] = item
            output.append(item)
        return output

    async def invitations_for(self, user_id):
        output = []
        for item in self._invitations.values():
            if item["recipient_id"] != user_id or item["status"] != "pending": continue
            if await self.room(item["room_id"]): output.append(dict(item))
            else: item["status"] = "cancelled"
        return output

    async def answer_invitation(self, user_id, invitation_id, accept):
        item = self._invitations.get(invitation_id)
        if not item or item["recipient_id"] != user_id or item["status"] != "pending":
            raise ValueError("Room invitation not found.")
        if not await self.room(item["room_id"]):
            item["status"] = "cancelled"
            raise ValueError("This room is no longer available.")
        item["status"] = "accepted" if accept else "declined"
        if accept: await self.join(item["room_id"], user_id)
        return dict(item)

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
            for item in self._invitations.values():
                if item["room_id"] == room_id and item["status"] == "pending": item["status"] = "cancelled"
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
                if await self._catalog.deleted(rid):
                    continue
                record = catalog.get(rid) or {"room_id": rid, "name": rid, "creator_id": None,
                                              "visibility": "public", "created_at": None}
                is_owner = bool(viewer_id and record["creator_id"] == viewer_id)
                members = await self._catalog.members(rid) | self._rooms.get(rid, set())
                is_joined = (rid in joined or viewer_id in members) and not is_owner
                is_friend = bool(viewer_id and record["creator_id"] and are_friends
                                 and await are_friends(viewer_id, record["creator_id"]))
                if viewer_id and not is_owner and not is_joined and not is_friend:
                    continue
                source = "you" if is_owner else "joined" if is_joined else "friend" if is_friend else "public"
                output.append(RoomSummary(**record, members=sorted(members),
                                          feed_source=source))
            priority = {"you": 0, "joined": 1, "friend": 2, "public": 3}
            return sorted(output, key=lambda room: (priority[room.feed_source], -(room.created_at or 0), room.room_id))
