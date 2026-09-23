"""Bounded, ephemeral table chat and poke receipts. No gameplay mutations."""
import asyncio
from collections import OrderedDict
import time
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from app.models.chat import ChatInput
from app.multiplayer.chat_names import sender_name, restore_guest_names
from app.models.table_social import TablePokePayload


class TableSocialService:
    def __init__(self, host, rooms, connections, profiles, pokes):
        self.host, self.rooms, self.connections = host, rooms, connections
        self.profiles, self.pokes = profiles, pokes
        self.tables = OrderedDict()
        # Separate from all game locks; serializes receipt creation across tabs.
        self.lock = asyncio.Lock()

    def state(self, room_id, match_id):
        key = (room_id, match_id)
        now = time.monotonic()
        for old, value in list(self.tables.items()):
            if now - value['touched'] > 3600:
                del self.tables[old]
        state = self.tables.setdefault(key, dict(messages=[], receipts=OrderedDict(), last={}, touched=now))
        state['touched'] = now
        self.tables.move_to_end(key)
        while len(self.tables) > 256:
            self.tables.popitem(last=False)
        return state

    async def access(self, room_id, user_id, match_id, write=False):
        members = set(await self.rooms.members(room_id))
        seats, queue = self.host.social_roster(room_id, match_id)
        if user_id not in members or user_id not in (seats if write else set(seats) | set(queue)):
            raise HTTPException(403, 'Only seated players can send; seated and waiting players can read table chat.')
        return seats, (set(seats) | set(queue)) & members

    async def handle(self, room_id, user_id, command):
        ack = dict(type='TABLE_SOCIAL_ACK', room_id=room_id, match_id=command.match_id, command_id=command.command_id)
        try:
            async with self.lock:
                seats, viewers = await self.access(room_id, user_id, command.match_id, command.type != 'TABLE_CHAT_HISTORY')
                state = self.state(room_id, command.match_id)
                if command.type == 'TABLE_CHAT_HISTORY':
                    if command.payload:
                        raise HTTPException(422, 'History has no payload.')
                    messages = await restore_guest_names(list(state['messages']), self.profiles)
                    await self.access(room_id, user_id, command.match_id)
                    return dict(ack, status='accepted', messages=messages)
                key = (user_id, command.command_id)
                fingerprint = (command.type, command.payload)
                if key in state['receipts']:
                    previous, result = state['receipts'][key]
                    if previous != fingerprint:
                        raise HTTPException(409, 'Command ID already used for a different social action.')
                    return result
                if command.type == 'TABLE_POKE_SEND':
                    payload = TablePokePayload.model_validate(command.payload)
                    recipient = next((u for u, seat in seats.items() if seat == payload.recipient_player_id), None)
                    if recipient is None:
                        raise HTTPException(409, 'That seat is empty.')
                    def validate_seats():
                        current, _ = self.host.social_roster(room_id, command.match_id)
                        if current.get(user_id) != seats[user_id] or current.get(recipient) != payload.recipient_player_id:
                            raise HTTPException(409, 'The seats changed. Choose a player again.')
                    result = await self.pokes.send(room_id, user_id, match_id=command.match_id,
                        sender_player_id=seats[user_id], recipient_user_id=recipient,
                        recipient_player_id=payload.recipient_player_id, text=payload.text, validate=validate_seats,
                        reaction=payload.reaction)
                    result = dict(ack, status='accepted', poke_id=result['id'])
                    delivery = None
                else:
                    payload = ChatInput.model_validate(command.payload)
                    now = time.monotonic()
                    if now - state['last'].get(user_id, float('-inf')) < 1:
                        raise HTTPException(429, 'Wait a moment before sending another message.')
                    name = await sender_name(self.profiles, user_id)
                    # Membership may change while a profile is fetched.
                    seats, viewers = await self.access(room_id, user_id, command.match_id, True)
                    message = dict(type='TABLE_CHAT_MESSAGE', id=uuid4().hex, room_id=room_id,
                        match_id=command.match_id, sender_id=user_id, sender_player_id=seats[user_id],
                        sender_name=name, text=payload.text, sent_at=int(time.time()*1000))
                    state['messages'].append(message)
                    del state['messages'][:-100]
                    state['last'] = {u: t for u, t in state['last'].items() if now-t < 1}
                    state['last'][user_id] = now
                    result = dict(ack, status='accepted', message=message)
                    delivery = message
                state['receipts'][key] = (fingerprint, result)
                while len(state['receipts']) > 512:
                    state['receipts'].popitem(last=False)
            if delivery:
                # Never broadcast table history to unrelated room spectators.
                async def deliver_to(viewer):
                    try:
                        await self.access(room_id, viewer, command.match_id)
                    except HTTPException:
                        return
                    await self.connections.send_to_room_user(room_id, viewer, delivery)
                await asyncio.gather(*(deliver_to(viewer) for viewer in viewers))
            return result
        except (HTTPException, ValidationError) as error:
            detail = error.detail if isinstance(error, HTTPException) else 'Invalid social command payload.'
            return dict(ack, status='rejected', detail=detail if isinstance(detail, str) else detail.get('detail', 'Action rejected.'))
