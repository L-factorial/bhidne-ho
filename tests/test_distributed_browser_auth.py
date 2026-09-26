from urllib.parse import parse_qs, urlsplit

from app.social_auth.browser import BrowserSocialAuth
from app.social_auth.models import VerifiedIdentity
from test_checkpoint_store import database
from test_distributed_platform import application


async def test_distributed_browser_login_cross_gateway_attempts_and_replay(database, monkeypatch):
    for key, value in {'SOCIAL_PUBLIC_URL':'https://api.test', 'SOCIAL_REDIRECT_URIS':'https://app.test/auth',
        'SOCIAL_ENABLED_PROVIDERS':'google','GOOGLE_WEB_CLIENT_ID':'test-client',
        'GOOGLE_WEB_CLIENT_SECRET':'test-secret'}.items():
        monkeypatch.setenv('BHIDNE_HO_' + key, value)
    async def exchange(self, provider, code, attempt, client):
        assert code == 'provider-code' and attempt['nonce'] and attempt['code_verifier']
        return VerifiedIdentity(provider=provider, subject='test-subject', display_name='Browser User')
    monkeypatch.setattr(BrowserSocialAuth, 'exchange', exchange)
    async with application(database[0]) as (first, _, _):
        async with application(database[0]) as (second, _, _):
            assert (await first.get('/auth/social/browser/providers')).json() == {'providers':['google']}
            assert (await first.post('/auth/social/browser/google/start', json={'redirect_uri':'https://evil.test'})).status_code == 400
            start = (await first.post('/auth/social/browser/google/start', json={'redirect_uri':'https://app.test/auth'})).json()
            state = parse_qs(urlsplit(start['authorization_url']).query)['state'][0]
            callback = await second.get('/auth/social/browser/google/callback', params={'state':state, 'code':'provider-code'})
            assert callback.status_code == 303, callback.text
            handoff = parse_qs(urlsplit(callback.headers['location']).query)['social_code'][0]
            body = dict(attempt_id=start['attempt_id'], secret=start['secret'], handoff=handoff)
            assert (await first.post('/auth/social/browser/complete', json=dict(body, secret='x'*32))).status_code == 409
            completed = await first.post('/auth/social/browser/complete', json=body)
            assert completed.status_code == 200, completed.text
            headers = {'Authorization':'Bearer ' + completed.json()['token']}
            assert (await second.get('/auth/me', headers=headers)).json()['display_name'] == 'Browser User'
            assert (await second.get('/distributed/rooms', headers=headers)).status_code == 200
            assert (await second.post('/auth/social/browser/complete', json=body)).status_code == 409
            assert (await first.get('/auth/social/browser/google/callback', params={'state':state,'code':'provider-code'})).status_code == 400
            assert (await first.post('/auth/social/google', json={})).status_code == 409
