"""Game-specific bridge from the test host to the shared command runtime."""

from app.runtime.command_runtime import CommandAccessError


class CallBreakCommandTarget:
    def __init__(self, host, game):
        self.host, self.game = host, game

    def handle_player_leave(self, user_id):
        if self.game.ended or self.game.finished:
            return []
        from app.games.base import GameCommandRejected
        raise GameCommandRejected("LEAVE_NOT_ALLOWED",
            "Call Break does not support departure during play. The creator can end the game.")

    def authorize(self, user_id):
        if self.host.games.get(self.game.room_id) is not self.game or self.game.state is None or self.game.ended:
            raise CommandAccessError(409, "This game is not active. Refresh its state.")
        if user_id not in self.game.users or user_id in self.game.departed:
            raise CommandAccessError(403, "Spectators cannot play.")

    @property
    def revision(self):
        return self.game.state.revision

    def checkpoint(self):
        return self.game.state, list(self.game.log), self.game.deadline

    def restore(self, checkpoint):
        self.game.state, self.game.log, self.game.deadline = checkpoint

    def apply(self, user_id, command):
        actor = self.game.users.index(user_id) + 1
        events = self.host._apply_player(self.game, actor, command.command, command.payload,
                                        command_id=command.command_id)
        events.extend(self.host._apply_controllers(self.game))
        return events

    def snapshot(self, user_id):
        return self.host._snapshot(self.game, user_id)
