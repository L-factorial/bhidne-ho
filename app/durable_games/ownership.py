"""Explicit PostgreSQL registry and room ownership primitives; no background worker.

Instance IDs identify one process boot. Callers retain registration/acquisition
secrets across uncertain responses. Ownership uses DB wall-clock time and row
locks; heartbeat is eligibility/routing information, never permission to steal a
live room lease. Activation is a trusted recovery coordinator's explicit action.
"""
from dataclasses import dataclass, field
from datetime import datetime
import json
from secrets import compare_digest, token_urlsafe
from uuid import uuid4

from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb

from .store import DurableGameConflict, DurableGameNotFound, StaleGameOwner, _token_hash


@dataclass(frozen=True)
class InstanceRegistration:
    instance_id: str
    token: str = field(repr=False)

    @classmethod
    def new(cls):
        return cls(uuid4().hex, token_urlsafe(32))


@dataclass(frozen=True)
class RoomWriteFence:
    room_id: str
    instance_id: str
    epoch: int
    token: str = field(repr=False)


@dataclass(frozen=True)
class RoomLease:
    fence: RoomWriteFence
    expires_at: datetime
    status: str


@dataclass(frozen=True)
class RoomOwnership:
    room_id: str
    instance_id: str | None
    epoch: int
    status: str
    expires_at: datetime | None
    live: bool
    internal_address: str | None
    instance_fresh: bool
    instance_draining: bool


class StaleInstance(RuntimeError):
    pass


class QuarantinedRoom(DurableGameConflict):
    pass


