"""Personal phrase collections keyed by authenticated identity."""

from uuid import uuid4
from fastapi import HTTPException


class PlayerPhraseService:
    phrase_limit = 24

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
            raise HTTPException(409, "You have 24 phrases. Remove one to add another.")
        phrase = {"id": uuid4().hex, "text": text, "created_by": user_id}
        phrases.append(phrase)
        return dict(phrase)

    async def remove_phrase(self, user_id, phrase_id):
        phrases = self.collections.get(user_id, [])
        phrase = next((p for p in phrases if p["id"] == phrase_id), None)
        if not phrase:
            raise HTTPException(404, "That phrase is not in your collection.")
        phrases.remove(phrase)

