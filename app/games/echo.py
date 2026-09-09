from app.games.base import GameCommandRejected
from app.models.game import GameCommand, GameEvent


class EchoGameEngine:
    """Milestone 2 test engine only; no real game rules."""

    def __init__(self) -> None:
        self.command_count = 0

    def handle_command(self, user_id: str, command: GameCommand) -> list[GameEvent]:
        if command.command != "PING":
            raise GameCommandRejected("UNKNOWN_COMMAND", "This test engine supports PING.")
        message = command.payload.get("message", "")
        if not isinstance(message, str):
            raise GameCommandRejected("INVALID_PAYLOAD", "PING message must be a string.")
        self.command_count += 1
        return [GameEvent(event="PONG", payload={
            "message": message, "player_id": user_id, "sequence": self.command_count,
        })]
