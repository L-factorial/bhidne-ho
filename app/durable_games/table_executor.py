"""Durable table rosters, starts, closure, and ready-roster rematches. No startup wiring.

expected_revision means TABLE revision, not engine revision. Unknown command
families or unsupported recovery structures stay pending for a compatible executor;
known invalid requests receive a durable no-effect rejection. Gameplay receipts
remain separate from the lane's table-command outcomes.
"""
from uuid import UUID

from pydantic import ValidationError
from app.games.base import GameCommandRejected
from app.multiplayer.table import GameTablePolicy
from app.multiplayer.table_lifecycle import GameTableLifecycle
from app.runtime.command_runtime import OutgoingEvent

from .checkpoint_store import user_uuid
from .checkpoints import capture_checkpoint, canonical_json
from .executor import ExecutionResult, _DetachedHost
from .outbox import append_lane_events
from .recovery import rebuild_hosted_game
from .store import DurableGameConflict
from .inbox import LaneTarget
from .initial_start import InitialStartPayload, start_rejection, build_initial_engine
from .table_closure import closure_rejection, close_table, cancel_pending_actions
from .rematch import rematch_rejection, build_rematch
from .flush_restart import restart_flush
from .seat_offers import OFFER_COMMANDS, InviteSeatPayload, ResolveSeatPayload, apply_offer, advance_offers
from .rules_commands import COMMANDS as RULE_COMMANDS, apply_rules
from . import invitations as hosted_invitations


class _LobbyHost(_DetachedHost):
    _seat_user = GameTableLifecycle._seat_user
    _promote = GameTableLifecycle._promote


class TableStateRejected(DurableGameConflict):
    """Known command is invalid in the current state, not a missing executor."""


