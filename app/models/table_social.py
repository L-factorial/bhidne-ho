"""Social commands share a connection, never game revisions or receipts."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
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
    text: str = Field(default='👋', min_length=1, max_length=30)
