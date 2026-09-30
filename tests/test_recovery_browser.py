"""Opt-in browser acceptance against disposable PostgreSQL and a private fake mailbox."""
import asyncio
import json
import os
from pathlib import Path

import pytest
import uvicorn

from app.auth.recovery_delivery import RecoveryConfig
from test_account_recovery_concurrency import postgres_pool
from test_recovery_delivery import config


@pytest.mark.skipif(os.getenv('RECOVERY_BROWSER') != '1', reason='Set RECOVERY_BROWSER=1 after exporting client/dist for localhost:8197.')
async def test_recovery_browser(postgres_pool, monkeypatch, tmp_path):
    import app.main as main
    class TestDatabase:
        def __init__(self, url): self.pool = postgres_pool
        async def open(self): pass
        async def close(self): pass
    monkeypatch.setattr(main,'Database',TestDatabase)
    monkeypatch.setenv('BHIDNE_HO_DATABASE_URL','disposable-test-database')
    monkeypatch.setenv('BHIDNE_HO_GAME_RUNTIME_MODE','memory')
    monkeypatch.setenv('BHIDNE_WEB_DIR',str(Path(__file__).parents[1]/'client/dist'))
    monkeypatch.setattr(RecoveryConfig,'from_environment',classmethod(lambda cls:config()))
    mailbox = tmp_path/'mail.jsonl'
    mailbox.touch(mode=0o600)
    def capture(self,payload):
        with mailbox.open('a') as target: target.write(json.dumps(payload)+'\n')
    monkeypatch.setattr(RecoveryConfig,'send',capture)
    server=uvicorn.Server(uvicorn.Config(main.create_app(),host='127.0.0.1',port=8197,log_level='warning',access_log=False))
    task=asyncio.create_task(server.serve())
    try:
        async with asyncio.timeout(15):
            while not server.started:
                if task.done(): await task
                await asyncio.sleep(.05)
        process=await asyncio.create_subprocess_exec('node','client/tests/browser/account-recovery.cjs',
            env={**os.environ,'TEST_WEB_URL':'http://127.0.0.1:8197','RECOVERY_TEST_MAILBOX':str(mailbox)},
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        try:
            async with asyncio.timeout(100): output,_=await process.communicate()
        finally:
            if process.returncode is None:
                process.kill(); await process.wait()
        assert process.returncode==0,output.decode()
        print(output.decode())
    finally:
        server.should_exit=True
        await task
        mailbox.unlink(missing_ok=True)
