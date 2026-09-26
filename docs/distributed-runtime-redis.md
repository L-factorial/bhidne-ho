# Redis integration: increments 5a and 5b

These are explicit components, not live application startup bindings. PostgreSQL
still holds commands, ordering, receipts, checkpoints, jobs and ownership fences.
No schema migration is required by these slices. Shared presence and owner-cache
components are included. Hosted delivery adapters are described in the
[increment 6a delivery notes](distributed-runtime-delivery.md), with scoped chat in
[6b1](distributed-runtime-chat.md). Conversation/recipient lanes are covered by [6b2](distributed-runtime-social.md).

## Composition contract

1. Create one `RedisPollingPolicy` per `RoomExecutionRuntime`, passing it as
   `inbox_polling`. Omitting it preserves the existing scan behavior.
2. Create `RoomWakeupReceiver(runtime)` and
   `PlacementDemandReceiver(RoomOwnerCoordinator(runtime))`.
3. Create `RedisSignalTransport.from_url(url, instance_id, secret,
   wakeup_receiver=..., placement_receiver=..., on_health=policy.observe)` with
   the runtime's unique boot registration ID. Start the runtime and explicitly
   start the transport. `start()` does not wait for Redis availability: PostgreSQL
   polling remains active while the subscription connects.
4. Supply `transport.send_wakeup` as `RoomCommandRouter.send_remote`, retaining
   the local receiver for local dispatch. In ingress's `(room_id, lane_id)` wakeup
   callback, call `router.wake(lane_id)`. Ingress commits before signalling.
5. Supply `transport.send_placement` as `RoomPlacementDiscovery.send_remote`.
   Keep periodic discovery running: missed placement hints must not strand rooms.
6. Stop accepting new local work and stop discovery/producers before stopping the
   transport, then drain the runtime using its existing fenced shutdown contract.
   Transport stop joins its reader/workers and closes its subscription. Factory
   clients are owned and closed; injected shared clients remain caller-owned.

Receivers recheck PostgreSQL ownership/admission and lane identity. Redis cannot
grant ownership, bypass engine validation or acknowledge command execution. A
positive publish subscriber count only reports Redis subscribers. Use durable
receipts/status for command outcomes and keep the same request ID when retrying.

## Failure and recovery behavior

- One addressed channel per boot ID; signed, size-limited envelopes contain routing
  identities, epoch, timestamp and nonce, never commands, game state or lease tokens.
  Duplicate hints are harmless scheduler offers; inbox receipts handle command dedupe.
- Health requires a signed nonce round trip through the subscription after its
  subscribe acknowledgement. A successful PING or publish alone is insufficient.
  Lost probes, publication errors and reconnects switch to fallback; a fresh probe
  establishes health again. Retry delays use capped exponential backoff and jitter.
- Default healthy inbox cadence is 5 seconds with 10% jitter; unavailable cadence is
  350 ms with 10% jitter. Healthy operation still uses a safety poll for lost hints.
  Health transitions request an immediate scan without overriding database backoff
  or ownership admission. These are scheduling intervals, not latency guarantees:
  query duration, bounded pages and backpressure affect drain time.
- Timer/settlement scans retain the runtime's separate maintenance cadence. Redis
  loss does not change leases or make an otherwise valid owner release its rooms.
- Dispatch has four workers and a 256-item queue by default. Overflow or receiver
  timeout drops advisory work; PostgreSQL scans/discovery recover it. Reader probes
  are independent of slow receiver work. No unbounded per-message tasks are created.
- Placement discovery keeps its existing periodic catalog scan. This slice does not
  optimize fleet-wide discovery or prove capacity at millions of users.