def _identity(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Identity must be a nonempty string.')


def _secret(value):
    if not isinstance(value, str) or not 32 <= len(value) <= 256:
        raise ValueError('Use a stable random token between 32 and 256 characters.')


def _duration(value, maximum=120):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError(f'Duration must be an integer between 1 and {maximum} seconds.')


def _matches(row, fence):
    return (row[0] == fence.instance_id and row[1] == fence.epoch and row[2] is not None
            and compare_digest(bytes(row[2]), _token_hash(fence.token)))


async def validate_room_fence(connection, fence, room_id):
    """Shared command lock: concurrent games coexist, takeover waits for commit."""
    if connection.info.transaction_status != TransactionStatus.INTRANS:
        raise RuntimeError('Room fencing requires an open transaction.')
    if fence.room_id != room_id:
        raise StaleGameOwner('Room fence belongs to another room.')
    row = await (await connection.execute('''SELECT owner_instance_id,ownership_epoch,
        fencing_token_hash,lease_expires_at,runtime_status FROM room_ownership
        WHERE room_id=%s FOR SHARE''', (room_id,))).fetchone()
    # Compute time AFTER lock acquisition. A SELECT projection could otherwise
    # have been evaluated before waiting for the row lock.
    now = (await (await connection.execute('SELECT clock_timestamp()')).fetchone())[0]
    if row is None or not _matches(row, fence) or row[3] is None or row[3] <= now or row[4] != 'serving':
        raise StaleGameOwner('Room is not serving under this live fence.')


class PostgresRoomOwnershipStore:
    def __init__(self, pool, *, heartbeat_ttl=30):
        _duration(heartbeat_ttl, 300)
        self.pool, self.heartbeat_ttl = pool, heartbeat_ttl

    async def register(self, registration, internal_address, *, capabilities=None):
        """Retry the same boot identity/secret/configuration; never replace a boot."""
        _identity(registration.instance_id)
        _secret(registration.token)
        _identity(internal_address)
        capabilities = {} if capabilities is None else capabilities
        if not isinstance(capabilities, dict):
            raise ValueError('Capabilities must be a JSON object.')
        capabilities = json.loads(json.dumps(capabilities, allow_nan=False))
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('''INSERT INTO server_instances
                    (instance_id,internal_address,capabilities,registration_token_hash)
                    VALUES (%s,%s,%s,%s) ON CONFLICT (instance_id) DO NOTHING''',
                    (registration.instance_id, internal_address, Jsonb(capabilities), _token_hash(registration.token)))
                await self._instance(connection, registration, fresh=False)
                matches = await (await connection.execute('''SELECT internal_address=%s AND capabilities=%s
                    FROM server_instances WHERE instance_id=%s''',
                    (internal_address, Jsonb(capabilities), registration.instance_id))).fetchone()
                if not matches[0]:
                    raise DurableGameConflict('Registered boot configuration cannot be replaced.')
        return registration

    async def _instance(self, connection, registration, *, fresh=True, accepting=False, exclusive=False):
        row = await (await connection.execute('''SELECT internal_address,capabilities,registration_token_hash,
            heartbeat_at,draining FROM server_instances WHERE instance_id=%s ''' + ('FOR UPDATE' if exclusive else 'FOR SHARE'),
            (registration.instance_id,))).fetchone()
        if row is None or row[2] is None or not compare_digest(bytes(row[2]), _token_hash(registration.token)):
            raise StaleInstance('Server registration does not identify this process boot.')
        valid = await (await connection.execute('''SELECT heartbeat_at > clock_timestamp()-(%s * interval '1 second')
            FROM server_instances WHERE instance_id=%s''', (self.heartbeat_ttl, registration.instance_id))).fetchone()
        if (fresh and not valid[0]) or (accepting and row[4]):
            raise StaleInstance('Server heartbeat is stale or server is draining.')
        return row

    async def heartbeat(self, registration):
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''UPDATE server_instances SET heartbeat_at=clock_timestamp()
                WHERE instance_id=%s AND registration_token_hash=%s RETURNING heartbeat_at''',
                (registration.instance_id, _token_hash(registration.token)))).fetchone()
        if row is None:
            raise StaleInstance('Server registration does not identify this process boot.')
        return row[0]

    async def drain_instance(self, registration):
        # Does not revoke existing room leases. Coordinator drains/releases rooms
        # explicitly; no instance-row -> room-row lock cycle in this operation.
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''UPDATE server_instances SET draining=true
                WHERE instance_id=%s AND registration_token_hash=%s RETURNING instance_id''',
                (registration.instance_id, _token_hash(registration.token)))).fetchone()
        if row is None:
            raise StaleInstance('Server registration does not identify this process boot.')

    async def _room(self, connection, room_id):
        row = await (await connection.execute('''SELECT owner_instance_id,ownership_epoch,
            fencing_token_hash,lease_expires_at,runtime_status FROM room_ownership
            WHERE room_id=%s FOR UPDATE''', (room_id,))).fetchone()
        if row is None:
            raise DurableGameNotFound(room_id)
        now = (await (await connection.execute('SELECT clock_timestamp()')).fetchone())[0]
        return row, now

    async def acquire(self, room_id, registration, *, expected_epoch, token, lease_seconds=30):
        """Acquire a free/expired room into recovering; retry with the SAME inputs.

        expected_epoch prevents an old delayed acquire from reclaiming a room after
        release. A retry of a committed, still-live acquisition returns its current
        lease without extending it or resetting recovery/serving state.
        """
        _identity(room_id)
        _secret(token)
        _duration(lease_seconds)
        if type(expected_epoch) is not int or expected_epoch < 0:
            raise ValueError('Expected epoch must be a nonnegative integer.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                instance = await self._instance(connection, registration, accepting=True, exclusive=True)
                await connection.execute('''INSERT INTO room_ownership (room_id) VALUES (%s)
                    ON CONFLICT (room_id) DO NOTHING''', (room_id,))
                row, now = await self._room(connection, room_id)
                await self._instance(connection, registration, accepting=True)
                now = (await (await connection.execute('SELECT clock_timestamp()')).fetchone())[0]
                retried = RoomWriteFence(room_id, registration.instance_id, expected_epoch + 1, token)
                if _matches(row, retried):
                    if row[3] <= now:
                        raise StaleGameOwner('The retried acquisition has expired; start a new acquisition.')
                    return RoomLease(retried, row[3], row[4])
                if row[1] != expected_epoch:
                    raise DurableGameConflict('Room epoch changed; inspect ownership before acquiring.')
                if row[2] is not None and compare_digest(bytes(row[2]), _token_hash(token)):
                    raise DurableGameConflict('A new acquisition requires a new token.')
                if row[4] == 'quarantined':
                    raise DurableGameConflict('Quarantined room requires explicit repair and release.')
                if row[3] is not None and row[3] > now:
                    raise DurableGameConflict('Room already has a live owner.')
                capacity = instance[1].get('room_capacity')
                if capacity is not None:
                    if type(capacity) is not int or capacity < 1:
                        raise DurableGameConflict('Invalid advertised room capacity.')
                    count = (await (await connection.execute('''SELECT count(*) FROM room_ownership
                        WHERE owner_instance_id=%s AND lease_expires_at>clock_timestamp()''',
                        (registration.instance_id,))).fetchone())[0]
                    if count >= capacity:
                        raise DurableGameConflict('Server room capacity is exhausted.')
                updated = await (await connection.execute('''UPDATE room_ownership
                    SET owner_instance_id=%s,ownership_epoch=ownership_epoch+1,fencing_token_hash=%s,
                        lease_expires_at=clock_timestamp()+(%s * interval '1 second'),runtime_status='recovering'
                    WHERE room_id=%s RETURNING ownership_epoch,lease_expires_at''',
                    (registration.instance_id, _token_hash(token), lease_seconds, room_id))).fetchone()
                fence = RoomWriteFence(room_id, registration.instance_id, updated[0], token)
                return RoomLease(fence, updated[1], 'recovering')

    async def _owned(self, connection, registration, fence, *, fresh=False, accepting=False):
        if registration.instance_id != fence.instance_id:
            raise StaleGameOwner('Fence belongs to another process boot.')
        await self._instance(connection, registration, fresh=fresh, accepting=accepting)
        row, now = await self._room(connection, fence.room_id)
        if fresh:
            await self._instance(connection, registration, fresh=True, accepting=accepting)
            now = (await (await connection.execute('SELECT clock_timestamp()')).fetchone())[0]
        if not _matches(row, fence) or row[3] is None or row[3] <= now:
            raise StaleGameOwner('Room lease is expired, released, or fenced.')
        return row

    async def renew(self, registration, fence, *, lease_seconds=30):
        _duration(lease_seconds)
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row = await self._owned(connection, registration, fence, fresh=True)
                expires = await (await connection.execute('''UPDATE room_ownership
                    SET lease_expires_at=GREATEST(lease_expires_at,clock_timestamp()+(%s * interval '1 second'))
                    WHERE room_id=%s AND lease_expires_at>clock_timestamp() RETURNING lease_expires_at''',
                    (lease_seconds, fence.room_id))).fetchone()
                if expires is None:
                    raise StaleGameOwner('Room expired before renewal.')
                return RoomLease(fence, expires[0], row[4])

    async def activate(self, registration, fence):
        """Trusted coordinator calls ONLY after recovery and compatibility checks."""
        return await self._transition(registration, fence, 'serving', {'recovering'})

    async def drain(self, registration, fence):
        return await self._transition(registration, fence, 'draining', {'recovering', 'serving'})

    async def quarantine(self, registration, fence):
        """Retry the exact transition even after a committed quarantine expires.

        Expiry never authorizes a new quarantine write. It only permits observing
        an already committed quarantine under the same boot, epoch and secret.
        """
        if registration.instance_id != fence.instance_id:
            raise StaleGameOwner('Fence belongs to another process boot.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await self._instance(connection, registration, fresh=False)
                row, now = await self._room(connection, fence.room_id)
                if not _matches(row, fence):
                    raise StaleGameOwner('Quarantine fence was replaced or released.')
                if row[4] == 'quarantined':
                    return RoomLease(fence, row[3], 'quarantined')
                if row[3] is None or row[3] <= now:
                    raise StaleGameOwner('Room expired before quarantine.')
                updated = await (await connection.execute('''UPDATE room_ownership
                    SET runtime_status='quarantined' WHERE room_id=%s
                    AND lease_expires_at>clock_timestamp() RETURNING lease_expires_at''',
                    (fence.room_id,))).fetchone()
                if updated is None:
                    raise StaleGameOwner('Room expired before quarantine.')
                return RoomLease(fence, updated[0], 'quarantined')

    async def retry_quarantined(self, room_id, *, expected_epoch):
        """Trusted repair control only: clear quarantine without editing game data.

        Caller must authorize repair/retry outside this store. No automatic runtime
        path calls this. New recovery must acquire a fresh epoch before serving.
        """
        _identity(room_id)
        if type(expected_epoch) is not int or expected_epoch < 1:
            raise ValueError('Expected quarantine epoch must be positive.')
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row, _ = await self._room(connection, room_id)
                if row[1] != expected_epoch:
                    raise DurableGameConflict('Room epoch changed after repair inspection.')
                if row[4] == 'unowned':
                    return False
                if row[4] != 'quarantined':
                    raise DurableGameConflict('Only a quarantined room can be retried after repair.')
                await connection.execute('''UPDATE room_ownership SET owner_instance_id=NULL,
                    fencing_token_hash=NULL,lease_expires_at=NULL,runtime_status='unowned'
                    WHERE room_id=%s''', (room_id,))
                return True

    async def _transition(self, registration, fence, status, allowed):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row = await self._owned(connection, registration, fence,
                                        fresh=status == 'serving', accepting=status == 'serving')
                if row[4] != status and row[4] not in allowed:
                    raise DurableGameConflict('Illegal room runtime transition.')
                updated = await (await connection.execute('''UPDATE room_ownership SET runtime_status=%s
                    WHERE room_id=%s AND lease_expires_at>clock_timestamp() RETURNING lease_expires_at''',
                    (status, fence.room_id))).fetchone()
                if updated is None:
                    raise StaleGameOwner('Room expired before runtime transition.')
                return RoomLease(fence, updated[0], status)

    async def release(self, registration, fence, *, preserve_quarantine=False):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                if registration.instance_id != fence.instance_id:
                    raise StaleGameOwner('Fence belongs to another process boot.')
                await self._instance(connection, registration, fresh=False)
                row, now = await self._room(connection, fence.room_id)
                if row[4] == 'unowned' and row[1] == fence.epoch:
                    return False  # A repeated release is an acknowledgment, not a write.
                if preserve_quarantine and _matches(row, fence) and row[4] == 'quarantined':
                    raise QuarantinedRoom('Drain cannot clear quarantine; explicit repair retry is required.')
                if not _matches(row, fence) or row[3] is None or row[3] <= now:
                    raise StaleGameOwner('Room lease is expired, released, or fenced.')
                released = await (await connection.execute('''UPDATE room_ownership SET owner_instance_id=NULL,
                    fencing_token_hash=NULL,lease_expires_at=NULL,runtime_status='unowned'
                    WHERE room_id=%s AND lease_expires_at>clock_timestamp() RETURNING room_id''',
                    (fence.room_id,))).fetchone()
                if released is None:
                    raise StaleGameOwner('Room expired before release.')
                return True

    async def inspect(self, room_id):
        """Routing/diagnostic metadata only; never exposes a credential or its hash."""
        async with self.pool.connection() as connection:
            row = await (await connection.execute('''SELECT r.owner_instance_id,r.ownership_epoch,
                r.runtime_status,r.lease_expires_at,COALESCE(r.lease_expires_at>clock_timestamp(),false) AS live,
                s.internal_address,COALESCE(s.heartbeat_at>clock_timestamp()-(%s * interval '1 second'),false) AS instance_fresh,
                COALESCE(s.draining,false) AS instance_draining FROM room_ownership r
                LEFT JOIN server_instances s ON s.instance_id=r.owner_instance_id WHERE r.room_id=%s''',
                (self.heartbeat_ttl, room_id))).fetchone()
        return RoomOwnership(room_id, *row) if row else None

    async def routing_hint(self, room_id):
        state = await self.inspect(room_id)
        if state and state.status == 'serving' and state.live and state.instance_fresh and not state.instance_draining:
            return state
        return None

    async def placement_candidates(self, *, limit=256):
        """Bounded registry snapshot; acquisition rechecks capacity under a lock."""
        if type(limit) is not int or not 1 <= limit <= 1024:
            raise ValueError('Invalid placement candidate limit.')
        async with self.pool.connection() as connection:
            return await (await connection.execute('''SELECT s.instance_id,s.internal_address,s.capabilities,
                (SELECT count(*) FROM room_ownership r WHERE r.owner_instance_id=s.instance_id
                    AND r.lease_expires_at>clock_timestamp()) FROM server_instances s
                WHERE NOT s.draining AND s.heartbeat_at>clock_timestamp()-(%s * interval '1 second')
                ORDER BY s.instance_id LIMIT %s''', (self.heartbeat_ttl, limit + 1))).fetchall()
