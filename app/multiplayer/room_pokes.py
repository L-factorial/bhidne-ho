"""Ephemeral social messages and room phrases, independent of game mutations."""

import time
from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import HTTPException


@dataclass
class RoomSocialState:
    phrases: list[dict] = field(default_factory=list)
    last_poke: dict[str, float] = field(default_factory=dict)


class RoomPokeService:
    phrase_limit = 24
    cooldown_seconds = 1.5
    display_ms = 5000

    def __init__(self, rooms, connections):
        self.rooms, self.connections = rooms, connections
        self.states: dict[str, RoomSocialState] = {}

    async def member(self, room_id, user_id):
        members = await self.rooms.members(room_id)
        if user_id not in members:
            raise HTTPException(403, "Connect to this room to use pokes and punchlines.")
        return members

    async def phrases(self, room_id, user_id):
        await self.member(room_id, user_id)
        return [dict(phrase) for phrase in self.states.get(room_id, RoomSocialState()).phrases]

    async def add_phrase(self, room_id, user_id, text):
        await self.member(room_id, user_id)
        state = self.states.setdefault(room_id, RoomSocialState())
        for phrase in state.phrases:
            if phrase["text"].casefold() == text.casefold():
                return dict(phrase)
        if len(state.phrases) >= self.phrase_limit:
            raise HTTPException(409, "This room has 24 punchlines. Remove one of yours to add another.")
        phrase = {"id": uuid4().hex, "text": text, "created_by": user_id}
        state.phrases.append(phrase)
        return dict(phrase)

    async def remove_phrase(self, room_id, user_id, phrase_id):
        await self.member(room_id, user_id)
        state = self.states.get(room_id)
        phrase = next((p for p in state.phrases if p["id"] == phrase_id), None) if state else None
        if not phrase:
            raise HTTPException(404, "That punchline is no longer in the room.")
        if phrase["created_by"] != user_id:
            raise HTTPException(403, "You can only remove punchlines you created.")
        state.phrases.remove(phrase)

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
