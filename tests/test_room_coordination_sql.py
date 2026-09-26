"""Coordinator composed with production ownership SQL, without runtime activation."""
import pytest

from app.durable_games.coordination import RoomLeaseCoordinator
from app.durable_games.ownership import PostgresRoomOwnershipStore, validate_room_fence
from app.durable_games.store import StaleGameOwner
from test_checkpoint_store import database


async def test_coordinate_recovery_serving_drain_and_expired_takeover(database):
    pool, _, _, _ = database
    await pool.execute('DELETE FROM room_ownership')
    store = PostgresRoomOwnershipStore(pool)
    first = RoomLeaseCoordinator(store, 'http://first:8000')
    second = RoomLeaseCoordinator(store, 'http://second:8000')
    await first.start()
    await second.start()
    try:
        lease = await first.acquire('room', expected_epoch=0)
        assert not first.admits(lease.fence)
        assert await store.routing_hint('room') is None
        # Test setup explicitly activates; production recovery integration is pending.
        await first.activate(lease.fence, store.activate)
        await first.renew_once()
        assert first.admits(lease.fence)
        async with pool.transaction(): await validate_room_fence(pool, lease.fence, 'room')
        await first.drain()
        assert not first.admits(lease.fence)
        assert await store.routing_hint('room') is None
        await first.renew_once()
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        replacement = await second.acquire('room', expected_epoch=1)
        assert replacement.fence.epoch == 2
        assert not second.admits(replacement.fence)
        await first.renew_once()
        assert first.failures[-1].error_type == 'StaleGameOwner'
        async with pool.transaction():
            with pytest.raises(StaleGameOwner):
                await validate_room_fence(pool, lease.fence, 'room')
        await second.activate(replacement.fence, store.activate)
        await second.renew_once()
        assert second.admits(replacement.fence)
        assert (await store.routing_hint('room')).instance_id == second.registration.instance_id
    finally:
        await first.stop()
        await second.stop()


async def test_sql_expiry_cannot_be_hidden_by_subsequent_healthy_heartbeat(database):
    pool, _, _, _ = database
    await pool.execute('DELETE FROM room_ownership')
    store = PostgresRoomOwnershipStore(pool)
    coordinator = RoomLeaseCoordinator(store, 'http://first:8000')
    await coordinator.start()
    try:
        lease = await coordinator.acquire('room', expected_epoch=0)
        await coordinator.activate(lease.fence, store.activate)
        await coordinator.renew_once()
        assert coordinator.admits(lease.fence)
        await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
        await coordinator.renew_once()
        await coordinator.heartbeat_once()
        assert not coordinator.admits(lease.fence)
        with pytest.raises(StaleGameOwner):
            await coordinator.acquire('room', expected_epoch=0)
    finally:
        await coordinator.stop()
