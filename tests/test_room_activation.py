"""Validated SQL activation and local admission remain separate across uncertain commits."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import replace
from uuid import uuid4

import pytest
from psycopg import OperationalError

from app.durable_games.activation import ACTIVATION_CAPABILITIES, PostgresRoomActivationStore, RoomActivationCoordinator
from app.durable_games.coordination import RoomLeaseCoordinator, OwnershipGuardedExecutor
from app.durable_games.executor import GameLaneExecutor, _DetachedHost
from app.durable_games.inbox import LaneTarget
from app.durable_games.ownership import PostgresRoomOwnershipStore, StaleInstance
from app.durable_games.recovery_coordinator import RoomRecoveryCoordinator
from app.durable_games.room_recovery import PostgresRoomRecoveryStore, UnsupportedRecoveryWork
from app.durable_games.checkpoints import CheckpointError
from app.durable_games.store import StaleGameOwner, DurableGameConflict
from test_checkpoint_store import database
from test_game_lane_executor import setup_game, command


async def context(database, capabilities=None):
    pool, _, _, _ = database
    await pool.execute('DELETE FROM room_ownership')
    ownership = PostgresRoomOwnershipStore(pool)
    leases = RoomLeaseCoordinator(ownership, 'http://owner:8000', capabilities=ACTIVATION_CAPABILITIES if capabilities is None else capabilities)
    await leases.start()
    store = PostgresRoomActivationStore(ownership)
    preparation = await RoomRecoveryCoordinator(leases, store.recovery).prepare('room', expected_epoch=0, host=_DetachedHost(8))
    assert preparation.status == 'prepared'
    return ownership, leases, store, preparation


async def test_validated_activation_opens_admission_and_executes_durable_work(database):
    pool, checkpoints, _, _ = database
    host, game, inbox, lane, executor = await setup_game(database)
    ownership, leases, store, prepared = await context(database)
    try:
        actor, body = command(game)
        # Ingress after initial preparation must not be lost at activation.
        await inbox.enqueue(lane, actor, body)
        assert not leases.admits(prepared.fence)
        coordinator = RoomActivationCoordinator(leases, store, runtime_ready=lambda fence: True)
        lease = await coordinator.activate(prepared)
        assert leases.admits(lease.fence)
        assert (await ownership.routing_hint('room')).epoch == lease.fence.epoch
        result = await OwnershipGuardedExecutor(coordinator, executor).execute_one(lane, lease.fence)
        assert result.outcome['status'] == 'accepted'
        with pytest.raises(StaleGameOwner): await coordinator.activate(prepared)
        assert leases.admits(lease.fence)  # A duplicate API call must not revoke serving work.
    finally:
        await leases.stop()
        await host.close()


@pytest.mark.parametrize('case', ['not_ready', 'capability', 'corrupt_after_prepare', 'unsupported_after_prepare'])
async def test_activation_rechecks_readiness_capabilities_and_current_inventory(database, case):
    pool, checkpoints, _, _ = database
    host, game, inbox, lane, executor = await setup_game(database)
    ownership, leases, store, prepared = await context(database, {} if case == 'capability' else None)
    try:
        if case == 'corrupt_after_prepare':
            await pool.execute("UPDATE table_recovery_state SET state=jsonb_set(state,'{digest}','\"invalid\"')")
        if case == 'unsupported_after_prepare':
            chat = await inbox.ensure_lane(LaneTarget(kind='room_chat', room_id='room'))
            await inbox.enqueue(chat, 'user-00000000-0000-0000-0000-000000000001',
                dict(command_id='future-chat-command', command='unsupported-chat-operation', payload={}))
        coordinator = RoomActivationCoordinator(leases, store, runtime_ready=lambda fence: case != 'not_ready')
        expected = CheckpointError if case == 'corrupt_after_prepare' else UnsupportedRecoveryWork
        with pytest.raises(expected): await coordinator.activate(prepared)
        assert not leases.admits(prepared.fence)
        assert (await pool.execute('SELECT runtime_status FROM room_ownership')).rows == [('recovering',)]
    finally:
        await leases.stop()
        await host.close()


async def test_unknown_activation_commit_never_reopens_admission_on_heartbeat(database, monkeypatch):
    pool, _, _, _ = database
    ownership, leases, store, prepared = await context(database)
    try:
        transaction = pool.transaction
        @asynccontextmanager
        async def lost_commit():
            async with transaction(): yield pool
            raise OperationalError('activation response lost after commit')
        coordinator = RoomActivationCoordinator(leases, store, runtime_ready=lambda fence: True)
        with monkeypatch.context() as patch:
            patch.setattr(pool, 'transaction', lost_commit)
            with pytest.raises(OperationalError): await coordinator.activate(prepared)
        assert (await pool.execute('SELECT runtime_status FROM room_ownership')).rows == [('serving',)]
        assert not leases.admits(prepared.fence)
        await leases.heartbeat_once()
        await leases.renew_once()
        assert not leases.admits(prepared.fence)
        with pytest.raises(StaleGameOwner): await coordinator.activate(prepared)
    finally:
        await leases.stop()


async def test_unconfirmed_external_activation_cannot_be_adopted_by_renewal(database):
    ownership, leases, store, prepared = await context(database)
    try:
        await ownership.activate(leases.registration, prepared.fence)
        await leases.renew_once()
        assert not leases.admits(prepared.fence)
        assert leases.failures[-1].error_type == 'StaleGameOwner'
    finally:
        await leases.stop()


async def test_readiness_lost_after_sql_commit_revokes_local_activation(database):
    ownership, leases, store, prepared = await context(database)
    ready = True
    class Changed:
        async def activate(self, registration, fence):
            nonlocal ready
            lease = await store.activate(registration, fence)
            ready = False
            return lease
    try:
        runner = RoomActivationCoordinator(leases, Changed(), runtime_ready=lambda fence: ready)
        with pytest.raises(UnsupportedRecoveryWork): await runner.activate(prepared)
        await leases.renew_once()
        assert not leases.admits(prepared.fence)
    finally:
        await leases.stop()


@pytest.mark.parametrize('interruption', ['cancel', 'stop', 'drain', 'overlap'])
async def test_inflight_activation_interruption_cannot_admit_late_result(database, interruption):
    ownership, leases, store, prepared = await context(database)
    entered, finish = asyncio.Event(), asyncio.Event()
    class Waiting:
        async def activate(self, registration, fence):
            entered.set()
            await finish.wait()
            return await store.activate(registration, fence)
    runner = RoomActivationCoordinator(leases, Waiting(), runtime_ready=lambda fence: True)
    task = asyncio.create_task(runner.activate(prepared))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        if interruption == 'cancel':
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        else:
            if interruption == 'stop': await leases.stop()
            if interruption == 'drain': await leases.drain()
            if interruption == 'overlap':
                with pytest.raises(DurableGameConflict): await runner.activate(prepared)
            finish.set()
            if interruption == 'overlap':
                await task
                assert leases.admits(prepared.fence)
            else:
                with pytest.raises((StaleGameOwner, StaleInstance)): await task
        if interruption != 'overlap': assert not leases.admits(prepared.fence)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await leases.stop()


@pytest.mark.parametrize('name', ['future-command'])
async def test_pending_unimplemented_table_command_blocks_activation(database, name):
    host, game, inbox, _, _ = await setup_game(database)
    ownership, leases, store, prepared = await context(database)
    try:
        from uuid import UUID
        lane = await inbox.ensure_lane(LaneTarget(kind='table', room_id='room', table_id=UUID(game.table.table_id)))
        await inbox.enqueue(lane, game.users[0], dict(command_id=uuid4().hex, command=name, payload={}))
        with pytest.raises(UnsupportedRecoveryWork):
            await RoomActivationCoordinator(leases, store, runtime_ready=lambda fence: True).activate(prepared)
        assert not leases.admits(prepared.fence)
    finally:
        await leases.stop()
        await host.close()


async def test_runtime_readiness_loss_after_activation_permanently_closes_gate(database):
    ownership, leases, store, prepared = await context(database)
    ready = True
    runner = RoomActivationCoordinator(leases, store, runtime_ready=lambda fence: ready)
    try:
        await runner.activate(prepared)
        assert runner.admits(prepared.fence)
        ready = False
        assert not runner.admits(prepared.fence)
        ready = True
        await leases.heartbeat_once()
        assert not runner.admits(prepared.fence)
    finally:
        await leases.stop()


@pytest.mark.parametrize('failure', ['timeout', 'expired'])
async def test_activation_timeout_or_expiry_keeps_admission_closed(database, failure):
    pool, _, _, _ = database
    ownership, leases, store, prepared = await context(database)
    try:
        if failure == 'timeout':
            leases.operation_timeout = 0.01
            class Waiting:
                async def activate(self, registration, fence):
                    await asyncio.Event().wait()
            store = Waiting()
        else:
            await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        runner = RoomActivationCoordinator(leases, store, runtime_ready=lambda fence: True)
        with pytest.raises(TimeoutError if failure == 'timeout' else StaleGameOwner):
            await runner.activate(prepared)
        assert not leases.admits(prepared.fence)
        assert (await pool.execute('SELECT runtime_status FROM room_ownership')).rows == [('recovering',)]
    finally:
        await leases.stop()
