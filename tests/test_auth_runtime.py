from unittest.mock import AsyncMock

import pytest

from app.auth.service import AuthenticationError, GuestAuthService
from app.models.messages import ClientMessage
from app.runtime.game_runtime import GameRuntime


async def test_guest_identity_and_invalid_credentials():
    auth = GuestAuthService()
    first, second = await auth.issue_guest(), await auth.issue_guest()
    assert first.token != second.token
    assert first.user_id != second.user_id
    assert (await auth.authenticate(first.token)).user_id == first.user_id
    for token in ("", first.user_id, "invented"):
        with pytest.raises(AuthenticationError):
            await auth.authenticate(token)


async def test_runtime_uses_authenticated_sender_and_broadcaster():
    broadcaster = AsyncMock()
    runtime = GameRuntime(broadcaster)
    message = ClientMessage.model_validate({
        "type": "MESSAGE", "sender_id": "forged", "room_id": "other",
        "payload": {"text": "hello"},
    })
    await runtime.handle("room", "authenticated", message)
    broadcaster.broadcast.assert_awaited_once_with("room", {
        "type": "MESSAGE", "sender_id": "authenticated", "payload": {"text": "hello"},
    }, exclude_user_id="authenticated")
