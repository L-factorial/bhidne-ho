from app.games.base import GameCommandRejected
from app.models.game import GameCommand, GameEvent
from app.runtime.command_runtime import OutgoingEvent


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


class EchoCommandTarget:
    """Minimal example adapter: rules/state only, no retry or receipt logic."""

    def __init__(self, engine: EchoGameEngine):
        self.engine = engine

    def authorize(self, user_id):
        # All authenticated room members may ping; membership is checked by HTTP.
        pass

    @property
    def revision(self):
        return self.engine.command_count

    def checkpoint(self):
        return self.engine.command_count

    def restore(self, checkpoint):
        self.engine.command_count = checkpoint

    def apply(self, user_id, command):
        events = self.engine.handle_command(user_id, GameCommand(command=command.command, payload=command.payload))
        return [OutgoingEvent(event.model_dump(mode="json")) for event in events]

    def snapshot(self, user_id):
        return {"game": {"revision": self.revision, "command_count": self.engine.command_count}}
