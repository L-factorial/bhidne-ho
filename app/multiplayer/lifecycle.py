"""Room membership and connectivity, independent of card-game rules.

The host's membership guard serializes room departure with seating/start/create.
No UI navigation is stored here. A room currently hosts at most one table.
"""
from fastapi import HTTPException


class RoomLifecycle:
    def __init__(self, rooms, connections, games):
        self.rooms, self.connections, self.games = rooms, connections, games

    async def snapshot(self, room_id, user_id):
        async with self.games.membership_guard(room_id):
            return await self._snapshot(room_id, user_id)

    async def _snapshot(self, room_id, user_id):
        members = await self.rooms.members(room_id)
        return {"room_id": room_id, "members": members,
                "is_member": user_id in members,
                "connected_members": await self.connections.connected_members(room_id),
                "active_game": self.games.membership(room_id, user_id)}

    async def enter(self, room_id, user_id):
        async with self.games.membership_guard(room_id):
            await self.rooms.join(room_id, user_id)
            state = await self._snapshot(room_id, user_id)
        await self._publish(room_id)
        return state

    async def leave(self, room_id, user_id):
        async with self.games.membership_guard(room_id):
            game = self.games.membership(room_id, user_id)
            if game and game["active"] and game["player_is_participant"]:
                raise HTTPException(409, {"code": "ACTIVE_GAME_EXISTS",
                    "detail": "Leave the game explicitly before leaving this room.",
                    "game_id": game["game_id"], "match_id": game["game_id"],
                    "requires_leave_game": True})
            await self.connections.leave_room(room_id, user_id)
            state = await self._snapshot(room_id, user_id)
        await self._publish(room_id)
        return state

    async def lookup(self, user_id):
        return [await self.snapshot(room.room_id, user_id)
                for room in await self.rooms.list_rooms() if user_id in room.members]

    async def _publish(self, room_id):
        await self.connections.broadcast(room_id, {"type": "ROOM_STATE", "payload": {
            "room_id": room_id, "members": await self.rooms.members(room_id),
            "connected_members": await self.connections.connected_members(room_id)}})
