"""Room-host wrapper around the Marriage reliable-command adapter."""
from app.adapters.marriage import MarriageCommandTarget
from app.runtime.command_runtime import CommandAccessError


class HostedMarriageTarget(MarriageCommandTarget):
    def __init__(self, host, game, adapter):
        super().__init__(adapter, seat_by_user={user: str(i + 1) for i, user in enumerate(game.users)})
        self.host, self.game = host, game

    def handle_player_leave(self, user_id):
        if self.game.ended or self.game.finished:
            return []
        from app.games.base import GameCommandRejected
        raise GameCommandRejected("LEAVE_NOT_ALLOWED",
            "Marriage does not support departure during play. The creator can end the game.")

    def authorize(self, user_id):
        if self.host.games.get(self.game.room_id) is not self.game or self.game.ended:
            raise CommandAccessError(409, "This game is no longer active.")
        if user_id in self.game.departed:
            raise CommandAccessError(403, "You have left this seat.")
        super().authorize(user_id)

    def snapshot(self, user_id):
        self.authorize(user_id)
        return self.host._snapshot(self.game, user_id)

    def checkpoint(self):
        return super().checkpoint(), dict(self.game.marriage_queries), list(self.game.marriage_moves)

    def restore(self, checkpoint):
        super().restore(checkpoint[0])
        self.game.marriage_queries = checkpoint[1]
        self.game.marriage_moves = checkpoint[2]

    def apply(self, user_id, command):
        events = super().apply(user_id, command)
        for event in events:
            if event.message["event"] == "QUERY_RESULT":
                self.game.marriage_queries[user_id] = event.message["payload"]
            elif event.recipient is None and event.message["event"] in ("CARD_DRAWN", "CARD_DISCARDED"):
                # Only the adapter's public projection may drive shared animation.
                self.game.marriage_moves.append(event.message["payload"]["event"])
                self.game.marriage_moves[:] = self.game.marriage_moves[-20:]
        return events
