import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from app.multiplayer.room_service import RoomService

logger = logging.getLogger(__name__)


class Socket(Protocol):
    async def send_json(self, data: Any) -> None: ...
    async def close(self, code: int = 1000) -> None: ...


@dataclass
class Connection:
    connection_id: str
    room_id: str
    user_id: str
    socket: Socket
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    active: bool = True


class ConnectionManager:
    """One event loop. Lifecycle lock protects sockets and membership together.

    Network I/O never holds the lifecycle lock. Each socket serializes its sends.
    Connection IDs ensure a stale disconnect cannot remove a replacement socket.
    """

    def __init__(self, rooms: RoomService, send_timeout: float = 5.0) -> None:
        self._rooms = rooms
        self._connections: dict[str, dict[str, Connection]] = {}
        self._lock = asyncio.Lock()
        self._send_timeout = send_timeout

    async def connect(self, room_id: str, user_id: str, websocket: Socket) -> str:
        connection = Connection(str(uuid4()), room_id, user_id, websocket)
        async with self._lock:
            await self._rooms.join(room_id, user_id)
            self._connections.setdefault(room_id, {})[connection.connection_id] = connection
        return connection.connection_id

    async def disconnect(self, room_id: str, connection_id: str) -> None:
        async with self._lock:
            connections = self._connections.get(room_id)
            if not connections:
                return
            connection = connections.pop(connection_id, None)
            if connection is None:
                return
            connection.active = False
            if not any(c.user_id == connection.user_id for c in connections.values()):
                await self._rooms.leave(room_id, connection.user_id)
            if not connections:
                del self._connections[room_id]

    async def _send(self, connection: Connection, message: dict[str, Any]) -> None:
        async with connection.send_lock:
            if not connection.active:
                return
            try:
                await asyncio.wait_for(connection.socket.send_json(message), self._send_timeout)
            except Exception:
                # A socket adapter may report different transport exceptions.
                logger.info("Removing failed connection %s", connection.connection_id)
                await self.disconnect(connection.room_id, connection.connection_id)
                try:
                    await asyncio.wait_for(connection.socket.close(code=1011), self._send_timeout)
                except Exception:
                    pass  # Already closed or unreachable.

    async def send_to_connection(
        self, room_id: str, connection_id: str, message: dict[str, Any],
    ) -> None:
        async with self._lock:
            connection = self._connections.get(room_id, {}).get(connection_id)
        if connection is not None:
            await self._send(connection, message)

    async def send_to_user(self, user_id: str, message: dict[str, Any]) -> None:
        async with self._lock:
            targets = [c for room in self._connections.values()
                       for c in room.values() if c.user_id == user_id]
        await asyncio.gather(*(self._send(c, message) for c in targets))

    async def send_to_room_user(self, room_id: str, user_id: str, message: dict[str, Any]) -> None:
        """Private match output must never reach the user's tabs in other rooms."""
        async with self._lock:
            targets = [c for c in self._connections.get(room_id, {}).values() if c.user_id == user_id]
        await asyncio.gather(*(self._send(c, message) for c in targets))

    async def broadcast(
        self, room_id: str, message: dict[str, Any],
        exclude_user_id: str | None = None,
    ) -> None:
        async with self._lock:
            targets = [c for c in self._connections.get(room_id, {}).values()
                       if c.user_id != exclude_user_id]
        await asyncio.gather(*(self._send(c, message) for c in targets))
