"""Ownership lifecycle SQL, including failure/retry behavior, in PostgreSQL/WASM."""
from contextlib import asynccontextmanager
from dataclasses import replace
from secrets import token_urlsafe

import pytest
from psycopg import OperationalError
from psycopg.errors import CheckViolation

from app.durable_games.ownership import (
    InstanceRegistration, PostgresRoomOwnershipStore, StaleInstance, validate_room_fence,
)
from app.durable_games.store import DurableGameConflict, StaleGameOwner
from app.durable_games.checkpoints import capture_checkpoint
from test_checkpoint_store import database, host_game


@pytest.fixture
async def ownership(database):
    pool, _, _, _ = database
    # Existing fixtures deliberately use a legacy registry/lease. New APIs require
    # boot credentials, so create independent registrations and reset only this room.
    await pool.execute('DELETE FROM room_ownership')
    store = PostgresRoomOwnershipStore(pool)
    a, b = InstanceRegistration.new(), InstanceRegistration.new()
    await store.register(a, 'http://one:8000', capabilities={'engine': 1})
    await store.register(b, 'http://two:8000', capabilities={'engine': 1})
    return pool, store, a, b


async def acquire(store, registration, epoch=0, token=None):
    return await store.acquire('room', registration, expected_epoch=epoch, token=token or token_urlsafe(32))


async def assert_fenced(pool, fence):
    with pytest.raises(StaleGameOwner):
        async with pool.transaction():
            await validate_room_fence(pool, fence, 'room')


async def test_registry_boot_identity_retry_heartbeat_and_immutable_configuration(ownership):
    pool, store, a, b = ownership
    assert await store.register(a, 'http://one:8000', capabilities={'engine': 1}) == a
    await store.heartbeat(a)
    impostor = replace(a, token=token_urlsafe(32))
    for method in (store.heartbeat, store.drain_instance):
        with pytest.raises(StaleInstance): await method(impostor)
    with pytest.raises(StaleInstance):
        await store.register(impostor, 'http://one:8000', capabilities={'engine': 1})
    with pytest.raises(DurableGameConflict):
        await store.register(a, 'http://changed:8000', capabilities={'engine': 1})
    with pytest.raises(CheckViolation):
        await pool.execute('UPDATE server_instances SET internal_address=%s WHERE instance_id=%s', ('changed', a.instance_id))
    # Old uncredentialed rows are preserved but cannot be adopted by a new boot.
    with pytest.raises(StaleInstance):
        await store.register(InstanceRegistration('one', token_urlsafe(32)), 'one')
    assert a.token not in repr(a)


async def test_acquire_recover_activate_renew_and_read_only_routing(ownership):
    pool, store, a, b = ownership
    assert await store.inspect('room') is None
    token = token_urlsafe(32)
    lease = await acquire(store, a, token=token)
    assert lease.fence.epoch == 1 and lease.status == 'recovering'
    assert await store.routing_hint('room') is None
    await assert_fenced(pool, lease.fence)
    serving = await store.activate(a, lease.fence)
    assert serving.status == 'serving'
    assert (await store.activate(a, lease.fence)) == serving
    retry = await acquire(store, a, token=token)
    assert retry == serving  # Retry must not reset state or extend expiry.
    hint = await store.routing_hint('room')
    assert hint.epoch == 1 and hint.internal_address == 'http://one:8000'
    assert token not in repr(lease) and token not in repr(hint)
    renewed = await store.renew(a, lease.fence, lease_seconds=1)
    assert renewed.expires_at >= lease.expires_at and renewed.fence == lease.fence
    async with pool.transaction(): await validate_room_fence(pool, renewed.fence, 'room')
    await assert_fenced(pool, replace(lease.fence, token=token_urlsafe(32)))
    await assert_fenced(pool, replace(lease.fence, room_id='another-room'))


async def test_expired_takeover_changes_fence_and_old_owner_cannot_mutate(ownership):
    pool, store, a, b = ownership
    first = await acquire(store, a)
    await store.activate(a, first.fence)
    with pytest.raises(DurableGameConflict, match='live owner'): await acquire(store, b, 1)
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    await assert_fenced(pool, first.fence)
    second = await acquire(store, b, 1)
    assert second.fence.epoch == 2 and second.fence.token != first.fence.token
    assert second.status == 'recovering'
    for method in (store.renew, store.activate, store.drain, store.quarantine, store.release):
        with pytest.raises(StaleGameOwner): await method(a, first.fence)
    await assert_fenced(pool, first.fence)
    await assert_fenced(pool, second.fence)
    await store.activate(b, second.fence)
    async with pool.transaction(): await validate_room_fence(pool, second.fence, 'room')


async def test_release_retry_and_delayed_acquire_cannot_reclaim_room(ownership):
    pool, store, a, b = ownership
    token = token_urlsafe(32)
    lease = await acquire(store, a, token=token)
    assert await store.release(a, lease.fence)
    assert not await store.release(a, lease.fence)
    released = await store.inspect('room')
    assert released.epoch == 1 and released.status == 'unowned' and released.instance_id is None
    with pytest.raises(DurableGameConflict, match='epoch changed'): await acquire(store, a, token=token)
    next_lease = await acquire(store, b, 1)
    with pytest.raises(StaleGameOwner): await store.release(a, lease.fence)
    assert (await store.inspect('room')).epoch == next_lease.fence.epoch


