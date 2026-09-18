"""Durable canonical state transitions for the existing multiplayer engines."""

from copy import deepcopy

from pydantic import JsonValue

from .models import CanonicalGameEvent, ProposedGameEvent


class HostedEngineDefinition:
    """Stores engine-authored JSON states while the existing adapters own rules.

    The host supplies a state only after its engine has validated a command. The
    durable runtime assigns event identity and commits it before client delivery.
    """

    engine_version = event_schema_version = rules_schema_version = 1

    def __init__(self, game_type: str):
        self.game_type = game_type

    def normalize_rules(self, rules: dict[str, JsonValue]):
        return deepcopy(rules)

    def initial_state(self, rules, players=()):
        raise ValueError("The hosted engine must supply its authoritative initial state.")

    def decide(self, state, actor_id, command, payload):
        next_state = payload.get("authoritative_state")
        if not isinstance(next_state, dict):
            raise ValueError("An authoritative engine state is required.")
        if next_state.get("revision") <= state.get("revision"):
            raise ValueError("A committed engine state must advance its revision.")
        return (ProposedGameEvent(event_type="ENGINE_STATE_COMMITTED", payload={"state": next_state}),)

    def reduce(self, state, event: CanonicalGameEvent):
        if event.event_type != "ENGINE_STATE_COMMITTED":
            raise ValueError("Unsupported hosted-engine event.")
        return deepcopy(event.payload["state"])

    def revision(self, state):
        return state["revision"]

    def encode_state(self, state):
        return deepcopy(state)

    def decode_state(self, value):
        return deepcopy(value)

    def snapshot(self, state, user_id):
        return {"engine_state": deepcopy(state)}

    def project(self, event):
        return ()
