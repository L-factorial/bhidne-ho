"""Display names keyed by authenticated identity, separate from login credentials."""

from uuid import UUID

class PlayerProfileService:
    def __init__(self):
        self.names: dict[str, str] = {}
        self.usernames: dict[str, str] = {}
        self.avatars: dict[str, str | None] = {}
        self.appearances: dict[str, dict] = {}

    def get(self, user_id):
        return {"display_name": self.names.get(user_id, "")}

    def update(self, user_id, display_name):
        self.names[user_id] = display_name
        return self.get(user_id)

    def avatar(self, user_id):
        from .avatars import avatar_url
        return avatar_url(self.avatars.get(user_id))

    def get_avatar(self, user_id):
        return {"avatar_id": self.avatars.get(user_id), "avatar_url": self.avatar(user_id)}

    def update_avatar(self, user_id, avatar_id):
        self.avatars[user_id] = avatar_id
        return self.get_avatar(user_id)

    def appearance(self, user_id):
        return dict(self.appearances.get(user_id, {"theme": "heritage", "mode": "system"}))

    def update_appearance(self, user_id, theme, mode):
        self.appearances[user_id] = {"theme": theme, "mode": mode}
        return self.appearance(user_id)

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
                SELECT p.display_name,a.username,p.avatar_id FROM user_profiles p
                LEFT JOIN account_credentials a ON a.user_id=p.user_id
                WHERE p.user_id=%s
            """, (self._uuid(user_id),))
            row = await result.fetchone()
        self.avatars[user_id] = row[2] if row else None
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

    async def get_avatar(self, user_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute("SELECT avatar_id FROM user_profiles WHERE user_id=%s", (self._uuid(user_id),))).fetchone()
        self.avatars[user_id] = row[0] if row else None
        return PlayerProfileService.get_avatar(self, user_id)

    async def update_avatar(self, user_id, avatar_id):
        async with self.pool.connection() as connection:
            await connection.execute("UPDATE user_profiles SET avatar_id=%s,updated_at=now() WHERE user_id=%s", (avatar_id,self._uuid(user_id)))
        self.avatars[user_id] = avatar_id
        return PlayerProfileService.get_avatar(self, user_id)

    async def appearance(self, user_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute(
                "SELECT theme_family,theme_mode FROM user_profiles WHERE user_id=%s",
                (self._uuid(user_id),))).fetchone()
        return {"theme": row[0], "mode": row[1]} if row else {"theme": "heritage", "mode": "system"}

    async def update_appearance(self, user_id, theme, mode):
        async with self.pool.connection() as connection:
            await connection.execute(
                "UPDATE user_profiles SET theme_family=%s,theme_mode=%s,updated_at=now() WHERE user_id=%s",
                (theme, mode, self._uuid(user_id)))
        return {"theme": theme, "mode": mode}
