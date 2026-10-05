"""Atomic idempotent room creation before any room owner exists."""

from .telemetry import observe, event
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
    # Retain legacy input in the retry fingerprint, but never persist privacy.
    visibility: Literal['public', 'private'] = 'public'
    invitees: list[Identity] = Field(default_factory=list, max_length=20)


class PostgresRoomCreation:
    def __init__(self, pool):
        self.pool = pool

    @observe('room.create')
    async def create(self, actor, body):
        body = CreateRoom.model_validate_json(canonical_json(body))
        identifier = user_uuid(actor)
        fingerprint = canonical_json(body.model_dump(exclude={'command_id'}))
        from app.moderation.content import validate_content
        name = validate_content(' '.join(body.name.split()))
        if not name:
            raise ValueError('A room name is required.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                from app.player_blocks.service import policy_read_lock, require_contact
                await policy_read_lock(connection)
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
                    from app.moderation.policy import require_posting
                    for recipient in set(body.invitees):
                        await require_posting(connection, actor, category='invitation', consume=True)
                        await require_contact(connection,actor,recipient)
                        if recipient == actor or not await (await connection.execute('SELECT id FROM users WHERE id=%s', (user_uuid(recipient),))).fetchone():
                            raise ValueError('Choose another existing player as invitation recipient.')
                    room_id = uuid5(NAMESPACE_URL, canonical_json(['room-create-v1', actor, body.command_id])).hex
                    await connection.execute('''INSERT INTO rooms(id,creator_id,name,visibility,creation_request_id,creation_fingerprint)
                        VALUES (%s,%s,%s,%s,%s,%s)''', (room_id, identifier, name, 'public', body.command_id, fingerprint))
                    await connection.execute('INSERT INTO room_memberships(room_id,user_id) VALUES (%s,%s)', (room_id, identifier))
                    for recipient in dict.fromkeys(body.invitees):
                        invitation = uuid5(NAMESPACE_URL, canonical_json(['room-create-invite-v1', room_id, recipient])).hex
                        await connection.execute('''INSERT INTO room_invitations(id,room_id,inviter_id,recipient_id,status)
                            VALUES (%s,%s,%s,%s,'pending')''', (invitation, room_id, actor, recipient))
                    from .lobby_events import changed
                    from .inbox import PostgresInboxStore
                    await changed(connection, PostgresInboxStore(self.pool), room_id)
                # Creation outcome stays resolvable after privacy changes/deletion;
                # a retry never reopens a room or restores departed memberships.
        event('room_creation_committed', room_id=room_id, command_id=body.command_id,
              result='duplicate' if prior else 'created')
        return dict(command_id=body.command_id, status='accepted', room_id=room_id)
