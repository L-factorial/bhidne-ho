"""Canonical data written to the durable game journal."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Any, Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue


PositiveVersion = Annotated[int, Field(strict=True, ge=1)]


class CanonicalGameEvent(BaseModel):
    """An internal authoritative fact, never a client-facing message."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    event_id: UUID
    event_type: str = Field(min_length=1, max_length=100, pattern=r"^[A-Z][A-Z0-9_]*$")
    event_version: PositiveVersion = 1
    payload: dict[str, JsonValue] = Field(default_factory=dict)


class ProposedGameEvent(BaseModel):
    """A fact proposed by game rules before the runtime assigns journal identity."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    event_type: str = Field(min_length=1, max_length=100, pattern=r"^[A-Z][A-Z0-9_]*$")
    event_version: PositiveVersion = 1
    payload: dict[str, JsonValue] = Field(default_factory=dict)


class DurableGameDefinition(Protocol):
    """Pure deterministic hooks required from every durable game engine.

    ``decide`` returns every authoritative transition, including internal ones
    that no client sees. ``project`` may return no messages for such an event;
    persistence and replay never depend on transport visibility.
    """

    game_type: str
    engine_version: int
    event_schema_version: int
    rules_schema_version: int

    def normalize_rules(self, rules: dict[str, JsonValue]) -> dict[str, JsonValue]: ...
    def initial_state(self, rules: dict[str, JsonValue],
                      players: tuple[tuple[str, int], ...] = ()) -> Any: ...
    def decide(self, state: Any, actor_id: str, command: str,
               payload: dict[str, JsonValue]) -> tuple[ProposedGameEvent, ...]: ...
    def reduce(self, state: Any, event: CanonicalGameEvent) -> Any: ...
    def revision(self, state: Any) -> int: ...
    def encode_state(self, state: Any) -> JsonValue: ...
    def decode_state(self, value: JsonValue) -> Any: ...
    def snapshot(self, state: Any, user_id: str) -> dict[str, JsonValue]: ...
    def project(self, event: CanonicalGameEvent) -> tuple[Any, ...]: ...


@dataclass(frozen=True)
class CommittedGameEvent:
    sequence: int
    event: CanonicalGameEvent


@dataclass(frozen=True)
class DurableCommandReceipt:
    command_id: str
    status: Literal["accepted", "rejected"]
    revision: int
    first_sequence: int | None = None
    last_sequence: int | None = None
    rejection_code: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class LoadedDurableGame:
    game_id: UUID
    room_id: str
    status: str
    sequence: int
    revision: int
    ownership_epoch: int
    state: Any
    rules_schema_version: int = 1
    rules: dict[str, JsonValue] = field(default_factory=dict)
    rules_digest: str = ""


@dataclass(frozen=True)
class DurableCommandResult:
    game: LoadedDurableGame
    receipt: DurableCommandReceipt
    events: tuple[CommittedGameEvent, ...]
    duplicate: bool = False


@dataclass(frozen=True)
class GameOwnership:
    game_id: UUID
    owner_instance_id: str
    epoch: int
    fencing_token: str
    lease_expires_at: datetime


@dataclass(frozen=True)
class StartedDurableGame:
    game: LoadedDurableGame
    ownership: GameOwnership | None
    created: bool
