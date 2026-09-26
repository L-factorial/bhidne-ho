"""Atomic idempotent room creation before any room owner exists."""
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, uuid5
from pydantic import Field
from .checkpoints import Record, Identity, canonical_json
from .checkpoint_store import user_uuid
from .queries import QueryAccessDenied
from .store import DurableGameConflict
from app.models.action import CommandId


class CreateRoom(Record):
    command_id: CommandId
    name: Annotated[str, Field(min_length=1, max_length=60)]
    visibility: Literal['public', 'private'] = 'private'
    invitees: list[Identity] = Field(default_factory=list, max_length=20)


class PostgresRoomCreation:
    def __init__(self, pool):
        self.pool = pool

    async def create(self, actor, body):
        body = CreateRoom.model_validate_json(canonical_json(body))
        identifier = user_uuid(actor)
        fingerprint = canonical_json(body.model_dump(exclude={'command_id'}))
        name = ' '.join(body.name.split())
        if not name:
            raise ValueError('A room name is required.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                user = await (await connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (identifier,))).fetchone()
                if user is None:
                    raise QueryAccessDenied('An authenticated player is required.')
                prior = await (await connection.execute('''SELECT id,creation_fingerprint FROM rooms
                    WHERE creator_id=%s AND creation_request_id=%s''', (identifier, body.command_id))).fetchone()
                if prior:
                    if prior[1] != fingerprint:
                        raise DurableGameConflict('Command ID already identifies a different room creation.')
                    room_id = prior[0]
                else:
                    for recipient in set(body.invitees):
                        if recipient == actor or not await (await connection.execute('SELECT id FROM users WHERE id=%s', (user_uuid(recipient),))).fetchone():
                            raise ValueError('Choose another existing player as invitation recipient.')
                    room_id = uuid5(NAMESPACE_URL, canonical_json(['room-create-v1', actor, body.command_id])).hex
                    await connection.execute('''INSERT INTO rooms(id,creator_id,name,visibility,creation_request_id,creation_fingerprint)
                        VALUES (%s,%s,%s,%s,%s,%s)''', (room_id, identifier, name, body.visibility, body.command_id, fingerprint))
                    await connection.execute('INSERT INTO room_memberships(room_id,user_id) VALUES (%s,%s)', (room_id, identifier))
                    for recipient in dict.fromkeys(body.invitees):
                        invitation = uuid5(NAMESPACE_URL, canonical_json(['room-create-invite-v1', room_id, recipient])).hex
                        await connection.execute('''INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id,status)
                            VALUES (%s,%s,%s,%s,'pending')''', (invitation, room_id, actor, recipient))
                # Creation outcome stays resolvable after privacy changes/deletion;
                # a retry never reopens a room or restores departed memberships.
                return dict(command_id=body.command_id, status='accepted', room_id=room_id)
