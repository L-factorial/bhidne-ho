from datetime import datetime, timezone
from uuid import UUID, uuid4

from psycopg.errors import UniqueViolation

from app.players.service import FriendshipConflict, FriendshipDenied, PlayerNotFound


def public_id(value):
    return f"user-{value}"


def internal_id(value):
    try:
        return UUID(value.removeprefix("user-"))
    except (AttributeError, ValueError):
        raise PlayerNotFound("Player not found.") from None


class InMemoryPlayerStore:
    def __init__(self, profiles):
        self.profiles = profiles
        self.users, self.usernames, self.friendships, self.messages = set(), {}, {}, []

    async def ensure_user(self, user_id): self.users.add(user_id)

    def player(self, user_id):
        return {"user_id": user_id, "display_name": self.profiles.get(user_id)["display_name"],
                "username": self.usernames.get(user_id)}

    async def search(self, user_id, query):
        needle = query.casefold()
        return [self.player(other) for other in sorted(self.users) if other != user_id and
                (needle in (self.profiles.get(other)["display_name"] or "").casefold()
                 or needle in (self.usernames.get(other) or "").casefold())][:20]

    async def snapshot(self, user_id):
        result = {"friends": [], "incoming": [], "outgoing": []}
        for pair, value in self.friendships.items():
            if user_id not in pair: continue
            other = next(item for item in pair if item != user_id)
            bucket = "friends" if value["status"] == "accepted" else "outgoing" if value["requested_by"] == user_id else "incoming"
            result[bucket].append(self.player(other))
        return result

    async def request_friend(self, user_id, target_id):
        if target_id not in self.users: raise PlayerNotFound("Player not found.")
        pair = frozenset((user_id, target_id))
        existing = self.friendships.get(pair)
        if existing: raise FriendshipConflict("A friendship or request already exists.")
        self.friendships[pair] = {"requested_by": user_id, "status": "pending"}
        return self.player(target_id)

    async def accept(self, user_id, requester_id):
        pair = frozenset((user_id, requester_id)); row = self.friendships.get(pair)
        if not row or row != {"requested_by": requester_id, "status": "pending"}:
            raise FriendshipConflict("No incoming friend request from this player.")
        row["status"] = "accepted"
        return self.player(requester_id)

    async def remove(self, user_id, other_id):
        if self.friendships.pop(frozenset((user_id, other_id)), None) is None:
            raise FriendshipConflict("Friendship or request not found.")

    def accepted(self, user_id, friend_id):
        return self.friendships.get(frozenset((user_id, friend_id)), {}).get("status") == "accepted"

    async def history(self, user_id, friend_id):
        if not self.accepted(user_id, friend_id): raise FriendshipDenied("Only friends can message each other.")
        return [message for message in self.messages if {message["sender_id"], message["recipient_id"]} == {user_id, friend_id}][-100:]

    async def send(self, user_id, friend_id, text):
        await self.history(user_id, friend_id)
        message = {"id": uuid4().hex, "sender_id": user_id, "recipient_id": friend_id,
                   "text": text, "sent_at": int(datetime.now(timezone.utc).timestamp() * 1000)}
        self.messages.append(message)
        return message