async def test_stale_heartbeat_is_not_permission_to_steal_live_lease(ownership):
    pool, store, a, b = ownership
    lease = await acquire(store, a)
    await store.activate(a, lease.fence)
    await pool.execute("UPDATE server_instances SET heartbeat_at=clock_timestamp()-interval '1 minute' WHERE instance_id=%s", (a.instance_id,))
    assert await store.routing_hint('room') is None
    with pytest.raises(StaleInstance): await store.renew(a, lease.fence)
    with pytest.raises(DurableGameConflict, match='live owner'): await acquire(store, b, 1)
    async with pool.transaction(): await validate_room_fence(pool, lease.fence, 'room')
    await store.heartbeat(a)
    assert await store.routing_hint('room') is not None


async def test_draining_server_stops_admission_activation_and_routing(ownership):
    pool, store, a, b = ownership
    lease = await acquire(store, a)
    await store.activate(a, lease.fence)
    await store.drain_instance(a)
    await store.heartbeat(a)
    await store.register(a, 'http://one:8000', capabilities={'engine': 1})
    assert await store.routing_hint('room') is None
    assert (await store.renew(a, lease.fence)).status == 'serving'
    with pytest.raises(StaleInstance): await store.activate(a, lease.fence)
    drained = await store.drain(a, lease.fence)
    assert drained.status == 'draining'
    await assert_fenced(pool, lease.fence)
    assert await store.release(a, lease.fence)
    with pytest.raises(StaleInstance): await acquire(store, a, 1)
    assert (await acquire(store, b, 1)).status == 'recovering'


async def test_quarantine_blocks_serving_and_automatic_takeover_even_after_expiry(ownership):
    pool, store, a, b = ownership
    lease = await acquire(store, a)
    quarantined = await store.quarantine(a, lease.fence)
    assert quarantined.status == 'quarantined'
    assert await store.quarantine(a, lease.fence) == quarantined
    with pytest.raises(DurableGameConflict): await store.activate(a, lease.fence)
    await assert_fenced(pool, lease.fence)
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    with pytest.raises(DurableGameConflict, match='Quarantined'): await acquire(store, b, 1)
    assert await store.routing_hint('room') is None


async def test_expired_lease_cannot_be_renewed_or_retried_as_fresh_acquisition(ownership):
    pool, store, a, b = ownership
    token = token_urlsafe(32)
    lease = await acquire(store, a, token=token)
    await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    for method in (store.renew, store.activate, store.release):
        with pytest.raises(StaleGameOwner): await method(a, lease.fence)
    with pytest.raises(StaleGameOwner): await acquire(store, a, token=token)
    with pytest.raises(DurableGameConflict, match='new token'): await acquire(store, a, 1, token=token)
    assert (await acquire(store, a, 1)).fence.epoch == 2


async def test_lost_acquire_commit_response_resolves_without_new_epoch(ownership, monkeypatch):
    pool, store, a, b = ownership
    original = pool.transaction
    @asynccontextmanager
    async def unknown_commit():
        async with original(): yield pool
        raise OperationalError('response lost after commit')
    token = token_urlsafe(32)
    with monkeypatch.context() as patch:
        patch.setattr(pool, 'transaction', unknown_commit)
        with pytest.raises(OperationalError): await acquire(store, a, token=token)
    before = await store.inspect('room')
    resolved = await acquire(store, a, token=token)
    assert resolved.fence.epoch == before.epoch == 1 and resolved.expires_at == before.expires_at


async def test_acquire_failure_before_commit_rolls_back_owner_and_epoch(ownership, monkeypatch):
    pool, store, a, b = ownership
    original = pool.transaction
    @asynccontextmanager
    async def fail_commit():
        async with original():
            yield pool
            raise OperationalError('failure before commit')
    with monkeypatch.context() as patch:
        patch.setattr(pool, 'transaction', fail_commit)
        with pytest.raises(OperationalError): await acquire(store, a)
    assert await store.inspect('room') is None
    assert (await acquire(store, b)).fence.epoch == 1


async def test_new_leases_gate_existing_checkpoint_writes(ownership, database):
    pool, store, a, b = ownership
    _, checkpoints, _, users = database
    host, game = await host_game(users)
    try:
        checkpoint = capture_checkpoint(game, table_revision=0)
        lease = await acquire(store, a)
        with pytest.raises(StaleGameOwner):
            await checkpoints.save(checkpoint, expected_revision=None, fence=lease.fence)
        await store.activate(a, lease.fence)
        await checkpoints.save(checkpoint, expected_revision=None, fence=lease.fence)
        await store.drain(a, lease.fence)
        with pytest.raises(StaleGameOwner):
            await checkpoints.save(capture_checkpoint(game, table_revision=1), expected_revision=0, fence=lease.fence)
        assert (await checkpoints.load(game.table.table_id)).checkpoint == checkpoint
    finally:
        await host.close()


def test_configuration_and_secrets_are_validated():
    for ttl in (0, True, 301):
        with pytest.raises(ValueError): PostgresRoomOwnershipStore(None, heartbeat_ttl=ttl)


async def test_shared_fence_checks_clock_after_simulated_lock_wait():
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace
    from psycopg.pq import TransactionStatus
    from app.durable_games.ownership import RoomWriteFence
    from app.durable_games.store import _token_hash
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    fence = RoomWriteFence('room', 'boot', 1, token_urlsafe(32))
    class Result:
        def __init__(self, row): self.row = row
        async def fetchone(self): return self.row
    class Connection:
        info = SimpleNamespace(transaction_status=TransactionStatus.INTRANS)
        locked = False
        async def execute(self, sql, params=()):
            if 'FOR SHARE' in sql:
                self.locked = True  # Simulate a lock wait longer than remaining TTL.
                return Result(('boot', 1, _token_hash(fence.token), start + timedelta(seconds=1), 'serving'))
            assert sql == 'SELECT clock_timestamp()'
            return Result((start + timedelta(seconds=2 if self.locked else 0),))
    with pytest.raises(StaleGameOwner):
        await validate_room_fence(Connection(), fence, 'room')
