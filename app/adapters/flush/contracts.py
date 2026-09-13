"""Flush command/event catalog. No actor IDs in player-supplied payloads."""
from dataclasses import dataclass
from enum import Enum
import json
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, field_validator, model_validator
from flush import PlayerView, AllowedActions, Eligibility, VisibleEvent

Identifier = Annotated[str, Field(strict=True, min_length=1, max_length=128, pattern=r'\S')]
Nonnegative = Annotated[int, Field(strict=True, ge=0)]


class Payload(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Empty(Payload):
    pass


class BetPayload(Payload):
    amount: Annotated[int, Field(strict=True, gt=0)]


class CutPayload(Payload):
    position: Annotated[int, Field(strict=True, ge=1, le=51)]


class EventsPayload(Payload):
    after_sequence: Nonnegative = 0


class CommandName(str, Enum):
    DEAL_CARDS = 'DEAL_CARDS'
    CUT_DECK = 'CUT_DECK'
    SKIP_CUT = 'SKIP_CUT'
    START_NEXT_ROUND = 'START_NEXT_ROUND'
    START_GAME = 'START_GAME'
    BET = 'BET'
    SEE_CARDS = 'SEE_CARDS'
    FOLD = 'FOLD'
    SHOW = 'SHOW'
    REVEAL_CARDS = 'REVEAL_CARDS'
    REQUEST_SIDE_SHOW = 'REQUEST_SIDE_SHOW'
    ACCEPT_SIDE_SHOW = 'ACCEPT_SIDE_SHOW'
    DECLINE_SIDE_SHOW = 'DECLINE_SIDE_SHOW'
    CAN_SIDE_SHOW = 'CAN_SIDE_SHOW'
    GET_STATE = 'GET_STATE'
    GET_ALLOWED_ACTIONS = 'GET_ALLOWED_ACTIONS'
    CAN_SEE_CARDS = 'CAN_SEE_CARDS'
    CAN_SHOW = 'CAN_SHOW'
    GET_EVENTS = 'GET_EVENTS'


@dataclass(frozen=True)
class CommandSpec:
    payload: type[Payload]
    engine_method: str
    mutates: bool


COMMAND_SPECS = {
    CommandName.REVEAL_CARDS: CommandSpec(Empty, 'reveal_cards', True),
    CommandName.START_NEXT_ROUND: CommandSpec(Empty, 'start_next_round', True),
    CommandName.DEAL_CARDS: CommandSpec(Empty, 'deal_cards', True),
    CommandName.CUT_DECK: CommandSpec(CutPayload, 'cut_deck', True),
    CommandName.SKIP_CUT: CommandSpec(Empty, 'skip_cut', True),
    CommandName.REQUEST_SIDE_SHOW: CommandSpec(Empty, 'request_side_show', True),
    CommandName.ACCEPT_SIDE_SHOW: CommandSpec(Empty, 'accept_side_show', True),
    CommandName.DECLINE_SIDE_SHOW: CommandSpec(Empty, 'decline_side_show', True),
    CommandName.CAN_SIDE_SHOW: CommandSpec(Empty, 'can_side_show', False),
    CommandName.START_GAME: CommandSpec(Empty, 'start_game', True),
    CommandName.BET: CommandSpec(BetPayload, 'bet', True),
    CommandName.SEE_CARDS: CommandSpec(Empty, 'see_cards', True),
    CommandName.FOLD: CommandSpec(Empty, 'fold', True),
    CommandName.SHOW: CommandSpec(Empty, 'show', True),
    CommandName.GET_STATE: CommandSpec(Empty, 'get_player_view', False),
    CommandName.GET_ALLOWED_ACTIONS: CommandSpec(Empty, 'get_allowed_actions', False),
    CommandName.CAN_SEE_CARDS: CommandSpec(Empty, 'can_see_cards', False),
    CommandName.CAN_SHOW: CommandSpec(Empty, 'can_show', False),
    CommandName.GET_EVENTS: CommandSpec(EventsPayload, 'get_visible_events', False),
}


class PlayerCommand(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['GAME_COMMAND'] = 'GAME_COMMAND'
    protocol_version: Literal[1] = 1
    match_id: Identifier
    command_id: Identifier
    expected_revision: Nonnegative
    command: CommandName
    payload: dict[str, JsonValue] = Field(default_factory=dict)

    @field_validator('protocol_version', mode='before')
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError('Unsupported protocol version.')
        return value

    @model_validator(mode='after')
    def valid_payload(self):
        COMMAND_SPECS[self.command].payload.model_validate(self.payload)
        return self


def parse_player_command(raw):
    return PlayerCommand.model_validate_json(raw) if isinstance(raw, (str, bytes)) else PlayerCommand.model_validate(raw)


class DomainPayload(Payload):
    event: VisibleEvent


class StatePayload(Payload):
    player_id: Identifier
    view: PlayerView

    @model_validator(mode='after')
    def same_seat(self):
        if self.player_id != self.view.player_id:
            raise ValueError('State must belong to its recipient.')
        return self


class QueryPayload(Payload):
    player_id: Identifier
    command_id: Identifier
    command: CommandName
    result: JsonValue

    @model_validator(mode='after')
    def result_shape(self):
        types = {CommandName.GET_STATE: PlayerView, CommandName.GET_ALLOWED_ACTIONS: AllowedActions,
                 CommandName.CAN_SIDE_SHOW: Eligibility, CommandName.CAN_SEE_CARDS: Eligibility, CommandName.CAN_SHOW: Eligibility,
                 CommandName.GET_EVENTS: tuple[VisibleEvent, ...]}
        if self.command not in types:
            raise ValueError('Only queries may return query results.')
        schema = TypeAdapter(types[self.command])
        value = schema.validate_json(json.dumps(self.result), strict=True)
        if schema.dump_python(value, mode='json') != self.result:
            raise ValueError('Query result must match its exact schema.')
        if self.command is CommandName.GET_STATE and value.player_id != self.player_id:
            raise ValueError('Query state must belong to its recipient.')
        return self


class EventName(str, Enum):
    ROUND_STARTED = 'ROUND_STARTED'
    DEAL_REQUESTED = 'DEAL_REQUESTED'
    DECK_CUT = 'DECK_CUT'
    CUT_SKIPPED = 'CUT_SKIPPED'
    CARDS_DEALT = 'CARDS_DEALT'
    GAME_STARTED = 'GAME_STARTED'
    BOOT_COLLECTED = 'BOOT_COLLECTED'
    TURN_CHANGED = 'TURN_CHANGED'
    BET_PLACED = 'BET_PLACED'
    CARDS_SEEN = 'CARDS_SEEN'
    PLAYER_FOLDED = 'PLAYER_FOLDED'
    SHOW_REQUESTED = 'SHOW_REQUESTED'
    ROUND_FINISHED = 'ROUND_FINISHED'
    SIDE_SHOW_REQUESTED = 'SIDE_SHOW_REQUESTED'
    SIDE_SHOW_DECLINED = 'SIDE_SHOW_DECLINED'
    SIDE_SHOW_RESOLVED = 'SIDE_SHOW_RESOLVED'
    PLAYER_STATE = 'PLAYER_STATE'
    QUERY_RESULT = 'QUERY_RESULT'


class OutboundEvent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['GAME_EVENT'] = 'GAME_EVENT'
    protocol_version: Literal[1] = 1
    game_type: Literal['flush'] = 'flush'
    match_id: Identifier
    revision: Nonnegative
    index: Nonnegative
    event: EventName
    payload: dict[str, JsonValue]

    @model_validator(mode='after')
    def valid_payload(self):
        schema = StatePayload if self.event is EventName.PLAYER_STATE else QueryPayload if self.event is EventName.QUERY_RESULT else DomainPayload
        parsed = schema.model_validate_json(json.dumps(self.payload))
        if parsed.model_dump(mode='json') != self.payload:
            raise ValueError('Event payload must match its exact schema.')
        if isinstance(parsed, DomainPayload):
            e = parsed.event
            if e.kind != self.event.value or e.revision != self.revision:
                raise ValueError('Domain identity/revision mismatch.')
            if self.event is EventName.SHOW_REQUESTED and (len(e.shown_hands) != 1 or e.shown_hands[0][0] != e.player_id):
                raise ValueError('Final show reveals only the requester hand.')
            if (self.event not in (EventName.ROUND_FINISHED, EventName.SHOW_REQUESTED) and e.shown_hands) or (self.event not in (EventName.ROUND_FINISHED, EventName.SIDE_SHOW_RESOLVED) and e.winner_ids):
                raise ValueError('Only a finished round can publish shown hands or winners.')
        return self


class RoutedEvent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    message: OutboundEvent
    recipient_player_id: Identifier | None = None

    @model_validator(mode='after')
    def audience(self):
        private = self.message.event in (EventName.PLAYER_STATE, EventName.QUERY_RESULT)
        if private:
            if self.recipient_player_id is None or self.recipient_player_id != self.message.payload['player_id']:
                raise ValueError('Private recipient must match payload seat.')
        elif self.recipient_player_id is not None:
            raise ValueError('Broadcast cannot specify a recipient.')
        return self


class CommandRejected(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['COMMAND_REJECTED'] = 'COMMAND_REJECTED'
    match_id: Identifier
    command_id: Identifier
    current_revision: Nonnegative
    code: Identifier
    detail: str
