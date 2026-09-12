"""Authoritative Marriage V1 wire command/event catalog; no game rules or delivery."""
from dataclasses import dataclass
from enum import Enum
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, field_validator, model_validator

from marriage import (AllowedActions, Capability, MaalView, Meld, PhysicalCard,
                      PlayerView, VisibleEvent, create_deck)
from marriage.scoring import RoundScore

Identifier = Annotated[str, Field(strict=True, min_length=1, max_length=128, pattern=r"\S")]
Nonnegative = Annotated[int, Field(strict=True, ge=0)]
_CARD_IDS = frozenset(c.card_id for c in create_deck())


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Empty(Payload):
    pass


class DrawPayload(Payload):
    source: Literal["stock", "discard"]


class CardPayload(Payload):
    card_id: str

    @field_validator("card_id")
    @classmethod
    def physical_id(cls, value):
        if value not in _CARD_IDS:
            raise ValueError("Unknown physical card ID.")
        return value


class MeldPayload(Payload):
    meld_type: Literal["pure_sequence", "tunnela", "dublee"]
    card_ids: Annotated[list[str], Field(min_length=2, max_length=22)]

    @field_validator("card_ids")
    @classmethod
    def physical_ids(cls, values):
        if len(set(values)) != len(values) or any(i not in _CARD_IDS for i in values):
            raise ValueError("Meld IDs must be distinct canonical physical cards.")
        return values


class ValidateMeldPayload(Payload):
    meld: MeldPayload


class InitialMeldsPayload(Payload):
    melds: Annotated[list[MeldPayload], Field(min_length=3, max_length=3)]


class DubleesPayload(Payload):
    pairs: Annotated[list[MeldPayload], Field(min_length=7, max_length=7)]


class EventsPayload(Payload):
    after_sequence: Nonnegative = 0


class CommandName(str, Enum):
    START_GAME = "START_GAME"
    DRAW_CARD = "DRAW_CARD"
    DISCARD_CARD = "DISCARD_CARD"
    SHOW_INITIAL_MELDS = "SHOW_INITIAL_MELDS"
    SHOW_DUBLEES = "SHOW_DUBLEES"
    FINISH = "FINISH"
    VALIDATE_MELD = "VALIDATE_MELD"
    VALIDATE_INITIAL_MELDS = "VALIDATE_INITIAL_MELDS"
    VALIDATE_DUBLEES = "VALIDATE_DUBLEES"
    GET_STATE = "GET_STATE"
    GET_ALLOWED_ACTIONS = "GET_ALLOWED_ACTIONS"
    GET_MAAL = "GET_MAAL"
    CAN_SEE_MAAL = "CAN_SEE_MAAL"
    READ_LAST_CARD = "READ_LAST_CARD"
    HAS_EIGHTH_DUBLEE = "HAS_EIGHTH_DUBLEE"
    CAN_FINISH_NORMAL_HAND = "CAN_FINISH_NORMAL_HAND"
    GET_EVENTS = "GET_EVENTS"
    GET_SCORES = "GET_SCORES"


@dataclass(frozen=True)
class CommandSpec:
    payload: type[Payload]
    engine_method: str
    actor: str
    mutates: bool


