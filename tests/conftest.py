import pytest


@pytest.fixture(autouse=True)
def enable_guest_login_for_backend_tests(monkeypatch):
    """Most legacy integration fixtures use disposable guests as test actors."""

    monkeypatch.setenv("BHIDNE_HO_GUEST_LOGIN_ENABLED", "1")
    monkeypatch.setenv("BHIDNE_HO_GAME_RUNTIME_MODE", "memory")
