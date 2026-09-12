"""Ephemeral room banter; no game-engine or HTTP transport dependencies.

Keep messages in bounded memory even after database adoption. Never archive
chat in saved game history, analytics payloads, or durable storage.
"""
import time
from uuid import uuid4

from app.multiplayer.participation import ParticipationSource


class ChatAccessDenied(Exception):
    pass


class ChatRateLimited(Exception):
    pass


class RoomChatService:
    def __init__(self, rooms, profiles, participation: ParticipationSource):
        self.rooms, self.profiles = rooms, profiles
        self.messages = {}
        self.participation = participation

    async def history(self, room_id, user_id):
        if user_id not in await self.rooms.members(room_id):
            raise ChatAccessDenied("Connect to this room to use chat.")
        if self.participation.is_playing(room_id, user_id):
            raise ChatAccessDenied("Chat is paused while you are playing. Return after the game ends.")
        return list(self.messages.get(room_id, []))

    async def send(self, room_id, user_id, text):
        await self.history(room_id, user_id)
        messages = self.messages.setdefault(room_id, [])
        now = int(time.time() * 1000)
        last = next((item for item in reversed(messages) if item["sender_id"] == user_id), None)
        if last and now - last["sent_at"] < 1000:
            raise ChatRateLimited("Wait a moment before sending another message.")
        message = {"id": uuid4().hex, "sender_id": user_id,
                   "sender_name": self.profiles.get(user_id)["display_name"] or "Guest",
                   "text": text, "sent_at": now}
        messages.append(message)
        del messages[:-100]
        return message


