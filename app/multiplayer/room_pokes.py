"""Ephemeral social messages and room delivery, independent of game mutations."""

import time
from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import HTTPException


@dataclass
class RoomSocialState:
    last_poke: dict[str, float] = field(default_factory=dict)


class RoomPokeService:
    cooldown_seconds = 1.5
    display_ms = 5000

    def __init__(self, rooms, connections):
        self.rooms, self.connections = rooms, connections
        self.states: dict[str, RoomSocialState] = {}

    async def member(self, room_id, user_id):
        members = await self.rooms.members(room_id)
        if user_id not in members:
            raise HTTPException(403, "Connect to this room to use pokes.")
        return members

    async def send(self, room_id, user_id, *, match_id, sender_player_id, recipient_user_id,
                   recipient_player_id, text):
        members = await self.member(room_id, user_id)
        if recipient_user_id == user_id:
            raise HTTPException(409, "Choose another player to poke.")
        if recipient_user_id is not None and recipient_user_id not in members:
            raise HTTPException(409, "That player is offline. Try when they return.")
        state = self.states.setdefault(room_id, RoomSocialState())
        now = time.monotonic()
        if now - state.last_poke.get(user_id, float("-inf")) < self.cooldown_seconds:
            raise HTTPException(429, "Give that poke a moment before sending another.")
        # Prune users who left, then record before any network wait.
        state.last_poke = {user: sent for user, sent in state.last_poke.items() if user in members}
        state.last_poke[user_id] = now
        event = {"type": "ROOM_POKE", "id": uuid4().hex, "room_id": room_id, "match_id": match_id,
                 "sender_id": user_id, "sender_player_id": sender_player_id,
                 "recipient_id": recipient_user_id, "recipient_player_id": recipient_player_id,
                 "scope": "private" if recipient_user_id is not None else "table", "text": text,
                 "expires_at": int(time.time() * 1000) + self.display_ms}
        if recipient_user_id is None:
            await self.connections.broadcast(room_id, event)
        else:
            await self.connections.send_to_room_user(room_id, recipient_user_id, event)
        # No history or automatic replay. Acknowledges dispatch, not that it was read.
        return {"id": event["id"], "scope": event["scope"]}