Redis Pub/Sub is at-most-once, so a healthy connection is not a durable delivery
guarantee; see the [official Pub/Sub documentation](https://redis.io/docs/latest/develop/pubsub/).
Client lifecycle follows the [redis-py asyncio documentation](https://redis.readthedocs.io/en/stable/examples/asyncio_examples.html).

## Configuration and verification

Install the optional project extra `.[redis]` for transport deployments. The factory
lazily imports redis-py, uses RESP2, bounds its pool and socket waits, and disables
client-level retries so transport retry bounds apply. Legacy imports need no Redis.

Inject a shared secret of at least 32 random bytes and a deployment-specific channel
namespace. Use private authenticated Redis with ACLs and TLS for network connections.
Do not log URLs, credentials, raw messages or secrets. HMAC authenticates trusted
server hints; it does not encrypt them or replace PostgreSQL authorization. Freshness
checks require reasonably synchronized clocks. Coordinated secret changes may lose
hints temporarily; safety polling must remain enabled.

Tests cover codec rejection, targeted dispatch, silent subscription loss, queue
saturation, cancelled shutdown, PostgreSQL receiver execution, reconnect rescans,
independent timer cadence and database retries. Isolated real-server tests exercise
redis-py 8.1.0 with Redis 7.4.2 over a private temporary Unix socket:

```sh
PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite \
  .venv/bin/python -m pytest -q tests/test_redis_signals.py tests/test_redis_polling.py
REDIS_TEST_SERVER=/path/to/redis-server \
  PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite \
  .venv/bin/python -m pytest -q tests/test_redis_live_transport.py
```

Real-server tests skip unless explicitly enabled. They launch a temporary server
with persistence disabled and TCP port disabled, stop/restart it, and clean it up.
They do not use an application Redis instance. Embedded PostgreSQL uses one
connection; independent-process ownership races remain increment 8.

## Shared presence and owner caching (5b)

`RedisPresenceStore` maintains separate user and room sorted-set indices. Each member
is one immutable `ConnectionPresence(instance_id, connection_id, user_id, room_id)`.
The gateway generates a fresh connection ID for each attachment; a reconnect never
reuses the previous handle. Platform sockets can omit `room_id` and use only the
user index. Room changes detach the old registration and attach a new one. Multiple
devices, tabs and servers therefore coexist without overwriting each other.

Each refresh uses Redis server time, a 30-second expiry score and a key TTL. Reads
filter expired scores even while other connections keep the index alive. Atomic
single-index scripts perform bounded expired-member cleanup, cap each index at
4,096 records, and renew the record. User and room indices can live in different
Redis Cluster slots; their updates intentionally are not one atomic transaction.
Partial registration or deletion during failure is advisory and converges by
refresh/expiry. Use consistent TTL/capacity settings across servers.

`ConnectionPresenceRegistry` holds only the gateway's actual local connections. It
refreshes them every 10 seconds through eight fixed workers, with at most 2,048 local
registrations by default. Health restoration triggers an immediate refresh; periodic
refresh also repairs key loss without a subscription disconnect. Detach removes only
the exact handle and serializes with known refresh work. An uncertain Redis result
or a crash can leave stale observations until expiry; it never changes room
membership, game seats, leases or durable history. Explicit stop joins refresh work
and attempts bounded per-registration removal. Injected Redis clients remain owned
by the caller.

Reads return `PresenceObservation` with one of three statuses:

- `observed`: a successful observation of unexpired registrations. This is not a
  complete online/offline truth; some gateways may still be rebuilding their indices.
- `unknown`: Redis is unavailable, the read failed/was malformed, or it crossed a
  reconnect. Do not turn this into an empty authoritative offline list.
- `overflow`: more than the default 512 read limit. No silently truncated recipient
  list is returned; delivery must fall back to durable catch-up rather than claim
  complete fanout. Limits are configurable within bounded index capacity.

These are trusted internal adapters. Authenticate the socket and authorize its room
before attaching, and authorize presence queries before exposing them to clients.
Presence metadata is not permission to deliver private payloads. Increment 6 must
reauthorize recipients and keep catch-up correct for unknown/partial observations.
No global key scan or persistent presence history is introduced.

`RedisOwnerCache` stores only room ID, boot ID, epoch and internal address, populated
from authoritative `ownership.inspect` results that are serving, live, fresh and
not draining. Its default TTL is two seconds (maximum five). An optional
`RoomCommandRouter(owner_cache=cache)` tries a cached wakeup first; a refusal or
send error compare-deletes that exact hint and performs a PostgreSQL lookup. A miss
or Redis failure uses the existing PostgreSQL path. Cached hits avoid the gateway's
owner lookup, but the receiver and executor still check ownership/admission. A
successful Pub/Sub publication can target a stale listener; PostgreSQL safety
polling remains the recovery mechanism, not publish acknowledgements.

Atomic updates reject lower epochs or conflicting boots at the same epoch. Delayed
invalidation cannot delete a newer route. Cache reads crossing health transitions
are discarded. For one cache TTL after reconnect, reads bypass old values so routes
rebuild from PostgreSQL; there is no fleet-wide cache scan. Drain/takeover hints may
remain until expiry/refusal, and never grant authority to the former owner.

Compose the same subscription health signal into all three components:

```python
def on_redis_health(available):
    policy.observe(available)
    presence.observe_health(available)
    owner_cache.observe_health(available)
```

Here `policy` is the runtime's `RedisPollingPolicy`, `presence` is its gateway's
`ConnectionPresenceRegistry`, and `owner_cache` is its `RedisOwnerCache`. Pass this
synchronous callback to `RedisSignalTransport(on_health=...)`. Construct presence
and cache with the shared injected Redis client and matching namespace; keep the
client open until registry and transport shutdown both finish. Start the registry
before accepting sockets. Stop socket admission and detach/drain connections before
stopping the registry. All components begin with Redis unavailable. No live app hook
installs this composition yet.

Additional verification commands:

```sh
.venv/bin/python -m pytest -q tests/test_redis_presence.py tests/test_redis_owner_cache.py
REDIS_TEST_SERVER=/path/to/redis-server \
  PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite \
  .venv/bin/python -m pytest -q tests/test_redis_state_live.py
```

The transport now also supports authenticated delivery hints and an optional
`delivery_receiver`; connect its health callback to `GatewayDelivery.observe_health`
alongside the three components above when composing increment 6a.

DM/notification components are complete in [6b2](distributed-runtime-social.md). Live startup/routes
remain gated on delivery, client compatibility and independent-process correctness.