COMMAND_SPECS = {
    CommandName.GET_SCORES: CommandSpec(Empty, "get_scores", "seated_player", False),
    CommandName.START_GAME: CommandSpec(Empty, "start_game", "owner", True),
    CommandName.DRAW_CARD: CommandSpec(DrawPayload, "draw_card", "current_player", True),
    CommandName.DISCARD_CARD: CommandSpec(CardPayload, "discard_card", "current_player", True),
    CommandName.SHOW_INITIAL_MELDS: CommandSpec(InitialMeldsPayload, "show_initial_melds", "current_player", True),
    CommandName.SHOW_DUBLEES: CommandSpec(DubleesPayload, "show_dublees", "current_player", True),
    CommandName.FINISH: CommandSpec(Empty, "finish", "current_player", True),
    CommandName.VALIDATE_MELD: CommandSpec(ValidateMeldPayload, "validate_meld", "seated_player", False),
    CommandName.VALIDATE_INITIAL_MELDS: CommandSpec(InitialMeldsPayload, "validate_initial_melds", "seated_player", False),
    CommandName.VALIDATE_DUBLEES: CommandSpec(DubleesPayload, "validate_dublees", "seated_player", False),
    CommandName.GET_STATE: CommandSpec(Empty, "get_player_view", "seated_player", False),
    CommandName.GET_ALLOWED_ACTIONS: CommandSpec(Empty, "get_allowed_actions", "seated_player", False),
    CommandName.GET_MAAL: CommandSpec(Empty, "get_maal", "seated_player", False),
    CommandName.CAN_SEE_MAAL: CommandSpec(Empty, "can_see_maal", "seated_player", False),
    CommandName.READ_LAST_CARD: CommandSpec(Empty, "read_last_card", "seated_player", False),
    CommandName.HAS_EIGHTH_DUBLEE: CommandSpec(Empty, "has_eighth_dublee", "seated_player", False),
    CommandName.CAN_FINISH_NORMAL_HAND: CommandSpec(Empty, "can_finish_normal_hand", "seated_player", False),
    CommandName.GET_EVENTS: CommandSpec(EventsPayload, "get_player_events", "seated_player", False),
}


