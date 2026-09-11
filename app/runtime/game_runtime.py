import logging

from app.games.base import GameCommandRejected
from app.models.game import CommandError, GameCommand
from app.models.messages import ClientMessage, ServerMessage
from app.multiplayer.broadcaster import Broadcaster
from app.runtime.game_registry import GameRegistry
from app.runtime.command_runtime import CommandAccessError, CommandRuntime

logger = logging.getLogger(__name__)


class GameRuntime:
    def __init__(self, broadcaster: Broadcaster, game_registry: GameRegistry | None = None) -> None:
        self._broadcaster = broadcaster
        self._registry = game_registry if game_registry is not None else GameRegistry()
        self.commands = CommandRuntime()

    def _command_game(self, room_id):
        game = self._registry.get_room(room_id)
        if game is None:
            raise CommandAccessError(404, "No game engine is registered for this room.")
        if game.command_target is None:
            raise CommandAccessError(409, "This engine has no shared command adapter.")
        return game

    async def snapshot(self, room_id, user_id):
        game = self._command_game(room_id)
        return await self.commands.snapshot(game.commands, game.command_target, user_id)

    async def action(self, room_id, user_id, command):
        game = self._command_game(room_id)

        async def deliver(events):
            for event in events:
                if event.recipient is None:
                    await self._broadcaster.broadcast(room_id, event.message)
                else:
                    await self._broadcaster.send_to_room_user(room_id, event.recipient, event.message)

        return await self.commands.execute(game.commands, game.command_target, user_id, command, deliver)

    async def handle(
        self, room_id: str, user_id: str, command: GameCommand | ClientMessage,
    ) -> CommandError | None:
        # Preserve the Milestone 1 message relay contract.
        if isinstance(command, ClientMessage):
            event = ServerMessage(sender_id=user_id, payload=command.payload)
            await self._broadcaster.broadcast(
                room_id, event.model_dump(mode="json"), exclude_user_id=user_id,
            )
            return None

        game = self._registry.get_room(room_id)
        if game is None:
            return CommandError(category="infrastructure", code="ENGINE_NOT_FOUND",
                                detail="No game engine is registered for this room.")
        # Include delivery in the critical section so event batches cannot interleave.
        # Other rooms have separate locks; synchronous engines must not block on I/O.
        async with game.lock:
            try:
                events = game.engine.handle_command(user_id=user_id, command=command)
                serialized = [event.model_dump(mode="json") for event in events]
            except GameCommandRejected as error:
                return CommandError(category="game", code=error.code, detail=error.detail)
            except Exception:
                logger.exception("Game engine failed for room %s", room_id)
                return CommandError(category="infrastructure", code="ENGINE_FAILURE",
                                    detail="The game engine could not process this command.")
            for event in serialized:
                await self._broadcaster.broadcast(room_id, event)
        return None
