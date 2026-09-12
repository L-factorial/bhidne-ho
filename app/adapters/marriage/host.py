"""Authenticated roster bridge to the shared reliable-command runtime."""
from types import MappingProxyType

from pydantic import ValidationError

from app.games.base import GameCommandRejected
from app.runtime.command_runtime import CommandAccessError, OutgoingEvent

from .contracts import CommandRejected, PlayerCommand


class MarriageCommandTarget:
    def __init__(self, adapter, *, seat_by_user):
        roster = dict(seat_by_user)
        seats = adapter.seat_ids
        if (len(roster) != len(seats) or set(roster.values()) != set(seats)
                or any(not isinstance(user, str) or not user.strip() for user in roster)):
            raise ValueError("Roster must map unique authenticated users to every configured seat exactly once.")
        self.adapter = adapter
        self.seat_by_user = MappingProxyType(roster)
        self.user_by_seat = MappingProxyType({seat: user for user, seat in roster.items()})
        self.active = True

    def authorize(self, user_id):
        if not self.active:
            raise CommandAccessError(409, "This game is no longer active.")
        if user_id not in self.seat_by_user:
            raise CommandAccessError(403, "Spectators cannot submit player commands.")

    @property
    def revision(self):
        return self.adapter.revision

    def checkpoint(self):
        return self.adapter.checkpoint()

    def restore(self, checkpoint):
        self.adapter.restore(checkpoint)

    def snapshot(self, user_id):
        self.authorize(user_id)
        return self.adapter.snapshot(self.seat_by_user[user_id])

    def apply(self, user_id, command):
        self.authorize(user_id)
        try:
            request = PlayerCommand.model_validate(command.model_dump(mode="json", exclude_none=True))
        except ValidationError as error:
            raise GameCommandRejected("INVALID_COMMAND", "Invalid Marriage command or payload.") from error
        result = self.adapter.dispatch_player(request, player_id=self.seat_by_user[user_id])
        if isinstance(result, CommandRejected):
            raise GameCommandRejected(result.code, result.detail)
        return [OutgoingEvent(event.message.model_dump(mode="json"),
                              self.user_by_seat[event.recipient_player_id] if event.recipient_player_id else None)
                for event in result.messages]

    def handle_command(self, user_id, command):
        """Reject legacy broadcast-only execution, which cannot safely carry private cards."""
        raise GameCommandRejected("RELIABLE_COMMAND_REQUIRED", "Use the shared reliable game action endpoint.")


def register_marriage(registry, room_id, *, adapter, seat_by_user):
    """Trusted host hook: register a prepared roster, with an identical session/match ID."""
    if adapter._registered:
        raise ValueError("Each room must own a separate Marriage adapter.")
    target = MarriageCommandTarget(adapter, seat_by_user=seat_by_user)
    registry.register(room_id, target, command_target=target)
    registry.get_room(room_id).commands.match_id = adapter.match_id
    adapter._registered = True
    return target
