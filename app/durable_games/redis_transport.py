"""Authenticated advisory Redis Pub/Sub signals; never a command/state store.

Explicit lifecycle only. PostgreSQL receivers recheck lanes, epochs and admission.
One channel per process incarnation, bounded dispatch, and subscription round-trip
probes keep notification failure independent of durable execution correctness.
"""
import asyncio
import hashlib
import hmac
import json
import math
import random
import re
import time
from uuid import UUID, uuid4

from .discovery import PlacementDemand
from .routing import RoomWakeup
from .delivery import DeliveryWakeup


class SignalCodec:
    def __init__(self, secret, *, max_age=30.0, max_bytes=4096):
        if not isinstance(secret, bytes) or len(secret) < 32:
            raise ValueError('Internal signalling requires at least 32 secret bytes.')
        if not math.isfinite(max_age) or max_age <= 0 or type(max_bytes) is not int or max_bytes < 512:
            raise ValueError('Invalid signal bounds.')
        self._secret, self.max_age, self.max_bytes = secret, max_age, max_bytes

    @staticmethod
    def _json(value):
        return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

    def encode(self, kind, destination, *, room_id=None, lane_id=None, epoch=None, nonce=None,
               event_id=None, sequence=None):
        body = dict(v=1, kind=kind, destination=destination, at=time.time(), nonce=nonce or uuid4().hex)
        if kind in ('wakeup', 'placement'):
            body['room_id'] = room_id
        if kind == 'wakeup':
            body.update(lane_id=str(lane_id), epoch=epoch)
        if kind == 'delivery':
            body.update(lane_id=str(lane_id), event_id=str(event_id), sequence=sequence)
        self._validate(body)
        body['mac'] = hmac.new(self._secret, self._json(body), hashlib.sha256).hexdigest()
        result = self._json(body)
        if len(result) > self.max_bytes:
            raise ValueError('Signal exceeds byte limit.')
        return result

    @staticmethod
    def _pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate signal field.')
            result[key] = value
        return result

    def _validate(self, body):
        if not isinstance(body, dict):
            raise ValueError('Invalid signal.')
        fields = {'v', 'kind', 'destination', 'at', 'nonce'}
        kind = body.get('kind')
        if kind in ('wakeup', 'placement'):
            fields.add('room_id')
        if kind == 'wakeup':
            fields.update(('lane_id', 'epoch'))
        if kind == 'delivery':
            fields.update(('lane_id', 'event_id', 'sequence'))
        if kind not in ('wakeup', 'placement', 'probe', 'delivery') or set(body) != fields or type(body['v']) is not int or body['v'] != 1:
            raise ValueError('Unsupported signal envelope.')
        for key in ('destination', 'nonce', 'room_id'):
            if key in body and (not isinstance(body[key], str) or not body[key].strip() or len(body[key]) > 128):
                raise ValueError('Invalid signal identity.')
        if type(body['at']) not in (int, float) or not math.isfinite(body['at']):
            raise ValueError('Invalid signal timestamp.')
        if kind == 'wakeup':
            RoomWakeup(body['room_id'], UUID(body['lane_id']), body['destination'], body['epoch'])
        if kind == 'delivery':
            DeliveryWakeup(body['destination'], UUID(body['lane_id']), UUID(body['event_id']), body['sequence'])

    def decode(self, value, destination):
        if isinstance(value, str):
            value = value.encode()
        if not isinstance(value, bytes) or len(value) > self.max_bytes:
            raise ValueError('Invalid signal size.')
        body = json.loads(value, object_pairs_hook=self._pairs)
        if not isinstance(body, dict):
            raise ValueError('Invalid signal.')
        mac = body.pop('mac', None)
        if not isinstance(mac, str) or len(mac) != 64:
            raise ValueError('Missing signal authentication.')
        expected = hmac.new(self._secret, self._json(body), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mac, expected):
            raise ValueError('Invalid signal authentication.')
        self._validate(body)
        if body['destination'] != destination or abs(time.time() - body['at']) > self.max_age:
            raise ValueError('Wrong destination or expired signal.')
        return body


