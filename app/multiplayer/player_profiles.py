"""Display names keyed by authenticated identity, separate from login credentials."""

from uuid import UUID

class PlayerProfileService:
    def __init__(self):
        self.names: dict[str, str] = {}
        self.usernames: dict[str, str] = {}

    def get(self, user_id):
        return {"display_name": self.names.get(user_id, "")}

    def update(self, user_id, display_name):
        self.names[user_id] = display_name
        return self.get(user_id)

    def remember_username(self, user_id, username):
        if username:
            self.usernames[user_id] = username

    def name(self, user_id, seat):
        return self.names.get(user_id) or self.usernames.get(user_id) or user_id


class PostgresPlayerProfileService(PlayerProfileService):
    """Database-backed profiles with a local read-through cache for game views."""

    def __init__(self, pool):
        super().__init__()
        self.pool = pool

    @staticmethod
    def _uuid(user_id):
        return UUID(user_id.removeprefix("user-"))

    async def get(self, user_id):
        async with self.pool.connection() as connection:
            result = await connection.execute("""
                SELECT p.display_name,a.username FROM user_profiles p
                LEFT JOIN account_credentials a ON a.user_id=p.user_id
                WHERE p.user_id=%s
            """, (self._uuid(user_id),))
            row = await result.fetchone()
        value = row[0] if row else ""
        self.names[user_id] = value
        if row and row[1]:
            self.usernames[user_id] = row[1]
        return {"display_name": value}

    async def update(self, user_id, display_name):
        async with self.pool.connection() as connection:
            await connection.execute(
                "UPDATE user_profiles SET display_name = %s, updated_at = now() WHERE user_id = %s",
                (display_name, self._uuid(user_id)),
            )
        self.names[user_id] = display_name
        return {"display_name": display_name}
