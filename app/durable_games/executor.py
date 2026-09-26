"""Detached game-lane execution. No live host registry, socket, timer, or ledger I/O.

Every attempt loads committed state under its table lock. A failed/unknown commit
therefore discards the entire speculative host; the next attempt consults the
inbox again. Only acknowledgments leave this module, never hidden engine state.
"""
from dataclasses import dataclass
from random import SystemRandom
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from app.adapters.callbreak.host import CallBreakCommandTarget
from app.games.base import GameCommandRejected
from app.models.action import ReliableActionCommand
from app.runtime.command_runtime import CommandAccessError, OutgoingEvent
from app.test_games.service import TestGameService
from .checkpoint_store import user_uuid
from .checkpoints import capture_checkpoint
from .departure import fold_and_leave
from .callbreak_review import next_deal
from .outbox import append_lane_events
from .recovery import rebuild_hosted_game
from .store import DurableGameConflict


class _DetachedHost:
    """Only the existing synchronous game hooks; deliberately no transport hooks."""
    _apply_player = TestGameService._apply_player
    _apply_controllers = TestGameService._apply_controllers
    _record = TestGameService._record
    _sync_proposal = TestGameService._sync_proposal

    def __init__(self, round_summary_seconds):
        self.game = None
        self._random = SystemRandom()
        self.round_summary_seconds = round_summary_seconds

    def _contains(self, game):
        return self.game is game


@dataclass(frozen=True)
class ExecutionResult:
    lane_id: UUID
    sequence: int
    outcome: dict


