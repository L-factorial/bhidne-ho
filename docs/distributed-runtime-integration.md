# Isolated executable integration

Production entrypoints remain unchanged. This stack is for implementation validation
with a new disposable dataset, not a rolling migration of a legacy deployment.

## Server and load balancer

`app.durable_games.bootstrap:create_app` is an explicit uvicorn factory. Set:

- `BHIDNE_DISTRIBUTED_ISOLATED=1`
- `BHIDNE_DISTRIBUTED_DATABASE_URL` naming a dedicated `bhidne_distributed_*` database
- `BHIDNE_DISTRIBUTED_REDIS_URL`
- `BHIDNE_DISTRIBUTED_SIGNAL_SECRET`: shared hexadecimal encoding of at least 32 random bytes
- `BHIDNE_DISTRIBUTED_ADDRESS`: unique gateway address
- `BHIDNE_DISTRIBUTED_ORIGINS`: comma-separated exact client origins
- Optional `BHIDNE_DISTRIBUTED_NAMESPACE`, identical across the participating gateways

Initialize once with `python -m app.durable_games.bootstrap initialize`. Initialization
refuses any existing public tables and holds the migration advisory lock. Gateway
startup never migrates: it verifies the persistent dataset marker and exact schema
versions, opens the configured pool, then starts the reviewed runtime composition.

This branch's legacy `Database.open` refuses marked datasets under the same migration
lock. That protects cooperating current binaries. Older binaries are not fenced by a
marker they do not understand: production cutover requires stopping them and revoking
their database credentials before changing dataset access. No production conversion
command is provided here.

The separate `deploy/compose.distributed.yaml` supplies PostgreSQL, Redis, two gateways
and nginx without changing the existing compose stack. Supply `DISTRIBUTED_DB_PASSWORD`,
`DISTRIBUTED_SIGNAL_SECRET` and `DISTRIBUTED_CLIENT_ORIGIN`, then:

```sh
docker compose -f deploy/compose.distributed.yaml up -d postgres redis
docker compose -f deploy/compose.distributed.yaml --profile initialize run --rm initialize
docker compose -f deploy/compose.distributed.yaml up -d gateway_a gateway_b balancer
```

The listener is localhost port 18081. No upstream affinity is needed: a WebSocket stays
on the server holding its TCP connection, while HTTP requests/reconnects can reach
either gateway. nginx supports Upgrade and disables buffering and automatic request
retries. Clients retry with the original durable ID. This example does not terminate
TLS or provide production HA/readiness/capacity configuration.

## Client

Build with `EXPO_PUBLIC_RUNTIME_MODE=distributed-integration` and an explicit
`EXPO_PUBLIC_API_URL` pointing at the integration proxy. The build mounts the native
room flow and existing three game screens. The default build still mounts legacy UI.
Pending commands use one persistent journal per server/account and survive reload;
Web Locks prevent duplicate browser owners. Native storage uses the existing explicit
SecureStore adapter. Long server/account namespaces fail closed at the 128-character
bound. No credentials are written into command journals.

The integration UI now includes platform panels, scoped chat and expiring pokes.
The implementation plan tracks remaining visual/navigation parity and native-device
checks. Do not point this build at a legacy backend or an existing production dataset.

## Verification commands

```sh
POSTGRES_TEST_BIN=/path/to/postgres/bin \
REDIS_TEST_SERVER=/path/to/redis-server \
NGINX_TEST_BIN=/path/to/nginx \
.venv/bin/python -m pytest tests/test_distributed_processes.py -q

EXPO_PUBLIC_RUNTIME_MODE=distributed-integration npm --prefix client run build:web
PLAYWRIGHT_MODULE=/path/to/playwright node client/tests/distributed-mounted-smoke.cjs
```

The process tests create temporary PostgreSQL clusters and Redis Unix sockets plus
independent gateway processes. They never connect to configured application services.
Without the explicit binary variables these tests skip, not pass. The mounted browser
smoke uses mocked HTTP/WS responses; it proves composition/journaling, not backend
failover or real authentication provider exchange.

The mounted smoke can also render real generated authorized game projections:

```sh
.venv/bin/python tests/export_distributed_views.py /tmp/bhidne-distributed-views
PLAYWRIGHT_MODULE=/path/to/playwright \
DISTRIBUTED_SNAPSHOT_DIR=/tmp/bhidne-distributed-views \
node client/tests/distributed-mounted-smoke.cjs
```

An iOS export validates Metro/Hermes/native module selection, not SecureStore behavior
on a physical device. Provider exchange tests use a controlled verified identity;
real Google/Facebook configuration and callbacks remain an external smoke gate.
