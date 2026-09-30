"""Opt-in UI acceptance against the distributed API and disposable PostgreSQL."""
import asyncio
import os
from pathlib import Path

import pytest
import uvicorn
from starlette.staticfiles import StaticFiles

from app.auth.postgres import PostgresAuthService
from app.durable_games.server import build_server
from app.main import create_app
from test_account_recovery_concurrency import postgres_pool
from test_redis_signals import Broker, SECRET


@pytest.mark.skipif(not os.getenv('BLOCK_BROWSER_WEB'), reason='Export distributed-original web to BLOCK_BROWSER_WEB for localhost:8197.')
async def test_block_browser(postgres_pool, monkeypatch):
    monkeypatch.setenv('BHIDNE_WEB_DIR', str(Path(os.environ['BLOCK_BROWSER_WEB']).resolve()))
    broker = Broker(); broker.online = False
    distributed = build_server(postgres_pool, broker, internal_address='block-browser-test', signal_secret=SECRET,
        auth=PostgresAuthService(postgres_pool), allowed_origins={'http://127.0.0.1:8197'})
    app = create_app(runtime_mode='distributed-integration', distributed_server=distributed)
    static = StaticFiles(directory=os.environ['BLOCK_BROWSER_WEB'], html=True)
    async def site(scope, receive, send):
        # Match the production web/API split without weakening the API allowlist.
        path = scope.get('path', '')
        if scope['type'] == 'http' and (path == '/' or path == '/favicon.ico' or path.startswith(('/_expo/', '/assets/'))):
            await static(scope, receive, send)
        else:
            await app(scope, receive, send)
    server = uvicorn.Server(uvicorn.Config(site,host='127.0.0.1',port=8197,log_level='warning',access_log=False))
    task = asyncio.create_task(server.serve())
    try:
        async with asyncio.timeout(15):
            while not server.started:
                if task.done(): await task
                await asyncio.sleep(.05)
        process = await asyncio.create_subprocess_exec('node','client/tests/browser/player-blocking.cjs',
            env={**os.environ,'TEST_WEB_URL':'http://127.0.0.1:8197'},stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        try:
            async with asyncio.timeout(100): output,_ = await process.communicate()
        finally:
            if process.returncode is None: process.kill(); await process.wait()
        assert process.returncode == 0, output.decode()
        print(output.decode())
    finally:
        server.should_exit = True
        await task
