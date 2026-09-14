"""Synchronous game departure hooks called once per held membership under its lock."""
from typing import Protocol

from app.runtime.command_runtime import OutgoingEvent


class PlayerDeparture(Protocol):
    def handle_player_leave(self, user_id: str) -> list[OutgoingEvent]: ...


class WaitingGameDeparture:
    def handle_player_leave(self, user_id: str) -> list[OutgoingEvent]:
        return []  # There is no engine state before the game starts.
