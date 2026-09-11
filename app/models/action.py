"""Shared HTTP command envelope; game-specific payload validation stays in adapters."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

CommandId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


class ActionCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    match_id: str = Field(min_length=1, max_length=128)
    command_id: CommandId | None = None  # Legacy callers only.
    expected_revision: Annotated[int, Field(strict=True, ge=0)]
    command: str = Field(min_length=1, pattern=r"\S")
    payload: dict[str, JsonValue] = Field(default_factory=dict)


class ReliableActionCommand(ActionCommand):
    command_id: CommandId


class ActionAcknowledgment(BaseModel):
    command_id: CommandId
    status: Literal["accepted", "rejected"]
    revision: int
    detail: str | None = None
