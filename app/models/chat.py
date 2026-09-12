"""Input contract shared by room chat transports."""
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=500)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value):
        if any(ord(char) < 32 and char not in "\n\t" or ord(char) == 127 for char in value):
            raise ValueError("Use text without control characters.")
        value = value.strip()
        if not value:
            raise ValueError("Enter a message.")
        return value


