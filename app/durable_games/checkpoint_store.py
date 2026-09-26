"""Transactional hosted recovery storage; deliberately not wired to live routing.

Callers supply engine-validated checkpoints under their game lock. Every write is
fenced by a room lease, then serialized by its table row (not an exclusive room
lock). The future inbox executor must call save_in_transaction in the SAME
transaction as inbox completion and outbox writes. No delivery belongs here.
"""
from dataclasses import dataclass
from hashlib import sha256
from uuid import UUID, uuid4

from psycopg.errors import UniqueViolation
from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb

from .checkpoints import CheckpointError, canonical_json, decode_checkpoint
from .recovery import ReceiptSnapshot, RecoveryReceipt
from .store import DurableGameConflict, DurableGameNotFound
from .ownership import RoomWriteFence, validate_room_fence


def digest(value):
    return sha256(canonical_json(value).encode()).hexdigest()


def user_uuid(value):
    # SQL UUIDs must round-trip to the exact authenticated application identity.
    result = UUID(value.removeprefix('user-'))
    if value != f'user-{result}':
        raise CheckpointError('Recovery storage requires canonical durable user IDs.')
    return result


@dataclass(frozen=True)
class StoredCheckpoint:
    checkpoint: dict
    receipt_snapshot: dict
    duplicate: bool = False


def _terminal(data):
    engine = data.engine
    return (data.host.ended or data.phase == 'COMPLETED' or
            (engine is not None and (engine.state.get('status') == 'finished' or
                                     engine.state.get('phase') == 'MATCH_COMPLETE')))


def _status(data):
    return 'closed' if data.host.ended else 'playing' if data.phase == 'STARTED' else 'waiting'


def _game_status(data):
    finished = data.engine and (data.engine.state.get('status') == 'finished' or
                                data.engine.state.get('phase') == 'MATCH_COMPLETE')
    return 'completed' if finished else 'abandoned' if data.host.ended else 'active'


