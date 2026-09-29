"""Telemetry must preserve cancellation, privacy, and post-commit accounting."""
import asyncio
from contextlib import asynccontextmanager
from io import StringIO
import json
import logging
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from prometheus_client import generate_latest

from app.durable_games import telemetry as t
from app.durable_games.telemetry_runtime import RuntimeTelemetry
from test_checkpoint_store import database
from test_inbox_store import room_lane, body


def sample(name, **labels):
    return t.REGISTRY.get_sample_value(name, labels) or 0


async def test_decorator_preserves_return_exception_and_cancellation(monkeypatch):
    @t.observe('test.boundary')
    async def run(result):
        if isinstance(result, BaseException):
            raise result
        return result
    sentinel = object()
    assert await run(sentinel) is sentinel
    assert await run(False) is False
    error = RuntimeError('secret SQL parameter')
    with pytest.raises(RuntimeError) as caught:
        await run(error)
    assert caught.value is error
    with pytest.raises(asyncio.CancelledError):
        await run(asyncio.CancelledError())
    assert sample('bhidne_operations_total', operation='test.boundary', result='cancelled') == 1
    assert sample('bhidne_operations_total', operation='test.boundary', result='error') == 1
    monkeypatch.setattr(t.OPERATIONS, 'labels', lambda *a: (_ for _ in ()).throw(RuntimeError('exporter failed')))
    assert await run(sentinel) is sentinel
    with pytest.raises(RuntimeError) as caught:
        await run(error)
    assert caught.value is error


async def test_claim_counts_after_commit_only_and_not_retry(database):
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    await store.enqueue(lane, users[0], body())
    labels = dict(lane_kind='room_chat', result='accepted')
    before = sample('bhidne_command_outcomes_total', **labels)
    with pytest.raises(RuntimeError):
        async with store.claim(lane, fence=fence) as claim:
            await claim.complete(dict(command_id='one', status='accepted'))
            assert sample('bhidne_command_outcomes_total', **labels) == before
            raise RuntimeError('force rollback after completion')
    assert sample('bhidne_command_outcomes_total', **labels) == before
    assert (await store.lookup(lane, users[0], 'one')).status == 'pending'
    async with store.claim(lane, fence=fence) as claim:
        await claim.complete(dict(command_id='one', status='accepted'))
        assert sample('bhidne_command_outcomes_total', **labels) == before
    assert sample('bhidne_command_outcomes_total', **labels) == before + 1
    assert (await store.enqueue(lane, users[0], body())).duplicate
    async with store.claim(lane, fence=fence) as claim:
        assert claim is None
    assert sample('bhidne_command_outcomes_total', **labels) == before + 1


async def test_final_fence_failure_never_reports_accepted(database):
    from app.durable_games.store import StaleGameOwner
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    await store.enqueue(lane, users[0], body())
    labels = dict(lane_kind='room_chat', result='accepted')
    before = sample('bhidne_command_outcomes_total', **labels)
    with pytest.raises(StaleGameOwner):
        async with store.claim(lane, fence=fence) as claim:
            await claim.complete(dict(command_id='one', status='accepted'))
            await pool.execute("UPDATE room_ownership SET lease_expires_at=clock_timestamp()-interval '1 second'")
    assert sample('bhidne_command_outcomes_total', **labels) == before


async def test_database_sample_is_read_only_and_counts_durable_backlog(database):
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    await store.enqueue(lane, users[0], body())
    telemetry = RuntimeTelemetry(SimpleNamespace(pool=pool), port=0)
    await telemetry.sample_database()
    assert sample('bhidne_runtime_state', state='commands_pending') == 1
    assert sample('bhidne_runtime_state', state='database_sample_ok') == 1
    async with store.claim(lane, fence=fence) as claim:
        await claim.complete(dict(command_id='one', status='rejected'))
    await telemetry.sample_database()
    assert sample('bhidne_runtime_state', state='commands_pending') == 0
    assert sample('bhidne_runtime_state', state='commands_oldest_seconds') == 0


