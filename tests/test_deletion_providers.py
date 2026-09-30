"""Provider adapter contracts: no live provider credentials or network calls."""
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest
from app.account_deletion.runtime import DeletionRuntime


@pytest.mark.parametrize('provider', ['google','apple','facebook'])
async def test_revocation_sends_verified_server_grant_only(provider,monkeypatch):
    config=SimpleNamespace(client_id='our-client',client_secret='our-secret',token_url='https://graph.facebook.com/v23.0/oauth/access_token')
    recovery=SimpleNamespace(enabled=True,decrypt=lambda _:dict(token='verified-grant',subject='verified-subject',hint='refresh_token'))
    runtime=DeletionRuntime(None,recovery,SimpleNamespace(providers={provider:config}))
    calls=[]
    def handle(request):
        calls.append(request)
        if provider=='facebook':
            assert request.method=='DELETE' and request.url.path=='/v23.0/verified-subject/permissions'
            assert request.headers['Authorization']=='Bearer verified-grant'
            return httpx.Response(200,json={'success':True})
        body=parse_qs(request.content.decode());assert body['token']==['verified-grant']
        assert request.method=='POST' and request.url.path==('/revoke' if provider=='google' else '/auth/revoke')
        if provider=='apple':assert body['client_secret']==['our-secret']
        return httpx.Response(200)
    factory=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **_:factory(transport=httpx.MockTransport(handle)))
    await runtime.revoke(provider,b'encrypted')
    assert len(calls)==1


@pytest.mark.parametrize('error,terminal', [('invalid_token',True),('invalid_request',False)])
async def test_google_retry_only_accepts_documented_terminal_error(error,terminal,monkeypatch):
    runtime=DeletionRuntime(None,SimpleNamespace(enabled=True,decrypt=lambda _:dict(token='refresh-grant')),
        SimpleNamespace(providers={'google':object()}))
    factory=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **_:factory(transport=httpx.MockTransport(lambda request:httpx.Response(400,json={'error':error}))))
    if terminal:await runtime.revoke('google',b'encrypted')
    else:
        with pytest.raises(httpx.HTTPStatusError):await runtime.revoke('google',b'encrypted')
