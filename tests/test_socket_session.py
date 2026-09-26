import asyncio
import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI

from app.auth.service import AuthenticationError
from app.durable_games.transport import create_router
from app.durable_games.socket_session import SocketSession
from test_distributed_transport import Gateway, Ingress
from test_room_runtime import until
from test_checkpoint_store import database
from app.auth.postgres import PostgresAuthService


class Socket:
    def __init__(self, app, token):
        self.incoming = asyncio.Queue()
        self.sent = []
        self.incoming.put_nowait({'type': 'websocket.connect'})
        self.frame(dict(type='AUTH', token=token, client_id=uuid4().hex))
        scope = dict(type='websocket', asgi={'version': '3.0'}, scheme='ws', path='/distributed/delivery',
                     raw_path=b'/distributed/delivery', query_string=b'', headers=[], root_path='',
                     server=('test', 80), client=('client', 1), subprotocols=[])
        async def send(message): self.sent.append(message)
        self.task = asyncio.create_task(app(scope, self.incoming.get, send))
    def frame(self, value): self.incoming.put_nowait({'type': 'websocket.receive', 'text': json.dumps(value)})
    async def wait(self, kind):
        async def check():
            return next((json.loads(m['text']) for m in self.sent if m['type'] == 'websocket.send'
                         and json.loads(m['text'])['type'] == kind), None)
        return await until(check)
    async def closed(self):
        async def check(): return next((m for m in self.sent if m['type'] == 'websocket.close'), None)
        message = await until(check)
        await self.task
        return message['code']
    async def stop(self):
        if not self.task.done():
            self.incoming.put_nowait({'type': 'websocket.disconnect', 'code': 1000})
        await self.task


def app_for(auth, **options):
    gateway, ingress = Gateway(), Ingress()
    app = FastAPI()
    app.include_router(create_router(auth=auth, hosted=ingress, chat=ingress, social=ingress,
        gateway=gateway, allowed_origins=set(), session_check_interval=.05, session_check_timeout=.02, **options))
    return app, gateway


@pytest.mark.parametrize('failure,code', [('revoked', 1008), ('identity', 1008), ('outage', 1011), ('timeout', 1011)])
async def test_idle_socket_closes_on_session_failure_and_removes_subscriptions(failure, code):
    class Auth:
        mode = None
        async def authenticate(self, token):
            if self.mode == 'revoked': raise AuthenticationError()
            if self.mode == 'outage': raise ConnectionError('private database failure')
            if self.mode == 'timeout': await asyncio.Event().wait()
            return SimpleNamespace(user_id='user-00000000-0000-0000-0000-00000000000' + ('2' if self.mode == 'identity' else '1'))
    auth = Auth()
    app, gateway = app_for(auth)
    sock = Socket(app, 'token')
    try:
        await sock.wait('READY')
        sock.frame(dict(type='SUBSCRIBE', subscription_id='a', lane_id=str(uuid4())))
        await sock.wait('SUBSCRIBED')
        assert gateway.handles
        auth.mode = failure
        assert await sock.closed() == code
        assert not gateway.handles
    finally:
        await sock.stop()


@pytest.mark.parametrize('expire', [False, True])
async def test_postgres_other_server_revocation_or_expiry_affects_only_that_token(database, expire):
    pool = database[0]
    issuer, verifier = PostgresAuthService(pool), PostgresAuthService(pool)
    first = await issuer.issue_guest()
    async with pool.connection() as connection:
        second = await issuer._session(connection, UUID(first.user_id[5:]))
    app, _ = app_for(verifier)
    one, two = Socket(app, first.token), Socket(app, second.token)
    try:
        await one.wait('READY'); await two.wait('READY')
        if expire:
            async with pool.connection() as connection:
                await connection.execute("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=%s",
                    (issuer._token_hash(first.token),))
        else:
            await issuer.revoke(first.token)  # Another service instance, no Redis hint.
        assert await one.closed() == 1008
        two.frame({'type': 'PING'})
        await two.wait('PONG')
        assert not two.task.done()
    finally:
        await one.stop(); await two.stop()


async def test_expired_freshness_blocks_background_delivery_before_watchdog_runs():
    class Auth:
        invalid = False
        async def authenticate(self, token):
            if self.invalid: raise AuthenticationError()
            return 'actor'
    auth = Auth()
    # No watchdog: exercising the mandatory outbound/inbound freshness gate itself.
    session = SocketSession(auth.authenticate, 'secret', asyncio.current_task(), interval=.01)
    assert await session.check() == 'actor'
    auth.invalid = True
    session.deadline = 0
    with pytest.raises(AuthenticationError): await session.check()
    assert session.close_code == 1008
    await session.stop()
    assert session._token is None


async def test_revocation_cleans_presence_and_blocks_late_delivery_callbacks():
    from app.durable_games.redis_presence import ConnectionPresenceRegistry
    from test_redis_presence import Store
    class Auth:
        invalid = False
        async def authenticate(self, token):
            if self.invalid: raise AuthenticationError()
            return SimpleNamespace(user_id='user-00000000-0000-0000-0000-000000000001')
    auth = Auth()
    presence = ConnectionPresenceRegistry(Store(), 'boot')
    await presence.start()
    async def room(actor, lane): return 'room'
    app, gateway = app_for(auth, presence=presence, presence_room=room)
    sock = Socket(app, 'secret')
    try:
        await sock.wait('READY')
        sock.frame(dict(type='SUBSCRIBE', subscription_id='a', lane_id=str(uuid4())))
        await sock.wait('SUBSCRIBED')
        assert len(presence._entries) == 2
        late_send = next(iter(gateway.handles.values()))[3]
        auth.invalid = True
        assert await sock.closed() == 1008
        assert not gateway.handles and not presence._entries
        count = len(sock.sent)
        with pytest.raises(RuntimeError): await late_send({'type': 'DELIVERY_PAGE', 'events': ['private']})
        assert len(sock.sent) == count
    finally:
        await sock.stop()
        await presence.stop()
