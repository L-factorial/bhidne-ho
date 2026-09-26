"""Optional integration harness; PGLITE_MODULE enables real SQL without a service."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import json
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

from psycopg import errors
from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb
import pytest


class Rows:
    def __init__(self, result):
        self.rows = []
        for row in result.get('rows', []):
            values = []
            for field in result['fields']:
                value = row[field['name']]
                oid = field['dataTypeID']
                if value is not None:
                    if oid == 2950: value = UUID(value)
                    elif oid == 1184: value = datetime.fromisoformat(value.replace('Z', '+00:00'))
                    elif oid == 17: value = bytes.fromhex(value[2:]) if isinstance(value, str) else bytes(value.values())
                    elif oid == 20: value = int(value)
                values.append(value)
            self.rows.append(tuple(values))

    async def fetchone(self): return self.rows[0] if self.rows else None
    async def fetchall(self): return self.rows


class PGlitePool:
    @property
    def info(self):
        return SimpleNamespace(transaction_status=TransactionStatus.INTRANS if self.depth else TransactionStatus.IDLE)

    @classmethod
    async def open(cls):
        if not os.environ.get('PGLITE_MODULE'):
            pytest.skip('Set PGLITE_MODULE to run PostgreSQL/WASM store integration tests.')
        self = cls()
        self.process = await asyncio.create_subprocess_exec('node', str(Path(__file__).with_name('pglite_bridge.cjs')),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        self.lock = asyncio.Lock()
        self.depth = 0
        return self

    async def close(self):
        self.process.stdin.close()
        await self.process.wait()
        assert self.process.returncode == 0, (await self.process.stderr.read()).decode()

    @asynccontextmanager
    async def connection(self):
        async with self.lock:
            yield self

    @asynccontextmanager
    async def transaction(self):
        assert self.depth == 0
        self.depth = 1
        try:
            await self.execute('BEGIN')
            yield self
            await self.execute('COMMIT')
        except BaseException:
            await self.execute('ROLLBACK')
            raise
        finally:
            self.depth = 0

    async def execute(self, sql, params=(), *, script=False):
        values = []
        for value in params:
            if isinstance(value, UUID): value = str(value)
            elif isinstance(value, datetime): value = value.isoformat()
            elif isinstance(value, Jsonb): value = value.obj
            elif isinstance(value, bytes): value = {'__bytes': list(value)}
            values.append(value)
        for index in range(len(values)):
            sql = sql.replace('%s', f'${index + 1}', 1)
        request = json.dumps({'sql': sql, 'params': values, 'script': script})
        self.process.stdin.write((request + '\n').encode())
        async def response_line():
            await self.process.stdin.drain()
            return await self.process.stdout.readline()
        # A cancelled caller must consume its response before releasing the
        # single connection; otherwise the next query reads the wrong result.
        response_task = asyncio.create_task(response_line())
        try:
            line = await asyncio.shield(response_task)
        except asyncio.CancelledError:
            await response_task
            raise
        if not line:
            raise RuntimeError((await self.process.stderr.read()).decode())
        response = json.loads(line)
        if 'error' in response:
            raise errors.lookup(response['code'])(response['error']) if response.get('code') else RuntimeError(response['error'])
        return Rows({} if script else response['result'])
