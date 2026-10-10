"""Durable table rosters, starts, closure, and ready-roster rematches. No startup wiring.

expected_revision means TABLE revision, not engine revision. Unknown command
families or unsupported recovery structures stay pending for a compatible executor;
known invalid requests receive a durable no-effect rejection. Gameplay receipts
remain separate from the lane's table-command outcomes.
"""

from .telemetry import observe
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
from .session_timers import COMMANDS as SESSION_COMMANDS
from app.multiplayer import table_session as session_policy
from .seat_offers import now as db_now


class _LobbyHost(_DetachedHost):
    _seat_user = GameTableLifecycle._seat_user
    _promote = GameTableLifecycle._promote


class TableStateRejected(DurableGameConflict):
    """Known command is invalid in the current state, not a missing executor."""


class TableLaneExecutor:
    roster_commands = frozenset({'join-seat', 'leave-seat', 'join-queue', 'leave-queue'})
    commands = frozenset({'join-seat', 'leave-seat', 'join-queue', 'leave-queue', 'lock', 'start', 'end', 'abandon', 'next-match', 'expire-seat-offer', 'answer-table-invitation', 'invite-table', 'send-poke', 'send-reaction', 'card-theme'}) | OFFER_COMMANDS | RULE_COMMANDS | SESSION_COMMANDS | {'session-tick'}

    def __init__(self, inbox, *, max_events=512, round_summary_seconds=8):
        if type(max_events) is not int or max_events < 1 or round_summary_seconds < 0:
            raise ValueError('Event limit must be positive and summary duration nonnegative.')
        self.inbox, self.checkpoints, self.max_events = inbox, inbox.checkpoints, max_events
        self.round_summary_seconds = round_summary_seconds

    @observe('execute.table')
    async def execute_one(self, lane_id, fence):
        async with self.inbox.claim(lane_id, fence=fence) as claim:
            if claim is None:
                return None
            from app.player_blocks.service import policy_read_lock
            await policy_read_lock(claim.connection)
            if claim.target.kind != 'table':
                raise DurableGameConflict('This executor handles table lanes only.')
            request = claim.entry.request
            if request.command in ('send-poke', 'send-reaction'):
                from .pokes import execute
                return await execute(claim, self.checkpoints)
            if request.command == 'session-tick':
                from .session_timers import execute_tick
                return await execute_tick(claim, self.checkpoints, fence, max_events=self.max_events,
                    round_summary_seconds=self.round_summary_seconds)
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
            before_effect = self._activity_state(game, data['invitations'])
            detail = None
            context = None
            invite_payload = None
            if request.command == 'invite-table':
                try:
                    invite_payload = hosted_invitations.InviteTablePayload.model_validate_json(canonical_json(request.payload))
                    for recipient in invite_payload.recipients:
                        user_uuid(recipient)
                except (ValidationError, ValueError, AttributeError):
                    invite_payload = None
                    detail = 'Invalid table invitation payload.'
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
                # Pair workers lock their lane before users. Acquire that same
                # order before acceptance can enqueue an automatic friendship.
                if request.command == 'answer-table-invitation' and request.payload.get('accept') is True:
                    invitation = next((item for item in data['invitations']
                        if item.get('id') == request.payload.get('invitation_id')
                        and item.get('recipient_id') == claim.entry.actor_id
                        and item.get('status') == 'pending' and item.get('auto_friend')), None)
                    if invitation:
                        low, high = sorted((actor_id, user_uuid(invitation['inviter_id'])))
                        await self.inbox.ensure_lane_in_transaction(claim.connection,
                            LaneTarget(kind='conversation', user_low=low, user_high=high))
                # Lock every potentially changed position in stable order, including
                # the actor and FIFO promotion candidates, before reservation reads.
                users = sorted({actor_id, *(user_uuid(p['user_id']) for p in data['positions'])})
                if request.command == 'invite-seat' and offer_payload is not None:
                    users = sorted(set(users) | {user_uuid(offer_payload.recipient)})
                if invite_payload is not None:
                    users = sorted(set(users) | {user_uuid(u) for u in invite_payload.recipients})
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
            elif detail is None and request.payload and not offer_command and request.command not in RULE_COMMANDS and request.command not in ('answer-table-invitation', 'invite-table', 'card-theme'):
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
                        if request.command in ({'join-seat', 'join-queue', 'start', 'next-match', 'accept-live-seat', 'reclaim-seat'}) or user != claim.entry.actor_id:
                            detail = 'A player is already seated at another table.'
                            if user == claim.entry.actor_id:
                                from .departure_context import occupied_context
                                context = await occupied_context(claim.connection, self.inbox.pool, user, claim.target.table_id)
                            break
            events = []
            invitations = data['invitations']
            invitation_before = canonical_json(invitations)
            invitation_recipients = [i['recipient_id'] for i in invitations]
            already_ended = game.ended
            if detail is None:
                if closing:
                    detail = await closure_rejection(claim.connection, game, claim.entry.actor_id, request.command)
                    if detail is None and not already_ended:
                        invitations = close_table(game, claim.entry.actor_id, request.command, invitations)
                elif rematching:
                    game = host.game = await build_rematch(claim, game, stored)
                    invitations = []
                elif request.command in SESSION_COMMANDS:
                    session_policy.sync(game, await db_now(claim.connection))
                    detail = session_policy.live_control(game, claim.entry.actor_id, request.command, await db_now(claim.connection))
                elif request.command == 'card-theme':
                    from app.multiplayer.card_themes import CardThemePayload, set_card_theme
                    try:
                        theme = CardThemePayload.model_validate_json(canonical_json(request.payload))
                    except ValidationError:
                        detail = 'Invalid card theme payload.'
                    else:
                        detail = set_card_theme(game, claim.entry.actor_id, theme.card_theme)
                elif request.command in RULE_COMMANDS:
                    host._sync_proposal(game)
                    detail = apply_rules(game, claim.entry.actor_id, request, claim.entry.lane_id)
                elif request.command == 'invite-table':
                    detail, created = await hosted_invitations.send(claim, game, invitations, invite_payload)
                    if detail is None:
                        invitation_recipients.extend(item['recipient_id'] for item in created)
                        events.extend(OutgoingEvent(dict(type='TABLE_INVITATION_CREATED', invitation_id=item['id'],
                            room_id=game.room_id, table_id=game.table.table_id, match_id=game.match_id), item['recipient_id'])
                            for item in created)
                elif request.command == 'answer-table-invitation':
                    from .room_commands import Answer
                    try:
                        invitation_answer = Answer.model_validate_json(canonical_json(request.payload))
                    except ValidationError:
                        detail = 'Invalid invitation answer.'
                    else:
                        detail = await hosted_invitations.answer(claim, game, invitations, invitation_answer, inbox=self.inbox)
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
                session_policy.sync(game, await db_now(claim.connection),
                    activity=self._activity_state(game, invitations) != before_effect)
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
                if context is not None:
                    outcome['context'] = context
            if detail is None and ((game.ended and not already_ended) or canonical_json(invitations)!=invitation_before):
                from .lobby_events import changed
                await changed(claim.connection, self.inbox, game.room_id, extra=invitation_recipients)
            if actor_id is not None:
                events.append(OutgoingEvent({'type': 'TABLE_COMMAND_ACK', **outcome}, claim.entry.actor_id))
            await append_lane_events(claim, events, max_events=self.max_events)
            await claim.complete(outcome)
            result = ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
        return result

    @classmethod
    def check_capability(cls, data, command):
        """Shared state-dependent capability gate for execution and activation."""
        if command in SESSION_COMMANDS or command == 'session-tick':
            return False, False, False, False, False
        if command in ('send-poke', 'send-reaction'):
            return False, False, False, False, False
        if command == 'leave-seat' and data['host']['ended']:
            # A concurrent End may win before leave ingress. Queue the original
            # request so execution records a durable no-effect rejection; an
            # ingress conflict would leave the client with an uncertain outcome.
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
        if (not closing and not rematching and not round_command and not completed_roster and not offer_command and not active_queue and command not in RULE_COMMANDS and command not in ('answer-table-invitation', 'invite-table', 'card-theme')
                and command != 'start' and data['engine'] is not None):
            raise TableStateRejected('This command is unavailable while the game is active.')
        if not closing and not rematching and command not in RULE_COMMANDS and command not in ('answer-table-invitation', 'invite-table', 'card-theme') and ((data['engine'] is None and data['phase'] not in ('OPEN', 'LOCKED', 'ENDED'))
                or (not completed_roster and (data['table']['next_seat_count'] is not None or data['table']['releases']))
                or (not completed_roster and any(o['status'] == 'PENDING' for o in data['table']['offers']))):
            raise DurableGameConflict('Active games and seat-offer reconciliation are not supported here.')
        return closing, rematching, offer_command, between_rounds, completed_roster

    @staticmethod
    async def _occupied(connection, actor, table_id):
        user = user_uuid(actor)
        return await (await connection.execute('''SELECT 1 FROM active_table_players
            WHERE user_id=%s AND table_id<>%s UNION ALL
            SELECT 1 FROM active_game_players p JOIN games g ON g.id=p.game_id
            WHERE p.user_id=%s AND g.table_id<>%s LIMIT 1''',
            (user, table_id, user, table_id))).fetchone()

    @staticmethod
    def _activity_state(game, invitations):
        from dataclasses import asdict
        # This is an intermediate-state comparison, not a checkpoint capture:
        # e.g. closure clears its remaining deadlines in the following sync.
        target = game.marriage_target or game.flush_target
        return canonical_json(dict(users=game.users, departed=sorted(game.departed),
            pending_flush_departures=sorted(game.pending_flush_departures), ended=game.ended,
            table=asdict(game.table), settings=game.settings, rule_proposal=game.rule_proposal,
            card_theme=game.card_theme, flush_rules=asdict(game.flush_rules),
            flush_rules_revision=game.flush_rules_revision, marriage_scoring=asdict(game.marriage_scoring),
            engine_revision=target.revision if target else game.state.revision if game.state else None,
            invitations=list(invitations),
            session={k:v for k,v in game.session.items() if k in ('controls', 'removed', 'expired_at')}))

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