def test_structured_logs_allow_only_metadata_and_do_not_include_exception_text():
    old = t.logger.handlers[:], t.logger.level, t.logger.propagate, getattr(t.logger, '_bhidne_configured', False)
    try:
        t.logger._bhidne_configured = False
        t.configure_logging()
        stream = StringIO()
        t.logger.handlers[0].setStream(stream)
        t.safe_log('command_committed', command_id='opaque-command', result='accepted',
                   payload={'hand': 'PRIVATE'}, token='SECRET', chat='PRIVATE')
        t.operation_done('test.privacy', 'error', .1, RuntimeError('PASSWORD'))
        rows = [json.loads(line) for line in stream.getvalue().splitlines()]
        assert rows[0]['command_id'] == 'opaque-command'
        assert rows[0]['event'] == 'command_committed' and rows[0]['timestamp']
        assert rows[1]['error_type'] == 'RuntimeError'
        assert all(value not in stream.getvalue() for value in ('PRIVATE', 'SECRET', 'PASSWORD'))
    finally:
        t.logger.handlers, t.logger.level, t.logger.propagate, t.logger._bhidne_configured = old


async def test_http_labels_use_templates_never_paths_queries_or_tokens():
    app = FastAPI()
    app.add_middleware(t.TelemetryMiddleware)
    @app.get('/items/{item_id}')
    async def item(item_id: str):
        return {'ok': True}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        for i in range(20):
            await client.get(f'/items/secret-room-{i}?token=SECRET', headers={'Authorization': 'Bearer SECRET'})
            await client.get(f'/missing/secret-room-{i}')
    exposed = generate_latest(t.REGISTRY).decode()
    assert 'secret-room' not in exposed and 'SECRET' not in exposed
    assert 'route="/items/{item_id}"' in exposed
    assert 'route="unmatched"' in exposed


def test_websocket_gauge_balances_disconnect_and_denial():
    app = FastAPI()
    app.add_middleware(t.TelemetryMiddleware)
    @app.websocket('/ws')
    async def websocket(socket: WebSocket):
        await socket.accept()
        await socket.receive_text()
        await socket.close()
    before = sample('bhidne_websocket_connections')
    with TestClient(app) as client:
        with client.websocket_connect('/ws') as socket:
            assert sample('bhidne_websocket_connections') == before + 1
            socket.send_text('PRIVATE')
    assert sample('bhidne_websocket_connections') == before


async def test_sampling_failure_marks_unavailable_retains_last_success(monkeypatch):
    class Pool:
        @asynccontextmanager
        async def connection(self):
            raise RuntimeError('private database URL')
            yield
    service = RuntimeTelemetry(SimpleNamespace(pool=Pool()), port=0)
    monkeypatch.setattr(service, 'sample_local', lambda: None)
    t.STATE.labels('database_sample_timestamp_seconds').set(123)
    t.STATE.labels('database_sample_ok').set(1)
    task = asyncio.create_task(service._run())
    try:
        for _ in range(100):
            if sample('bhidne_runtime_state', state='database_sample_ok') == 0:
                break
            await asyncio.sleep(.001)
        assert sample('bhidne_runtime_state', state='database_sample_ok') == 0
        assert sample('bhidne_runtime_state', state='database_sample_timestamp_seconds') == 123
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_commit_observer_failure_cannot_turn_commit_into_retry(database, monkeypatch):
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    await store.enqueue(lane, users[0], body())
    def fail(*args, **kwargs):
        raise RuntimeError('metrics broken')
    monkeypatch.setattr(t.COMMANDS, 'labels', fail)
    async with store.claim(lane, fence=fence) as claim:
        await claim.complete(dict(command_id='one', status='accepted'))
    assert (await store.lookup(lane, users[0], 'one')).status == 'accepted'


