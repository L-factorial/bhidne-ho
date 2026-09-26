"""Room-lane creation of a new durable lobby; no engine start or live installation.

IDs derive from the lane/actor/request identity, never process randomness. An
explicit old table/revision makes replacement reviewable and safe to retry.
Creation, replacement, invitations, receipts and outgoing events commit together.
"""
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import Field, ValidationError, model_validator

from app.multiplayer.table import TableState
from app.runtime.command_runtime import CommandSession, OutgoingEvent
from app.test_games.service import HostedGame

from .checkpoint_store import user_uuid
from .checkpoints import Record, Identity, Nonnegative, canonical_json, capture_checkpoint
from .executor import ExecutionResult
from .inbox import LaneTarget
from .outbox import append_lane_events
from .store import DurableGameConflict
from . import invitations as hosted_invitations
from .recovery import rebuild_hosted_game
from .table_executor import _LobbyHost
from .table_closure import close_table, cancel_pending_actions


class CreateTablePayload(Record):
    game_type: Literal['callbreak', 'marriage', 'flush']
    capacity: Annotated[int, Field(ge=2, le=10)]
    name: Annotated[str, Field(min_length=1, max_length=60)] = 'Table'
    invitees: list[Identity] = Field(default_factory=list, max_length=20)
    replace_table_id: UUID | None = None
    replace_revision: Nonnegative | None = None

    @model_validator(mode='after')
    def valid_capacity(self):
        allowed = range(2, 11) if self.game_type == 'flush' else range(2, 6) if self.game_type == 'marriage' else (4, 5)
        if self.capacity not in allowed or not self.name.strip():
            raise ValueError('Unsupported player count or empty table name.')
        if (self.replace_table_id is None) != (self.replace_revision is None):
            raise ValueError('Replacement requires the old table and its revision.')
        return self


def creation_ids(lane_id, actor_id, command_id):
    identity = canonical_json(['bhidne-ho:create-table:v1', str(UUID(str(lane_id))), actor_id, command_id])
    return uuid5(NAMESPACE_URL, identity + ':table'), uuid5(NAMESPACE_URL, identity + ':match')


