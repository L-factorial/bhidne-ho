"""Strict reconstruction shared by recovery code and deterministic tests."""

from collections.abc import Iterable
from typing import Any

from pydantic import JsonValue

from .models import CanonicalGameEvent, DurableGameDefinition


class GameJournalError(ValueError):
    """The stored stream cannot reconstruct an authoritative game."""


def replay(definition: DurableGameDefinition, initial_state: JsonValue,
           events: Iterable[tuple[int, CanonicalGameEvent]]) -> Any:
    state = definition.decode_state(initial_state)
    expected = 1
    for sequence, event in events:
        if sequence != expected:
            raise GameJournalError(
                f"Expected game event sequence {expected}, received {sequence}."
            )
        state = definition.reduce(state, event)
        expected += 1
    return state
