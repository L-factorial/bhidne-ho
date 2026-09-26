"""Opt-in, disposable real PostgreSQL/Redis and independent ASGI processes."""
import asyncio
import os
from pathlib import Path
import signal
import socket
import sys
import subprocess
import tempfile

import httpx
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool
import pytest

from app.durable_games.bootstrap import Settings, initialize
from test_redis_live_transport import LocalRedis


async def until(check, timeout=60):
    async with asyncio.timeout(timeout):
        while True:
            value = await check()
            if value:
                return value
            await asyncio.sleep(.1)


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class GatewayProcess:
    # Use Popen for deliberately stopped/resumed children. On this macOS/Python
    # build asyncio's waitid watcher notified STOP as exit and blocked its event
    # loop in waitpid; a dedicated wait thread keeps test timeouts responsive.
    def __init__(self, *args, **kwargs): self.process=subprocess.Popen(*args, **kwargs)
    @property
    def returncode(self): return self.process.poll()
    def send_signal(self, value): self.process.send_signal(value)
    def terminate(self): self.process.terminate()
    def kill(self): self.process.kill()
    async def wait(self): return await asyncio.to_thread(self.process.wait)


class Cluster:
    def __init__(self, directory, pg, redis):
        self.directory, self.pg = Path(directory), Path(pg)
        self.redis = LocalRedis(directory, redis)
        self.processes, self.logs, self.urls = [], [], []
        self.db_process = None
        self.pool = None
        self.dburl = f'host={directory} port=5432 dbname=bhidne_distributed_test'

    async def rows(self, sql, args=()):
        async with self.pool.connection() as c:
            return await (await c.execute(sql, args)).fetchall()

    async def start(self):
        initialized = await asyncio.create_subprocess_exec(str(self.pg/'initdb'), '-D', str(self.directory/'data'),
            '--no-locale', '--encoding=UTF8', '--auth=trust', stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        output,_ = await initialized.communicate()
        if initialized.returncode:
            raise RuntimeError(output.decode()[-3000:])
        logfile = open(self.directory/'postgres.log','wb');self.logs.append(logfile)
        self.db_process = await asyncio.create_subprocess_exec(str(self.pg/'postgres'), '-D', str(self.directory/'data'),
            '-k', str(self.directory), '-h', '', '-c', 'fsync=on', stdout=logfile, stderr=logfile)
        async def ready():
            try:
                async with await AsyncConnection.connect(f'host={self.directory} dbname=postgres connect_timeout=1',autocommit=True) as c:
                    await c.execute('CREATE DATABASE bhidne_distributed_test')
                return True
            except Exception:
                if self.db_process.returncode is not None:
                    raise RuntimeError((self.directory/'postgres.log').read_text()[-3000:])
                return False
        await until(ready,15)
        await self.redis.start()
        await initialize(Settings(self.dburl,self.redis.url,b'x'*32,'test',('http://localhost',)))
        self.pool=AsyncConnectionPool(self.dburl,min_size=1,max_size=4,open=False)
        await self.pool.open(wait=True)
        await self.gateway()
        await self.gateway()

    async def restart_database(self):
        logfile=open(self.directory/'postgres-restart.log','wb');self.logs.append(logfile)
        self.db_process=await asyncio.create_subprocess_exec(str(self.pg/'postgres'),'-D',str(self.directory/'data'),
            '-k',str(self.directory),'-h','',stdout=logfile,stderr=logfile)
        async def ready():
            try:
                async with await AsyncConnection.connect(self.dburl+' connect_timeout=1') as connection:
                    await connection.execute('SELECT 1')
                return True
            except Exception:return False
        await until(ready,15)

        # Only the test's inspection pool is refreshed here. Gateway pools must
        # recover on their own through the production runtime and client retries.
        await self.pool.check()

    async def gateway(self):
        index=len(self.processes); number=port();url=f'http://127.0.0.1:{number}'
        env=os.environ.copy()
        env.update(BHIDNE_DISTRIBUTED_ISOLATED='1',BHIDNE_DISTRIBUTED_DATABASE_URL=self.dburl,
            BHIDNE_DISTRIBUTED_REDIS_URL=self.redis.url,BHIDNE_DISTRIBUTED_SIGNAL_SECRET=(b'x'*32).hex(),
            BHIDNE_DISTRIBUTED_ADDRESS=url,BHIDNE_DISTRIBUTED_ORIGINS='http://localhost')
        logfile=open(self.directory/f'gateway-{index}.log','wb');self.logs.append(logfile)
        process=GatewayProcess([sys.executable,'-m','uvicorn','app.durable_games.bootstrap:create_app',
            '--factory','--host','127.0.0.1','--port',str(number),'--log-level','warning'],env=env,stdout=logfile,stderr=logfile)
        self.processes.append(process);self.urls.append(url)
        async with httpx.AsyncClient(timeout=1) as client:
            async def ready():
                if process.returncode is not None:
                    raise RuntimeError((self.directory/f'gateway-{index}.log').read_text()[-4000:])
                try:return (await client.get(url+'/health')).status_code==200
                except httpx.HTTPError:return False
            await until(ready,20)
        return index

    async def owner(self, room):
        rows=await self.rows('''SELECT s.internal_address,o.ownership_epoch,o.runtime_status
            FROM room_ownership o JOIN server_instances s ON s.instance_id=o.owner_instance_id WHERE o.room_id=%s''',(room,))
        return (self.urls.index(rows[0][0]),rows[0][1],rows[0][2]) if rows else None

    async def close(self):
        for process in self.processes:
            if process.returncode is None:
                process.send_signal(signal.SIGCONT)
                process.terminate()
        for process in self.processes:
            if process.returncode is None:
                try:await asyncio.wait_for(process.wait(),10)
                except TimeoutError:process.kill();await process.wait()
        if self.pool:await self.pool.close()
        await self.redis.stop()
        if self.db_process and self.db_process.returncode is None:
            self.db_process.send_signal(signal.SIGINT)
            try:await asyncio.wait_for(self.db_process.wait(),10)
            except TimeoutError:self.db_process.kill();await self.db_process.wait()
        for log in self.logs:log.close()


@pytest.fixture
async def cluster():
    pg,redis=os.environ.get('POSTGRES_TEST_BIN'),os.environ.get('REDIS_TEST_SERVER')
    if not pg or not redis:pytest.skip('Set POSTGRES_TEST_BIN and REDIS_TEST_SERVER for real independent-process tests.')
    with tempfile.TemporaryDirectory(prefix='bh-process-',dir='/private/tmp') as directory:
        cluster=Cluster(directory,pg,redis)
        try:
            await cluster.start()
            yield cluster
        except BaseException:
            for path in Path(directory).glob('gateway-*.log'):
                print(path.name,path.read_text()[-5000:])
            raise
        finally:await cluster.close()
