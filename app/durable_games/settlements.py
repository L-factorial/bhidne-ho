"""Manual settlement effects and receipts share a fenced room-lane transaction."""
from hashlib import sha256
from typing import Literal
from uuid import UUID, uuid5, NAMESPACE_URL

from pydantic import model_validator
from app.ledger.service import transfer_plan
from app.runtime.command_runtime import OutgoingEvent
from .checkpoints import Record, canonical_json
from .checkpoint_store import user_uuid
from .executor import ExecutionResult
from .outbox import append_lane_events
from .queries import require_member


class Create(Record):
    scope: Literal['game', 'table']
    table_id: UUID
    game_id: UUID | None = None

    @model_validator(mode='after')
    def scope_matches(self):
        if (self.scope == 'game') != (self.game_id is not None):
            raise ValueError('Game scope requires exactly one game ID.')
        return self


class Act(Record):
    batch_id: UUID
    transfer_id: UUID
    action: Literal['mark-paid', 'confirm']


MODELS = {'create-settlement': Create, 'settlement-action': Act}


async def execute(claim):
    connection, request, actor, room = claim.connection, claim.entry.request, claim.entry.actor_id, claim.target.room_id
    detail, operation = None, None
    try:
        who = user_uuid(actor)
        await require_member(connection, room, actor)
        payload = MODELS[request.command].model_validate_json(canonical_json(request.payload))
        if request.match_id is not None or request.expected_revision is not None:
            raise ValueError('Settlement commands have no gameplay revision.')
        if request.command == 'create-settlement':
            games = await (await connection.execute('''SELECT g.game_id FROM ledger_games g
                WHERE g.room_id=%s AND g.table_id=%s AND (%s::uuid IS NULL OR g.game_id=%s)
                AND NOT EXISTS (SELECT 1 FROM settlement_games s WHERE s.game_id=g.game_id)
                ORDER BY g.game_id LIMIT 1001''', (room, payload.table_id, payload.game_id, payload.game_id))).fetchall()
            if not games or len(games) > 1000:
                raise ValueError('Settlement requires 1 to 1000 unclaimed completed games.')
            ids = [str(row[0]) for row in games]
            rows = await (await connection.execute('''SELECT player_id,sum(amount) FROM game_ledger_entries
                WHERE game_id=ANY(%s::uuid[]) GROUP BY player_id''', (ids,))).fetchall()
            balances = {player: int(amount) for player, amount in rows}
            if not balances.get(who):
                raise PermissionError('Only a player with an outstanding balance can create a settlement.')
            transfers = transfer_plan(balances)
            if not transfers or sum(balances.values()) != 0:
                raise ValueError('Settlement balances are invalid or empty.')
            operation = 'create'
        else:
            row = await (await connection.execute('''SELECT t.payer_id,t.payee_id,t.status
                FROM settlement_transfers t JOIN settlement_batches b USING(batch_id)
                WHERE b.room_id=%s AND b.batch_id=%s AND t.transfer_id=%s FOR UPDATE OF t,b''',
                (room, payload.batch_id, payload.transfer_id))).fetchone()
            if row is None:
                raise ValueError('Settlement transfer not found in this room.')
            required_actor, required_state = (row[0], 'OPEN') if payload.action == 'mark-paid' else (row[1], 'MARKED_PAID')
            if who != required_actor:
                raise PermissionError('Only the designated payer/payee can perform this action.')
            if row[2] != required_state:
                raise ValueError('Settlement transfer is not in the required state.')
            operation = 'act'
    except (ValueError, PermissionError) as error:
        detail = str(error)
    outcome = dict(command_id=request.command_id, status='rejected' if detail else 'accepted')
    events = []
    if detail:
        outcome['detail'] = detail
    else:
        key = sha256(canonical_json(['settlement', str(claim.entry.lane_id), actor, request.command_id]).encode()).hexdigest()
        if operation == 'create':
            batch = uuid5(NAMESPACE_URL, key)
            await connection.execute('''INSERT INTO settlement_batches
                (batch_id,room_id,table_id,scope,game_id,status,created_by,idempotency_key)
                VALUES (%s,%s,%s,%s,%s,'OPEN',%s,%s)''',
                (batch, room, payload.table_id, payload.scope, payload.game_id, who, key))
            for game in ids:
                await connection.execute('INSERT INTO settlement_games(batch_id,game_id) VALUES (%s,%s)', (batch, game))
            for index, (payer, payee, amount) in enumerate(transfers):
                await connection.execute('''INSERT INTO settlement_transfers
                    (transfer_id,batch_id,payer_id,payee_id,amount,status) VALUES (%s,%s,%s,%s,%s,'OPEN')''',
                    (uuid5(batch, str(index)), batch, payer, payee, amount))
        else:
            batch = payload.batch_id
            if payload.action == 'mark-paid':
                await connection.execute("UPDATE settlement_transfers SET status='MARKED_PAID',marked_paid_at=clock_timestamp() WHERE transfer_id=%s", (payload.transfer_id,))
            else:
                await connection.execute("UPDATE settlement_transfers SET status='RESOLVED',resolved_at=clock_timestamp() WHERE transfer_id=%s", (payload.transfer_id,))
            await connection.execute('INSERT INTO settlement_actions(actor_id,action,idempotency_key,transfer_id) VALUES (%s,%s,%s,%s)',
                (who, payload.action, key, payload.transfer_id))
            await connection.execute('''UPDATE settlement_batches b SET status=CASE
                WHEN NOT EXISTS(SELECT 1 FROM settlement_transfers t WHERE t.batch_id=b.batch_id AND t.status<>'RESOLVED') THEN 'RESOLVED'
                WHEN EXISTS(SELECT 1 FROM settlement_transfers t WHERE t.batch_id=b.batch_id AND t.status='RESOLVED') THEN 'PARTIALLY_RESOLVED'
                ELSE 'OPEN' END WHERE batch_id=%s''', (batch,))
        events.append(OutgoingEvent(dict(type='SETTLEMENT_CHANGED', room_id=room, batch_id=str(batch))))
    events.append(OutgoingEvent(dict(type='ROOM_COMMAND_ACK', **outcome), actor))
    await append_lane_events(claim, events)
    await claim.complete(outcome)
    return ExecutionResult(claim.entry.lane_id, claim.entry.sequence, outcome)
