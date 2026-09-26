"""Explicit distributed server assembly. The legacy application never mounts it.

The supplied pool/Redis client must already be configured; construction does no I/O.
Resources are borrowed unless ownership is explicitly transferred. One assembly is
one process boot and cannot be restarted after shutdown or uncertain startup.
"""
import asyncio

from fastapi import HTTPException

from .delivery import _join_cleanup


class DistributedServer:
    def __init__(self, *, runtime, discovery, signals, presence, gateway, publisher,
                 social, polling, pool, redis, owns_pool=False, owns_redis=False,
                 max_requests=4096):
        if type(max_requests) is not int or max_requests < 1:
            raise ValueError('Invalid request capacity.')
        self.runtime, self.discovery, self.signals = runtime, discovery, signals
        self.presence, self.gateway, self.publisher = presence, gateway, publisher
        self.social, self.polling = social, polling
        self.pool, self.redis = pool, redis
        self.owns_pool, self.owns_redis = owns_pool, owns_redis
        self.max_requests = max_requests
        self.state = 'new'
        self.drain_report = None
        self._attempted = set()
        self._requests = set()
        self._lock = asyncio.Lock()

    def observe_health(self, available):
        self.polling.observe(available)
        self.presence.observe_health(available)
        self.gateway.observe_health(available)

    async def admission(self):
        """Router dependency tracks HTTP and socket lifetimes before pool shutdown."""
        if self.state != 'running' or len(self._requests) >= self.max_requests:
            raise HTTPException(503, 'Distributed server is unavailable; retain command IDs.')
        task = asyncio.current_task()
        self._requests.add(task)
        try:
            yield
        finally:
            self._requests.discard(task)

    async def start(self):
        async with self._lock:
            if self.state != 'new':
                raise RuntimeError('Server requires a fresh lifecycle.')
            self.state = 'starting'
            try:
                # Registration and fenced execution precede placement dispatch.
                for name in ('runtime', 'presence', 'gateway', 'social', 'signals', 'publisher', 'discovery'):
                    self._attempted.add(name)  # Include partially completed starts.
                    await getattr(self, name).start()
                self.state = 'running'
            except BaseException:
                self.state = 'stopping'
                await _join_cleanup(asyncio.create_task(self._cleanup(), name='server-start-cleanup'))
                raise

    async def stop(self):
        async with self._lock:
            if self.state == 'closed':
                return
            self.state = 'stopping'
            await _join_cleanup(asyncio.create_task(self._cleanup(), name='distributed-server-stop'))

    async def _cleanup(self):
        # Synchronously fence local admission before any await or remote withdrawal.
        self.runtime.leases.begin_drain()
        self.observe_health(False)
        errors = []
        async def stop(name):
            if name not in self._attempted:
                return
            try:
                if name == 'runtime':
                    self.drain_report = await self.runtime.drain_and_stop()
                else:
                    await getattr(self, name).stop()
            except Exception as error:
                errors.append(error)
        await stop('discovery')
        await stop('signals')
        requests = tuple(self._requests)
        for task in requests:
            task.cancel()
        await asyncio.gather(*requests, return_exceptions=True)
        for name in ('social', 'publisher', 'gateway', 'presence', 'runtime'):
            await stop(name)
        if errors:
            # A failed stop is not proof that its tasks no longer use the pool.
            # Keep resources open and permit a later stop attempt.
            raise ExceptionGroup('Distributed shutdown incomplete; resources retained', errors)
        if self.owns_redis:
            await self.redis.aclose()
            self.owns_redis = False
        if self.owns_pool:
            await self.pool.close()
            self.owns_pool = False
        self.state = 'closed'


def build_server(pool, redis, *, internal_address, signal_secret, auth, allowed_origins,
                 namespace='bhidne-ho:runtime:v1', max_rooms=128, max_connections=2048,
                 owns_pool=False, owns_redis=False, guest_login_enabled=False):
    """Build real components without starting tasks, migrating DBs or mounting routes."""
    from .catalog import PostgresRoomCreation
    from .chat import ChatIngress
    from .delivery import GatewayDelivery, OutboxPublisher
    from .delivery_store import PostgresDeliveryStore
    from .discovery import PlacementDemandReceiver, RoomPlacementDiscovery
    from .ingress import HostedCommandIngress
    from .placement import RoomOwnerCoordinator
    from .polling import RedisPollingPolicy
    from .read_transport import DistributedReads
    from .redis_presence import ConnectionPresenceRegistry, RedisPresenceStore
    from .redis_transport import RedisSignalTransport
    from .room_runtime import RoomExecutionRuntime
    from .routing import RoomCommandRouter, RoomWakeupReceiver
    from .social import SocialIngress
    from .social_runtime import SocialRuntime
    from .transport import create_router
    from .platform import SharedPlatform

    polling = RedisPollingPolicy()
    runtime = RoomExecutionRuntime(pool, internal_address, max_rooms=max_rooms,
                                   maintenance_workers=min(2, max_rooms), inbox_polling=polling)
    instance = runtime.leases.registration.instance_id
    coordinator = RoomOwnerCoordinator(runtime)
    receiver = RoomWakeupReceiver(runtime)
    store = PostgresDeliveryStore(pool)
    gateway = GatewayDelivery(store, instance)
    presence = ConnectionPresenceRegistry(RedisPresenceStore(redis, namespace=namespace), instance,
        max_connections=max_connections, workers=min(8, max_connections))
    social = SocialRuntime(runtime.inbox)
    signals = RedisSignalTransport(redis, instance, signal_secret, namespace=namespace,
        wakeup_receiver=receiver, placement_receiver=PlacementDemandReceiver(coordinator),
        delivery_receiver=gateway)
    discovery = RoomPlacementDiscovery(coordinator, send_remote=signals.send_placement)
    publisher = OutboxPublisher(store, presence, signals.send_delivery)
    server = DistributedServer(runtime=runtime, discovery=discovery, signals=signals,
        presence=presence, gateway=gateway, publisher=publisher, social=social,
        polling=polling, pool=pool, redis=redis, owns_pool=owns_pool, owns_redis=owns_redis)
    server.allowed_origins = frozenset(allowed_origins)
    server.platform = SharedPlatform(pool, auth, guest_login_enabled=guest_login_enabled)
    signals.on_health = server.observe_health
    router = RoomCommandRouter(runtime.inbox, runtime.ownership,
                               local_receiver=receiver, send_remote=signals.send_wakeup)
    server.router = create_router(auth=auth, hosted=HostedCommandIngress(runtime.inbox, wakeup=router.wake),
        chat=ChatIngress(runtime.inbox, wakeup=router.wake),
        social=SocialIngress(runtime.inbox, wakeup=social.wake), gateway=gateway,
        allowed_origins=server.allowed_origins, reads=DistributedReads(pool), catalog=PostgresRoomCreation(pool),
        presence=presence, presence_room=store.presence_room, admission=server.admission)
    return server
