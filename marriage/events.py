"""Immutable domain records. History is trusted data, not a broadcast API."""
from dataclasses import dataclass, field
from typing import TypeAlias

from .enums import DrawSource, MeldType, QualificationRoute, TurnPhase
from .cards import PhysicalCard


@dataclass(frozen=True)
class GameStarted:
    sequence: int
    revision: int
    player_ids: tuple[str, ...]
    cards_per_player: int
    kind: str = field(default="GAME_STARTED", init=False)

    def __post_init__(self):
        object.__setattr__(self, "player_ids", tuple(self.player_ids))


@dataclass(frozen=True)
class TurnChanged:
    sequence: int
    revision: int
    player_id: str
    phase: TurnPhase
    kind: str = field(default="TURN_CHANGED", init=False)


@dataclass(frozen=True)
class DiscardPileRecycled:
    sequence: int
    revision: int
    card_count: int
    kind: str = field(default="DISCARD_PILE_RECYCLED", init=False)


@dataclass(frozen=True)
class CardDrawn:
    """Trusted event: stock card identity must not be broadcast to opponents."""
    sequence: int
    revision: int
    player_id: str
    source: DrawSource
    card: PhysicalCard
    kind: str = field(default="CARD_DRAWN", init=False)


@dataclass(frozen=True)
class CardDiscarded:
    sequence: int
    revision: int
    player_id: str
    card: PhysicalCard
    kind: str = field(default="CARD_DISCARDED", init=False)


@dataclass(frozen=True)
class MeldsShown:
    sequence: int
    revision: int
    player_id: str
    route: QualificationRoute
    meld_types: tuple[MeldType, ...]
    card_groups: tuple[tuple[str, ...], ...]

    def __post_init__(self):
        object.__setattr__(self, "meld_types", tuple(self.meld_types))
        object.__setattr__(self, "card_groups", tuple(tuple(group) for group in self.card_groups))

    @property
    def kind(self) -> str:
        return "SEVEN_DUBLEES_SHOWN" if self.route is QualificationRoute.DUBLEE else "MELDS_SHOWN"


@dataclass(frozen=True)
class TipluRevealed:
    sequence: int
    revision: int
    card: PhysicalCard
    kind: str = field(default="TIPLU_REVEALED", init=False)


@dataclass(frozen=True)
class PlayerSawMaal:
    sequence: int
    revision: int
    player_id: str
    kind: str = field(default="PLAYER_SAW_MAAL", init=False)


@dataclass(frozen=True)
class PlayerFinished:
    sequence: int
    revision: int
    player_id: str
    winning_pair: tuple[str, ...]
    kind: str = field(default="PLAYER_FINISHED", init=False)

    def __post_init__(self):
        object.__setattr__(self, "winning_pair", tuple(self.winning_pair))


DomainEvent: TypeAlias = (GameStarted | TurnChanged | DiscardPileRecycled | CardDrawn | CardDiscarded
                         | MeldsShown | TipluRevealed | PlayerSawMaal | PlayerFinished)


@dataclass(frozen=True)
class ActionResult:
    revision: int
    events: tuple[DomainEvent, ...]

    def __post_init__(self):
        object.__setattr__(self, "events", tuple(self.events))
