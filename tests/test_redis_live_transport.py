"""Opt-in real Redis tests: REDIS_TEST_SERVER=/path/to/redis-server.

Starts only private, temporary Unix-socket servers with persistence disabled.
Never connects to a configured application Redis/database deployment.
"""
import asyncio
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.durable_games.redis_transport import RedisSignalTransport
from app.durable_games.routing import RoomWakeup, RoomWakeupReceiver, RoomCommandRouter
from app.durable_games.polling import RedisPollingPolicy
from app.durable_games.ingress import HostedCommandIngress
from app.durable_games.inbox import LaneTarget
from test_checkpoint_store import database
from test_redis_signals import Receiver, SECRET, eventually
from test_room_runtime import start, outcome


class LocalRedis:
    def __init__(self, directory, binary):
        self.directory, self.binary, self.process = Path(directory), binary, None
        self.url = 'unix://' + str(self.directory / 'redis.sock')

    async def start(self):
        from redis.asyncio import Redis
        self.process = await asyncio.create_subprocess_exec(self.binary, '--port', '0',
            '--unixsocket', str(self.directory / 'redis.sock'), '--save', '', '--appendonly', 'no',
            '--dir', str(self.directory), '--logfile', str(self.directory / 'server.log'),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        client = Redis.from_url(self.url, protocol=2, socket_connect_timeout=.2, socket_timeout=.2)
        try:
            async with asyncio.timeout(8):
                while True:
                    if self.process.returncode is not None:
                        raise RuntimeError((self.directory / 'server.log').read_text()[-2000:])
                    try:
                        if await client.ping():
                            return
                    except Exception:
                        pass
                    await asyncio.sleep(.02)
        finally:
            await client.aclose()

    async def stop(self):
        if self.process is not None and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=3)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()


@pytest.fixture
async def redis_server():
    binary = os.environ.get('REDIS_TEST_SERVER')
    if not binary:
        pytest.skip('Set REDIS_TEST_SERVER for isolated real Redis tests.')
    pytest.importorskip('redis.asyncio')
    with tempfile.TemporaryDirectory(prefix='bh-redis-', dir='/private/tmp') as directory:
        server = LocalRedis(directory, binary)
        try:
            await server.start()
            yield server
        finally:
            await server.stop()


def bus(server, instance, **options):
    return RedisSignalTransport.from_url(server.url, instance, SECRET,
        wakeup_receiver=options.pop('wakeup_receiver', Receiver()), placement_receiver=Receiver(),
        probe_interval=.05, probe_timeout=.5, retry_base=.02, retry_max=.1, **options)


async def test_real_client_targeted_pubsub_and_rejected_unsigned_message(redis_server):
    owner, gateway = bus(redis_server, 'owner'), bus(redis_server, 'gateway')
    try:
        await owner.start()
        await gateway.start()
        await eventually(lambda: owner.healthy and gateway.healthy)
        message = RoomWakeup('room', uuid4(), 'owner', 1)
        assert await gateway.send_wakeup(SimpleNamespace(instance_id='owner'), message)
        await eventually(lambda: owner.wakeup_receiver.messages == [message])
        assert gateway.wakeup_receiver.messages == []
        await gateway.client.publish(owner.channel('owner'), b'{"mac":"unsigned"}')
        await eventually(lambda: owner.invalid_messages == 1)
    finally:
        await gateway.stop()
        await owner.stop()


async def test_real_restart_reestablishes_subscription_before_healthy(redis_server):
    changes = []
    owner = bus(redis_server, 'owner', on_health=changes.append)
    try:
        await owner.start()
        await eventually(lambda: owner.healthy)
        await redis_server.stop()
        await eventually(lambda: not owner.healthy)
        assert changes[-1] is False
        await redis_server.start()
        await eventually(lambda: owner.healthy)
        assert changes.count(True) >= 2
        message = RoomWakeup('room', uuid4(), 'owner', 3)
        assert await owner.send_wakeup(SimpleNamespace(instance_id='owner'), message)
        await eventually(lambda: owner.wakeup_receiver.messages == [message])
    finally:
        await owner.stop()


async def test_real_redis_outage_preserves_postgres_progress_and_epoch(redis_server, database):
    _, _, _, users = database
    policy = RedisPollingPolicy(healthy_interval=60, failed_interval=.02, jitter=0)
    runtime, fence = await start(database, inbox_polling=policy)
    owner = bus(redis_server, fence.instance_id, wakeup_receiver=RoomWakeupReceiver(runtime), on_health=policy.observe)
    router = RoomCommandRouter(runtime.inbox, runtime.ownership, send_remote=owner.send_wakeup)
    async def wake(room, lane):
        await router.wake(lane)
    ingress = HostedCommandIngress(runtime.inbox, wakeup=wake)
    try:
        await owner.start()
        await eventually(lambda: owner.healthy)
        await redis_server.stop()
        await eventually(lambda: not policy.available)
        for n in range(2):
            body = dict(command_id=uuid4().hex,command='create-table',
                payload={'game_type':'marriage','capacity':2,'name':f'Table {n}'})
            pending = await ingress.submit(users[n], LaneTarget(kind='room',room_id='room'), body)
            assert (await outcome(runtime.inbox, pending['lane_id'], users[n], body))['status'] == 'accepted'
            assert runtime.admitted_fence('room') == fence
            if n == 0:
                await redis_server.start()
                await eventually(lambda: owner.healthy and policy.available)
    finally:
        await owner.stop()
        await runtime.stop()
