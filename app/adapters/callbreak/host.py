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
        if not self.host._contains(self.game) or self.game.state is None or self.game.ended:
            raise CommandAccessError(409, "This game is not active. Refresh its state.")
        from app.multiplayer.table_session import player_seat
        if player_seat(self.game, user_id) is None:
            raise CommandAccessError(403, "Spectators cannot play.")

    @property
    def revision(self):
        return self.game.state.revision

    def checkpoint(self):
        return self.game.state, list(self.game.log), self.game.deadline

    def restore(self, checkpoint):
        self.game.state, self.game.log, self.game.deadline = checkpoint

    def validate_concurrency(self, user_id, command):
        from app.games.base import GameCommandRejected
        from app.multiplayer.table_session import player_seat
        from .concurrency import review_scope_matches
        scoped = command.command in ('ACCEPT_HAND', 'CLAIM_REDEAL') and command.payload.get('hand_review_phase_id') is not None
        valid = (review_scope_matches(self.game.state, self.game.match_id, command, player_seat(self.game, user_id))
                 if scoped else command.expected_revision == self.revision)
        if not valid:
            raise GameCommandRejected('STALE_REVISION', 'The turn changed. Your view has been refreshed; try again.')

    def apply(self, user_id, command):
        from app.multiplayer.table_session import player_seat
        actor = player_seat(self.game, user_id)
        entry = self.game.session.get('controls', {}).get(str(actor))
        if entry and entry['mode'] == 'auto':
            from app.games.base import GameCommandRejected
            raise GameCommandRejected('RECLAIM_REQUIRED', 'Reclaim your seat before playing.')
        events = self.host._apply_player(self.game, actor, command.command, command.payload,
                                        command_id=command.command_id)
        events.extend(self.host._apply_controllers(self.game))
        return events

    def snapshot(self, user_id):
        return self.host._snapshot(self.game, user_id)