class TableLaneExecutor:
    roster_commands = frozenset({'join-seat', 'leave-seat', 'join-queue', 'leave-queue'})
    commands = frozenset({'join-seat', 'leave-seat', 'join-queue', 'leave-queue', 'lock', 'start', 'end', 'abandon', 'next-match', 'expire-seat-offer', 'answer-table-invitation', 'send-poke'}) | OFFER_COMMANDS | RULE_COMMANDS

    def __init__(self, inbox, *, max_events=512, round_summary_seconds=8):
        if type(max_events) is not int or max_events < 1 or round_summary_seconds < 0:
            raise ValueError('Event limit must be positive and summary duration nonnegative.')
        self.inbox, self.checkpoints, self.max_events = inbox, inbox.checkpoints, max_events
        self.round_summary_seconds = round_summary_seconds

    async def execute_one(self, lane_id, fence):
        async with self.inbox.claim(lane_id, fence=fence) as claim:
            if claim is None:
                return None
            if claim.target.kind != 'table':
                raise DurableGameConflict('This executor handles table lanes only.')
            request = claim.entry.request
            if request.command == 'send-poke':
                from .pokes import execute
                return await execute(claim, self.checkpoints)
            if request.command == 'expire-seat-offer':
                from .offer_expiry import execute_expiry
                return await execute_expiry(claim, self.checkpoints, fence, max_events=self.max_events)
            if request.command not in self.commands:
                raise DurableGameConflict('Table command requires another executor capability.')
            stored = await self.checkpoints.load_for_update(claim.connection, claim.target.table_id)
            data = stored.checkpoint['data']
            state_error = None
            try:
                closing, rematching, offer_command, between_rounds, completed_roster = self.check_capability(data, request.command)
            except TableStateRejected as error:
                state_error = str(error)
                closing = rematching = offer_command = between_rounds = completed_roster = False
            host = _LobbyHost(self.round_summary_seconds)
            game = host.game = rebuild_hosted_game(host, stored.checkpoint,
                receipt_snapshot=stored.receipt_snapshot).game
            detail = None
            offer_payload = None
            payload_error = None
            if offer_command:
                try:
                    model = InviteSeatPayload if request.command == 'invite-seat' else ResolveSeatPayload
                    offer_payload = model.model_validate_json(canonical_json(request.payload))
                    if request.command == 'invite-seat':
                        user_uuid(offer_payload.recipient)
                except (ValidationError, ValueError, AttributeError):
                    offer_payload = None
                    payload_error = 'Invalid seat-offer payload.'
            try:
                actor_id = user_uuid(claim.entry.actor_id)
            except (ValueError, AttributeError):
                actor_id = None
                detail = 'An authenticated player is required.'
            if detail is None:
                # Lock every potentially changed position in stable order, including
                # the actor and FIFO promotion candidates, before reservation reads.
                users = sorted({actor_id, *(user_uuid(p['user_id']) for p in data['positions'])})
                if request.command == 'invite-seat' and offer_payload is not None:
                    users = sorted(set(users) | {user_uuid(offer_payload.recipient)})
                for user in users:
                    row = await (await claim.connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user,))).fetchone()
                    if user == actor_id and row is None:
                        actor_id = None  # No outbox FK targeting a nonexistent user.
                member = await (await claim.connection.execute('''SELECT user_id FROM room_memberships
                    WHERE room_id=%s AND user_id=%s FOR KEY SHARE''',
                    (claim.target.room_id, actor_id))).fetchone()
                if member is None and (request.command != 'answer-table-invitation' or actor_id is None):
                    detail = 'You are no longer a member of this room.'
            if detail is None and state_error is not None:
                detail = state_error
            if detail is None and (request.match_id != game.match_id or request.expected_revision is None):
                detail = 'Table commands require the current match and table revision.'
            if detail is None and request.expected_revision != data['table_revision']:
                detail = 'The table changed. Refresh and try again.'
            if detail is None and payload_error:
                detail = payload_error
            start_payload = None
            if detail is None and request.command == 'start':
                try:
                    start_payload = InitialStartPayload.model_validate_json(canonical_json(request.payload))
                except ValidationError:
                    detail = 'Invalid start payload. Only manual play and a rules revision are supported.'
            elif detail is None and request.payload and not offer_command and request.command not in RULE_COMMANDS and request.command != 'answer-table-invitation':
                detail = 'This table command does not accept a payload.'
            if detail is None and game.ended and not closing:
                detail = 'This table has ended.'
            if detail is None and request.command == 'start' and game.started and not between_rounds:
                detail = 'This match has already started.'
            if detail is None and rematching:
                detail = rematch_rejection(game, claim.entry.actor_id)
            if detail is None and not closing:
                candidates = {claim.entry.actor_id}
                if request.command == 'start' and (not game.started or between_rounds):
                    candidates.update(game.users)
                if rematching:
                    candidates.update(u for u in game.table.seats(game) if u is not None)
                if (request.command == 'leave-seat' and game.table.phase == 'OPEN'
                        and claim.entry.actor_id in game.users):
                    candidates.update(game.table.queue[:game.capacity - len(game.users) + 1])
                for user in sorted(candidates):
                    if await self._occupied(claim.connection, user, claim.target.table_id):
                        # Leaving a queue must remain possible while seated elsewhere.
                        if request.command in ('join-seat', 'join-queue', 'start', 'next-match') or user != claim.entry.actor_id:
                            detail = 'A player is already seated at another table.'
                            break
            events = []
            invitations = data['invitations']
            already_ended = game.ended
            if detail is None:
                if closing:
                    detail = await closure_rejection(claim.connection, game, claim.entry.actor_id, request.command)
                    if detail is None and not already_ended:
                        invitations = close_table(game, claim.entry.actor_id, request.command, invitations)
                elif rematching:
                    game = host.game = await build_rematch(claim, game, stored)
                    invitations = []
                elif request.command in RULE_COMMANDS:
                    host._sync_proposal(game)
                    detail = apply_rules(game, claim.entry.actor_id, request, claim.entry.lane_id)
                elif request.command == 'answer-table-invitation':
                    from .room_commands import Answer
                    try:
                        invitation_answer = Answer.model_validate_json(canonical_json(request.payload))
                    except ValidationError:
                        detail = 'Invalid invitation answer.'
                    else:
                        detail = await hosted_invitations.answer(claim, game, invitations, invitation_answer)
                elif request.command == 'start':
                    host._sync_proposal(game)
                    detail = start_rejection(game, claim.entry.actor_id, start_payload,
                                             allow_finished_flush=between_rounds)
                    if detail is None:
                        try:
                            events = (await restart_flush(claim, host, game, stored) if between_rounds
                                      else build_initial_engine(host, game, request.command_id))
                        except GameCommandRejected as error:
                            detail = error.detail
                else:
                    if completed_roster:
                        intent = await (await claim.connection.execute('''SELECT 1 FROM game_finalization_jobs
                            WHERE game_id=%s AND round_number=0 AND job_type='hosted_settlement' ''',
                            (game.durable_game_id,))).fetchone()
                        if intent is None:
                            raise DurableGameConflict('Completed match is missing its finalization intent.')
                    if between_rounds and request.command in self.roster_commands:
                        if game.pending_flush_departures:
                            raise DurableGameConflict('Completed round still has unreconciled departures.')
                        intent = await (await claim.connection.execute('''SELECT 1 FROM game_finalization_jobs
                            WHERE game_id=%s AND round_number=%s AND job_type='hosted_settlement' ''',
                            (game.durable_game_id, data['engine']['state']['round_number']))).fetchone()
                        if intent is None:
                            raise DurableGameConflict('Completed Flush round is missing its finalization intent.')
                    host._sync_proposal(game)
                    detail = (await apply_offer(claim, game, offer_payload, self._occupied) if offer_command
                              else self._apply(host, game, claim.entry.actor_id, request.command))
                    if detail is None and completed_roster:
                        await advance_offers(claim, game)
                    if detail is None and between_rounds and game.ended and not already_ended:
                        invitations = close_table(game, claim.entry.actor_id, 'empty-roster', invitations)
            revision = data['table_revision']
            if detail is None and not (closing and already_ended):
                host._sync_proposal(game)
                game.table.sync(game)
                events.extend(OutgoingEvent({'type': 'TABLE_EVENT', 'table_id': game.table.table_id, **event})
                              for event in game.table.events[game.table.published_sequence:])
                game.table.published_sequence = len(game.table.events)
                revision += 1
                invitations = hosted_invitations.reconcile(game, invitations)
                saved = await self.checkpoints.save_in_transaction(claim.connection,
                    capture_checkpoint(game, table_revision=revision,
                                       invitations=invitations),
                    expected_revision=data['table_revision'], fence=fence,
                    receipt_limit=stored.receipt_snapshot['receipt_limit'])
                if closing or rematching or (between_rounds and (request.command == 'start' or game.ended)):
                    await cancel_pending_actions(claim.connection, game.table.table_id)
                if request.command == 'start':
                    await self.inbox.ensure_lane_in_transaction(claim.connection, LaneTarget(kind='game',
                        room_id=game.room_id, table_id=UUID(game.table.table_id), game_id=game.durable_game_id))
                if request.command == 'start' or (game.started and (closing or game.ended)):
                    events.append(OutgoingEvent({'type': 'GAME_STATE_CHANGED', 'table_id': game.table.table_id,
                        'match_id': game.match_id, 'table_revision': revision,
                        'revision': saved.checkpoint['data']['engine']['revision']}))
                events.append(OutgoingEvent({'type': 'TABLE_STATE_CHANGED', 'table_id': game.table.table_id,
                    'match_id': game.match_id, 'table_revision': revision}))
            outcome = {'command_id': request.command_id, 'status': 'accepted' if detail is None else 'rejected',
                       'revision': revision}
            if rematching and detail is None:
                outcome.update(table_id=game.table.table_id, match_id=game.match_id)
            if detail is not None:
                events = []
                outcome['detail'] = detail
            if actor_id is not None:
                events.append(OutgoingEvent({'type': 'TABLE_COMMAND_ACK', **outcome}, claim.entry.actor_id))
            await append_lane_events(claim, events, max_events=self.max_events)
            await claim.complete(outcome)
            result = ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
        return result

    @classmethod
    def check_capability(cls, data, command):
        """Shared state-dependent capability gate for execution and activation."""
        if command == 'send-poke':
            return False, False, False, False, False
        closing = command in ('end', 'abandon')
        rematching = command == 'next-match'
        offer_command = command in OFFER_COMMANDS
        between_rounds = (data['game_type'] == 'flush' and data['engine'] is not None
                          and data['engine']['state'].get('status') == 'finished')
        round_command = between_rounds and command in (cls.roster_commands | {'lock', 'start'})
        active_queue = (data['engine'] is not None and data['phase'] == 'STARTED'
                        and command in ('join-queue', 'leave-queue'))
        completed_roster = (data['game_type'] in ('callbreak', 'marriage')
            and data['engine'] is not None and data['phase'] == 'COMPLETED'
            and command in ({'leave-seat', 'join-queue', 'leave-queue'} | OFFER_COMMANDS))
        # Never consume a supported future command against a partially ported
        # active/rotation runtime. No legacy async publish or timer loop runs.
        if (not closing and not rematching and not round_command and not completed_roster and not offer_command and not active_queue and command not in RULE_COMMANDS and command != 'answer-table-invitation'
                and command != 'start' and data['engine'] is not None):
            raise TableStateRejected('This command is unavailable while the game is active.')
        if not closing and not rematching and command not in RULE_COMMANDS and command != 'answer-table-invitation' and ((data['engine'] is None and data['phase'] not in ('OPEN', 'LOCKED', 'ENDED'))
                or (not completed_roster and (data['table']['next_seat_count'] is not None or data['table']['releases']))
                or (not completed_roster and any(o['status'] == 'PENDING' for o in data['table']['offers']))):
            raise DurableGameConflict('Active games and seat-offer reconciliation are not supported here.')
        return closing, rematching, offer_command, between_rounds, completed_roster

    @staticmethod
    async def _occupied(connection, actor, table_id):
        user = user_uuid(actor)
        return await (await connection.execute('''SELECT 1 FROM active_table_players
            WHERE user_id=%s AND table_id<>%s UNION ALL
            SELECT 1 FROM active_game_players WHERE user_id=%s LIMIT 1''',
            (user, table_id, user))).fetchone()

    @staticmethod
    def _apply(host, game, actor, command):
        table = game.table
        if command == 'join-seat':
            if actor in game.users:
                return None
            if table.phase != 'OPEN':
                return 'The roster is locked.'
            if len(game.users) >= game.capacity:
                return 'The table is full. Join the waitlist.'
            host._seat_user(game, actor)
        elif command == 'join-queue':
            if actor in table.seats(game):
                return 'You already have a seat.'
            if actor not in table.queue:
                table.queue.append(actor)
                table.emit('QUEUE_JOINED', user_id=actor)
        elif command == 'leave-queue':
            if actor in table.queue:
                table.queue.remove(actor)
        elif command == 'leave-seat':
            if table.phase == 'COMPLETED':
                # The completed engine keeps its original users; only the next
                # roster changes. Offers are advanced after this transition.
                seats = table.seats(game)
                if actor not in seats:
                    return None
                seat = seats.index(actor) + 1
                table.next_seats[seat - 1] = None
                game.departed.add(actor)
                if GameTablePolicy.for_game(game.game_type, game.capacity).requires_replacement:
                    table.releases[seat] = actor
                    table.emit('SEAT_RELEASED', seat_id=seat, user_id=actor, match_id=game.match_id)
                else:
                    table.emit('SEAT_RELEASED', user_id=actor, match_id=game.match_id)
                return None
            if actor not in game.users:
                return None
            if table.phase != 'OPEN':
                return 'The locked roster remains reserved until the game is ended.'
            game.users.remove(actor)
            host._promote(game)
            if not game.users:
                game.ended = True
                table.phase = 'ENDED'
            table.emit('SEAT_RELEASED', user_id=actor, match_id=game.match_id)
        elif command == 'lock':
            if game.rule_proposal and game.rule_proposal['status'] == 'PENDING':
                return 'Resolve the proposed rules before locking.'
            if not game.users or actor != game.users[0]:
                return 'Only the table host can lock the roster.'
            policy = GameTablePolicy.for_game(game.game_type, game.capacity)
            if not policy.requires_explicit_lock:
                return 'This table locks when the match starts.'
            if table.phase == 'LOCKED':
                return None
            if table.phase != 'OPEN' or not policy.min_players <= len(game.users) <= policy.max_players:
                return 'Seat enough players in an open roster before locking.'
            table.phase = 'LOCKED'
            table.emit('GAME_LOCKED', match_id=game.match_id)
        return None
