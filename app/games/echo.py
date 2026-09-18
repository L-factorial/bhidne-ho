from dataclasses import dataclass

from app.durable_games.models import CanonicalGameEvent, ProposedGameEvent
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


@dataclass(frozen=True)
class EchoState:
    command_count: int = 0


class DurableEchoGame:
    """Reference implementation of the durable decide/reduce contract."""

    game_type = "echo"
    engine_version = 1
    event_schema_version = 1
    rules_schema_version = 1

    def normalize_rules(self, rules):
        if rules:
            raise ValueError("Echo does not define configurable rules.")
        return {}

    def initial_state(self, rules=None, players=()) -> EchoState:
        self.normalize_rules(rules or {})
        return EchoState()

    def decide(self, state: EchoState, actor_id: str, command: str, payload):
        if command != "PING":
            raise GameCommandRejected("UNKNOWN_COMMAND", "This test engine supports PING.")
        message = payload.get("message", "")
        if not isinstance(message, str):
            raise GameCommandRejected("INVALID_PAYLOAD", "PING message must be a string.")
        return (ProposedGameEvent(event_type="PING_ACCEPTED", payload={
            "actor_id": actor_id,
            "message": message,
            "command_count": state.command_count + 1,
        }),)

    def reduce(self, state: EchoState, event: CanonicalGameEvent) -> EchoState:
        if event.event_version != self.event_schema_version or event.event_type != "PING_ACCEPTED":
            raise ValueError("Unsupported Echo event.")
        count = event.payload.get("command_count")
        if type(count) is not int or count != state.command_count + 1:
            raise ValueError("Echo event command count is not contiguous.")
        if not isinstance(event.payload.get("actor_id"), str):
            raise ValueError("Echo event actor is invalid.")
        if not isinstance(event.payload.get("message"), str):
            raise ValueError("Echo event message is invalid.")
        return EchoState(count)

    def revision(self, state: EchoState) -> int:
        return state.command_count

    def encode_state(self, state: EchoState):
        return {"command_count": state.command_count}

    def decode_state(self, value):
        if not isinstance(value, dict) or set(value) != {"command_count"}:
            raise ValueError("Invalid Echo initial state.")
        count = value["command_count"]
        if type(count) is not int or count < 0:
            raise ValueError("Invalid Echo command count.")
        return EchoState(count)

    def snapshot(self, state: EchoState, user_id: str):
        return {"game": {"revision": state.command_count,
                         "command_count": state.command_count}}

    def project(self, event: CanonicalGameEvent):
        return (OutgoingEvent({"event": "PONG", "payload": {
            "message": event.payload["message"],
            "player_id": event.payload["actor_id"],
            "sequence": event.payload["command_count"],
        }}),)

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
