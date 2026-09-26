import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.durable_games.server import DistributedServer, build_server
from test_checkpoint_store import database
from test_redis_signals import Broker, SECRET, eventually


class Component:
    def __init__(self, name, log):
        self.name, self.log = name, log
        self.fail_start = self.fail_stop = False
        self.gate = None
    async def start(self):
        self.log.append('start:' + self.name)
        if self.fail_start:
            raise RuntimeError('injected startup failure')
    async def stop(self):
        self.log.append('stop:' + self.name)
        if self.gate:
            await self.gate.wait()
        if self.fail_stop:
            raise RuntimeError('injected shutdown failure')
    async def drain_and_stop(self):
        await self.stop()
        return 'drained'
    def observe_health(self, value):
        self.available = value
    observe = observe_health
    async def close(self): self.log.append('close:' + self.name)
    aclose = close


def assembly():
    log = []
    parts = {name: Component(name, log) for name in
             ('runtime', 'discovery', 'signals', 'presence', 'gateway', 'publisher', 'social', 'polling', 'pool', 'redis')}
    parts['runtime'].leases = SimpleNamespace(begin_drain=lambda: log.append('fence'))
    return DistributedServer(**parts, owns_pool=True, owns_redis=True), log


async def test_start_shutdown_order_and_request_join():
    server, log = assembly()
    with pytest.raises(HTTPException):
        await anext(server.admission())
    await server.start()
    entered = asyncio.Event()
    async def request():
        async for _ in server.admission():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                log.append('request-cleaned')
    task = asyncio.create_task(request())
    await entered.wait()
    await server.stop()
    assert task.cancelled()
    assert log[:7] == ['start:' + n for n in ('runtime','presence','gateway','social','signals','publisher','discovery')]
    assert log.index('fence') < log.index('stop:discovery') < log.index('request-cleaned')
    assert log.index('request-cleaned') < log.index('stop:runtime') < log.index('close:pool')
    assert log[-2:] == ['close:redis', 'close:pool']
    assert server.state == 'closed' and server.drain_report == 'drained'
    await server.stop()
    with pytest.raises(RuntimeError): await server.start()


@pytest.mark.parametrize('name', ['runtime','presence','gateway','social','signals','publisher','discovery'])
async def test_partial_start_is_stopped_including_failing_component(name):
    server, log = assembly()
    getattr(server, name).fail_start = True
    with pytest.raises(RuntimeError, match='startup failure'):
        await server.start()
    assert 'stop:' + name in log
    assert server.state == 'closed' and log[-1] == 'close:pool'
    with pytest.raises(HTTPException): await anext(server.admission())


async def test_cancelled_shutdown_finishes_cleanup_before_propagating():
    server, log = assembly()
    await server.start()
    server.discovery.gate = asyncio.Event()
    task = asyncio.create_task(server.stop())
    await eventually(lambda: 'stop:discovery' in log)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done() and 'close:pool' not in log
    server.discovery.gate.set()
    with pytest.raises(asyncio.CancelledError): await task
    assert server.state == 'closed' and log[-1] == 'close:pool'


async def test_failed_stop_keeps_resources_open_and_admission_closed_until_retry():
    server, log = assembly()
    await server.start()
    server.social.fail_stop = True
    with pytest.raises(ExceptionGroup): await server.stop()
    assert 'stop:runtime' in log and 'close:pool' not in log
    with pytest.raises(HTTPException): await anext(server.admission())
    server.social.fail_stop = False
    await server.stop()
    assert server.state == 'closed'


async def test_health_fanout_and_borrowed_resources():
    server, log = assembly()
    server.owns_pool = server.owns_redis = False
    await server.start()
    server.observe_health(True)
    assert all(c.available for c in (server.polling, server.presence, server.gateway))
    await server.stop()
    assert not any(c.available for c in (server.polling, server.presence, server.gateway))
    assert not any(s.startswith('close:') for s in log)


async def test_real_assembly_boot_identity_redis_fallback_and_database_drain(database):
    pool = database[0]
    broker = Broker()
    broker.online = False
    server = build_server(pool, broker, internal_address='test-server', signal_secret=SECRET,
                          auth=None, allowed_origins=set())
    other = build_server(pool, broker, internal_address='test-server', signal_secret=SECRET,
                         auth=None, allowed_origins=set())
    assert server.runtime.leases.registration != other.runtime.leases.registration
    assert server.state == 'new' and server.runtime._maintenance is None
    try:
        await server.start()
        assert server.state == 'running' and not server.polling.available
        broker.online = True
        await eventually(lambda: server.signals.healthy)
        assert server.polling.available and server.presence.available and server.gateway.available
    finally:
        await server.stop()
    assert server.drain_report.routing_status == 'confirmed'
    assert not broker.closed and not broker.subscribers
    async with pool.connection() as connection:
        row = await (await connection.execute('SELECT draining FROM server_instances WHERE instance_id=%s',
            (server.runtime.leases.registration.instance_id,))).fetchone()
    assert row == (True,)


