from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RoomPhraseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=25)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value):
        value = " ".join(value.split())
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("Enter a keyword or punchline.")
        return value


class CallBreakPokeInput(RoomPhraseInput):
    match_id: str = Field(min_length=1, max_length=128)
    recipient_player_id: Annotated[int, Field(strict=True, ge=1, le=5)] | None = None
