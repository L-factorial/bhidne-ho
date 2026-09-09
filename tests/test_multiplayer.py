import asyncio

from app.multiplayer.connection_manager import ConnectionManager
from app.multiplayer.presence import PresenceService
from app.multiplayer.room_service import RoomService


class FakeSocket:
    def __init__(self, fail=False, stall=False):
        self.messages = []
        self.fail = fail
        self.stall = stall
        self.closed = False
        self.sending = False

    async def send_json(self, data):
        assert not self.sending, "Concurrent writes to one socket"
        self.sending = True
        try:
            await asyncio.sleep(0)
            if self.fail:
                raise OSError("Socket lost")
            if self.stall:
                await asyncio.Event().wait()
            self.messages.append(data)
        finally:
            self.sending = False

    async def close(self, code=1000):
        self.closed = True


async def test_room_join_leave_and_snapshot():
    rooms = RoomService()
    await rooms.join("one", "alice")
    await rooms.join("one", "alice")
    assert await rooms.members("one") == ["alice"]
    await rooms.join("one", "bob")
    snapshot = await PresenceService(rooms).snapshot("one")
    assert snapshot.members == ["alice", "bob"]
    snapshot.members.clear()
    await rooms.leave("one", "alice")
    assert await rooms.members("one") == ["bob"]
    await rooms.leave("one", "bob")
    await rooms.leave("one", "bob")
    assert await rooms.members("one") == []


async def test_broadcast_isolation_exclusion_and_disconnect():
    rooms = RoomService()
    manager = ConnectionManager(rooms)
    alice, bob, outside = FakeSocket(), FakeSocket(), FakeSocket()
    alice_id = await manager.connect("one", "alice", alice)
    await manager.connect("one", "bob", bob)
    await manager.connect("two", "outside", outside)
    await manager.broadcast("one", {"n": 1}, exclude_user_id="alice")
    assert alice.messages == []
    assert bob.messages == [{"n": 1}]
    assert outside.messages == []
    await manager.broadcast("one", {"n": 2})
    assert alice.messages == [{"n": 2}]
    await manager.disconnect("one", alice_id)
    await manager.disconnect("one", alice_id)
    assert await rooms.members("one") == ["bob"]
    await manager.broadcast("one", {"n": 3})
    assert bob.messages[-1] == {"n": 3}
    assert alice.messages == [{"n": 2}]
    assert await rooms.members("two") == ["outside"]


async def test_multiple_tabs_and_stale_disconnect():
    rooms = RoomService()
    manager = ConnectionManager(rooms)
    first = await manager.connect("one", "alice", FakeSocket())
    second_socket = FakeSocket()
    second = await manager.connect("one", "alice", second_socket)
    await manager.disconnect("one", first)
    await manager.disconnect("one", first)
    assert await rooms.members("one") == ["alice"]
    await manager.send_to_user("alice", {"hello": True})
    assert second_socket.messages == [{"hello": True}]
    await manager.disconnect("one", second)
    assert await rooms.members("one") == []


async def test_failed_and_slow_sockets_do_not_stop_delivery():
    rooms = RoomService()
    manager = ConnectionManager(rooms, send_timeout=0.02)
    failed, slow, healthy = FakeSocket(fail=True), FakeSocket(stall=True), FakeSocket()
    await manager.connect("one", "failed", failed)
    await manager.connect("one", "slow", slow)
    await manager.connect("one", "healthy", healthy)
    await manager.broadcast("one", {"hello": True})
    assert healthy.messages == [{"hello": True}]
    assert failed.closed and slow.closed
    assert await rooms.members("one") == ["healthy"]


async def test_concurrent_lifecycle_and_serialized_sends():
    rooms = RoomService()
    manager = ConnectionManager(rooms)
    sockets = [FakeSocket() for _ in range(20)]
    ids = await asyncio.gather(*(manager.connect("one", "alice", s) for s in sockets))
    assert await rooms.members("one") == ["alice"]
    await asyncio.gather(*(manager.broadcast("one", {"n": n}) for n in range(10)))
    assert all(len(s.messages) == 10 for s in sockets)
    await asyncio.gather(*(manager.disconnect("one", cid) for cid in ids[:-1]))
    assert await rooms.members("one") == ["alice"]
    await manager.disconnect("one", ids[-1])
    assert await rooms.members("one") == []
