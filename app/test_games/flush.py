"""Flush room lifecycle and private query results around the reliable adapter."""
from app.adapters.flush import FlushCommandTarget
from app.runtime.command_runtime import CommandAccessError


class HostedFlushTarget(FlushCommandTarget):
    def __init__(self, host, game, adapter):
        super().__init__(adapter, seat_by_user={u: str(game.flush_seats[u]) for u in game.users})
        self.host, self.game = host, game

    def authorize(self, user_id):
        if self.host.games.get(self.game.room_id) is not self.game or self.game.ended:
            raise CommandAccessError(409, 'This game is no longer active.')
        if user_id not in self.game.users:
            raise CommandAccessError(403, "Take a seat before acting.")
        super().authorize(user_id)

    def snapshot(self, user_id):
        self.authorize(user_id)
        return self.host._snapshot(self.game, user_id)

    def checkpoint(self):
        return super().checkpoint(), dict(self.game.flush_queries)

    def restore(self, checkpoint):
        super().restore(checkpoint[0])
        self.game.flush_queries = checkpoint[1]

    def apply(self, user_id, command):
        if command.command == "START_NEXT_ROUND":
            from app.games.base import GameCommandRejected
            raise GameCommandRejected("LOCK_REQUIRED", "The creator must lock the table before the next deal.")
        events = super().apply(user_id, command)
        for event in events:
            if event.message['event'] == 'QUERY_RESULT':
                self.game.flush_queries[user_id] = event.message['payload']
        return events
