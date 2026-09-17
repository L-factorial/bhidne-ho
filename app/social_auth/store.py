from uuid import UUID, uuid4

from psycopg.errors import UniqueViolation


def clean_display_name(value: str) -> str:
    return " ".join(value.split())[:25] if not any(ord(c) < 32 or ord(c) == 127 for c in value) else ""


class InMemorySocialIdentityStore:
    def __init__(self, auth, profiles):
        self.auth, self.profiles = auth, profiles
        self.identities = {}

    async def login(self, identity):
        key = (identity.provider, identity.subject)
        user_id = self.identities.get(key)
        if user_id is None:
            user_id = f"user-{uuid4()}"
            self.identities[key] = user_id
            name = clean_display_name(identity.display_name)
            if name:
                self.profiles.update(user_id, name)
        return await self.auth.issue_identity(user_id)


class PostgresSocialIdentityStore:
    def __init__(self, pool, auth, profiles):
        self.pool, self.auth, self.profiles = pool, auth, profiles

    async def login(self, identity):
        async with self.pool.connection() as connection:
            result = await connection.execute(
                "SELECT user_id FROM external_identities WHERE provider = %s AND provider_subject = %s",
                (identity.provider, identity.subject),
            )
            row = await result.fetchone()
            if row:
                user_uuid = row[0]
                await connection.execute(
                    "UPDATE external_identities SET email = %s, email_verified = %s, last_login_at = now() "
                    "WHERE provider = %s AND provider_subject = %s",
                    (identity.email, identity.email_verified, identity.provider, identity.subject),
                )
            else:
                user_uuid = uuid4()
                try:
                    async with connection.transaction():
                        await connection.execute("INSERT INTO users (id, kind) VALUES (%s, 'account')", (user_uuid,))
                        await connection.execute(
                            "INSERT INTO user_profiles (user_id, display_name) VALUES (%s, %s)",
                            (user_uuid, clean_display_name(identity.display_name)),
                        )
                        await connection.execute(
                            "INSERT INTO external_identities "
                            "(provider, provider_subject, user_id, email, email_verified) VALUES (%s, %s, %s, %s, %s)",
                            (identity.provider, identity.subject, user_uuid, identity.email, identity.email_verified),
                        )
                except UniqueViolation:
                    # A concurrent first login won. Use the identity it committed.
                    result = await connection.execute(
                        "SELECT user_id FROM external_identities WHERE provider = %s AND provider_subject = %s",
                        (identity.provider, identity.subject),
                    )
                    row = await result.fetchone()
                    if row is None:
                        raise
                    user_uuid = row[0]
        user_id = f"user-{user_uuid}"
        profile = self.profiles.get(user_id)
        if hasattr(profile, "__await__"):
            await profile
        return await self.auth.issue_identity(UUID(str(user_uuid)))
