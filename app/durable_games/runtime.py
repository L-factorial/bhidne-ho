"""Transport-independent durable command orchestration."""

from collections.abc import Awaitable, Callable
from copy import deepcopy
from uuid import UUID

from app.models.action import ActionAcknowledgment, ReliableActionCommand
from app.runtime.command_runtime import CommandAccessError, OutgoingEvent

from .models import DurableGameDefinition, LoadedDurableGame

_UNSET = object()


class DurableCommandRuntime:
    """Commit before delivery and recover every response from authoritative state."""

    def __init__(self, store):
        self.store = store

    async def start(self, game_id: UUID, room_id: str, definition: DurableGameDefinition,
                    initial_state=_UNSET, rules=_UNSET):
        arguments = {}
        if initial_state is not _UNSET:
            arguments["initial_state"] = initial_state
        if rules is not _UNSET:
            arguments["rules"] = rules
        return await self.store.create(game_id, room_id, definition, **arguments)

    async def start_owned(self, game_id: UUID, room_id: str, definition: DurableGameDefinition, *,
                          start_command_id: str, owner_instance_id: str, players,
                          initial_state=_UNSET, rules=_UNSET, lease_seconds: int = 30):
        arguments = dict(start_command_id=start_command_id,
                         owner_instance_id=owner_instance_id,
                         players=tuple(players), lease_seconds=lease_seconds)
        if initial_state is _UNSET:
            if rules is _UNSET:
                return await self.store.start(game_id, room_id, definition, **arguments)
            return await self.store.start(game_id, room_id, definition, rules=rules, **arguments)
        if rules is not _UNSET:
            arguments["rules"] = rules
        return await self.store.start(game_id, room_id, definition,
                                      initial_state=initial_state, **arguments)

    async def snapshot(self, game_id: UUID, definition, user_id: str):
        game = await self.store.load(game_id, definition)
        return self._snapshot(game, definition, user_id)

    async def execute(self, game_id: UUID, definition, user_id: str,
                      command: ReliableActionCommand,
                      deliver: Callable[[tuple[OutgoingEvent, ...]], Awaitable[None]], *,
                      ownership):
        if command.match_id not in (str(game_id), game_id.hex):
            raise CommandAccessError(409, "This game is not active. Refresh its state.")
        result = await self.store.execute(
            game_id, definition, actor_id=user_id, command_id=command.command_id,
            expected_revision=command.expected_revision, command=command.command,
            payload=command.payload, ownership=ownership,
        )
        if result.events and not result.duplicate:
            # Projection may be empty. Internal events are already committed and
            # remain part of replay even when clients receive no corresponding
            # public or private message.
            outgoing = tuple(event for committed in result.events
                             for event in definition.project(committed.event))
            await deliver(outgoing)
        snapshot = self._snapshot(result.game, definition, user_id)
        snapshot["action_ack"] = ActionAcknowledgment(
            command_id=result.receipt.command_id,
            status=result.receipt.status,
            revision=result.receipt.revision,
            detail=result.receipt.detail,
        ).model_dump(exclude_none=True)
        return snapshot

    @staticmethod
    def _snapshot(game: LoadedDurableGame, definition, user_id):
        return {
            **deepcopy(definition.snapshot(game.state, user_id)),
            "game_id": str(game.game_id),
            "match_id": str(game.game_id),
            "room_id": game.room_id,
            "status": game.status,
            "rules_schema_version": game.rules_schema_version,
            "rules": deepcopy(game.rules),
            "rules_digest": game.rules_digest,
        }
