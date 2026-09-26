"""Flush room lifecycle and private query results around the reliable adapter."""
from app.adapters.flush import FlushCommandTarget
from app.runtime.command_runtime import CommandAccessError


class HostedFlushTarget(FlushCommandTarget):
    def __init__(self, host, game, adapter, *, seat_by_user=None):
        # Recovery can retain a finished engine's roster while the table forms
        # its next round. Normal creation still uses the current seated users.
        super().__init__(adapter, seat_by_user=(
            {u: str(game.flush_seats[u]) for u in game.users} if seat_by_user is None else seat_by_user))
        self.host, self.game = host, game

    def handle_player_leave(self, user_id):
        if self.game.ended or self.game.finished:
            return []
        # Explicit departure can fold off-turn; preparation remains engine-validated.
        from uuid import uuid4
        from app.models.action import ActionCommand
        if self.game.flush_open:
            return []
        state = self.adapter.checkpoint().get_state()
        player = next(p for p in state.players if p.player_id == self.seat_by_user[user_id])
        if state.status.value == "finished" or player.status.value != "active":
            return []
        return self.apply(user_id, ActionCommand(match_id=self.game.match_id,
            command_id=uuid4().hex, expected_revision=self.revision, command="FOLD_FOR_LEAVE"))

    def authorize(self, user_id):
        if not self.host._contains(self.game) or self.game.ended:
            raise CommandAccessError(409, 'This game is no longer active.')
        if user_id not in self.game.users or user_id in self.game.pending_flush_departures:
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
