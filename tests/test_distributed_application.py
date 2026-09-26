import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.durable_games.server import build_server
from test_checkpoint_store import database
from test_distributed_transport import Auth
from test_distributed_server import assembly
from test_redis_signals import Broker, SECRET


def configured():
    server, log = assembly()
    server.allowed_origins = {'https://game.test'}
    server.router = APIRouter(prefix='/distributed')
    @server.router.get('/probe')
    async def probe(): return {'native': True}
    return server, log


def test_explicit_selection_excludes_legacy_services_routes_and_static(monkeypatch):
    server, log = configured()
    monkeypatch.setattr('app.main.RoomService', lambda *a, **kw: pytest.fail('Legacy room service constructed'))
    app = create_app(runtime_mode='distributed-integration', distributed_server=server)
    # Even accidentally mounting a legacy writer cannot bypass the protocol boundary.
    called = []
    @app.post('/rooms')
    async def legacy_writer(): called.append(True)
    with TestClient(app) as client:
        assert client.get('/health').json()['runtime'] == 'distributed-integration'
        assert client.get('/distributed/probe').json() == {'native': True}
        for method, path in [('POST', '/rooms'), ('POST', '/games/one/actions'),
                             ('POST', '/test-games/marriage/rooms/one/start'),
                             ('GET', '/rooms/one'), ('GET', '/active-tables'),
                             ('POST', '/auth/signin'), ('GET', '/test-ui/'), ('GET', '/')]:
            reply = client.request(method, path)
            assert reply.status_code == 409
            assert reply.json()['code'] == 'unsupported_runtime_route'
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/ws/rooms/one'): pass
        assert not called and not hasattr(app.state, 'test_games')
    assert server.state == 'closed' and log[-1] == 'close:pool'


def test_production_selection_and_mixed_arguments_fail_before_startup():
    server, log = configured()
    for options in [dict(runtime_mode='distributed'), dict(runtime_mode='unexpected'),
                    dict(distributed_server=server), dict(runtime_mode='distributed-integration')]:
        with pytest.raises(ValueError): create_app(**options)
    assert not log
    server.state = 'running'
    with pytest.raises(ValueError):
        create_app(runtime_mode='distributed-integration', distributed_server=server)


def test_lifespan_failure_cleans_resources_without_serving():
    server, log = configured()
    server.publisher.fail_start = True
    app = create_app(runtime_mode='distributed-integration', distributed_server=server)
    with pytest.raises(RuntimeError, match='startup failure'):
        with TestClient(app): pytest.fail('Failed application served requests')
    assert server.state == 'closed' and log[-1] == 'close:pool'


def test_cors_uses_same_explicit_origin_allowlist():
    server, _ = configured()
    app = create_app(runtime_mode='distributed-integration', distributed_server=server)
    with TestClient(app) as client:
        response = client.options('/distributed/probe', headers={
            'Origin': 'https://game.test', 'Access-Control-Request-Method': 'GET'})
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == 'https://game.test'
        assert client.options('/distributed/probe', headers={
            'Origin': 'https://evil.test', 'Access-Control-Request-Method': 'GET'}).status_code == 400


async def test_real_application_lifespan_native_auth_and_room_creation(database):
    broker = Broker()
    broker.online = False
    server = build_server(database[0], broker, internal_address='integration-app', signal_secret=SECRET,
                          auth=Auth(), allowed_origins=iter(['https://game.test']))
    app = create_app(runtime_mode='distributed-integration', distributed_server=server)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        assert (await client.get('/health')).status_code == 503
        async with app.router.lifespan_context(app):
            assert server.state == 'running'
            assert (await client.post('/distributed/rooms', json={})).status_code == 401
            request = dict(command_id='application-create', name='Native room', visibility='private', invitees=[])
            headers = {'Authorization': 'Bearer valid'}
            first = await client.post('/distributed/rooms', json=request, headers=headers)
            assert first.status_code == 200, first.text
            second = await client.post('/distributed/rooms', json=request, headers=headers)
            assert second.json() == first.json()
            room = await client.get('/distributed/rooms/' + first.json()['room_id'], headers=headers)
            assert room.status_code == 200, room.text
        assert server.state == 'closed'
        assert (await client.get('/health')).status_code == 503
        assert (await client.post('/distributed/rooms', json=request, headers=headers)).status_code == 503
    assert not broker.closed  # Borrowed resources remain with their caller.


def test_default_application_remains_legacy():
    app = create_app()
    with TestClient(app) as client:
        assert client.get('/health').json() == {'status': 'ok'}
        assert hasattr(app.state, 'test_games')
        assert not hasattr(app.state, 'distributed_server')
        assert client.get('/distributed/rooms/example').status_code == 404
