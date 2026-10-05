"""APNs HTTP/2 and FCM HTTP v1 adapters. Credentials never enter payloads/logs."""
from dataclasses import dataclass
import asyncio
from contextvars import ContextVar
import logging
import json
import os
from pathlib import Path
import re
import time
import jwt
import httpx

_sending = ContextVar('native_push_request', default=False)
class _PrivateTransportLog(logging.Filter):
    def filter(self,record):return not _sending.get()
# HTTPX otherwise logs the APNs URL, whose path contains the device token.
for _logger in ('httpx','httpcore.connection','httpcore.http11','httpcore.http2','httpcore.proxy','httpcore.socks'):
    logging.getLogger(_logger).addFilter(_PrivateTransportLog())

@dataclass(frozen=True)
class SendResult:
    status: str  # sent, retry, invalid, failed
    retry_after: int = 0

class NativeProviders:
    def __init__(self, *, apns=None, firebase=None, client=None):
        self.apns, self.firebase = apns, firebase
        self.client = client
        self.owned = client is None
        self._apns_token = None
        self._google_token = None
        self._lock = asyncio.Lock()

    @classmethod
    def from_environment(cls):
        apns = firebase = None
        path = os.getenv('BHIDNE_APNS_KEY_FILE')
        if path:
            apns = dict(key=Path(path).read_text(), team=os.environ['BHIDNE_APNS_TEAM_ID'],
                        kid=os.environ['BHIDNE_APNS_KEY_ID'], topic=os.environ['BHIDNE_APNS_TOPIC'])
            # Validate at startup, before advertising delivery capability.
            jwt.encode({'iss':apns['team'],'iat':int(time.time())},apns['key'],algorithm='ES256',headers={'kid':apns['kid']})
        path = os.getenv('BHIDNE_FCM_SERVICE_ACCOUNT_FILE')
        if path:
            firebase = json.loads(Path(path).read_text())
            if not re.fullmatch(r'[a-z][a-z0-9-]{4,62}', firebase['project_id']):
                raise ValueError('Invalid Firebase project ID.')
            jwt.encode({'iss':firebase['client_email']},firebase['private_key'],algorithm='RS256')
        return cls(apns=apns, firebase=firebase)

    @property
    def available(self):
        return [name for name,value in [('apns',self.apns),('fcm',self.firebase)] if value]

    async def start(self):
        if self.client is None and self.available:
            self.client = httpx.AsyncClient(http2=True,timeout=10,follow_redirects=False)

    async def close(self):
        if self.owned and self.client:
            await self.client.aclose()
            self.client = None

    async def _credentials(self, provider):
        now = int(time.time())
        async with self._lock:
            if provider == 'apns':
                if not self._apns_token or self._apns_token[1] <= now:
                    key = self.apns
                    value = jwt.encode({'iss':key['team'],'iat':now},key['key'],algorithm='ES256',headers={'kid':key['kid']})
                    self._apns_token = (value, now + 3000)
                return self._apns_token[0]
            if not self._google_token or self._google_token[1] <= now:
                key = self.firebase
                assertion = jwt.encode({'iss':key['client_email'],'scope':'https://www.googleapis.com/auth/firebase.messaging',
                    'aud':'https://oauth2.googleapis.com/token','iat':now,'exp':now+3600},key['private_key'],algorithm='RS256')
                response = await self.client.post('https://oauth2.googleapis.com/token',data={
                    'grant_type':'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion':assertion})
                if response.status_code != 200:
                    raise RuntimeError('FCM authentication unavailable.')
                data = response.json()
                self._google_token = (data['access_token'],now+max(1,int(data['expires_in'])-120))
            return self._google_token[0]

    async def send(self, device, payload, *, expires_at, collapse_id, sound):
        marker=_sending.set(True)
        try:
            return await self._send(device,payload,expires_at=expires_at,collapse_id=collapse_id,sound=sound)
        finally:_sending.reset(marker)

    async def _send(self, device, payload, *, expires_at, collapse_id, sound):
        provider, token, environment = device
        if provider not in self.available:
            return SendResult('failed')
        try:
            bearer = await self._credentials(provider)
            ttl = max(0,int(expires_at-time.time()))
            if ttl == 0:return SendResult('failed')
            if provider == 'apns':
                host = 'api.sandbox.push.apple.com' if environment == 'development' else 'api.push.apple.com'
                content = {**payload['data'],'aps':{'alert':{'title':payload['title'],'body':payload['body']}}}
                if sound:content['aps']['sound']='default'
                response = await self.client.post(f'https://{host}/3/device/{token}',headers={
                    'authorization':f'bearer {bearer}','apns-topic':self.apns['topic'],'apns-push-type':'alert',
                    'apns-priority':'10','apns-expiration':str(int(expires_at)), 'apns-collapse-id':collapse_id},json=content)
                if response.status_code == 200:return SendResult('sent')
                reason = response.json().get('reason') if response.content else None
                if response.status_code == 410 or reason in ('BadDeviceToken','DeviceTokenNotForTopic','Unregistered'):
                    return SendResult('invalid')
            else:
                android = {'ttl':f'{ttl}s','collapse_key':collapse_id,'priority':'HIGH',
                    'notification':{'channel_id':'game-actions','tag':collapse_id}}
                if sound:android['notification']['sound']='default'
                else:android['notification']['channel_id']='game-actions-silent'
                response = await self.client.post(f"https://fcm.googleapis.com/v1/projects/{self.firebase['project_id']}/messages:send",
                    headers={'authorization':f'Bearer {bearer}'},json={'message':{'token':token,
                        'notification':{'title':payload['title'],'body':payload['body']},
                        'data':{k:str(v) for k,v in payload['data'].items()},'android':android}})
                if response.status_code == 200:return SendResult('sent')
                errors=response.json().get('error',{}).get('details',[]) if response.content else []
                if any(e.get('errorCode')=='UNREGISTERED' for e in errors):return SendResult('invalid')
            if response.status_code in (429,500,502,503,504):
                retry = response.headers.get('retry-after','0')
                return SendResult('retry',min(300,int(retry)) if retry.isdigit() else 0)
            return SendResult('failed')
        except (httpx.HTTPError,RuntimeError,ValueError,KeyError):
            return SendResult('retry')
