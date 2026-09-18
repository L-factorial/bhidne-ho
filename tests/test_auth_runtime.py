from unittest.mock import AsyncMock

import pytest

from app.auth.service import AuthenticationError, GuestAuthService
from app.models.messages import ClientMessage
from app.runtime.game_runtime import GameRuntime
from app.main import create_app
from fastapi.testclient import TestClient


def test_durable_game_runtime_is_default_and_refuses_start_without_postgres(monkeypatch):
    monkeypatch.delenv("BHIDNE_HO_GAME_RUNTIME_MODE", raising=False)
    monkeypatch.delenv("BHIDNE_HO_DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="Durable game runtime requires PostgreSQL"):
        with TestClient(create_app()):
            pass


def test_game_runtime_mode_rejects_unknown_values(monkeypatch):
    monkeypatch.setenv("BHIDNE_HO_GAME_RUNTIME_MODE", "fallback")
    with pytest.raises(RuntimeError, match="must be 'durable' or 'memory'"):
        with TestClient(create_app()):
            pass


def test_guest_http_login_is_disabled_unless_explicitly_enabled(monkeypatch):
    monkeypatch.setenv("BHIDNE_HO_GUEST_LOGIN_ENABLED", "0")
    with TestClient(create_app()) as client:
        response = client.post("/auth/guest")
    assert response.status_code == 403
    assert response.json()["detail"] == "Guest login is temporarily disabled. Sign in or create an account."


async def test_guest_identity_and_invalid_credentials():
    auth = GuestAuthService()
    first, second = await auth.issue_guest(), await auth.issue_guest()
    assert first.token != second.token
    assert first.user_id != second.user_id
    assert (await auth.authenticate(first.token)).user_id == first.user_id
    for token in ("", first.user_id, "invented"):
        with pytest.raises(AuthenticationError):
            await auth.authenticate(token)


async def test_revoked_guest_token_is_rejected():
    auth = GuestAuthService()
    credentials = await auth.issue_guest()
    await auth.revoke(credentials.token)
    with pytest.raises(AuthenticationError):
        await auth.authenticate(credentials.token)


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