async def test_mounted_test_assembly_creates_and_executes_with_redis_offline(database):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from test_distributed_transport import Auth
    from test_room_runtime import until
    pool = database[0]
    broker = Broker()
    broker.online = False
    server = build_server(pool, broker, internal_address='offline-test', signal_secret=SECRET,
                          auth=Auth(), allowed_origins=set())
    app = FastAPI()
    app.include_router(server.router)  # Test application only.
    headers = {'Authorization': 'Bearer valid'}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test', headers=headers) as client:
        assert (await client.post('/distributed/rooms', json={})).status_code == 503
        await server.start()
        try:
            creation = {'command_id': 'create-once', 'name': 'New room', 'visibility': 'private', 'invitees': []}
            result = await client.post('/distributed/rooms', json=creation)
            assert result.status_code == 200, result.text
            room = result.json()['room_id']
            assert (await client.post('/distributed/rooms', json=creation)).json() == result.json()
            command = dict(target=dict(kind='room', room_id=room),
                body=dict(command_id='first-table', command='create-table', payload=dict(game_type='marriage', capacity=2)))
            submitted = await client.post('/distributed/commands', json=command)
            assert submitted.status_code == 200, submitted.text
            lane = submitted.json()['lane_id']
            async def accepted():
                reply = await client.get(f'/distributed/commands/{lane}/first-table')
                assert reply.status_code == 200, reply.text
                return reply.json() if reply.json()['status'] != 'pending' else None
            receipt = await until(accepted)
            assert receipt['status'] == 'accepted', receipt
            assert server.runtime.admitted_fence(room) is not None
            assert (await client.post('/distributed/commands', json=command)).json()['command_id'] == 'first-table'
        finally:
            await server.stop()
        assert (await client.post('/distributed/rooms', json=creation)).status_code == 503
        assert any(r.room_id == room and r.status == 'released' for r in server.drain_report.releases)


async def test_cancelled_start_drains_attempted_components():
    server, log = assembly()
    entered = asyncio.Event()
    async def blocked():
        entered.set()
        await asyncio.Event().wait()
    server.social.start = blocked
    task = asyncio.create_task(server.start())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert server.state == 'closed'
    assert 'stop:social' in log and 'stop:signals' not in log
    assert log[-1] == 'close:pool'


async def test_shutdown_closes_authenticated_socket_and_joins_presence_cleanup():
    import json
    from fastapi import FastAPI
    from app.durable_games.redis_presence import ConnectionPresenceRegistry
    from app.durable_games.transport import create_router
    from test_distributed_transport import Auth, Gateway, Ingress
    from test_redis_presence import Store
    server, log = assembly()
    presence = ConnectionPresenceRegistry(Store(), 'socket-boot')
    server.presence = presence
    gateway, ingress = Gateway(), Ingress()
    async def room(actor, lane): return None
    app = FastAPI()
    app.include_router(create_router(auth=Auth(), hosted=ingress, chat=ingress, social=ingress,
        gateway=gateway, allowed_origins=set(), presence=presence, presence_room=room,
        admission=server.admission))
    await server.start()
    incoming = asyncio.Queue()
    incoming.put_nowait({'type': 'websocket.connect'})
    incoming.put_nowait({'type': 'websocket.receive', 'text': json.dumps(
        dict(type='AUTH', token='valid', client_id='device'))})
    sent = []
    async def send(message): sent.append(message)
    scope = dict(type='websocket', asgi={'version': '3.0'}, scheme='ws', path='/distributed/delivery',
                 raw_path=b'/distributed/delivery', query_string=b'', headers=[], root_path='',
                 server=('test', 80), client=('client', 1234), subprotocols=[])
    task = asyncio.create_task(app(scope, incoming.get, send))
    try:
        await eventually(lambda: any('READY' in m.get('text', '') for m in sent))
        assert len(presence._entries) == 1 and task in server._requests
        await server.stop()
        assert task.cancelled() and not presence._entries
        assert {'type': 'websocket.close', 'code': 1012, 'reason': ''} in sent
        assert log[-1] == 'close:pool'
    finally:
        await server.stop()
        if not task.done(): task.cancel()
        await asyncio.gather(task, return_exceptions=True)