class PlayerCommand(BaseModel):
    """No actor/room/recipient fields: identity comes from authenticated host context."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["GAME_COMMAND"] = "GAME_COMMAND"
    protocol_version: Literal[1] = 1
    match_id: Identifier
    command_id: Identifier
    expected_revision: Nonnegative
    command: CommandName
    payload: dict[str, JsonValue] = Field(default_factory=dict)

    @field_validator("protocol_version", mode="before")
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError("Unsupported protocol version.")
        return value

    @model_validator(mode="after")
    def valid_payload(self):
        COMMAND_SPECS[self.command].payload.model_validate(self.payload)
        return self


def parse_player_command(raw: str | bytes | dict) -> PlayerCommand:
    return PlayerCommand.model_validate_json(raw) if isinstance(raw, (str, bytes)) else PlayerCommand.model_validate(raw)


class DomainPayload(Payload):
    event: VisibleEvent


class StatePayload(Payload):
    player_id: Identifier
    view: PlayerView

    @model_validator(mode="after")
    def same_seat(self):
        if self.player_id != self.view.player_id:
            raise ValueError("State must belong to its recipient.")
        return self


class QueryPayload(Payload):
    player_id: Identifier
    command_id: Identifier
    command: CommandName
    result: JsonValue

    @model_validator(mode="after")
    def result_shape(self):
        result_types = {
            CommandName.GET_SCORES: RoundScore | None,
            CommandName.VALIDATE_MELD: Meld,
            CommandName.VALIDATE_INITIAL_MELDS: tuple[Meld, ...],
            CommandName.VALIDATE_DUBLEES: tuple[Meld, ...],
            CommandName.GET_STATE: PlayerView,
            CommandName.GET_ALLOWED_ACTIONS: AllowedActions,
            CommandName.GET_MAAL: MaalView | None,
            CommandName.CAN_SEE_MAAL: bool,
            CommandName.READ_LAST_CARD: PhysicalCard | None,
            CommandName.HAS_EIGHTH_DUBLEE: bool,
            CommandName.CAN_FINISH_NORMAL_HAND: Capability,
            CommandName.GET_EVENTS: tuple[VisibleEvent, ...],
        }
        if self.command not in result_types:
            raise ValueError("Mutation commands cannot produce query results.")
        schema = TypeAdapter(result_types[self.command])
        value = schema.validate_json(json.dumps(self.result), strict=True)
        if schema.dump_python(value, mode="json") != self.result:
            raise ValueError("Query result must match the exact declared schema.")
        if self.command is CommandName.GET_STATE and value.player_id != self.player_id:
            raise ValueError("Query state must belong to its recipient.")
        return self


class EventName(str, Enum):
    GAME_STARTED = "GAME_STARTED"
    TURN_CHANGED = "TURN_CHANGED"
    DISCARD_PILE_RECYCLED = "DISCARD_PILE_RECYCLED"
    CARD_DRAWN = "CARD_DRAWN"
    CARD_DISCARDED = "CARD_DISCARDED"
    MELDS_SHOWN = "MELDS_SHOWN"
    SEVEN_DUBLEES_SHOWN = "SEVEN_DUBLEES_SHOWN"
    TIPLU_REVEALED = "TIPLU_REVEALED"
    PLAYER_SAW_MAAL = "PLAYER_SAW_MAAL"
    PLAYER_FINISHED = "PLAYER_FINISHED"
    PLAYER_STATE = "PLAYER_STATE"
    QUERY_RESULT = "QUERY_RESULT"


@dataclass(frozen=True)
class EventSpec:
    payload: type[Payload]
    audience: Literal["broadcast", "unicast"]


EVENT_SPECS = {name: EventSpec(DomainPayload, "broadcast") for name in EventName
               if name not in (EventName.PLAYER_STATE, EventName.QUERY_RESULT)}
EVENT_SPECS[EventName.PLAYER_STATE] = EventSpec(StatePayload, "unicast")
EVENT_SPECS[EventName.QUERY_RESULT] = EventSpec(QueryPayload, "unicast")


class OutboundEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["GAME_EVENT"] = "GAME_EVENT"
    protocol_version: Literal[1] = 1
    game_type: Literal["marriage"] = "marriage"
    match_id: Identifier
    revision: Nonnegative
    index: Nonnegative
    event: EventName
    payload: dict[str, JsonValue]

    @model_validator(mode="after")
    def valid_payload(self):
        parsed = EVENT_SPECS[self.event].payload.model_validate_json(json.dumps(self.payload))
        if parsed.model_dump(mode="json") != self.payload:
            raise ValueError("Event payload must match the exact declared schema.")
        if isinstance(parsed, DomainPayload):
            event = parsed.event
            if event.kind != self.event.value or event.revision != self.revision:
                raise ValueError("Domain event identity/revision mismatch.")
            if event.kind == "CARD_DRAWN" and event.source is None:
                raise ValueError("Draw event requires its source.")
            if (event.kind == "TIPLU_REVEALED" or
                    (event.kind == "CARD_DRAWN" and event.source.value == "stock")) and event.card is not None:
                raise ValueError("Broadcast must redact hidden cards.")
            permitted = {
                "GAME_STARTED": {"player_ids", "card_count"},
                "TURN_CHANGED": {"player_id", "phase"},
                "DISCARD_PILE_RECYCLED": {"card_count"},
                "CARD_DRAWN": {"player_id", "source", "card"},
                "CARD_DISCARDED": {"player_id", "card"},
                "MELDS_SHOWN": {"player_id", "route", "meld_types", "card_groups"},
                "SEVEN_DUBLEES_SHOWN": {"player_id", "route", "meld_types", "card_groups"},
                "TIPLU_REVEALED": set(), "PLAYER_SAW_MAAL": {"player_id"},
                "PLAYER_FINISHED": {"player_id", "winning_pair"},
            }[event.kind] | {"sequence", "revision", "kind"}
            if any(value not in (None, [], ()) for key, value in self.payload["event"].items() if key not in permitted):
                raise ValueError("Event contains fields outside its public audience contract.")
        return self


class RoutedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: OutboundEvent
    recipient_player_id: Identifier | None = None

    @model_validator(mode="after")
    def audience(self):
        spec = EVENT_SPECS[self.message.event]
        if spec.audience == "broadcast":
            if self.recipient_player_id is not None:
                raise ValueError("Broadcast cannot specify a recipient.")
        elif self.recipient_player_id is None or self.recipient_player_id != self.message.payload["player_id"]:
            raise ValueError("Private recipient must match the payload seat.")
        return self


class CommandRejected(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["COMMAND_REJECTED"] = "COMMAND_REJECTED"
    match_id: Identifier
    command_id: Identifier
    current_revision: Nonnegative
    code: Identifier
    detail: str
