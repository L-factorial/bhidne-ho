"""Personal phrase collections keyed by authenticated identity."""

from uuid import UUID, uuid4
from fastapi import HTTPException


class PlayerPhraseService:
    phrase_limit = 25

    def __init__(self):
        self.collections: dict[str, list[dict]] = {}

    async def phrases(self, user_id):
        return [dict(phrase) for phrase in self.collections.get(user_id, [])]

    async def add_phrase(self, user_id, text):
        phrases = self.collections.setdefault(user_id, [])
        for phrase in phrases:
            if phrase["text"].casefold() == text.casefold():
                return dict(phrase)
        if len(phrases) >= self.phrase_limit:
            raise HTTPException(409, "You have 25 phrases. Remove one to add another.")
        phrase = {"id": uuid4().hex, "text": text, "created_by": user_id}
        phrases.append(phrase)
        return dict(phrase)

    async def update_phrase(self, user_id, phrase_id, text):
        phrases = self.collections.get(user_id, [])
        phrase = next((p for p in phrases if p["id"] == phrase_id), None)
        if not phrase:
            raise HTTPException(404, "That phrase is not in your collection.")
        if any(p["id"] != phrase_id and p["text"].casefold() == text.casefold() for p in phrases):
            raise HTTPException(409, "You already have that phrase.")
        phrase["text"] = text
        return dict(phrase)

    async def remove_phrase(self, user_id, phrase_id):
        phrases = self.collections.get(user_id, [])
        phrase = next((p for p in phrases if p["id"] == phrase_id), None)
        if not phrase:
            raise HTTPException(404, "That phrase is not in your collection.")
        phrases.remove(phrase)


class PostgresPlayerPhraseService(PlayerPhraseService):
    def __init__(self, pool):
        self.pool = pool

    @staticmethod
    def _user_id(user_id):
        return UUID(user_id.removeprefix("user-"))

    @staticmethod
    def _value(row, user_id):
        return {"id": row[0].hex, "text": row[1], "created_by": user_id}

    async def phrases(self, user_id):
        async with self.pool.connection() as connection:
            rows = await (await connection.execute(
                "SELECT id,text FROM player_phrases WHERE user_id=%s ORDER BY created_at,id",
                (self._user_id(user_id),),
            )).fetchall()
        return [self._value(row, user_id) for row in rows]

    async def add_phrase(self, user_id, text):
        async with self.pool.connection() as connection, connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (user_id + ':phrases',))
            existing = await (await connection.execute(
                "SELECT id,text FROM player_phrases WHERE user_id=%s AND lower(text)=lower(%s)",
                (self._user_id(user_id), text),
            )).fetchone()
            if existing:
                return self._value(existing, user_id)
            count = await (await connection.execute(
                "SELECT count(*) FROM player_phrases WHERE user_id=%s", (self._user_id(user_id),),
            )).fetchone()
            if count[0] >= self.phrase_limit:
                raise HTTPException(409, "You have 25 phrases. Remove one to add another.")
            phrase_id = uuid4()
            await connection.execute(
                "INSERT INTO player_phrases(id,user_id,text) VALUES(%s,%s,%s)",
                (phrase_id, self._user_id(user_id), text),
            )
        return {"id": phrase_id.hex, "text": text, "created_by": user_id}

    async def update_phrase(self, user_id, phrase_id, text):
        async with self.pool.connection() as connection, connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (user_id + ':phrases',))
            duplicate = await (await connection.execute(
                "SELECT 1 FROM player_phrases WHERE user_id=%s AND lower(text)=lower(%s) AND id<>%s",
                (self._user_id(user_id), text, UUID(phrase_id)),
            )).fetchone()
            if duplicate:
                raise HTTPException(409, "You already have that phrase.")
            row = await (await connection.execute(
                "UPDATE player_phrases SET text=%s WHERE id=%s AND user_id=%s RETURNING id,text",
                (text, UUID(phrase_id), self._user_id(user_id)),
            )).fetchone()
        if not row:
            raise HTTPException(404, "That phrase is not in your collection.")
        return self._value(row, user_id)

    async def remove_phrase(self, user_id, phrase_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute(
                "DELETE FROM player_phrases WHERE id=%s AND user_id=%s RETURNING id",
                (UUID(phrase_id), self._user_id(user_id)),
            )).fetchone()
        if not row:
            raise HTTPException(404, "That phrase is not in your collection.")
