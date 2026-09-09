from typing import Protocol

from app.models.game import GameCommand, GameEvent


class GameCommandRejected(Exception):
    """Expected game-level rejection; detail must be safe to show the client.

    Engines must validate before mutating state when rejecting a command.
    """

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


class GameEngine(Protocol):
    """Pure, synchronous commands in and server events out; no transport or I/O."""

    def handle_command(self, user_id: str, command: GameCommand) -> list[GameEvent]: ...