class GameLaneExecutor:
    def __init__(self, inbox, *, round_summary_seconds=8, max_events=512):
        if round_summary_seconds < 0 or type(max_events) is not int or max_events <= 0:
            raise ValueError('Executor limits must be nonnegative/positive.')
        self.inbox = inbox
        self.checkpoints = inbox.checkpoints
        # Match the live application's Call Break review behavior. The owner must
        # use the same runtime configuration; NEXT_DEAL is creator-controlled.
        self.round_summary_seconds = round_summary_seconds
        self.max_events = max_events

    async def execute_one(self, lane_id, fence):
        result = None
        async with self.inbox.claim(lane_id, fence=fence) as claim:
            if claim is None:
                return None
            if claim.target.kind != 'game':
                raise DurableGameConflict('This executor handles game lanes only.')
            stored = await self.checkpoints.load_for_update(claim.connection, claim.target.table_id)
            entry = claim.entry
            request = ReliableActionCommand.model_validate(entry.request.model_dump())
            prior = await (await claim.connection.execute('''SELECT request_fingerprint,status,
                resulting_revision,rejection_detail,original_request FROM game_commands
                WHERE game_id=%s AND actor_id=%s AND command_id=%s''',
                (claim.target.game_id, entry.actor_id, request.command_id))).fetchone()
            if prior:
                if prior[0] != entry.fingerprint or prior[4] != request.model_dump(mode='json'):
                    raise DurableGameConflict('Committed receipt identifies a different original request.')
                outcome = {'command_id': request.command_id, 'status': prior[1], 'revision': prior[2]}
                if prior[3] is not None:
                    outcome['detail'] = prior[3]
            else:
                outcome = await self._execute(claim, stored, request, fence)
            await claim.complete(outcome)
            result = ExecutionResult(entry.lane_id, entry.sequence, outcome)
        # Context exit includes commit and final fencing. Never return speculative
        # success if the driver reports an unknown commit or loses its connection.
        return result

    async def _execute(self, claim, stored, request, fence):
        data = stored.checkpoint['data']
        actor = claim.entry.actor_id
        detail = None
        try:
            actor_uuid = user_uuid(actor)
        except (ValueError, AttributeError):
            actor_uuid = None
            detail = 'This game executor requires an authenticated player.'
        if actor_uuid is not None:
            member = await (await claim.connection.execute('''SELECT user_id FROM room_memberships
                WHERE room_id=%s AND user_id=%s FOR KEY SHARE''', (claim.target.room_id, actor_uuid))).fetchone()
            if member is None:
                detail = 'You are no longer a member of this room.'
        current = data['host']['durable_game_id']
        game_row = await (await claim.connection.execute('SELECT status FROM games WHERE id=%s',
                                                         (claim.target.game_id,))).fetchone()
        if (current is None or UUID(current) != claim.target.game_id or data['match_id'] != request.match_id or
                data['host']['ended'] or game_row is None or game_row[0] != 'active'):
            detail = 'This game is no longer active. Refresh its state.'
        if detail is None and stored.receipt_snapshot['receipt_count'] >= stored.receipt_snapshot['receipt_limit']:
            # Ingress reserves receipt capacity. Legacy/manual over-admission must
            # fail closed, not erase outcomes or advance an unreceipted command.
            raise DurableGameConflict('The match has reached its command receipt limit.')
        events = []
        if detail is None:
            host = _DetachedHost(self.round_summary_seconds)
            rebuilt = rebuild_hosted_game(host, stored.checkpoint, receipt_snapshot=stored.receipt_snapshot)
            game = host.game = rebuilt.game
            target = game.flush_target or game.marriage_target or CallBreakCommandTarget(host, game)
            try:
                target.authorize(actor)
                if actor not in game.table.seats(game):
                    raise CommandAccessError(403, 'You no longer hold a seat in this game.')
                if request.expected_revision != target.revision:
                    raise GameCommandRejected('STALE_REVISION', 'The turn changed. Refresh and try again.')
                if request.command == 'NEXT_DEAL':
                    events = next_deal(host, game, actor, request)
                else:
                    events = (fold_and_leave(game, actor, request) if request.command == 'FOLD_AND_LEAVE'
                              else target.apply(actor, request))
            except (CommandAccessError, GameCommandRejected) as error:
                # Discard the detached game wholesale, including partial adapter
                # mutations, randomness, query caches, table metadata, and events.
                detail = error.detail
            else:
                if game.pending_flush_departures and game.flush_open:
                    for user in sorted(game.pending_flush_departures):
                        if user in game.users:
                            game.users.remove(user)
                        game.table.emit('SEAT_RELEASED', user_id=user, match_id=game.match_id, reason='ROUND_COMPLETED')
                    game.pending_flush_departures.clear()
                host._sync_proposal(game)
                game.table.sync(game)
                # Offer creation/expiry belongs to table lanes and durable timers;
                # never invoke the legacy async _publish/_advance_table here.
                for event in game.table.events[game.table.published_sequence:]:
                    events.append(OutgoingEvent({'type': 'TABLE_EVENT', 'table_id': game.table.table_id, **event}))
                # This cursor now means handed to the durable outbox, not delivered
                # to sockets. It advances only with the same database commit.
                game.table.published_sequence = len(game.table.events)
                outcome = {'command_id': request.command_id, 'status': 'accepted', 'revision': target.revision}
                candidate = capture_checkpoint(game, table_revision=rebuilt.table_revision + 1, invitations=rebuilt.invitations)
                receipt = {'actor_id': actor, 'request': request.model_dump(mode='json'),
                           'fingerprint': claim.entry.fingerprint, 'outcome': outcome}
                saved = await self.checkpoints.save_in_transaction(claim.connection, candidate,
                    expected_revision=rebuilt.table_revision, fence=fence,
                    receipt=receipt, receipt_limit=stored.receipt_snapshot['receipt_limit'])
                if saved.duplicate:
                    raise DurableGameConflict('Receipt changed during execution; reload before retrying.')
                events.append(OutgoingEvent({'type': 'GAME_STATE_CHANGED', 'match_id': game.match_id,
                    'table_id': game.table.table_id, 'revision': target.revision,
                    'table_revision': rebuilt.table_revision + 1}))
                if request.command == 'FOLD_AND_LEAVE':
                    events.append(OutgoingEvent({'type': 'TABLE_STATE_CHANGED', 'match_id': game.match_id,
                        'table_id': game.table.table_id, 'table_revision': rebuilt.table_revision + 1}))
                await self._finalization(claim, candidate)
        if detail is not None:
            outcome = await self.checkpoints.reject_claim(claim, stored, detail)
            events = []
        if actor_uuid is not None:
            events.append(OutgoingEvent({'type': 'ACTION_ACK', **outcome}, actor))
        await self._outbox(claim, events)
        return outcome

    async def _outbox(self, claim, events):
        await append_lane_events(claim, events, max_events=self.max_events)

    async def _finalization(self, claim, checkpoint):
        data = checkpoint['data']
        state = data['engine']['state']
        if state.get('status') != 'finished' and state.get('phase') != 'MATCH_COMPLETE':
            return
        round_number = state['round_number'] if data['game_type'] == 'flush' else 0
        await claim.connection.execute('''INSERT INTO game_finalization_jobs
            (job_id,game_id,round_number,job_type,payload) VALUES (%s,%s,%s,'hosted_settlement',%s)
            ON CONFLICT (game_id,round_number,job_type) DO NOTHING''',
            (uuid4(), claim.target.game_id, round_number, Jsonb({'room_id': data['room_id'],
             'table_id': data['table_id'], 'match_id': data['match_id'], 'revision': data['engine']['revision']})))