class RedisSignalTransport:
    def __init__(self, client, instance_id, secret, *, wakeup_receiver, placement_receiver,
                 delivery_receiver=None, on_health=None, namespace='bhidne-ho:runtime:v1', workers=4, max_pending=256,
                 operation_timeout=2.0, probe_interval=1.0, probe_timeout=2.0,
                 retry_base=.2, retry_max=5.0, owns_client=False):
        if (not isinstance(instance_id, str) or not instance_id.strip() or len(instance_id) > 128
                or re.fullmatch(r'[A-Za-z0-9:_-]{1,80}', namespace) is None
                or type(workers) is not int or workers < 1 or type(max_pending) is not int or max_pending < workers
                or any(not math.isfinite(v) or v <= 0 for v in
                       (operation_timeout, probe_interval, probe_timeout, retry_base, retry_max))
                or retry_max < retry_base or on_health is not None and not callable(on_health)):
            raise ValueError('Invalid Redis transport configuration.')
        self.client, self.instance_id, self.namespace = client, instance_id, namespace
        self.codec = SignalCodec(secret)
        self.wakeup_receiver, self.placement_receiver, self.on_health = wakeup_receiver, placement_receiver, on_health
        self.delivery_receiver = delivery_receiver
        self.workers, self.queue = workers, asyncio.Queue(maxsize=max_pending)
        self.operation_timeout, self.probe_interval, self.probe_timeout = operation_timeout, probe_interval, probe_timeout
        self.retry_base, self.retry_max, self.owns_client = retry_base, retry_max, owns_client
        self._task, self._workers = None, []
        self._closed, self._healthy = False, False
        self._restart = asyncio.Event()
        self._lifecycle = asyncio.Lock()
        self.invalid_messages = self.dropped_messages = self.dispatch_failures = self.connection_failures = 0

    @classmethod
    def from_url(cls, url, instance_id, secret, **options):
        """Use a private Redis ACL identity/TLS URL; never log URL or HMAC secret.

        Import is lazy so legacy installations do not require the optional extra.
        Explicit protocol 2 and disabled client retries leave retry bounds here.
        """
        from redis.asyncio import Redis
        from redis.backoff import NoBackoff
        from redis.asyncio.retry import Retry
        client = Redis.from_url(url, protocol=2, decode_responses=False, max_connections=16,
            socket_connect_timeout=2, socket_timeout=2, retry=Retry(NoBackoff(), 0))
        return cls(client, instance_id, secret, owns_client=True, **options)

    def channel(self, instance_id):
        return f'{self.namespace}:{hashlib.sha256(instance_id.encode()).hexdigest()}'

    @property
    def healthy(self):
        return self._healthy and not self._closed and self._task is not None and not self._task.done()

    def _health(self, value, *, force=False):
        changed = value != self._healthy
        self._healthy = value
        if self.on_health is not None and (changed or force):
            self.on_health(value)

    async def start(self):
        async with self._lifecycle:
            if self._task is not None or self._closed:
                raise RuntimeError('Transport requires a fresh lifecycle.')
            self._health(False, force=True)
            self._workers = [asyncio.create_task(self._dispatch(), name='redis-signal-dispatch') for _ in range(self.workers)]
            self._task = asyncio.create_task(self._listen(), name='redis-signal-listener')
            self._task.add_done_callback(lambda task: self._health(False))

    async def _publish(self, instance_id, message):
        if not self.healthy:
            return False
        try:
            async with asyncio.timeout(self.operation_timeout):
                subscribers = await self.client.publish(self.channel(instance_id), message)
            # Subscriber count is only advisory receipt by Redis, not execution
            # or receiver acknowledgement. Zero leaves durable polling to recover.
            return subscribers > 0
        except Exception:
            self.connection_failures += 1
            self._health(False)
            self._restart.set()
            return False

    async def send_wakeup(self, destination, wakeup):
        if not isinstance(wakeup, RoomWakeup) or destination.instance_id != wakeup.instance_id:
            raise ValueError('Wakeup destination mismatch.')
        return await self._publish(wakeup.instance_id, self.codec.encode('wakeup', wakeup.instance_id,
            room_id=wakeup.room_id, lane_id=wakeup.lane_id, epoch=wakeup.epoch))

    async def send_placement(self, destination, demand):
        if not isinstance(demand, PlacementDemand) or destination.instance_id != demand.instance_id:
            raise ValueError('Placement destination mismatch.')
        return await self._publish(demand.instance_id, self.codec.encode('placement', demand.instance_id, room_id=demand.room_id))

    async def send_delivery(self, destination, notice):
        if not isinstance(notice, DeliveryWakeup) or destination != notice.instance_id:
            raise ValueError('Delivery destination mismatch.')
        return await self._publish(destination, self.codec.encode('delivery', destination,
            lane_id=notice.lane_id, event_id=notice.event_id, sequence=notice.sequence))

    async def _dispatch(self):
        while True:
            body = await self.queue.get()
            try:
                async with asyncio.timeout(self.operation_timeout):
                    if body['kind'] == 'wakeup':
                        await self.wakeup_receiver.receive(RoomWakeup(body['room_id'], UUID(body['lane_id']),
                            self.instance_id, body['epoch']))
                    elif body['kind'] == 'placement':
                        await self.placement_receiver.receive(PlacementDemand(body['room_id'], self.instance_id))
                    elif self.delivery_receiver is not None:
                        await self.delivery_receiver.receive(DeliveryWakeup(self.instance_id, UUID(body['lane_id']),
                            UUID(body['event_id']), body['sequence']))
            except Exception:
                self.dispatch_failures += 1
            finally:
                self.queue.task_done()

    async def _session(self, pubsub):
        channel = self.channel(self.instance_id)
        async with asyncio.timeout(self.operation_timeout):
            await pubsub.subscribe(channel)
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=False, timeout=.1)
                if (message and message.get('type') == 'subscribe'
                        and message.get('channel') in (channel, channel.encode())):
                    break
                await asyncio.sleep(0)
        pending, next_probe, deadline = None, 0, 0
        while not self._closed:
            if self._restart.is_set():
                raise ConnectionError('Redis signal connection requires a new probe.')
            now = time.monotonic()
            if pending is not None and now >= deadline:
                raise TimeoutError('Redis subscription probe expired.')
            if pending is None and now >= next_probe:
                pending = uuid4().hex
                deadline = now + self.probe_timeout
                async with asyncio.timeout(self.operation_timeout):
                    await self.client.publish(channel, self.codec.encode('probe', self.instance_id, nonce=pending))
            async with asyncio.timeout(self.operation_timeout):
                message = await pubsub.get_message(ignore_subscribe_messages=False, timeout=.1)
            if self._restart.is_set():
                raise ConnectionError('Redis publisher failed.')
            if not message:
                await asyncio.sleep(0)
                continue
            if message.get('type') == 'subscribe':
                # redis-py may reconnect/resubscribe internally. A new round trip
                # must establish health again and cause a PostgreSQL rescan.
                self._health(False)
                pending, next_probe = None, 0
                continue
            if message.get('type') != 'message' or message.get('channel') not in (channel, channel.encode()):
                continue
            try:
                body = self.codec.decode(message.get('data'), self.instance_id)
            except (ValueError, TypeError, UnicodeError, AttributeError, OverflowError, RecursionError):
                self.invalid_messages += 1
                continue
            if body['kind'] == 'probe':
                if pending == body['nonce']:
                    pending, next_probe = None, time.monotonic() + self.probe_interval
                    self._health(True)
            else:
                try:
                    self.queue.put_nowait(body)
                except asyncio.QueueFull:
                    self.dropped_messages += 1

    async def _listen(self):
        attempt = 0
        try:
            while not self._closed:
                pubsub = None
                self._restart.clear()
                try:
                    pubsub = self.client.pubsub()
                    await self._session(pubsub)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self.connection_failures += 1
                finally:
                    was_healthy = self._healthy
                    self._health(False)
                    if pubsub is not None:
                        try:
                            async with asyncio.timeout(self.operation_timeout):
                                await pubsub.aclose()
                        except Exception:
                            pass
                attempt = 0 if was_healthy else min(attempt + 1, 20)
                delay = min(self.retry_max, self.retry_base * 2 ** max(0, attempt - 1))
                await asyncio.sleep(delay * random.uniform(.9, 1.1))
        finally:
            self._health(False)

    async def stop(self):
        async with self._lifecycle:
            self._closed = True
            self._health(False)
            cleanup = asyncio.create_task(self._join(), name='redis-signal-stop')
            cancelled = False
            while not cleanup.done():
                try:
                    await asyncio.shield(cleanup)
                except asyncio.CancelledError:
                    cancelled = True
            cleanup.result()
            if cancelled:
                raise asyncio.CancelledError

    async def _join(self):
        tasks = [task for task in [self._task, *self._workers] if task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        while not self.queue.empty():
            self.queue.get_nowait()
            self.queue.task_done()
        if self.owns_client:
            async with asyncio.timeout(self.operation_timeout):
                await self.client.aclose()