class PostgresCheckpointStore:
    def __init__(self, pool):
        self.pool = pool

    async def save(self, checkpoint, *, expected_revision, fence: RoomWriteFence,
                   receipt=None, receipt_limit=10000):
        """Atomic save; None expects creation, otherwise revision must advance once.

        Receipt retries return the committed checkpoint, even if a speculative
        candidate differs. Callers must use the returned state before any delivery.
        No existing legacy journal is silently imported or rewritten.
        """
        try:
            async with self.pool.connection() as connection:
                async with connection.transaction():
                    return await self.save_in_transaction(connection, checkpoint,
                        expected_revision=expected_revision, fence=fence, receipt=receipt,
                        receipt_limit=receipt_limit)
        except UniqueViolation as error:
            raise DurableGameConflict('A table, game, player, or seat is already assigned.') from error

    async def _fence(self, connection, fence, room_id):
        await validate_room_fence(connection, fence, room_id)

    async def save_in_transaction(self, connection, checkpoint, *, expected_revision,
                                  fence, receipt=None, receipt_limit=10000):
        """Caller MUST own an open transaction; rolls back as a unit on any error."""
        if connection.info.transaction_status != TransactionStatus.INTRANS:
            raise RuntimeError('Checkpoint writes require an open transaction.')
        decoded = decode_checkpoint(checkpoint)
        data = decoded.record.data
        if type(receipt_limit) is not int or receipt_limit <= 0:
            raise CheckpointError('Receipt limit must be positive.')
        if expected_revision is not None and (type(expected_revision) is not int or expected_revision < 0):
            raise CheckpointError('Expected table revision must be nonnegative or None.')
        game_id = UUID(data.host.durable_game_id) if data.host.durable_game_id else None
        if (data.engine is None) != (game_id is None):
            raise CheckpointError('An engine checkpoint must identify its durable game.')
        receipt = RecoveryReceipt.model_validate_json(canonical_json(receipt)) if receipt is not None else None
        if receipt and (not data.engine or receipt.request.match_id != data.match_id or
                        receipt.outcome.revision != data.engine.revision):
            raise CheckpointError('Receipt does not describe this checkpoint.')
        table_id = UUID(data.table_id)
        await self._fence(connection, fence, data.room_id)
        if expected_revision is None:
            await connection.execute('''INSERT INTO room_tables (table_id,room_id,name,game_type)
                VALUES (%s,%s,%s,%s) ON CONFLICT (table_id) DO NOTHING''',
                (table_id, data.room_id, data.name, data.game_type))
        table = await (await connection.execute('''SELECT room_id,game_type,revision FROM room_tables
            WHERE table_id=%s FOR UPDATE''', (table_id,))).fetchone()
        if table is None:
            raise DurableGameNotFound(str(table_id))
        if table[:2] != (data.room_id, data.game_type):
            raise DurableGameConflict('Table identity cannot change.')
        previous = await self._load(connection, table_id, missing_ok=True)
        old = decode_checkpoint(previous.checkpoint).record.data if previous else None
        # Resolve unknown commits before revision validation. Never replace receipts.
        if receipt and previous and old.match_id == data.match_id:
            for prior in previous.receipt_snapshot['receipts']:
                if (prior['actor_id'], prior['request']['command_id']) == (receipt.actor_id, receipt.request.command_id):
                    if prior['fingerprint'] != receipt.fingerprint:
                        raise DurableGameConflict('Command ID already identifies a different request.')
                    return StoredCheckpoint(previous.checkpoint, previous.receipt_snapshot, True)
        if previous and previous.checkpoint == checkpoint:
            if receipt is not None:
                raise DurableGameConflict('Checkpoint retry cannot introduce a receipt.')
            if receipt_limit != previous.receipt_snapshot['receipt_limit']:
                raise DurableGameConflict('Receipt capacity cannot change on retry.')
            return StoredCheckpoint(previous.checkpoint, previous.receipt_snapshot, True)
        if ((old is None) != (expected_revision is None) or
                (old is not None and old.table_revision != expected_revision) or
                data.table_revision != (0 if expected_revision is None else expected_revision + 1)):
            raise DurableGameConflict('Table revision changed; reload committed state.')
        if old and old.host.ended:
            raise DurableGameConflict('A closed table cannot be reopened by checkpoint recovery.')
        if old and old.match_id == data.match_id and receipt_limit != previous.receipt_snapshot['receipt_limit']:
            raise DurableGameConflict('Receipt capacity cannot change during a match.')
        old_id = UUID(old.host.durable_game_id) if old and old.host.durable_game_id else None
        if old and (old.match_id != data.match_id or old_id != game_id) and old.engine and not _terminal(old):
            raise DurableGameConflict('An unfinished game cannot be replaced.')
        if receipt and (old is None or old_id != game_id):
            raise DurableGameConflict('Create the initial checkpoint before executing game commands.')
        if old and old.engine and old_id == game_id and old.engine != data.engine and receipt is None:
            raise DurableGameConflict('Engine advancement requires its original command and outcome.')
        if receipt:
            if receipt.outcome.status == 'rejected' and old.engine != data.engine:
                raise DurableGameConflict('A rejected command cannot change engine state.')
            if receipt.outcome.status == 'accepted' and receipt.request.expected_revision != old.engine.revision:
                raise DurableGameConflict('Accepted request does not match the committed revision.')
        if old_id and old_id != game_id:
            await connection.execute("UPDATE games SET status='completed',completed_at=COALESCE(completed_at,clock_timestamp()) WHERE id=%s", (old_id,))
            await connection.execute('DELETE FROM active_game_players WHERE game_id=%s', (old_id,))
        sequence = 0
        if game_id:
            sequence = await self._save_engine(connection, data, old, game_id, old_id, receipt)
        receipts = (list(previous.receipt_snapshot['receipts']) if old and old.match_id == data.match_id else [])
        if receipt:
            receipts.append(receipt.model_dump(mode='json', exclude_none=True))
        snapshot = ReceiptSnapshot.model_validate_json(canonical_json({
            'match_id': data.match_id, 'revision': data.engine.revision if data.engine else 0,
            'receipt_count': len(receipts), 'receipt_limit': receipt_limit, 'receipts': receipts,
        }))
        await self._positions(connection, data, game_id)
        # SQL owns current positions and engine snapshots; the document has no
        # duplicate copy of those facts. Digest covers the reassembled envelope.
        document = data.model_dump(mode='json')
        del document['positions'], document['engine']
        state = {'data': document, 'digest': decoded.record.digest,
                 'game_sequence': sequence, 'receipt_count': snapshot.receipt_count,
                 'receipt_limit': receipt_limit}
        await connection.execute('''INSERT INTO table_recovery_state
            (table_id,match_id,schema_version,revision,phase,capacity,state)
            VALUES (%s,%s,1,%s,%s,%s,%s) ON CONFLICT (table_id) DO UPDATE SET
            match_id=EXCLUDED.match_id,schema_version=1,revision=EXCLUDED.revision,
            phase=EXCLUDED.phase,capacity=EXCLUDED.capacity,state=EXCLUDED.state,saved_at=clock_timestamp()
        ''', (table_id, UUID(data.match_id), data.table_revision, data.phase, data.capacity, Jsonb(state)))
        await connection.execute('DELETE FROM table_positions WHERE table_id=%s', (table_id,))
        for position in data.positions:
            await connection.execute('''INSERT INTO table_positions (table_id,user_id,seat,queue_position)
                VALUES (%s,%s,%s,%s)''', (table_id, user_uuid(position.user_id), position.seat, position.queue_position))
        await connection.execute('''UPDATE room_tables SET name=%s,status=%s,revision=%s,
            closed_at=CASE WHEN %s='closed' THEN clock_timestamp() ELSE NULL END WHERE table_id=%s''',
            (data.name, _status(data), data.table_revision, _status(data), table_id))
        # Recheck wall-clock expiry after all work, even when the transaction began
        # before a pause. SHARE prevents concurrent takeover until commit/rollback.
        await self._fence(connection, fence, data.room_id)
        return await self._load(connection, table_id)

    async def _save_engine(self, connection, data, old, game_id, old_id, receipt):
        engine = data.engine.model_dump(mode='json')
        terminal = _terminal(data)
        if game_id != old_id:
            if await (await connection.execute('SELECT id FROM games WHERE id=%s', (game_id,))).fetchone():
                raise DurableGameConflict('Cannot import an existing or legacy game as a new checkpoint.')
            await connection.execute('''INSERT INTO games
                (id,room_id,table_id,game_type,engine_version,event_schema_version,initial_state,
                 current_revision,status,completed_at)
                VALUES (%s,%s,%s,%s,1,1,%s,%s,%s,CASE WHEN %s THEN clock_timestamp() ELSE NULL END)''',
                (game_id, data.room_id, UUID(data.table_id), data.game_type, Jsonb(engine),
                 data.engine.revision, _game_status(data), terminal))
            sequence = 0
        else:
            row = await (await connection.execute('''SELECT current_sequence,current_revision,status
                FROM games WHERE id=%s FOR UPDATE''', (game_id,))).fetchone()
            if row[1] != old.engine.revision:
                raise DurableGameConflict('Engine changed outside the checkpoint transaction.')
            if row[2] != 'active' and old.engine != data.engine:
                raise DurableGameConflict('A terminal engine cannot advance.')
            sequence = row[0]
            changed = old.engine != data.engine
            if changed and data.engine.revision <= old.engine.revision:
                raise DurableGameConflict('Engine change must advance revision.')
            next_sequence = sequence + int(changed)
            if receipt:
                await connection.execute('''INSERT INTO game_commands
                    (game_id,actor_id,command_id,request_fingerprint,expected_revision,status,
                     first_sequence,last_sequence,resulting_revision,rejection_code,rejection_detail,original_request)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                    (game_id, receipt.actor_id, receipt.request.command_id, receipt.fingerprint,
                     receipt.request.expected_revision, receipt.outcome.status,
                     next_sequence if changed else None, next_sequence if changed else None,
                     receipt.outcome.revision, 'HOSTED_REJECTION' if receipt.outcome.status == 'rejected' else None,
                     receipt.outcome.detail, Jsonb(receipt.request.model_dump(mode='json'))))
            if changed:
                await connection.execute('''INSERT INTO game_events
                    (game_id,sequence,event_id,actor_id,command_id,event_type,event_version,payload)
                    VALUES (%s,%s,%s,%s,%s,'HOSTED_CHECKPOINT_COMMITTED',1,%s)''',
                    (game_id, next_sequence, uuid4(), receipt.actor_id, receipt.request.command_id, Jsonb(engine)))
            sequence = next_sequence
            await connection.execute('''UPDATE games SET current_sequence=%s,current_revision=%s,
                status=%s,completed_at=CASE WHEN %s THEN COALESCE(completed_at,clock_timestamp()) ELSE NULL END WHERE id=%s''',
                (sequence, data.engine.revision, _game_status(data), terminal, game_id))
        existing = await (await connection.execute('SELECT state FROM game_snapshots WHERE game_id=%s AND sequence=%s',
                                                  (game_id, sequence))).fetchone()
        if existing:
            if existing[0] != engine:
                raise CheckpointError('Snapshot disagrees with committed state.')
        else:
            await connection.execute('''INSERT INTO game_snapshots (game_id,sequence,revision,
                engine_version,event_schema_version,snapshot_schema_version,state,state_digest)
                VALUES (%s,%s,%s,1,1,1,%s,%s)''',
                (game_id, sequence, data.engine.revision, Jsonb(engine), digest(engine)))
        return sequence

    async def _positions(self, connection, data, game_id):
        table_id = UUID(data.table_id)
        # Stable lock order across rooms/tables prevents reservation write skew.
        ids = sorted(user_uuid(p.user_id) for p in data.positions)
        for user_id in ids:
            await connection.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user_id,))
            member = await (await connection.execute('''SELECT user_id FROM room_memberships
                WHERE room_id=%s AND user_id=%s FOR KEY SHARE''', (data.room_id, user_id))).fetchone()
            if member is None:
                raise DurableGameConflict('A positioned user is no longer a room member.')
        await connection.execute('DELETE FROM active_table_players WHERE table_id=%s', (table_id,))
        if game_id:
            await connection.execute('DELETE FROM active_game_players WHERE game_id=%s', (game_id,))
        for position in data.positions:
            if position.seat is None:
                continue
            user_id = user_uuid(position.user_id)
            other = await (await connection.execute('SELECT game_id FROM active_game_players WHERE user_id=%s', (user_id,))).fetchone()
            if other is not None:
                raise DurableGameConflict('A seated user is reserved in another active game.')
            await connection.execute('''INSERT INTO active_table_players
                (user_id,table_id,match_id,room_id,game_type,seat) VALUES (%s,%s,%s,%s,%s,%s)''',
                (user_id, table_id, UUID(data.match_id), data.room_id, data.game_type, position.seat))
            if game_id and not _terminal(data):
                await connection.execute('''INSERT INTO active_game_players (user_id,game_id,room_id,seat)
                    VALUES (%s,%s,%s,%s)''', (user_id, game_id, data.room_id, position.seat))

    async def load(self, table_id):
        # All rows, including receipts/count/reservations, come from ONE snapshot.
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                return await self._load(connection, UUID(str(table_id)))

    async def load_for_update(self, connection, table_id):
        """Load under the table lock inside a room-fenced command transaction."""
        if connection.info.transaction_status != TransactionStatus.INTRANS:
            raise RuntimeError('Locked recovery requires an open transaction.')
        table_id = UUID(str(table_id))
        row = await (await connection.execute('SELECT table_id FROM room_tables WHERE table_id=%s FOR UPDATE',
                                              (table_id,))).fetchone()
        if row is None:
            raise DurableGameNotFound(str(table_id))
        return await self._load(connection, table_id)

    async def load_in_snapshot(self, connection, table_id):
        """Read within the caller's repeatable-read room inventory transaction.

        The caller owns isolation and ownership checks; this grants no write or
        activation permission and never opens a second connection/snapshot.
        """
        if connection.info.transaction_status != TransactionStatus.INTRANS:
            raise RuntimeError('Snapshot recovery requires an open transaction.')
        return await self._load(connection, UUID(str(table_id)))

    async def reject_claim(self, claim, stored, detail):
        """Record a no-effect rejection, including closed or superseded rounds.

        Caller holds the room/lane/table locks. Receipt metadata can advance even
        when the engine/table is terminal; no checkpoint facts are changed.
        """
        connection, entry = claim.connection, claim.entry
        if connection.info.transaction_status != TransactionStatus.INTRANS or not claim._active:
            raise RuntimeError('Rejection requires an active command transaction.')
        row = await (await connection.execute('''SELECT current_revision FROM games
            WHERE id=%s AND table_id=%s AND room_id=%s FOR UPDATE''',
            (claim.target.game_id, claim.target.table_id, claim.target.room_id))).fetchone()
        if row is None:
            raise DurableGameNotFound(str(claim.target.game_id))
        same_match = stored.checkpoint['data']['match_id'] == entry.request.match_id
        if same_match and stored.receipt_snapshot['receipt_count'] >= stored.receipt_snapshot['receipt_limit']:
            raise DurableGameConflict('The match has reached its command receipt limit.')
        outcome = {'command_id': entry.request.command_id, 'status': 'rejected', 'revision': row[0], 'detail': detail}
        await connection.execute('''INSERT INTO game_commands
            (game_id,actor_id,command_id,request_fingerprint,expected_revision,status,
             resulting_revision,rejection_code,rejection_detail,original_request)
            VALUES (%s,%s,%s,%s,%s,'rejected',%s,'EXECUTION_REJECTION',%s,%s)''',
            (claim.target.game_id, entry.actor_id, entry.request.command_id, entry.fingerprint,
             entry.request.expected_revision, row[0], detail, Jsonb(entry.request.model_dump(mode='json'))))
        if same_match:
            await connection.execute('''UPDATE table_recovery_state
                SET state=jsonb_set(state,'{receipt_count}',to_jsonb(%s::bigint)),saved_at=clock_timestamp()
                WHERE table_id=%s''', (stored.receipt_snapshot['receipt_count'] + 1, claim.target.table_id))
        return outcome

    async def _load(self, connection, table_id, missing_ok=False):
        row = await (await connection.execute('''SELECT r.match_id,r.schema_version,r.revision,r.phase,
            r.capacity,r.state,t.room_id,t.game_type,t.name,t.revision,t.status
            FROM table_recovery_state r JOIN room_tables t USING(table_id) WHERE r.table_id=%s''', (table_id,))).fetchone()
        if row is None:
            if missing_ok:
                return None
            raise DurableGameNotFound(str(table_id))
        match_id, version, revision, phase, capacity, stored, room, kind, name, table_revision, status = row
        data = dict(stored['data'])
        if (version != 1 or (UUID(data['table_id']), UUID(data['match_id']), data['table_revision'], data['phase'],
                data['capacity'], data['room_id'], data['game_type'], data['name']) !=
                (table_id, match_id, revision, phase, capacity, room, kind, name) or revision != table_revision):
            raise CheckpointError('Table metadata does not match its recovery document.')
        positions = await (await connection.execute('''SELECT user_id,seat,queue_position FROM table_positions
            WHERE table_id=%s ORDER BY seat NULLS LAST,queue_position''', (table_id,))).fetchall()
        data['positions'] = [{'user_id': f'user-{u}', 'seat': s, 'queue_position': q} for u, s, q in positions]
        game_id = UUID(data['host']['durable_game_id']) if data['host']['durable_game_id'] else None
        data['engine'] = None
        if game_id:
            data['engine'] = await self._load_engine(connection, game_id, table_id, room, kind, stored['game_sequence'])
        envelope = {'schema_version': version, 'data': data, 'digest': stored['digest']}
        decoded = decode_checkpoint(envelope)
        if status != _status(decoded.record.data):
            raise CheckpointError('Table lifecycle disagrees with its checkpoint.')
        if game_id:
            game_status = await (await connection.execute('SELECT status FROM games WHERE id=%s', (game_id,))).fetchone()
            if game_status[0] != _game_status(decoded.record.data):
                raise CheckpointError('Game lifecycle disagrees with its checkpoint.')
        receipts = await self._receipts(connection, table_id, data['match_id'])
        snapshot = ReceiptSnapshot.model_validate_json(canonical_json({
            'match_id': data['match_id'], 'revision': data['engine']['revision'] if data['engine'] else 0,
            'receipt_count': stored['receipt_count'], 'receipt_limit': stored['receipt_limit'], 'receipts': receipts,
        }))
        await self._check_reservations(connection, decoded.record.data, game_id)
        return StoredCheckpoint(envelope, snapshot.model_dump(mode='json', exclude_none=True))

    async def _load_engine(self, connection, game_id, table_id, room, kind, sequence):
        row = await (await connection.execute('''SELECT g.table_id,g.room_id,g.game_type,g.current_sequence,
            g.current_revision,g.initial_state,s.state,s.state_digest,s.revision,
            g.engine_version,g.event_schema_version,s.engine_version,s.event_schema_version,s.snapshot_schema_version
            FROM games g JOIN game_snapshots s ON s.game_id=g.id AND s.sequence=g.current_sequence
            WHERE g.id=%s''', (game_id,))).fetchone()
        if (row is None or row[:4] != (table_id, room, kind, sequence) or row[4] != row[8] or
                row[9:] != (1, 1, 1, 1, 1) or digest(row[6]) != row[7]):
            raise CheckpointError('Engine snapshot is missing, incompatible, or outside the journal boundary.')
        events = await (await connection.execute('''SELECT sequence,event_type,event_version,payload
            FROM game_events WHERE game_id=%s ORDER BY sequence''', (game_id,))).fetchall()
        state = row[5]
        for index, (seq, event_type, event_version, payload) in enumerate(events, 1):
            if (seq != index or event_type != 'HOSTED_CHECKPOINT_COMMITTED' or event_version != 1 or
                    payload['revision'] <= state['revision']):
                raise CheckpointError('Checkpoint journal is not contiguous and advancing.')
            state = payload
        if len(events) != sequence or state != row[6] or state['revision'] != row[4]:
            raise CheckpointError('Snapshot does not reproduce the committed journal prefix.')
        return row[6]

    async def _receipts(self, connection, table_id, match_id):
        # Flush rounds can use distinct durable game IDs under one hosted match.
        rows = await (await connection.execute('''SELECT c.actor_id,c.original_request,c.request_fingerprint,
            c.command_id,c.status,c.resulting_revision,c.rejection_detail,c.expected_revision
            FROM game_commands c JOIN games g ON c.game_id=g.id
            WHERE g.table_id=%s ORDER BY c.created_at,c.game_id,c.actor_id,c.command_id''', (table_id,))).fetchall()
        result = []
        for actor, request, fingerprint, command_id, status, revision, detail, expected in rows:
            if request is None:
                raise CheckpointError('Legacy receipt has no recoverable original request.')
            if request.get('match_id') != match_id:
                continue
            if request.get('expected_revision') != expected:
                raise CheckpointError('Receipt original revision mismatch.')
            outcome = {'command_id': command_id, 'status': status, 'revision': revision}
            if detail is not None:
                outcome['detail'] = detail
            result.append({'actor_id': actor, 'request': request, 'fingerprint': fingerprint, 'outcome': outcome})
        return result

    async def _check_reservations(self, connection, data, game_id):
        expected = {(user_uuid(p.user_id), p.seat) for p in data.positions if p.seat is not None}
        rows = await (await connection.execute('''SELECT user_id,seat,match_id,room_id,game_type
            FROM active_table_players WHERE table_id=%s''', (UUID(data.table_id),))).fetchall()
        if ({(r[0], r[1]) for r in rows} != expected or
                any(r[2:] != (UUID(data.match_id), data.room_id, data.game_type) for r in rows)):
            raise CheckpointError('Table reservations disagree with normalized positions.')
        if game_id:
            rows = await (await connection.execute('SELECT user_id,seat,room_id FROM active_game_players WHERE game_id=%s', (game_id,))).fetchall()
            if ({(r[0], r[1]) for r in rows} != (set() if _terminal(data) else expected) or
                    any(r[2] != data.room_id for r in rows)):
                raise CheckpointError('Game reservations disagree with normalized positions.')
        for position in data.positions:
            if not await (await connection.execute('''SELECT 1 FROM room_memberships
                WHERE room_id=%s AND user_id=%s''', (data.room_id, user_uuid(position.user_id)))).fetchone():
                raise CheckpointError('Recovered position belongs to a former room member.')

    async def lookup_receipt(self, table_id, actor_id, command):
        """Trusted status lookup across rematches/terminal games; auth is upstream."""
        from app.runtime.command_runtime import request_fingerprint
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                rows = await self._receipts(connection, UUID(str(table_id)), command.match_id)
                for receipt in rows:
                    if receipt['actor_id'] == actor_id and receipt['request']['command_id'] == command.command_id:
                        validated = RecoveryReceipt.model_validate_json(canonical_json(receipt))
                        if validated.fingerprint != request_fingerprint(command):
                            raise DurableGameConflict('Command ID already identifies a different request.')
                        return validated.outcome.model_dump(exclude_none=True)
                return None
