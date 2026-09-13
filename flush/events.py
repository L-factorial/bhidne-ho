"""Immutable domain events; card identities are only carried by legal shows."""
from dataclasses import dataclass
from card_utils import Card


@dataclass(frozen=True)
class ShownHand:
    player_id: str
    cards: tuple[Card, ...]

    def __post_init__(self):
        object.__setattr__(self, 'cards', tuple(self.cards))


@dataclass(frozen=True)
class DomainEvent:
    sequence: int
    revision: int
    kind: str
    player_id: str | None = None
    amount: int = 0
    winner_ids: tuple[str, ...] = ()
    shown_hands: tuple[ShownHand, ...] = ()
    target_player_id: str | None = None
    loser_player_id: str | None = None

    def __post_init__(self):
        object.__setattr__(self, 'winner_ids', tuple(self.winner_ids))
        object.__setattr__(self, 'shown_hands', tuple(self.shown_hands))


@dataclass(frozen=True)
class ActionResult:
    revision: int
    events: tuple[DomainEvent, ...]

    def __post_init__(self):
        object.__setattr__(self, 'events', tuple(self.events))
