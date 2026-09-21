"""Confidential-client OAuth code flows, shared by web and system-browser clients."""
import base64
import hashlib
import json
import os
import re
import secrets
from dataclasses import dataclass
from time import time
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import HTTPException

from app.social_auth.models import VerifiedIdentity
from app.social_auth.verifiers import FacebookTokenVerifier, OpenIdTokenVerifier, ProviderVerificationError


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class BrowserProvider:
    client_id: str
    client_secret: str
    authorize_url: str
    token_url: str
    scope: str


class BrowserSocialAuth:
    def __init__(self, attempts, identities, public_url='', redirects=(), providers=None, client=None):
        self.attempts, self.identities = attempts, identities
        self.public_url, self.redirects = public_url.rstrip('/'), tuple(redirects)
        self.providers = providers or {}
        self.client = client
        self.verifiers = {}
        for name, config in self.providers.items():
            if name == 'facebook':
                self.verifiers[name] = FacebookTokenVerifier(config.client_id, config.client_secret, client,
                    graph_url=config.token_url.removesuffix('/oauth/access_token'))
            else:
                self.verifiers[name] = OpenIdTokenVerifier((config.client_id,),
                    ('https://accounts.google.com', 'accounts.google.com') if name == 'google' else 'https://appleid.apple.com',
                    'https://www.googleapis.com/oauth2/v3/certs' if name == 'google' else 'https://appleid.apple.com/auth/keys',
                    name, client)

    @classmethod
    def from_environment(cls, attempts, identities):
        def env(name):
            return os.environ.get('BHIDNE_HO_' + name, '').strip()
        public_url = env('SOCIAL_PUBLIC_URL').rstrip('/')
        redirects = tuple(value.strip() for value in env('SOCIAL_REDIRECT_URIS').split(',') if value.strip())
        providers = {}
        enabled = {value.strip() for value in env('SOCIAL_ENABLED_PROVIDERS').split(',')}
        graph_version = env('FACEBOOK_GRAPH_VERSION')
        specs = {
            'google': (env('GOOGLE_WEB_CLIENT_ID'), env('GOOGLE_WEB_CLIENT_SECRET'),
                       'https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token', 'openid email profile'),
            'apple': (env('APPLE_SERVICE_ID'), env('APPLE_CLIENT_SECRET'),
                      'https://appleid.apple.com/auth/authorize', 'https://appleid.apple.com/auth/token', 'name email'),
            'facebook': (env('FACEBOOK_APP_ID'), env('FACEBOOK_APP_SECRET'),
                         f'https://www.facebook.com/{graph_version}/dialog/oauth',
                         f'https://graph.facebook.com/{graph_version}/oauth/access_token', 'public_profile,email'),
        }
        if public_url:
            cls.validate_redirect(public_url, server=True)
        for redirect in redirects:
            cls.validate_redirect(redirect)
        if public_url and redirects:
            for name, spec in specs.items():
                if name in enabled and spec[0] and spec[1] and (name != 'facebook' or re.fullmatch(r'v\d+\.\d+', graph_version)):
                    providers[name] = BrowserProvider(*spec)
        return cls(attempts, identities, public_url, redirects, providers)

    @staticmethod
    def validate_redirect(value, server=False):
        parsed = urlsplit(value)
        local = parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')
        native = not server and value == 'bhidneho://auth'
        if (not (native or local or (parsed.scheme == 'https' and parsed.hostname))
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError('Social login URLs must be HTTPS (HTTP localhost for development), or bhidneho://auth for native returns, without query or fragment.')

    def callback_url(self, provider):
        return f'{self.public_url}/auth/social/browser/{provider}/callback'

    async def start(self, provider, redirect_uri):
        config = self.providers.get(provider)
        if not config:
            raise HTTPException(503, 'This sign-in provider is not configured.')
        if redirect_uri not in self.redirects:
            raise HTTPException(400, 'This sign-in return URL is not registered.')
        attempt_id, state, secret, nonce, verifier = [secrets.token_urlsafe(32) for _ in range(5)]
        attempt = dict(id=attempt_id, provider=provider, redirect_uri=redirect_uri,
                       state_hash=digest(state), secret_hash=digest(secret), nonce=nonce,
                       code_verifier=verifier, status='pending', expires_at=time() + 600)
        await self.attempts.create(attempt)
        params = dict(client_id=config.client_id, redirect_uri=self.callback_url(provider),
                      response_type='code', scope=config.scope, state=state)
        if provider in ('google', 'apple'):
            params['nonce'] = nonce
        if provider == 'google':
            params.update(code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),
                          code_challenge_method='S256', prompt='select_account')
        if provider == 'apple':
            params['response_mode'] = 'form_post'
        return dict(attempt_id=attempt_id, secret=secret,
                    authorization_url=config.authorize_url + '?' + urlencode(params))

    async def callback(self, provider, fields):
        state = fields.get('state', '')
        if not state or len(state) > 128:
            raise HTTPException(400, 'Invalid sign-in state. Start sign-in again.')
        attempt = await self.attempts.claim(provider, digest(state))
        if not attempt:
            raise HTTPException(400, 'Sign-in expired or already completed. Start again.')
        result = {'error': 'failed'}
        if fields.get('error') == 'access_denied':
            result = {'error': 'cancelled'}
        elif not fields.get('error'):
            try:
                code = fields.get('code', '')
                if not code or len(code) > 4096:
                    raise ProviderVerificationError('Missing authorization code')
                if self.client:
                    identity = await self.exchange(provider, code, attempt, self.client)
                else:
                    async with httpx.AsyncClient(timeout=10) as client:
                        identity = await self.exchange(provider, code, attempt, client)
                if provider == 'apple' and fields.get('user'):
                    # Apple's initial name is editable profile metadata, never identity proof.
                    try:
                        name = json.loads(fields['user']).get('name', {})
                        identity.display_name = ' '.join(str(name.get(k, '')) for k in ('firstName', 'lastName')).strip()[:25]
                    except (ValueError, TypeError, AttributeError):
                        pass
                result = {'identity': identity.model_dump()}
            except (httpx.HTTPError, ProviderVerificationError, ValueError, KeyError, TypeError):
                # Never reflect provider responses, codes, credentials, or private details.
                result = {'error': 'failed'}
        # Completion requires BOTH the initiating app secret and the callback code.
        # Someone who sends their own authorization URL to another user cannot
        # redeem that user's login using only the secret from their own attempt.
        handoff = secrets.token_urlsafe(32)
        result['handoff_hash'] = digest(handoff)
        await self.attempts.finish(attempt['id'], result)
        return attempt['redirect_uri'] + '?' + urlencode({'social_attempt': attempt['id'], 'social_code': handoff})

    async def exchange(self, provider, code, attempt, client):
        config = self.providers[provider]
        body = dict(client_id=config.client_id, client_secret=config.client_secret, code=code,
                    redirect_uri=self.callback_url(provider), grant_type='authorization_code')
        if provider == 'google':
            body['code_verifier'] = attempt['code_verifier']
        response = await client.post(config.token_url, data=body)
        response.raise_for_status()
        data = response.json()
        credential = data['access_token' if provider == 'facebook' else 'id_token']
        if not isinstance(credential, str) or not credential:
            raise ProviderVerificationError('Missing provider credential')
        return await self.verifiers[provider].verify(credential, None if provider == 'facebook' else attempt['nonce'])

    async def complete(self, attempt_id, secret, handoff):
        result = await self.attempts.consume(attempt_id, digest(secret), digest(handoff))
        if result is None:
            raise HTTPException(409, 'Sign-in expired, incomplete, or already used. Please start again.')
        if 'error' in result:
            raise HTTPException(400, 'Sign-in cancelled.' if result['error'] == 'cancelled' else 'Provider sign-in failed. Please try again.')
        return await self.identities.login(VerifiedIdentity.model_validate(result['identity']))
