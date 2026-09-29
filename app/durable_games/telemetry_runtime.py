"""Opt-in private metrics listener and bounded background sampling for one process."""
import asyncio
from time import time
from prometheus_client import start_http_server
from .telemetry import REGISTRY, STATE, ACTIVE_GAMES, ACTIVE_PLAYERS, ONLINE_USERS, event, observe


class RuntimeTelemetry:
    def __init__(self, server, *, port, address='127.0.0.1', interval=30):
        if not 0 <= port <= 65535 or interval < 1:
            raise ValueError('Invalid telemetry listener or sample interval.')
        self.server, self.port, self.address, self.interval = server, port, address, interval
        self.http = self.thread = self.task = None

    def start(self):
        # The public application deliberately has no /metrics route.
        self.http, self.thread = start_http_server(self.port, addr=self.address, registry=REGISTRY)
        self.task = asyncio.create_task(self._run(), name='runtime-telemetry')

    @observe('telemetry.database_sample')
    async def sample_database(self):
        # Read-only and bounded in time; never block game execution on collection.
        async with asyncio.timeout(2):
            async with self.server.pool.connection() as connection:
                async with connection.transaction():
                    await connection.execute('SET TRANSACTION READ ONLY')
                    await connection.execute("SET LOCAL statement_timeout = '1500ms'")
                    row = await (await connection.execute('''SELECT count(*),
                        coalesce(extract(epoch FROM (clock_timestamp()-min(created_at))),0)
                        FROM command_inbox WHERE status='pending' ''')).fetchone()
                    outbox = await (await connection.execute('''SELECT count(*),
                        coalesce(extract(epoch FROM (clock_timestamp()-min(created_at))),0)
                        FROM notification_outbox WHERE published_at IS NULL''')).fetchone()
                    activity = await (await connection.execute('''SELECT g.game_type,
                        count(DISTINCT g.id) AS games,count(DISTINCT p.user_id) AS players
                        FROM games g JOIN room_tables t ON t.table_id=g.table_id
                        LEFT JOIN active_game_players p ON p.game_id=g.id
                        WHERE g.status='active' AND t.status='playing'
                        AND NOT EXISTS(SELECT 1 FROM deleted_rooms d WHERE d.id=g.room_id)
                        GROUP BY GROUPING SETS ((g.game_type),())''')).fetchall()
        values = {kind or 'all': (int(games), int(players)) for kind, games, players in activity}
        for kind in ('callbreak', 'marriage', 'flush', 'all'):
            games, players = values.get(kind, (0, 0))
            ACTIVE_GAMES.labels(kind).set(games)
            ACTIVE_PLAYERS.labels(kind).set(players)
        for kind, values in (('commands', row), ('outbox', outbox)):
            STATE.labels(kind + '_pending').set(int(values[0]))
            STATE.labels(kind + '_oldest_seconds').set(max(0, float(values[1])))
        STATE.labels('database_sample_timestamp_seconds').set(time())
        STATE.labels('database_sample_ok').set(1)

    async def sample_presence(self):
        try:
            count = await self.server.presence.store.online_users()
            ONLINE_USERS.set(count)
            STATE.labels('presence_sample_ok').set(1)
            STATE.labels('presence_sample_timestamp_seconds').set(time())
        except asyncio.CancelledError:
            raise
        except Exception:
            # An unavailable observation is unknown, never a false zero.
            ONLINE_USERS.set(float('nan'))
            STATE.labels('presence_sample_ok').set(0)

    def sample_local(self):
        server = self.server
        values = {
            'server_running': server.state == 'running',
            'redis_available': server.signals.healthy,
            'admitted_requests': len(server._requests),
            'tracked_rooms': len(server.runtime._rooms),
            'scheduler_lanes': len(server.runtime.scheduler._work),
            'scheduler_healthy': server.runtime.scheduler.healthy,
            'delivery_subscriptions': len(server.gateway._streams),
            'presence_connections': len(server.presence._entries),
        }
        # Pool statistics are cumulative gauges. The pool may reset these; callers
        # should not interpret them as Prometheus counters without reset handling.
        stats = server.pool.get_stats()
        for key in ('pool_size', 'pool_available', 'requests_waiting', 'requests_wait_ms',
                    'requests_errors', 'connections_errors'):
            values['db_' + key] = stats.get(key, 0)
        for key, value in values.items():
            STATE.labels(key).set(value)

    async def _run(self):
        while True:
            try:
                self.sample_local()
                await self.sample_database()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                STATE.labels('database_sample_ok').set(0)
                for kind in ('callbreak', 'marriage', 'flush', 'all'):
                    ACTIVE_GAMES.labels(kind).set(float('nan'))
                    ACTIVE_PLAYERS.labels(kind).set(float('nan'))
                event('telemetry_sample_failed', error_type=type(error).__name__)
            await self.sample_presence()
            await asyncio.sleep(self.interval)

    async def stop(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
        if self.http:
            await asyncio.to_thread(self.http.shutdown)
            self.http.server_close()
            await asyncio.to_thread(self.thread.join, 2)
            self.http = self.thread = None
