from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class GameCommand(BaseModel):
    # Identity and routing always come from the authenticated transport context.
    model_config = ConfigDict(extra="ignore")
    type: Literal["GAME_COMMAND"] = "GAME_COMMAND"
    command: str = Field(min_length=1, pattern=r"\S")
    payload: dict[str, JsonValue] = Field(default_factory=dict)


class GameEvent(BaseModel):
    type: Literal["GAME_EVENT"] = "GAME_EVENT"
    event: str = Field(min_length=1, pattern=r"\S")
    payload: dict[str, JsonValue] = Field(default_factory=dict)


class CommandError(BaseModel):
    type: Literal["ERROR"] = "ERROR"
    category: Literal["transport", "infrastructure", "game"]
    code: str
    detail: str