async def test_listener_scrapes_and_closes_without_public_route(monkeypatch):
    import httpx
    service = RuntimeTelemetry(SimpleNamespace(), port=0)
    monkeypatch.setattr(service, 'sample_local', lambda: None)
    async def no_database():
        pass
    monkeypatch.setattr(service, 'sample_database', no_database)
    try:
        service.start()
        address, port = service.http.server_address[:2]
        assert address == '127.0.0.1'
        async with httpx.AsyncClient(trust_env=False) as client:
            response = await client.get(f'http://127.0.0.1:{port}/metrics')
        assert response.status_code == 200
        assert 'bhidne_websocket_connections' in response.text
        thread = service.thread
    finally:
        await service.stop()
    assert not thread.is_alive()
    assert service.task is None and service.http is None


async def test_unknown_commit_response_is_not_reported_as_confirmed(database, monkeypatch):
    pool, _, fence, users = database
    store, lane = await room_lane(pool)
    await store.enqueue(lane, users[0], body())
    original = pool.transaction
    @asynccontextmanager
    async def unknown_commit():
        async with original():
            yield
        raise RuntimeError('lost connection after commit')
    labels = dict(lane_kind='room_chat', result='accepted')
    before = sample('bhidne_command_outcomes_total', **labels)
    with monkeypatch.context() as patch:
        patch.setattr(pool, 'transaction', unknown_commit)
        with pytest.raises(RuntimeError):
            async with store.claim(lane, fence=fence) as claim:
                await claim.complete(dict(command_id='one', status='accepted'))
    assert sample('bhidne_command_outcomes_total', **labels) == before
    assert (await store.lookup(lane, users[0], 'one')).status == 'accepted'


async def test_result_metadata_cannot_change_business_return():
    class Result:
        @property
        def status(self):
            raise RuntimeError('metadata property failed')
    value = Result()
    @t.observe('test.result_metadata')
    async def run():
        return value
    assert await run() is value


async def test_transport_cancellation_is_not_an_http_server_error():
    async def cancelled(scope, receive, send):
        raise asyncio.CancelledError()
    labels = dict(route='unmatched', method='GET', status='cancelled')
    before = sample('bhidne_http_requests_total', **labels)
    with pytest.raises(asyncio.CancelledError):
        await t.TelemetryMiddleware(cancelled)({'type': 'http', 'method': 'GET'}, None, None)
    assert sample('bhidne_http_requests_total', **labels) == before + 1


@pytest.mark.parametrize('kind', ['callbreak', 'marriage', 'flush'])
async def test_cluster_activity_counts_games_and_distinct_players_and_clears(database, kind):
    from test_checkpoint_store import host_game
    from app.durable_games.checkpoints import capture_checkpoint
    pool, store, fence, users = database
    host, game = await host_game(users, kind)
    try:
        await store.save(capture_checkpoint(game, table_revision=0), expected_revision=None, fence=fence)
        collector = RuntimeTelemetry(SimpleNamespace(pool=pool), port=0)
        await collector.sample_database()
        assert sample('bhidne_active_games', game_type=kind) == 1
        assert sample('bhidne_active_games', game_type='all') == 1
        assert sample('bhidne_active_players', game_type=kind) == len(game.users)
        assert sample('bhidne_active_players', game_type='all') == len(game.users)
        # Another sampler observes the same global value, never increments it.
        await RuntimeTelemetry(SimpleNamespace(pool=pool), port=0).sample_database()
        assert sample('bhidne_active_games', game_type=kind) == 1
        await pool.execute("UPDATE games SET status='completed',completed_at=now()")
        await collector.sample_database()
        assert sample('bhidne_active_games', game_type=kind) == 0
        assert sample('bhidne_active_players', game_type='all') == 0
    finally:
        await host.close()


async def test_failed_presence_sample_is_unknown_not_zero():
    import math
    class Store:
        async def online_users(self):
            raise OSError('offline')
    collector = RuntimeTelemetry(SimpleNamespace(presence=SimpleNamespace(store=Store())), port=0)
    await collector.sample_presence()
    assert math.isnan(sample('bhidne_online_users'))
    assert sample('bhidne_runtime_state', state='presence_sample_ok') == 0
