from typing import Any, Protocol


class Broadcaster(Protocol):
    async def broadcast(
        self, room_id: str, message: dict[str, Any],
        exclude_user_id: str | None = None,
    ) -> None: ...

    async def send_to_room_user(
        self, room_id: str, user_id: str, message: dict[str, Any],
    ) -> None: ...
