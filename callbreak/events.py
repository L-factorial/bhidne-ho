"""Audience is explicit: recipient=None means public, otherwise one player."""

from dataclasses import dataclass

from .game import MatchState


@dataclass(frozen=True)
class Event:
    name: str
    revision: int
    index: int
    data: tuple[tuple[str, object], ...]
    recipient: int | None = None


@dataclass(frozen=True)
class Transition:
    state: MatchState
    events: tuple[Event, ...]
