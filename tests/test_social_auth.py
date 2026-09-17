import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.auth.service import AuthenticationError, InMemoryAuthService
from app.multiplayer.player_profiles import PlayerProfileService
from app.social_auth.models import VerifiedIdentity
from app.social_auth.config import SocialAuthConfig
from app.social_auth.service import ProviderNotConfiguredError, SocialAuthError, SocialAuthService
from app.social_auth.store import InMemorySocialIdentityStore
from app.social_auth.verifiers import ProviderVerificationError


class FakeVerifier:
    def __init__(self, identity=None, error=None):
        self.identity, self.error = identity, error

    async def verify(self, credential, nonce=None):
        if self.error:
            raise self.error
        assert credential == "provider-credential-long-enough"
        return self.identity


def make(identity=None, error=None):
    auth, profiles = InMemoryAuthService(), PlayerProfileService()
    service = SocialAuthService({"google": FakeVerifier(identity, error)},
                                InMemorySocialIdentityStore(auth, profiles))
    return service, auth, profiles


async def test_first_social_login_creates_user_profile_and_app_session():
    identity = VerifiedIdentity(provider="google", subject="google-123", email="a@example.com",
                                email_verified=True, display_name="  Social   Player ")
    service, auth, profiles = make(identity)
    first = await service.login("google", "provider-credential-long-enough")
    second = await service.login("google", "provider-credential-long-enough")
    assert first.user_id == second.user_id
    assert first.token != second.token
    assert (await auth.authenticate(first.token)).user_id == first.user_id
    assert profiles.get(first.user_id) == {"display_name": "Social Player"}


async def test_provider_subjects_are_namespaced_and_not_linked_by_email():
    auth, profiles = InMemoryAuthService(), PlayerProfileService()
    google = VerifiedIdentity(provider="google", subject="same", email="same@example.com")
    apple = VerifiedIdentity(provider="apple", subject="same", email="same@example.com")
    store = InMemorySocialIdentityStore(auth, profiles)
    service = SocialAuthService({"google": FakeVerifier(google), "apple": FakeVerifier(apple)}, store)
    g = await service.login("google", "provider-credential-long-enough")
    a = await service.login("apple", "provider-credential-long-enough")
    assert g.user_id != a.user_id


async def test_social_login_rejects_unconfigured_invalid_and_mismatched_provider():
    service, _, _ = make(error=ProviderVerificationError("bad token"))
    with pytest.raises(ProviderNotConfiguredError):
        await service.login("apple", "provider-credential-long-enough")
    with pytest.raises(SocialAuthError, match="bad token"):
        await service.login("google", "provider-credential-long-enough")
    identity = VerifiedIdentity(provider="apple", subject="123")
    service, _, _ = make(identity)
    with pytest.raises(SocialAuthError, match="does not match"):
        await service.login("google", "provider-credential-long-enough")


def test_social_http_contract_and_provider_discovery():
    identity = VerifiedIdentity(provider="google", subject="http-user", display_name="HTTP Player")
    with TestClient(create_app()) as client:
        auth, profiles = client.app.state.auth, client.app.state.player_profiles
        client.app.state.social_auth = SocialAuthService(
            {"google": FakeVerifier(identity)}, InMemorySocialIdentityStore(auth, profiles),
        )
        assert client.get('/auth/social/providers').json() == {'providers': ['google']}
        response = client.post('/auth/social/google', json={'credential': 'provider-credential-long-enough'})
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        assert client.get('/auth/me', headers={'Authorization': f"Bearer {response.json()['token']}"}).status_code == 200
        assert client.post('/auth/social/apple', json={'credential': 'provider-credential-long-enough'}).status_code == 503
        assert client.post('/auth/social/not-real', json={'credential': 'provider-credential-long-enough'}).status_code == 422


def test_social_config_prefers_canonical_bhidne_ho_names(monkeypatch):
    monkeypatch.setenv('GOOGLE_CLIENT_IDS', 'legacy-google')
    monkeypatch.setenv('BHIDNE_HO_GOOGLE_CLIENT_IDS', 'web-google,ios-google')
    monkeypatch.setenv('BHIDNE_HO_APPLE_CLIENT_IDS', 'apple-service')
    monkeypatch.setenv('BHIDNE_HO_FACEBOOK_APP_ID', 'facebook-id')
    monkeypatch.setenv('BHIDNE_HO_FACEBOOK_APP_SECRET', 'facebook-secret')
    config = SocialAuthConfig.from_environment()
    assert config.google_client_ids == ('web-google', 'ios-google')
    assert config.apple_client_ids == ('apple-service',)
    assert config.facebook_app_id == 'facebook-id'
    assert config.facebook_app_secret == 'facebook-secret'
