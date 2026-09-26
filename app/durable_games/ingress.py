"""Explicit authenticated ingress/status contract; no HTTP/WS installation.

The transport supplies the authenticated actor, never an actor from request JSON.
PostgreSQL commit precedes the optional wakeup. A wakeup failure cannot turn a
durably queued request into an execution failure. Callers retain the original ID.
"""
import asyncio
import math
from uuid import UUID

from .checkpoints import canonical_json
from .checkpoint_store import user_uuid
from .creation_executor import CreateTablePayload
from .inbox import InboxRequest, LaneTarget, _fingerprint
from .queries import QueryAccessDenied, require_member
from .store import DurableGameConflict, DurableGameNotFound
from .table_executor import TableLaneExecutor
from .room_commands import MODELS as ROOM_MODELS, can_enter, Answer
from .settlements import MODELS as SETTLEMENT_MODELS


def command_status(entry):
    return dict(lane_id=str(entry.lane_id), sequence=entry.sequence,
        command_id=entry.request.command_id, status=entry.status,
        outcome=entry.outcome, status_reference=dict(lane_id=str(entry.lane_id),
            command_id=entry.request.command_id))


class HostedCommandIngress:
    def __init__(self, inbox, *, wakeup=None, wakeup_timeout=1.0):
        if not math.isfinite(wakeup_timeout) or wakeup_timeout <= 0:
            raise ValueError('Wakeup timeout must be finite and positive.')
        self.inbox, self.pool, self.wakeup = inbox, inbox.pool, wakeup
        self.wakeup_timeout = wakeup_timeout

    async def submit(self, actor, target, body):
        user_uuid(actor)
        target = LaneTarget.model_validate(target)
        request = InboxRequest.model_validate_json(canonical_json(body))
        if target.kind not in ('room', 'table', 'game'):
            raise DurableGameConflict('This ingress only handles hosted game commands.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                if target.kind == 'room' and request.command in ('enter-room', 'answer-room-invitation'):
                    room = await (await connection.execute('''SELECT id,creator_id,visibility FROM rooms
                        WHERE id=%s AND NOT EXISTS (SELECT 1 FROM deleted_rooms WHERE id=%s)''', (target.room_id, target.room_id))).fetchone()
                    if room is None:
                        raise DurableGameNotFound('Room not found.')
                    if request.command == 'enter-room' and not await can_enter(connection, room, actor):
                        raise QueryAccessDenied('Room access is required.')
                    if request.command == 'answer-room-invitation':
                        answer = Answer.model_validate_json(canonical_json(request.payload))
                        invitation = await (await connection.execute('SELECT 1 FROM room_invitations WHERE id=%s AND room_id=%s AND recipient_id=%s', (answer.invitation_id, target.room_id, actor))).fetchone()
                        if invitation is None:
                            raise QueryAccessDenied('Invitation does not belong to you.')
                elif not (target.kind == 'table' and request.command == 'answer-table-invitation'):
                    await require_member(connection, target.room_id, actor)
                if target.table_id is not None:
                    row = await (await connection.execute('''SELECT 1 FROM room_tables
                        WHERE room_id=%s AND table_id=%s''', (target.room_id, target.table_id))).fetchone()
                    if row is None:
                        raise DurableGameNotFound('Table not found in this room.')
                lane_id = await self.inbox.ensure_lane_in_transaction(connection, target)
                prior = await self.inbox._lookup(connection, lane_id, actor, request.command_id)
                if prior is not None:
                    if prior.fingerprint != _fingerprint(request):
                        raise DurableGameConflict('Command ID already identifies a different request.')
                    entry = prior
                else:
                    if target.kind == 'room':
                        if request.command != 'create-table' and request.command not in ROOM_MODELS and request.command not in SETTLEMENT_MODELS:
                            raise DurableGameConflict('Unsupported room command.')
                        model = SETTLEMENT_MODELS.get(request.command, ROOM_MODELS.get(request.command, CreateTablePayload))
                        model.model_validate_json(canonical_json(request.payload))
                        if request.match_id is not None or request.expected_revision is not None:
                            raise DurableGameConflict('Creation has no existing match or revision.')
                    else:
                        if request.match_id is None or request.expected_revision is None:
                            raise DurableGameConflict('Stable match identity and expected revision are required.')
                        if target.kind == 'table':
                            if request.command not in TableLaneExecutor.commands or request.command == 'expire-seat-offer':
                                raise DurableGameConflict('Unsupported player table command.')
                            if request.command == 'send-poke':
                                from .pokes import Poke
                                Poke.model_validate_json(canonical_json(request.payload))
                            # Match execution's lane -> table order. Checkpoint
                            # state stores the engine separately from table JSON.
                            await connection.execute('SELECT lane_id FROM command_lanes WHERE lane_id=%s FOR UPDATE', (lane_id,))
                            saved = await self.inbox.checkpoints.load_for_update(connection, target.table_id)
                            if request.command == 'answer-table-invitation':
                                answer = Answer.model_validate_json(canonical_json(request.payload))
                                if not any(i.get('id') == answer.invitation_id and i.get('recipient_id') == actor
                                           for i in saved.checkpoint['data']['invitations']):
                                    raise QueryAccessDenied('Invitation does not belong to you.')
                            TableLaneExecutor.check_capability(saved.checkpoint['data'], request.command)
                    entry = await self.inbox.enqueue_in_transaction(connection, lane_id, actor,
                        request.model_dump(mode='json'))
        if self.wakeup is not None and entry.status == 'pending':
            try:
                await asyncio.wait_for(self.wakeup(target.room_id, entry.lane_id), timeout=self.wakeup_timeout)
            except Exception:
                # Delivery diagnostics belong to the transport. The committed
                # inbox and fallback scanner remain authoritative for progress.
                pass
        return command_status(entry)

    async def status(self, actor, lane_id, command_id):
        """Only the actor's own receipt, including after room departure/rematch.

        No checkpoint, payload, private cards, or another actor's outcome is exposed.
        Current room membership is not required to resolve an earlier submission.
        """
        user_uuid(actor)
        entry = await self.inbox.lookup(UUID(str(lane_id)), actor, command_id)
        if entry is None:
            raise DurableGameNotFound('Command not found.')
        return command_status(entry)
