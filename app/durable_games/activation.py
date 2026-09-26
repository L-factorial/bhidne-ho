"""Explicit validated activation boundary. No live startup, routing, or scheduler wiring."""
import inspect

from .ownership import RoomLease
from .recovery_coordinator import RecoveryPreparation
from .room_recovery import PostgresRoomRecoveryStore, UnsupportedRecoveryWork
from .store import DurableGameConflict, StaleGameOwner
from .table_executor import TableLaneExecutor, TableStateRejected
from .executor import _DetachedHost
from .room_commands import COMMANDS as ROOM_COMMANDS
from .settlements import MODELS as SETTLEMENT_MODELS

# Advertised by the explicitly assembled runtime, not inferred from installed code.
ACTIVATION_CAPABILITIES = {
    'manual_settlement': 1,
    'table_pokes': 1,
    'durable_scoped_chat': 1,
    'durable_room_creation': 2, 'durable_table_commands': 2, 'durable_game_commands': 1,
    'offer_expiry': 1, 'callbreak_review': 1, 'match_settlement': 1, 'flush_settlement': 1,
}


class PostgresRoomActivationStore:
    def __init__(self, ownership, *, max_items=4096, round_summary_seconds=8):
        self.ownership, self.pool = ownership, ownership.pool
        self.recovery = PostgresRoomRecoveryStore(self.pool, max_items=max_items,
            offer_expiry=True, callbreak_review=True, match_settlement=True, flush_settlement=True)
        self.round_summary_seconds = round_summary_seconds

    async def activate(self, registration, fence):
        """Revalidate and transition atomically; prepared inventories are advisory.

        SERIALIZABLE gives one consistent inventory/transition. The ownership row
        lock excludes fenced room mutations and takeover. Ingress may still append;
        commands reload authoritative state and must be rescanned after activation.
        """
        async with self.pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
                row = await self.ownership._owned(connection, registration, fence, fresh=True, accepting=True)
                if row[4] != 'recovering':
                    raise DurableGameConflict('Activation requires fresh recovering state.')
                capabilities = (await (await connection.execute(
                    'SELECT capabilities FROM server_instances WHERE instance_id=%s',
                    (registration.instance_id,))).fetchone())[0]
                if any(type(capabilities.get(key)) is not int or capabilities[key] != version
                       for key, version in ACTIVATION_CAPABILITIES.items()):
                    raise UnsupportedRecoveryWork('Instance has not advertised all required runtime capabilities.')
                observed = (await (await connection.execute('SELECT clock_timestamp()')).fetchone())[0]
                inventory = await self.recovery._load(connection, fence,
                    _DetachedHost(self.round_summary_seconds), observed)
                if any(lane.kind not in ('room', 'table', 'game', 'room_chat', 'table_chat', 'game_chat') for lane in inventory.lanes):
                    raise UnsupportedRecoveryWork('Room contains an unsupported execution lane.')
                # Unsupported command families deliberately remain pending in
                # their executors. Do not declare a room ready with known blocked work.
                pending = await self.recovery._rows(connection, '''SELECT l.kind,i.command,i.payload,l.table_id
                    FROM command_inbox i JOIN command_lanes l USING(lane_id)
                    WHERE l.room_id=%s AND i.status='pending' ORDER BY i.lane_id,i.sequence''',
                    (fence.room_id,))
                tables = {table.table_id: table.stored.checkpoint['data'] for table in inventory.tables}
                for kind, command, payload, table_id in pending:
                    if kind in ('room_chat', 'table_chat', 'game_chat') and command != 'send-chat':
                        raise UnsupportedRecoveryWork('Pending chat command needs an unavailable capability.')
                    if kind == 'room' and command not in ROOM_COMMANDS and command not in SETTLEMENT_MODELS and command != 'create-table':
                        raise UnsupportedRecoveryWork('Pending room command needs an unavailable capability.')
                    if kind == 'table' and command not in TableLaneExecutor.commands:
                        raise UnsupportedRecoveryWork('Pending table command needs an unavailable capability.')
                    if kind == 'table' and command != 'expire-seat-offer':
                        try:
                            TableLaneExecutor.check_capability(tables[table_id], command)
                        except TableStateRejected:
                            pass  # Executor will record a durable state rejection.
                        except DurableGameConflict as error:
                            raise UnsupportedRecoveryWork('Pending table state requires another capability.') from error
                expires = await (await connection.execute('''UPDATE room_ownership SET runtime_status='serving'
                    WHERE room_id=%s AND lease_expires_at>clock_timestamp() RETURNING lease_expires_at''',
                    (fence.room_id,))).fetchone()
                if expires is None:
                    raise StaleGameOwner('Room lease expired during activation validation.')
                return RoomLease(fence, expires[0], 'serving')


class RoomActivationCoordinator:
    def __init__(self, leases, store, *, runtime_ready, max_inflight=4):
        """runtime_ready(fence) is the integrating runtime's synchronous readiness gate.

        It must cover execution/maintenance scheduling and shutdown admission, not
        merely SQL connectivity. No default true gate or production binding exists.
        """
        if (not callable(runtime_ready) or inspect.iscoroutinefunction(runtime_ready)
                or type(max_inflight) is not int or max_inflight < 1):
            raise ValueError('Activation requires a synchronous readiness gate and positive bound.')
        self.leases, self.store, self.runtime_ready = leases, store, runtime_ready
        self.max_inflight, self._active = max_inflight, set()

    def _ready(self, fence):
        ready = self.runtime_ready(fence)
        if inspect.iscoroutine(ready):
            ready.close()
        if ready is not True:
            raise UnsupportedRecoveryWork('Execution runtime is not ready for this room.')

    def admits(self, fence):
        """Use this gate for runtime work so readiness loss cannot be ignored."""
        if not self.leases.admits(fence):
            return False
        try:
            self._ready(fence)
        except Exception:
            self.leases.abandon_fence(fence)
            return False
        return True

    async def activate(self, preparation):
        if (not isinstance(preparation, RecoveryPreparation) or preparation.status != 'prepared'
                or preparation.fence is None or preparation.inventory is None
                or preparation.inventory.fence != preparation.fence
                or preparation.room_id != preparation.fence.room_id):
            raise ValueError('Activation requires a successfully prepared, matching inventory.')
        fence = preparation.fence
        if fence.room_id in self._active or len(self._active) >= self.max_inflight:
            raise DurableGameConflict('Activation capacity is busy; retry without queuing.')
        self._active.add(fence.room_id)
        try:
            self._ready(fence)
            async def transition(registration, current):
                self._ready(current)
                lease = await self.store.activate(registration, current)
                self._ready(current)
                return lease
            return await self.leases.activate(fence, transition)
        finally:
            self._active.remove(fence.room_id)
