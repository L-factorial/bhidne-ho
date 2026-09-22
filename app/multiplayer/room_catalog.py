from datetime import datetime, timezone
from uuid import UUID


def public_id(value): return f"user-{value}"
def internal_id(value): return UUID(value.removeprefix("user-"))


class MemoryRoomCatalog:
    def __init__(self): self.rooms, self.memberships, self.deleted_rooms = {}, set(), set()

    async def create(self, room_id, name, creator_id, visibility):
        record = {"room_id": room_id, "name": name, "creator_id": creator_id,
                  "visibility": visibility, "created_at": int(datetime.now(timezone.utc).timestamp() * 1000)}
        self.rooms[room_id] = record
        return record

    async def get(self, room_id): return self.rooms.get(room_id)
    async def list(self): return sorted(self.rooms.values(), key=lambda room: (-room["created_at"], room["room_id"]))[:100]
    async def join(self, room_id, user_id):
        if room_id in self.rooms: self.memberships.add((room_id, user_id))
    async def leave(self, room_id, user_id): self.memberships.discard((room_id, user_id))
    async def joined(self, user_id): return {room_id for room_id, member in self.memberships if member == user_id}
    async def members(self, room_id): return {member for member_room, member in self.memberships if member_room == room_id}
    async def owned(self, user_id): return {room_id for room_id, room in self.rooms.items() if room["creator_id"] == user_id}
    async def delete(self, room_id):
        self.memberships = {pair for pair in self.memberships if pair[0] != room_id}
        deleted = self.rooms.pop(room_id, None) is not None
        if deleted: self.deleted_rooms.add(room_id)
        return deleted
    async def deleted(self, room_id): return room_id in self.deleted_rooms


class PostgresRoomCatalog:
    def __init__(self, pool): self.pool = pool

    @staticmethod
    def record(row):
        return {"room_id": row[0], "name": row[1], "creator_id": public_id(row[2]),
                "visibility": row[3], "created_at": int(row[4].timestamp() * 1000)}

    async def create(self, room_id, name, creator_id, visibility):
        async with self.pool.connection() as connection:
            result = await connection.execute("INSERT INTO rooms (id,name,creator_id,visibility) VALUES (%s,%s,%s,%s) RETURNING id,name,creator_id,visibility,created_at", (room_id, name, internal_id(creator_id), visibility))
            return self.record(await result.fetchone())

    async def get(self, room_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute("SELECT id,name,creator_id,visibility,created_at FROM rooms WHERE id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE deleted_rooms.id=rooms.id)", (room_id,))).fetchone()
        return self.record(row) if row else None

    async def list(self):
        async with self.pool.connection() as connection:
            rows = await (await connection.execute("SELECT id,name,creator_id,visibility,created_at FROM rooms WHERE NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE deleted_rooms.id=rooms.id) ORDER BY created_at DESC,id LIMIT 100")).fetchall()
        return [self.record(row) for row in rows]

    async def join(self, room_id, user_id):
        async with self.pool.connection() as connection:
            await connection.execute("INSERT INTO room_memberships (room_id,user_id) SELECT id,%s FROM rooms WHERE id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE deleted_rooms.id=rooms.id) ON CONFLICT DO NOTHING", (internal_id(user_id), room_id))

    async def leave(self, room_id, user_id):
        async with self.pool.connection() as connection:
            await connection.execute("DELETE FROM room_memberships WHERE room_id=%s AND user_id=%s", (room_id, internal_id(user_id)))

    async def joined(self, user_id):
        async with self.pool.connection() as connection:
            rows = await (await connection.execute("SELECT room_id FROM room_memberships WHERE user_id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE deleted_rooms.id=room_memberships.room_id)", (internal_id(user_id),))).fetchall()
        return {row[0] for row in rows}

    async def members(self, room_id):
        async with self.pool.connection() as connection:
            rows = await (await connection.execute("SELECT user_id FROM room_memberships WHERE room_id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE deleted_rooms.id=room_memberships.room_id)", (room_id,))).fetchall()
        return {public_id(row[0]) for row in rows}

    async def owned(self, user_id):
        async with self.pool.connection() as connection:
            rows = await (await connection.execute("SELECT id FROM rooms WHERE creator_id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE deleted_rooms.id=rooms.id)", (internal_id(user_id),))).fetchall()
        return {row[0] for row in rows}

    async def delete(self, room_id):
        # Retain the room row: game journals and settlement history reference it
        # with ON DELETE RESTRICT. A tombstone removes it from the live catalog.
        async with self.pool.connection() as connection, connection.transaction():
            row = await (await connection.execute(
                "INSERT INTO deleted_rooms (id) SELECT id FROM rooms WHERE id=%s "
                "ON CONFLICT DO NOTHING RETURNING id", (room_id,))).fetchone()
            if row:
                await connection.execute("DELETE FROM room_memberships WHERE room_id=%s", (room_id,))
        return row is not None

    async def deleted(self, room_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute("SELECT 1 FROM deleted_rooms WHERE id=%s", (room_id,))).fetchone()
        return row is not None
