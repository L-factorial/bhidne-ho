from typing import Any, Protocol


class Broadcaster(Protocol):
    async def broadcast(
        self, room_id: str, message: dict[str, Any],
        exclude_user_id: str | None = None,
    ) -> None: ...
