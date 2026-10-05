import json
import time
import logging
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec,rsa
from app.push.providers import NativeProviders
from app.push.events import message

def pem(key):return key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()

@pytest.mark.parametrize('environment',['development','production'])
async def test_apns_native_token_auth_payload_expiry_collapse_and_private_logs(environment,caplog):
    key=ec.generate_private_key(ec.SECP256R1());seen=[]
    def handler(request):
        seen.append(request);return httpx.Response(200)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler),http2=True) as client:
        providers=NativeProviders(apns=dict(key=pem(key),team='TEAM',kid='KEY',topic='com.lfactorial.bhidne-ho'),client=client)
        with caplog.at_level(logging.INFO):
            result=await providers.send(('apns','a'*64,environment),message('play','en',{'type':'bhidne_notification','room_id':'r'}),expires_at=time.time()+90,collapse_id='turn',sound=False)
        assert result.status=='sent';request=seen[0]
        assert request.url.host==('api.sandbox.push.apple.com' if environment=='development' else 'api.push.apple.com')
        assert request.headers['apns-topic']=='com.lfactorial.bhidne-ho'
        assert request.headers['apns-push-type']=='alert';assert request.headers['apns-collapse-id']=='turn'
        assert int(request.headers['apns-expiration'])>time.time()
        bearer=request.headers['authorization'].split(' ')[1]
        assert jwt.decode(bearer,key.public_key(),algorithms=['ES256'])['iss']=='TEAM'
        assert jwt.get_unverified_header(bearer)['kid']=='KEY'
        body=json.loads(request.content);assert 'sound' not in body['aps']
        assert body['room_id']=='r' and 'a'*64 not in caplog.text

@pytest.mark.parametrize('status,reason,expected',[(410,'Unregistered','invalid'),(400,'BadDeviceToken','invalid'),(429,'TooManyRequests','retry'),(503,'Shutdown','retry'),(403,'InvalidProviderToken','failed')])
async def test_apns_errors_are_classified_without_exposing_credentials(status,reason,expected):
    key=ec.generate_private_key(ec.SECP256R1())
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(status,json={'reason':reason},headers={'retry-after':'12'}))) as client:
        providers=NativeProviders(apns=dict(key=pem(key),team='TEAM',kid='KEY',topic='topic'),client=client)
        result=await providers.send(('apns','a'*64,'production'),message('bid','en',{}),expires_at=time.time()+90,collapse_id='turn',sound=True)
        assert result.status==expected
        if expected=='retry':assert result.retry_after==12

async def test_fcm_oauth_scoped_credentials_native_token_and_quiet_payload():
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048);seen=[]
    def handler(request):
        seen.append(request)
        if request.url.host=='oauth2.googleapis.com':return httpx.Response(200,json={'access_token':'access','expires_in':3600})
        return httpx.Response(200,json={'name':'message'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        providers=NativeProviders(firebase=dict(project_id='bhidne-test',client_email='sender@test',private_key=pem(key)),client=client)
        result=await providers.send(('fcm','native-token','production'),message('draw','ne',{'room_id':'r'}),expires_at=time.time()+90,collapse_id='turn',sound=False)
        assert result.status=='sent'
        from urllib.parse import parse_qs
        assertion=parse_qs(seen[0].content.decode())['assertion'][0]
        auth=jwt.decode(assertion,key.public_key(),algorithms=['RS256'],audience='https://oauth2.googleapis.com/token')
        assert auth['scope']=='https://www.googleapis.com/auth/firebase.messaging'
        sent=json.loads(seen[1].content)['message'];assert sent['token']=='native-token'
        assert sent['data']=={'room_id':'r'}
        assert sent['android']['notification']['channel_id']=='game-actions-silent'
        assert 'sound' not in sent['android']['notification']
        await providers.send(('fcm','native-token','production'),message('draw','en',{}),expires_at=time.time()+90,collapse_id='turn',sound=True)
        assert len([r for r in seen if r.url.host=='oauth2.googleapis.com'])==1

async def test_fcm_unregistered_is_revoked_and_transient_errors_retry():
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048);status=404
    def handler(request):
        if request.url.host=='oauth2.googleapis.com':return httpx.Response(200,json={'access_token':'access','expires_in':3600})
        return httpx.Response(status,json={'error':{'details':[{'errorCode':'UNREGISTERED'}] if status==404 else []}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider=NativeProviders(firebase=dict(project_id='bhidne-test',client_email='sender@test',private_key=pem(key)),client=client)
        args=(('fcm','native-token','production'),message('play','en',{}))
        assert (await provider.send(*args,expires_at=time.time()+90,collapse_id='turn',sound=True)).status=='invalid'
        status=503
        assert (await provider.send(*args,expires_at=time.time()+90,collapse_id='turn',sound=True)).status=='retry'
