"""Transport-independent, in-memory command transactions shared by every game."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from app.games.base import GameCommandRejected
from app.models.action import ActionAcknowledgment, ActionCommand


class CommandAccessError(Exception):
    """Safe failure before execution/receipt creation, mapped by the transport."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


@dataclass(frozen=True)
class OutgoingEvent:
    message: dict
    recipient: str | None = None  # None broadcasts; otherwise authenticated user ID.


@dataclass
class CommandSession:
    """One lifecycle per match; all mutations, including timers, use this lock."""

    match_id: str = field(default_factory=lambda: uuid4().hex)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    receipt_limit: int = 10000
    receipts: dict[tuple[str, str], tuple[str, dict]] = field(default_factory=dict)


class CommandTarget(Protocol):
    """Hooks MUST be synchronous and perform no delivery or external side effects.

    A checkpoint must restore everything apply() can mutate. Snapshots must be
    detached, JSON-compatible, and filtered for the authenticated viewer.
    """

    def authorize(self, user_id: str) -> None: ...
    @property
    def revision(self) -> int: ...
    def checkpoint(self) -> Any: ...
    def restore(self, checkpoint: Any) -> None: ...
    def apply(self, user_id: str, command: ActionCommand) -> list[OutgoingEvent]: ...
    def snapshot(self, user_id: str) -> dict: ...


class CommandRuntime:
    async def snapshot(self, session: CommandSession, target: CommandTarget, user_id: str) -> dict:
        async with session.lock:
            target.authorize(user_id)
            return self._snapshot(session, target, user_id)

    def _snapshot(self, session, target, user_id):
        return {**deepcopy(target.snapshot(user_id)), "match_id": session.match_id}

    async def execute(self, session: CommandSession, target: CommandTarget, user_id: str,
                      command: ActionCommand,
                      deliver: Callable[[list[OutgoingEvent]], Awaitable[None]]) -> dict:
        async with session.lock:
            if command.match_id != session.match_id:
                raise CommandAccessError(409, "This game is not active. Refresh its state.")
            target.authorize(user_id)
            key = (user_id, command.command_id)
            fingerprint = json.dumps(command.model_dump(mode="json", exclude={"command_id"}), sort_keys=True)
            if command.command_id and key in session.receipts:
                original, receipt = session.receipts[key]
                if original != fingerprint:
                    raise CommandAccessError(409, "Command ID already used for a different request.")
                return {**self._snapshot(session, target, user_id), "action_ack": dict(receipt)}
            if command.command_id and len(session.receipts) >= session.receipt_limit:
                raise CommandAccessError(409, "This match has reached its command receipt limit.")

            checkpoint = target.checkpoint()
            try:
                if command.expected_revision != target.revision:
                    raise GameCommandRejected("STALE_REVISION", "The turn changed. Your view has been refreshed; try again.")
                events = target.apply(user_id, command)
                # Validate serialization before committing, while rollback is possible.
                for event in events:
                    json.dumps(event.message, allow_nan=False)
                receipt = (ActionAcknowledgment(command_id=command.command_id, status="accepted",
                    revision=target.revision).model_dump(exclude_none=True) if command.command_id else None)
            except GameCommandRejected as error:
                target.restore(checkpoint)
                if not command.command_id:
                    raise
                receipt = ActionAcknowledgment(command_id=command.command_id, status="rejected",
                    revision=target.revision, detail=error.detail).model_dump(exclude_none=True)
                events = []
            except Exception:
                target.restore(checkpoint)
                raise
            if command.command_id:
                session.receipts[key] = (fingerprint, receipt)
            # First possible yield after applying state: the outcome is now recorded.
            # Retain the lock through delivery so batches remain ordered per match.
            await deliver(events)
            snapshot = self._snapshot(session, target, user_id)
            if receipt is not None:
                snapshot["action_ack"] = dict(receipt)
            return snapshot
