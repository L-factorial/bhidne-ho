"""Version 1 adapter-owned protocol, independent of the core command classes.

No sockets, identity lookup, automatic engine calls or broadcasting happen here.
The command/event registries are the authoritative payload and audience catalog.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from card_utils import Card

PlayerId = Annotated[int, Field(strict=True, ge=1, le=5)]
Positive = Annotated[int, Field(strict=True, ge=1)]
Nonnegative = Annotated[int, Field(strict=True, ge=0)]
DealNumber = Annotated[int, Field(strict=True, ge=1, le=5)]
Identifier = Annotated[str, Field(strict=True, min_length=1, max_length=128, pattern=r"\S")]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Empty(Payload):
    pass


class CutPayload(Payload):
    position: Annotated[int, Field(strict=True, ge=1, le=51)]


class BidPayload(Payload):
    amount: Annotated[int, Field(strict=True, ge=1, le=13)]


class CardPayload(Payload):
    card: str

    @field_validator("card")
    @classmethod
    def canonical_card(cls, value: str) -> str:
        Card.parse(value)
        return value


class CommandName(str, Enum):
    SHUFFLE_DECK = "SHUFFLE_DECK"
    CUT_DECK = "CUT_DECK"
    SKIP_CUT = "SKIP_CUT"
    START_DISTRIBUTION = "START_DISTRIBUTION"
    ACCEPT_HAND = "ACCEPT_HAND"
    CLAIM_REDEAL = "CLAIM_REDEAL"
    PLACE_BID = "PLACE_BID"
    PLAY_CARD = "PLAY_CARD"


@dataclass(frozen=True)
class CommandSpec:
    payload: type[Payload]
    actor: str
    engine_command: str | None  # None means a new phase/command must be implemented.


COMMAND_SPECS = {
    CommandName.SHUFFLE_DECK: CommandSpec(Empty, "dealer", "ShuffleDeck"),
    CommandName.CUT_DECK: CommandSpec(CutPayload, "player_after_dealer", "CutDeck"),
    CommandName.SKIP_CUT: CommandSpec(Empty, "player_after_dealer", "SkipCut"),
    CommandName.START_DISTRIBUTION: CommandSpec(Empty, "dealer", "StartDistribution"),
    CommandName.ACCEPT_HAND: CommandSpec(Empty, "reviewing_player", "AcceptHand"),
    CommandName.CLAIM_REDEAL: CommandSpec(Empty, "eligible_reviewing_player", "ClaimRedeal"),
    CommandName.PLACE_BID: CommandSpec(BidPayload, "current_bidder", "PlaceBid"),
    CommandName.PLAY_CARD: CommandSpec(CardPayload, "current_player", "PlayCard"),
}


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    protocol_version: Literal[1] = 1
    match_id: Identifier
    deal_number: DealNumber
    attempt: Positive

    @field_validator("protocol_version", mode="before")
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError("Unsupported protocol version.")
        return value


class PlayerCommand(Envelope):
    """Actor/room/recipient are intentionally absent; use authenticated context."""

    type: Literal["GAME_COMMAND"] = "GAME_COMMAND"
    command_id: Identifier
    expected_revision: Nonnegative
    command: CommandName
    payload: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def check_payload(self):
        COMMAND_SPECS[self.command].payload.model_validate(self.payload)
        return self


def parse_player_command(raw: str | bytes | dict) -> PlayerCommand:
    """Parse the raw request before a generic envelope can discard extra fields."""
    if isinstance(raw, (str, bytes)):
        return PlayerCommand.model_validate_json(raw)
    return PlayerCommand.model_validate(raw)


class ControllerAction(str, Enum):
    """Trusted internal triggers; not members of the client command namespace."""

    PREPARE_DEAL = "PREPARE_DEAL"
    COMPLETE_SHUFFLE = "COMPLETE_SHUFFLE"
    ADVANCE_DISTRIBUTION = "ADVANCE_DISTRIBUTION"


class PlayerPayload(Payload):
    player_id: PlayerId


class DealerPayload(Payload):
    dealer_id: PlayerId


class CutRequestedPayload(PlayerPayload):
    deck_size: Literal[52] = 52


class CutCompletedPayload(Payload):
    cutter_id: PlayerId
    skipped: bool
    position: Annotated[int, Field(strict=True, ge=1, le=51)] | None

    @model_validator(mode="after")
    def check_skip(self):
        if self.skipped != (self.position is None):
            raise ValueError("Skipped cuts require position=null; completed cuts require a position.")
        return self


class DistributionStartedPayload(DealerPayload):
    first_recipient_id: PlayerId
    cards_per_player: Annotated[int, Field(strict=True, ge=10, le=13)]


class CardDistributedPayload(PlayerPayload):
    hand_count: Annotated[int, Field(strict=True, ge=1, le=13)]
    distribution_index: Annotated[int, Field(strict=True, ge=1, le=52)]


class CardDealtPayload(CardDistributedPayload, CardPayload):
    pass


class HandCount(PlayerPayload):
    hand_count: Annotated[int, Field(strict=True, ge=0, le=13)]


class DistributionCompletedPayload(Payload):
    hand_counts: list[HandCount]
    undealt_count: Annotated[int, Field(strict=True, ge=0, le=2)]


Reason = Literal["WEAK_HAND", "NO_SPADES"]


class EligibilityPayload(PlayerPayload):
    reasons: list[Reason]


class HandReviewPayload(EligibilityPayload):
    can_claim_redeal: bool

    @model_validator(mode="after")
    def check_eligibility(self):
        if self.can_claim_redeal != bool(self.reasons):
            raise ValueError("Eligibility and reasons must agree.")
        return self


class BiddingStartedPayload(Payload):
    first_bidder_id: PlayerId
    bidding_order: list[PlayerId]


class BidRequestedPayload(PlayerPayload):
    minimum: Annotated[int, Field(strict=True, ge=1, le=13)]
    maximum: Annotated[int, Field(strict=True, ge=1, le=13)]

    @model_validator(mode="after")
    def check_range(self):
        if self.minimum > self.maximum:
            raise ValueError("Invalid bidding range.")
        return self


class BidPlacedPayload(PlayerPayload, BidPayload):
    pass


class BiddingCompletedPayload(Payload):
    bids: list[BidPlacedPayload]


class PlayStartedPayload(Payload):
    leader_id: PlayerId
    trick_number: Annotated[int, Field(strict=True, ge=1, le=13)]


class PublicPlay(PlayerPayload, CardPayload):
    pass


class CardPlayedPayload(PublicPlay):
    trick_number: Annotated[int, Field(strict=True, ge=1, le=13)]


class TrickCount(PlayerPayload):
    tricks_won: Annotated[int, Field(strict=True, ge=0, le=13)]


class TrickCompletedPayload(Payload):
    trick_number: Annotated[int, Field(strict=True, ge=1, le=13)]
    winner_id: PlayerId
    plays: list[PublicPlay]
    tricks_won: list[TrickCount]


class Score(PlayerPayload):
    score_tenths: Annotated[int, Field(strict=True)]


class DealCompletedPayload(Payload):
    bids: list[BidPlacedPayload]
    tricks_won: list[TrickCount]
    scores: list[Score]
    totals: list[Score]


class MatchCompletedPayload(Payload):
    totals: list[Score]
    winner_ids: list[PlayerId]


AdapterPhase = Literal[
    "AWAITING_SHUFFLE", "SHUFFLING", "AWAITING_CUT", "AWAITING_DISTRIBUTION", "DISTRIBUTING",
    "HAND_REVIEW", "AWAITING_REDEAL", "BIDDING", "PLAYING", "DEAL_COMPLETE", "MATCH_COMPLETE",
]


class TurnChangedPayload(Payload):
    phase: AdapterPhase
    player_id: PlayerId | None


class EventName(str, Enum):
    DEALER_ASSIGNED = "DEALER_ASSIGNED"
    SHUFFLE_REQUESTED = "SHUFFLE_REQUESTED"
    DECK_SHUFFLED = "DECK_SHUFFLED"
    CUT_REQUESTED = "CUT_REQUESTED"
    CUT_COMPLETED = "CUT_COMPLETED"
    DISTRIBUTION_REQUESTED = "DISTRIBUTION_REQUESTED"
    DISTRIBUTION_STARTED = "DISTRIBUTION_STARTED"
    CARD_DEALT = "CARD_DEALT"
    CARD_DISTRIBUTED = "CARD_DISTRIBUTED"
    DISTRIBUTION_COMPLETED = "DISTRIBUTION_COMPLETED"
    HAND_REVIEW_REQUESTED = "HAND_REVIEW_REQUESTED"
    HAND_ACCEPTED = "HAND_ACCEPTED"
    REDEAL_REQUESTED = "REDEAL_REQUESTED"
    REDEAL_ELIGIBLE = "REDEAL_ELIGIBLE"
    BIDDING_STARTED = "BIDDING_STARTED"
    BID_REQUESTED = "BID_REQUESTED"
    BID_PLACED = "BID_PLACED"
    BIDDING_COMPLETED = "BIDDING_COMPLETED"
    PLAY_STARTED = "PLAY_STARTED"
    CARD_PLAYED = "CARD_PLAYED"
    TRICK_COMPLETED = "TRICK_COMPLETED"
    DEAL_COMPLETED = "DEAL_COMPLETED"
    MATCH_COMPLETED = "MATCH_COMPLETED"
    TURN_CHANGED = "TURN_CHANGED"


@dataclass(frozen=True)
class EventSpec:
    payload: type[Payload]
    audience: Literal["broadcast", "unicast"]
    recipient_field: str | None = None


EVENT_SPECS = {
    EventName.DEALER_ASSIGNED: EventSpec(DealerPayload, "broadcast"),
    EventName.SHUFFLE_REQUESTED: EventSpec(DealerPayload, "unicast", "dealer_id"),
    EventName.DECK_SHUFFLED: EventSpec(DealerPayload, "broadcast"),
    EventName.CUT_REQUESTED: EventSpec(CutRequestedPayload, "unicast", "player_id"),
    EventName.CUT_COMPLETED: EventSpec(CutCompletedPayload, "broadcast"),
    EventName.DISTRIBUTION_REQUESTED: EventSpec(DealerPayload, "unicast", "dealer_id"),
    EventName.DISTRIBUTION_STARTED: EventSpec(DistributionStartedPayload, "broadcast"),
    EventName.CARD_DEALT: EventSpec(CardDealtPayload, "unicast", "player_id"),
    EventName.CARD_DISTRIBUTED: EventSpec(CardDistributedPayload, "broadcast"),
    EventName.DISTRIBUTION_COMPLETED: EventSpec(DistributionCompletedPayload, "broadcast"),
    EventName.HAND_REVIEW_REQUESTED: EventSpec(HandReviewPayload, "unicast", "player_id"),
    EventName.HAND_ACCEPTED: EventSpec(PlayerPayload, "broadcast"),
    EventName.REDEAL_REQUESTED: EventSpec(PlayerPayload, "broadcast"),
    EventName.REDEAL_ELIGIBLE: EventSpec(EligibilityPayload, "unicast", "player_id"),
    EventName.BIDDING_STARTED: EventSpec(BiddingStartedPayload, "broadcast"),
    EventName.BID_REQUESTED: EventSpec(BidRequestedPayload, "unicast", "player_id"),
    EventName.BID_PLACED: EventSpec(BidPlacedPayload, "broadcast"),
    EventName.BIDDING_COMPLETED: EventSpec(BiddingCompletedPayload, "broadcast"),
    EventName.PLAY_STARTED: EventSpec(PlayStartedPayload, "broadcast"),
    EventName.CARD_PLAYED: EventSpec(CardPlayedPayload, "broadcast"),
    EventName.TRICK_COMPLETED: EventSpec(TrickCompletedPayload, "broadcast"),
    EventName.DEAL_COMPLETED: EventSpec(DealCompletedPayload, "broadcast"),
    EventName.MATCH_COMPLETED: EventSpec(MatchCompletedPayload, "broadcast"),
    EventName.TURN_CHANGED: EventSpec(TurnChangedPayload, "broadcast"),
}


class OutboundEvent(Envelope):
    type: Literal["GAME_EVENT"] = "GAME_EVENT"
    revision: Nonnegative
    index: Nonnegative
    event: EventName
    payload: dict[str, JsonValue]

    @model_validator(mode="after")
    def check_payload(self):
        EVENT_SPECS[self.event].payload.model_validate(self.payload)
        return self


class RoutedEvent(BaseModel):
    """Server-side delivery instruction, not a client-controlled wire field.

Serialize `message` only. Map recipient_player_id via the trusted match roster;
None broadcasts within that room, a player ID unicasts within that room.
"""

    model_config = ConfigDict(extra="forbid")
    message: OutboundEvent
    recipient_player_id: PlayerId | None = None

    @model_validator(mode="after")
    def check_audience(self):
        spec = EVENT_SPECS[self.message.event]
        if spec.audience == "broadcast":
            if self.recipient_player_id is not None:
                raise ValueError("Broadcast events cannot specify a private recipient.")
        elif (self.recipient_player_id is None or
              self.recipient_player_id != self.message.payload[spec.recipient_field]):
            raise ValueError("Private recipient must match the event's player.")
        return self


class CommandRejected(Envelope):
    """Unicast to the requesting connection; not a successful game event."""

    type: Literal["COMMAND_REJECTED"] = "COMMAND_REJECTED"
    command_id: Identifier
    current_revision: Nonnegative
    code: Identifier
    detail: Annotated[str, Field(strict=True, min_length=1, max_length=512)]