class RoomCreationExecutor:
    def __init__(self, inbox, *, max_events=512):
        if type(max_events) is not int or max_events < 1:
            raise ValueError('Event batch limit must be a positive integer.')
        self.inbox, self.checkpoints, self.max_events = inbox, inbox.checkpoints, max_events

    async def execute_one(self, lane_id, fence):
        async with self.inbox.claim(lane_id, fence=fence) as claim:
            if claim is None:
                return None
            request, actor = claim.entry.request, claim.entry.actor_id
            from .settlements import MODELS as SETTLEMENT_MODELS, execute as execute_settlement
            if claim.target.kind == 'room' and request.command in SETTLEMENT_MODELS:
                return await execute_settlement(claim)
            from .room_commands import COMMANDS as ROOM_COMMANDS, execute as execute_room
            if claim.target.kind == 'room' and request.command in ROOM_COMMANDS:
                return await execute_room(claim, self.inbox, fence, max_events=self.max_events)
            if claim.target.kind != 'room' or request.command != 'create-table':
                raise DurableGameConflict('This executor only handles room-lane create-table commands.')
            detail = None
            try:
                payload = CreateTablePayload.model_validate_json(canonical_json(request.payload))
            except ValidationError:
                payload = None
                detail = 'Invalid table type, capacity, name, or payload fields.'
            if request.match_id is not None or request.expected_revision is not None:
                detail = 'Creation has no existing match or expected table revision.'
            try:
                actor_id = user_uuid(actor)
            except (ValueError, AttributeError):
                actor_id = None
            old, old_game = None, None
            if detail is None and actor_id is not None and payload.replace_table_id is not None:
                row = await (await claim.connection.execute('SELECT room_id FROM room_tables WHERE table_id=%s', (payload.replace_table_id,))).fetchone()
                if row is None or row[0] != claim.target.room_id:
                    detail = 'Replacement table not found in this room.'
                else:
                    old = await self.checkpoints.load_for_update(claim.connection, payload.replace_table_id)
                    host = _LobbyHost(8)
                    old_game = host.game = rebuild_hosted_game(host, old.checkpoint, receipt_snapshot=old.receipt_snapshot).game
                    if (old.checkpoint['data']['table_revision'] != payload.replace_revision or old_game.ended
                            or actor not in old_game.table.seats(old_game) or not old_game.replaceable):
                        detail = 'Replacement requires your current completed table and its revision.'
            if actor_id is not None:
                # Lock all old positions and invitation targets before the actor,
                # retaining the global user order used by table execution.
                try:
                    locked_users = {actor_id}
                    if payload is not None:
                        locked_users.update(user_uuid(u) for u in payload.invitees)
                    if old is not None:
                        locked_users.update(user_uuid(p['user_id']) for p in old.checkpoint['data']['positions'])
                except (ValueError, AttributeError):
                    locked_users, detail = {actor_id}, 'Invalid invitation recipient.'
                for identifier in sorted(locked_users):
                    await claim.connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (identifier,))
                user = await (await claim.connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',
                                                            (actor_id,))).fetchone()
                if user is None:
                    actor_id = None
            if actor_id is None:
                detail = 'An authenticated player is required.'
            else:
                member = await (await claim.connection.execute('''SELECT user_id FROM room_memberships
                    WHERE room_id=%s AND user_id=%s FOR KEY SHARE''', (claim.target.room_id, actor_id))).fetchone()
                if member is None:
                    detail = 'You are no longer a member of this room.'
            if detail is None:
                occupied = await (await claim.connection.execute('''SELECT 1 FROM active_table_players WHERE user_id=%s
                    AND table_id IS DISTINCT FROM %s
                    UNION ALL SELECT 1 FROM active_game_players WHERE user_id=%s LIMIT 1''',
                    (actor_id, payload.replace_table_id, actor_id))).fetchone()
                if occupied:
                    detail = 'Leave your existing seat before creating another table.'
            if detail is None:
                # User BEFORE room-counter lock: closing a lobby already follows
                # table -> users -> room counter. Do not invert users/room here.
                room = await (await claim.connection.execute('''SELECT open_table_count,max_open_tables FROM rooms
                    WHERE id=%s FOR UPDATE''', (claim.target.room_id,))).fetchone()
                if room is None:
                    raise DurableGameConflict('Room disappeared during creation.')
                if room[0] - int(old_game is not None) >= room[1]:
                    detail = 'This room has reached its open-table limit.'
                else:
                    names = await (await claim.connection.execute('''SELECT name FROM room_tables
                        WHERE room_id=%s AND status<>'closed' AND table_id IS DISTINCT FROM %s''', (claim.target.room_id, payload.replace_table_id))).fetchall()
                    if any(name.casefold() == ' '.join(payload.name.split()).casefold() for (name,) in names):
                        detail = 'An open table with that name already exists in this room.'
            if detail is None:
                eligibility = await hosted_invitations.eligibility(claim.connection, claim.target.room_id, actor, payload.invitees)
                detail = next((item['reason'] for item in eligibility if not item['eligible']), None)
            if detail is None:
                detail = await hosted_invitations.reserve_rate(claim.connection, actor, len(set(payload.invitees)))
            outcome = {'command_id': request.command_id, 'status': 'rejected' if detail else 'accepted'}
            events = []
            if detail is not None:
                outcome['detail'] = detail
            else:
                table_id, match_id = creation_ids(claim.entry.lane_id, actor, request.command_id)
                # A previously committed creation is resolved from the inbox, not
                # adopted here. Colliding/corrupt catalog state must stop this head.
                collision = await (await claim.connection.execute('''SELECT 1 FROM room_tables WHERE table_id=%s
                    UNION ALL SELECT 1 FROM table_recovery_state WHERE match_id=%s
                    UNION ALL SELECT 1 FROM games WHERE id=%s LIMIT 1''',
                    (table_id, match_id, match_id))).fetchone()
                if collision:
                    raise DurableGameConflict('Creation identities already exist without this completed receipt.')
                if old_game is not None:
                    round_number = old.checkpoint['data']['engine']['state']['round_number'] if old_game.game_type == 'flush' else 0
                    finalization = await (await claim.connection.execute('''SELECT 1 FROM game_finalization_jobs
                        WHERE game_id=%s AND round_number=%s AND job_type='hosted_settlement' ''', (old_game.durable_game_id, round_number))).fetchone()
                    if finalization is None:
                        raise DurableGameConflict('Replacement would discard a missing settlement intent.')
                    old_invitations = close_table(old_game, actor, 'replace-table', old.checkpoint['data']['invitations'])
                    events.extend(OutgoingEvent({'type':'TABLE_EVENT', 'table_id':old_game.table.table_id, **event})
                        for event in old_game.table.events[old_game.table.published_sequence:])
                    old_game.table.published_sequence = len(old_game.table.events)
                    await self.checkpoints.save_in_transaction(claim.connection,
                        capture_checkpoint(old_game, table_revision=payload.replace_revision + 1, invitations=old_invitations),
                        expected_revision=payload.replace_revision, fence=fence, receipt_limit=old.receipt_snapshot['receipt_limit'])
                    await cancel_pending_actions(claim.connection, old_game.table.table_id)
                    events.append(OutgoingEvent(dict(type='TABLE_STATE_CHANGED', table_id=old_game.table.table_id,
                        match_id=old_game.match_id, table_revision=payload.replace_revision + 1)))
                game = HostedGame(claim.target.room_id, payload.capacity, [actor],
                    name=' '.join(payload.name.split()), game_type=payload.game_type,
                    table=TableState(table_id=table_id.hex), commands=CommandSession(match_id=match_id.hex))
                if game.game_type == 'flush':
                    game.flush_seats[actor] = 1
                invitations = await hosted_invitations.create(claim, game, payload.invitees)
                await self.checkpoints.save_in_transaction(claim.connection,
                    capture_checkpoint(game, table_revision=0, invitations=invitations), expected_revision=None, fence=fence)
                await self.inbox.ensure_lane_in_transaction(claim.connection, LaneTarget(
                    kind='table', room_id=claim.target.room_id, table_id=table_id))
                outcome.update(table_id=table_id.hex, match_id=match_id.hex, revision=0)
                events.append(OutgoingEvent({'type': 'TABLE_CREATED', 'table_id': table_id.hex,
                    'match_id': match_id.hex, 'game_type': payload.game_type, 'name': game.name, 'table_revision': 0}))
                events.extend(OutgoingEvent(dict(type='TABLE_INVITATION_CREATED', invitation_id=i['id'],
                    room_id=game.room_id, table_id=table_id.hex, match_id=game.match_id), i['recipient_id']) for i in invitations)
            if actor_id is not None:
                events.append(OutgoingEvent({'type': 'TABLE_CREATION_ACK', **outcome}, actor))
            await append_lane_events(claim, events, max_events=self.max_events)
            await claim.complete(outcome)
            result = ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
        return result
