"""Social commands share a connection, never game revisions or receipts."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.models.poke import PlayerPhraseInput


class TableSocialCommand(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['TABLE_CHAT_SEND', 'TABLE_CHAT_HISTORY', 'TABLE_POKE_SEND']
    match_id: str = Field(min_length=1, max_length=128)
    command_id: str = Field(min_length=1, max_length=128)
    payload: dict = Field(default_factory=dict)


class TablePokePayload(PlayerPhraseInput):
    model_config = ConfigDict(extra='forbid')
    recipient_player_id: int = Field(strict=True, ge=1)
    reaction: Literal['love', 'pinch', 'clap', 'cheers', 'laugh', 'hammer', 'punchline'] | None = None
    text: str = Field(default='👋', min_length=1, max_length=60)

    @model_validator(mode='after')
    def validate_punchline(self):
        if '\x7f' in self.text:
            raise ValueError('Enter a punchline without control characters.')
        if self.reaction == 'punchline' and 'text' not in self.model_fields_set:
            raise ValueError('Enter a punchline.')
        if self.reaction != 'punchline' and len(self.text) > 30:
            raise ValueError('Poke text must be at most 30 characters.')
        return self
