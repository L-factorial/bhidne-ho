import asyncio
import json
from time import time
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth.service import InMemoryAuthService
from app.main import create_app
from app.multiplayer.player_profiles import PlayerProfileService
from app.social_auth.browser import BrowserProvider, BrowserSocialAuth
from app.social_auth.browser_store import MemoryBrowserAttempts
from app.social_auth.store import InMemorySocialIdentityStore
from app.social_auth.verifiers import ProviderVerificationError


@pytest.fixture
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_flow(provider, key, claims_override=None):
    auth = InMemoryAuthService()
    profiles = PlayerProfileService()
    attempts = MemoryBrowserAttempts()
    calls = []
    nonce = {'value': ''}
    config = BrowserProvider('our-client', 'server-secret', f'https://{provider}.example/authorize',
        'https://graph.facebook.com/v99.0/oauth/access_token' if provider == 'facebook' else f'https://{provider}.example/token',
        'openid email profile')

    def handle(request):
        calls.append(request)
        if request.url.path.endswith('/token') or request.url.path.endswith('/access_token'):
            body = parse_qs(request.content.decode())
            assert body['client_secret'] == ['server-secret']
            assert body['redirect_uri'] == [f'https://api.example/auth/social/browser/{provider}/callback']
            assert body['code'] == ['valid-code']
            if provider == 'google':
                assert body['code_verifier']
            if provider == 'facebook':
                return httpx.Response(200, json={'access_token': 'facebook-user-access-token'})
            claims = dict(iss='https://accounts.google.com' if provider == 'google' else 'https://appleid.apple.com',
                          aud='our-client', sub='stable-subject', exp=int(time()) + 300, iat=int(time()),
                          nonce=nonce['value'], name='Test Player')
            claims.update(claims_override or {})
            token = jwt.encode(claims, key, algorithm='RS256', headers={'kid': 'test-key'})
            return httpx.Response(200, json={'id_token': token, 'refresh_token': 'must-not-be-persisted'})
        if request.url.path.endswith('/debug_token'):
            return httpx.Response(200, json={'data': {'is_valid': True, 'app_id': 'our-client', 'user_id': 'facebook-user'}})
        if request.url.path.endswith('/me'):
            assert request.url.params['appsecret_proof']
            return httpx.Response(200, json={'id': 'facebook-user', 'name': 'Facebook Player'})
        public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
        return httpx.Response(200, json={'keys': [{**public, 'kid': 'test-key'}]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    flow = BrowserSocialAuth(attempts, InMemorySocialIdentityStore(auth, profiles), 'https://api.example',
                             ('https://app.example/', 'bhidneho://auth'), {provider: config}, client)
    return flow, auth, nonce, calls, client


async def begin(flow, provider, nonce):
    started = await flow.start(provider, 'https://app.example/')
    params = parse_qs(urlsplit(started['authorization_url']).query)
    nonce['value'] = params.get('nonce', [''])[0]
    return started, params['state'][0]


def handoff(url):
    return parse_qs(urlsplit(url).query)['social_code'][0]


@pytest.mark.parametrize('provider', ['google', 'apple', 'facebook'])
async def test_browser_login_creates_one_identity_and_bound_single_use_sessions(provider, signing_key):
    flow, auth, nonce, calls, client = make_flow(provider, signing_key)
    try:
        first_user = None
        for _ in range(2):
            started, state = await begin(flow, provider, nonce)
            target = await flow.callback(provider, {'state': state, 'code': 'valid-code'})
            assert target.startswith('https://app.example/?social_attempt=' + started['attempt_id'])
            assert 'token' not in target and 'secret' not in target
            with pytest.raises(HTTPException):
                await flow.complete(started['attempt_id'], 'wrong-client-secret', handoff(target))
            with pytest.raises(HTTPException):
                await flow.complete(started['attempt_id'], started['secret'], 'wrong-handoff')
            session = await flow.complete(started['attempt_id'], started['secret'], handoff(target))
            assert (await auth.authenticate(session.token)).user_id == session.user_id
            if first_user:
                assert session.user_id == first_user
            first_user = session.user_id
            with pytest.raises(HTTPException):
                await flow.complete(started['attempt_id'], started['secret'], handoff(target))
            with pytest.raises(HTTPException):
                await flow.callback(provider, {'state': state, 'code': 'valid-code'})
        assert not flow.attempts.attempts
        if provider != 'facebook':
            assert len([call for call in calls if call.method == 'GET']) == 1  # Cached signing keys.
    finally:
        await client.aclose()


@pytest.mark.parametrize('override', [
    {'nonce': 'wrong'}, {'aud': 'another-app'}, {'iss': 'https://attacker.example'},
    {'exp': 1}, {'sub': ''},
])
async def test_bad_identity_never_issues_application_session(override, signing_key):
    flow, auth, nonce, calls, client = make_flow('google', signing_key, override)
    try:
        started, state = await begin(flow, 'google', nonce)
        target = await flow.callback('google', {'state': state, 'code': 'valid-code'})
        with pytest.raises(HTTPException) as rejected:
            await flow.complete(started['attempt_id'], started['secret'], handoff(target))
        assert rejected.value.status_code == 400
        assert not auth._identities
    finally:
        await client.aclose()


async def test_redirect_state_expiry_and_provider_binding(signing_key):
    flow, auth, nonce, calls, client = make_flow('google', signing_key)
    try:
        for target in ('https://evil.example/', 'https://app.example/?next=https://evil.example'):
            with pytest.raises(HTTPException):
                await flow.start('google', target)
        started, state = await begin(flow, 'google', nonce)
        with pytest.raises(HTTPException):
            await flow.callback('apple', {'state': state, 'code': 'valid-code'})
        with pytest.raises(HTTPException):
            await flow.callback('google', {'state': 'wrong-state', 'code': 'valid-code'})
        flow.attempts.attempts[started['attempt_id']]['expires_at'] = time() - 1
        with pytest.raises(HTTPException):
            await flow.callback('google', {'state': state, 'code': 'valid-code'})
        assert not calls and not auth._identities
    finally:
        await client.aclose()


async def test_cancel_and_concurrent_callback_and_completion(signing_key):
    flow, auth, nonce, calls, client = make_flow('google', signing_key)
    try:
        started, state = await begin(flow, 'google', nonce)
        target = await flow.callback('google', {'state': state, 'error': 'access_denied'})
        with pytest.raises(HTTPException, match='cancelled'):
            await flow.complete(started['attempt_id'], started['secret'], handoff(target))
        assert not calls
        started, state = await begin(flow, 'google', nonce)
        results = await asyncio.gather(*(flow.callback('google', {'state': state, 'code': 'valid-code'})
                                         for _ in range(2)), return_exceptions=True)
        assert sum(isinstance(result, HTTPException) for result in results) == 1
        target = next(result for result in results if isinstance(result, str))
        results = await asyncio.gather(*(flow.complete(started['attempt_id'], started['secret'], handoff(target))
                                         for _ in range(2)), return_exceptions=True)
        assert sum(isinstance(result, HTTPException) for result in results) == 1
        assert len(auth._identities) == 1
    finally:
        await client.aclose()


async def test_unknown_signing_key_is_rejected_without_runtime_error(signing_key):
    flow, auth, nonce, calls, client = make_flow('google', signing_key)
    try:
        token = jwt.encode({'sub': 'user'}, signing_key, algorithm='RS256', headers={'kid': 'unknown'})
        with pytest.raises(ProviderVerificationError):
            await flow.verifiers['google'].verify(token)
    finally:
        await client.aclose()


def test_provider_configuration_requires_explicit_enablement(monkeypatch):
    monkeypatch.setenv('BHIDNE_HO_SOCIAL_PUBLIC_URL', 'https://api.example')
    monkeypatch.setenv('BHIDNE_HO_SOCIAL_REDIRECT_URIS', 'https://app.example/,bhidneho://auth')
    monkeypatch.setenv('BHIDNE_HO_GOOGLE_WEB_CLIENT_ID', 'our-client')
    monkeypatch.setenv('BHIDNE_HO_GOOGLE_WEB_CLIENT_SECRET', 'secret')
    monkeypatch.delenv('BHIDNE_HO_SOCIAL_ENABLED_PROVIDERS', raising=False)
    assert not BrowserSocialAuth.from_environment(None, None).providers
    monkeypatch.setenv('BHIDNE_HO_SOCIAL_ENABLED_PROVIDERS', 'google')
    assert set(BrowserSocialAuth.from_environment(None, None).providers) == {'google'}
    monkeypatch.setenv('BHIDNE_HO_SOCIAL_REDIRECT_URIS', 'https://app.example/?next=bad')
    with pytest.raises(ValueError):
        BrowserSocialAuth.from_environment(None, None)


def test_http_discovery_disabled_legacy_and_apple_form_callback(signing_key):
    with TestClient(create_app()) as web:
        assert web.get('/auth/social/browser/providers').json() == {'providers': []}
        assert web.post('/auth/social/google', json={'credential': 'a' * 30}).status_code == 410
        flow, auth, nonce, calls, client = make_flow('apple', signing_key)
        web.app.state.browser_social_auth = flow
        start = web.post('/auth/social/browser/apple/start', json={'redirect_uri': 'https://app.example/'})
        assert start.status_code == 200 and start.headers['cache-control'] == 'no-store'
        body = start.json()
        params = parse_qs(urlsplit(body['authorization_url']).query)
        nonce['value'] = params['nonce'][0]
        callback = web.post('/auth/social/browser/apple/callback', data={
            'state': params['state'][0], 'code': 'valid-code',
            'user': json.dumps({'name': {'firstName': 'Apple', 'lastName': 'Player'}}),
        }, follow_redirects=False)
        assert callback.status_code == 303 and callback.headers['referrer-policy'] == 'no-referrer'
        result = web.post('/auth/social/browser/complete', json={
            'attempt_id': body['attempt_id'], 'secret': body['secret'], 'handoff': handoff(callback.headers['location'])})
        assert result.status_code == 200 and result.json()['token']
        repeated = web.post('/auth/social/browser/complete', json={
            'attempt_id': body['attempt_id'], 'secret': body['secret'], 'handoff': handoff(callback.headers['location'])})
        assert repeated.status_code == 409 and repeated.headers['cache-control'] == 'no-store'


def test_callback_rejects_ambiguous_and_oversized_inputs_and_rate_limits():
    with TestClient(create_app()) as web:
        path = '/auth/social/browser/apple/callback'
        assert web.get(path + '?state=a&state=b').status_code == 400
        assert web.post(path, content='x' * 20000, headers={
            'Content-Type': 'application/x-www-form-urlencoded'}).status_code == 413
        assert web.post(path, json={}).status_code == 415
        for _ in range(60):
            result = web.post('/auth/social/browser/google/start', json={'redirect_uri': 'https://app.example/'})
        assert result.status_code == 429 and result.headers['retry-after'] == '60'