class PostgresPlayerStore:
    def __init__(self, pool): self.pool = pool
    async def ensure_user(self, user_id): internal_id(user_id)

    @staticmethod
    def player(row):
        return {"user_id": public_id(row[0]), "display_name": row[1], "username": row[2]}

    async def _get_player(self, user_id):
        async with self.pool.connection() as connection:
            result = await connection.execute("""
                SELECT u.id,p.display_name,a.username FROM users u
                JOIN user_profiles p ON p.user_id=u.id
                LEFT JOIN account_credentials a ON a.user_id=u.id WHERE u.id=%s
            """, (internal_id(user_id),))
            row = await result.fetchone()
        if row is None: raise PlayerNotFound("Player not found.")
        return self.player(row)

    async def search(self, user_id, query):
        async with self.pool.connection() as connection:
            result = await connection.execute("""
                SELECT u.id, p.display_name, a.username FROM users u
                JOIN user_profiles p ON p.user_id = u.id
                LEFT JOIN account_credentials a ON a.user_id = u.id
                WHERE u.id <> %s AND (p.display_name ILIKE %s OR a.username ILIKE %s)
                ORDER BY CASE WHEN lower(a.username) = lower(%s) THEN 0 ELSE 1 END,
                         p.display_name, a.username LIMIT 20
            """, (internal_id(user_id), f"%{query}%", f"%{query}%", query))
            return [self.player(row) for row in await result.fetchall()]

    async def snapshot(self, user_id):
        current = internal_id(user_id)
        async with self.pool.connection() as connection:
            result = await connection.execute("""
                SELECT u.id, p.display_name, a.username, f.status, f.requested_by
                FROM friendships f
                JOIN users u ON u.id = CASE WHEN f.user_low = %s THEN f.user_high ELSE f.user_low END
                JOIN user_profiles p ON p.user_id = u.id
                LEFT JOIN account_credentials a ON a.user_id = u.id
                WHERE f.user_low = %s OR f.user_high = %s ORDER BY p.display_name, a.username
            """, (current, current, current))
            rows = await result.fetchall()
        output = {"friends": [], "incoming": [], "outgoing": []}
        for row in rows:
            bucket = "friends" if row[3] == "accepted" else "outgoing" if row[4] == current else "incoming"
            output[bucket].append(self.player(row))
        return output

    async def request_friend(self, user_id, target_id):
        source, target = internal_id(user_id), internal_id(target_id)
        low, high = sorted((source, target))
        try:
            async with self.pool.connection() as connection:
                found = await (await connection.execute("SELECT 1 FROM users WHERE id = %s", (target,))).fetchone()
                if not found: raise PlayerNotFound("Player not found.")
                existing = await (await connection.execute("SELECT 1 FROM friendships WHERE user_low=%s AND user_high=%s", (low, high))).fetchone()
                if existing: raise FriendshipConflict("A friendship or request already exists.")
                await connection.execute("INSERT INTO friendships (user_low,user_high,requested_by,status) VALUES (%s,%s,%s,'pending')", (low, high, source))
        except UniqueViolation:
            raise FriendshipConflict("A friendship or request already exists.") from None
        return await self._get_player(target_id)

    async def accept(self, user_id, requester_id):
        current, requester = internal_id(user_id), internal_id(requester_id); low, high = sorted((current, requester))
        async with self.pool.connection() as connection:
            result = await connection.execute("UPDATE friendships SET status='accepted',updated_at=now() WHERE user_low=%s AND user_high=%s AND status='pending' AND requested_by=%s RETURNING user_low", (low, high, requester))
            if await result.fetchone() is None: raise FriendshipConflict("No incoming friend request from this player.")
        return await self._get_player(requester_id)

    async def remove(self, user_id, other_id):
        current, other = internal_id(user_id), internal_id(other_id); low, high = sorted((current, other))
        async with self.pool.connection() as connection:
            result = await connection.execute("DELETE FROM friendships WHERE user_low=%s AND user_high=%s RETURNING user_low", (low, high))
            if await result.fetchone() is None: raise FriendshipConflict("Friendship or request not found.")

    async def _require_friend(self, connection, user_id, friend_id):
        current, friend = internal_id(user_id), internal_id(friend_id); low, high = sorted((current, friend))
        row = await (await connection.execute("SELECT 1 FROM friendships WHERE user_low=%s AND user_high=%s AND status='accepted'", (low, high))).fetchone()
        if not row: raise FriendshipDenied("Only friends can message each other.")
        return current, friend

    async def history(self, user_id, friend_id):
        async with self.pool.connection() as connection:
            current, friend = await self._require_friend(connection, user_id, friend_id)
            result = await connection.execute("""
                SELECT id,sender_id,recipient_id,text,extract(epoch from sent_at)*1000 FROM
                (SELECT * FROM direct_messages WHERE (sender_id=%s AND recipient_id=%s) OR (sender_id=%s AND recipient_id=%s) ORDER BY sent_at DESC LIMIT 100) recent
                ORDER BY sent_at
            """, (current, friend, friend, current))
            return [{"id": str(r[0]), "sender_id": public_id(r[1]), "recipient_id": public_id(r[2]), "text": r[3], "sent_at": int(r[4])} for r in await result.fetchall()]

    async def send(self, user_id, friend_id, text):
        async with self.pool.connection() as connection:
            current, friend = await self._require_friend(connection, user_id, friend_id)
            message_id = uuid4()
            row = await (await connection.execute("INSERT INTO direct_messages (id,sender_id,recipient_id,text) VALUES (%s,%s,%s,%s) RETURNING extract(epoch from sent_at)*1000", (message_id, current, friend, text))).fetchone()
        return {"id": str(message_id), "sender_id": user_id, "recipient_id": friend_id, "text": text, "sent_at": int(row[0])}
