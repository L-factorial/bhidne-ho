"""Explicit isolated integration launcher; no production environment switch.

Initialize only a new dedicated database, then launch with uvicorn --factory.
The persistent marker also prevents this branch's legacy Database.open from writing
that dataset. Older deployed binaries still require credential/network exclusion.
"""
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urlsplit

from psycopg.conninfo import conninfo_to_dict
from psycopg_pool import AsyncConnectionPool

from app.auth.postgres import PostgresAuthService
from app.database import MIGRATIONS
from .application import create_integration_app
from .server import build_server

MIGRATION_LOCK = 0x424849444E45484F
MARKER = 'distributed-integration-v1'


@dataclass(frozen=True)
class Settings:
    database: str
    redis: str
    secret: bytes
    address: str
    origins: tuple[str, ...]
    namespace: str = 'bhidne-ho:integration:v1'

    def __post_init__(self):
        name = conninfo_to_dict(self.database).get('dbname', '')
        if not name.startswith('bhidne_distributed_') or len(name) > 63:
            raise ValueError('Integration requires a dedicated bhidne_distributed_* database.')
        if len(self.secret) < 32 or not self.address.strip() or len(self.address) > 128:
            raise ValueError('Supply a stable address and at least 32 signalling secret bytes.')
        if not self.origins or len(self.origins) > 16:
            raise ValueError('Supply explicit client origins.')
        for origin in self.origins:
            value = urlsplit(origin)
            if value.scheme not in ('http', 'https') or not value.netloc or value.username or value.password or value.query or value.fragment or value.path:
                raise ValueError('Origins must be exact HTTP(S) origins without paths or credentials.')
        if not self.namespace.strip() or len(self.namespace) > 128:
            raise ValueError('Invalid integration Redis namespace.')

    @classmethod
    def environment(cls):
        if os.environ.get('BHIDNE_DISTRIBUTED_ISOLATED') != '1':
            raise ValueError('Explicit BHIDNE_DISTRIBUTED_ISOLATED=1 is required.')
        return cls(os.environ['BHIDNE_DISTRIBUTED_DATABASE_URL'], os.environ['BHIDNE_DISTRIBUTED_REDIS_URL'],
                   bytes.fromhex(os.environ['BHIDNE_DISTRIBUTED_SIGNAL_SECRET']),
                   os.environ['BHIDNE_DISTRIBUTED_ADDRESS'],
                   tuple(x.strip() for x in os.environ['BHIDNE_DISTRIBUTED_ORIGINS'].split(',') if x.strip()),
                   os.environ.get('BHIDNE_DISTRIBUTED_NAMESPACE', 'bhidne-ho:integration:v1'))


async def initialize(settings):
    """Explicit CLI step, only empty datasets. Never called by the ASGI factory."""
    async with AsyncConnectionPool(settings.database, open=False) as pool:
        async with pool.connection() as connection:
            async with connection.transaction():
                await connection.execute('SELECT pg_advisory_xact_lock(%s)', (MIGRATION_LOCK,))
                row = await (await connection.execute("SELECT 1 FROM pg_tables WHERE schemaname='public' LIMIT 1")).fetchone()
                if row:
                    raise ValueError('Initialization requires an empty database; existing data is never converted.')
                await connection.execute('CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
                for version, sql in MIGRATIONS:
                    await connection.execute(sql)
                    await connection.execute('INSERT INTO schema_migrations(version) VALUES (%s)', (version,))
                await connection.execute('CREATE TABLE runtime_dataset(singleton boolean PRIMARY KEY CHECK(singleton), mode text NOT NULL)')
                await connection.execute('INSERT INTO runtime_dataset VALUES (true,%s)', (MARKER,))


async def verify_dataset(pool):
    async with pool.connection() as connection:
        async with connection.transaction():
            await connection.execute('SET TRANSACTION READ ONLY')
            marker = await (await connection.execute("SELECT to_regclass('public.runtime_dataset')")).fetchone()
            if not marker or marker[0] is None:
                raise ValueError('Initialize an isolated distributed dataset first.')
            row = await (await connection.execute('SELECT mode FROM runtime_dataset WHERE singleton')).fetchone()
            versions = await (await connection.execute('SELECT version FROM schema_migrations ORDER BY version')).fetchall()
            if row != (MARKER,) or [v[0] for v in versions] != [v for v, _ in MIGRATIONS]:
                raise ValueError('Dataset mode or schema does not match this integration runtime.')


def create_app(settings=None):
    from redis.asyncio import Redis
    settings = settings or Settings.environment()
    pool = AsyncConnectionPool(settings.database, min_size=2, max_size=16, open=False,
                               kwargs={'connect_timeout': 5})
    redis = Redis.from_url(settings.redis, protocol=2, socket_connect_timeout=.5, socket_timeout=.5)
    server = build_server(pool, redis, internal_address=settings.address, signal_secret=settings.secret,
                          auth=PostgresAuthService(pool), allowed_origins=settings.origins,
                          namespace=settings.namespace, owns_pool=True, owns_redis=True)
    app = create_integration_app(server)
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def configured(application):
        try:
            await pool.open(wait=True, timeout=10)
            await verify_dataset(pool)
        except BaseException:
            await redis.aclose()
            await pool.close()
            raise
        async with lifespan(application):
            yield
    app.router.lifespan_context = configured
    return app


if __name__ == '__main__':
    import asyncio
    import sys
    if sys.argv[1:] != ['initialize']:
        raise SystemExit('Usage: python -m app.durable_games.bootstrap initialize')
    asyncio.run(initialize(Settings.environment()))
