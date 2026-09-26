# C3a: explicit server assembly

`app.durable_games.server.build_server(pool, redis, ...)` constructs the distributed
components and an unmounted router. It performs no I/O on construction and is not
imported by the legacy application. The caller supplies a configured, open PostgreSQL
pool, Redis client, authentication service, exact browser origin allowlist, internal
address and shared signal secret. Resource ownership is borrowed by default; use
`owns_pool`/`owns_redis` only when transferring their shutdown responsibility.

## Startup and admission

Each assembly receives a fresh random boot identity and registration secret through
`RoomExecutionRuntime`. Its advertised capability includes room capacity. `start()`
starts registration/lease maintenance and the fenced room scheduler, then presence,
gateway delivery, social execution, Redis signals, outbox publication and placement
discovery. Redis readiness is not a startup prerequisite. A failed or cancelled start
cleans every attempted component, including the partially started component. A stopped
assembly cannot restart with the same boot identity.

The assembled router admits HTTP requests and sockets only after startup completes.
It tracks their task lifetimes with a bounded dependency (default 4,096 concurrent
requests, including open sockets). Admission closes before shutdown awaits anything.
A refusal is not a command outcome; clients retain their original request IDs.

The factory wires real hosted/chat ingress to the room router, social ingress to the
social worker, and all optional read/catalog routes. Room wakeups, placement demands
and delivery signals use their existing validated receivers. Redis health updates the
inbox polling policy, presence registry and gateway together. Failed Redis increases
inbox/delivery scans; recovery refreshes surviving registrations and requests catch-up.
Healthy Redis still retains safety reconciliation. Discovery, social work, outbox
publication and timer/lease maintenance keep their existing bounded schedules.
The optional advisory owner cache is not installed by this factory.

## Socket presence

Authentication precedes the user presence registration and `READY`. After a paused
subscription is authorized, the server resolves its room from PostgreSQL and attaches
a room hint. Multiple lanes in the same room share one registration per socket.
Unsubscribe/revocation removes that hint after the last corresponding lane is removed;
disconnect removes all remaining registrations. Separate sockets have separate IDs,
so an old disconnect cannot remove a replacement connection.

ACK-only access for a former member does not create a room presence hint. A room
hint may become stale between authorization checks; it remains advisory and never
grants delivery permission. Events are still read through the authorized gateway.
Presence refresh/recovery is handled by the existing bounded registry; Redis removal
failure expires by TTL and does not change membership, seats or game state.

`max_connections` bounds local presence registrations, not physical sockets: each
socket uses one user registration plus one per distinct subscribed room. Its default
2,048 allows 1,024 sockets with one room each before other limits apply; this is a
configuration bound, not a measured capacity claim. Redis index limits can also
make hints incomplete; durable gateway reconciliation remains necessary.

## Shutdown and uncertainty

`stop()` closes router admission and local lease admission, then stops discovery and
Redis dispatch. It cancels and joins admitted HTTP/socket tasks before stopping social
execution, publication, gateway delivery, presence and room execution. Socket
cancellation sends close code 1012 when possible and joins presence cleanup. Room
runtime drain withdraws routing, stops execution and attempts fenced lease release.
Its `DrainReport` remains on the server: uncertain releases are not reported as
success and retain existing expiry/quarantine semantics.

Owned Redis and then the owned pool close only after component cleanup. Caller
cancellation waits for cleanup before propagating. If a component stop fails, remaining
stops are attempted, resources stay open, admission stays closed and an exception group
is raised; a later `stop()` can retry. Once all components are stopped, a report with
uncertain SQL release may still allow pool closure because execution is quiescent.
No new ownership is claimed during shutdown.

## Verification and remaining gates

86 targeted lifecycle/transport/delivery/presence/drain/Redis regression tests passed;
a final 25-test server/transport run passed after adding socket-close coverage
(87 distinct tests across these runs). Tests include a real assembled HTTP-to-inbox
creation/placement/execution flow with Redis offline, PostgreSQL/WASM SQL, startup
failure at each stage, cancelled startup/shutdown, retained resources on failed stop,
health recovery and socket cleanup. Broker/socket peers are controlled test doubles;
this is not independent-process PostgreSQL/Redis failover or load-test evidence.

Next is C3b: application lifespan/bootstrap and route compatibility boundaries,
including explicit runtime selection and exclusion of competing legacy/distributed
writers. Keep the assembly unmounted in the production app while that work, live
client bindings, platform smoke checks, load balancing and increment-8 correctness
remain outstanding. No migration or deployment was applied for C3a.

## C3b: isolated application lifecycle and route boundary

`app.main.create_app(runtime_mode='distributed-integration', distributed_server=server)`
now creates a separate ASGI application around a fresh `build_server(...)` assembly.
It never constructs `RoomService`, `TestGameService`, the Echo registry, legacy
schedulers or legacy sockets. Its lifespan starts the server before serving and
stops it on normal exit, startup failure or context exit failure. C3a resource
ownership and cleanup semantics still apply. The caller supplies already configured
resources and authentication; this bootstrap does not run database migrations.

Application runtime selection is separate from the existing legacy
`BHIDNE_HO_GAME_RUNTIME_MODE=durable|memory` engine setting. `create_app()` and the
module-level production app stay legacy. Selecting `distributed` fails explicitly;
there is no environment variable that enables production cutover. Supplying a server
to legacy mode, an absent integration server or a previously started server fails
before any services are constructed.

| Surface | Integration application behavior |
| --- | --- |
| `/distributed/commands` and command status | Durable hosted/chat/social ingress and original-ID status recovery. |
| `/distributed/rooms` POST | Atomic idempotent catalog creation. |
| `/distributed/rooms/{room_id}` GET | Authorized native room/table projection. |
| `/distributed/streams/*`, `/history/*`, `/legacy/*` under the distributed prefix | Native discovery/history plus explicit legacy-history reads; these are not legacy writers. |
| `/distributed/delivery` | Authenticated multiplexed socket with presence/ACK cleanup. |
| `/health` | 200 only while the assembly is running, otherwise 503; this is lifecycle state, not a database/worker readiness probe. |
| Old room/game/table/chat/social endpoints, Generic/Echo/ad-hoc paths | HTTP 409 `unsupported_runtime_route`; no fallback to a legacy handler. |
| Old `/ws/rooms/...` | Closed with code 1008 before legacy socket handling. |
| Authentication issuance, profiles, friendships, ledger and static UI | Not mounted yet; intentionally unavailable in this integration application. Existing tokens are verified by the supplied authenticator. |

A protocol middleware enforces this boundary even if a legacy route is accidentally
added to the integration app. Native unknown routes remain ordinary 404s. CORS and
socket origins use the same captured exact allowlist, including when supplied as an
iterator. Browser preflight uses GET/POST and Authorization/Content-Type.

**Exclusion scope:** this prevents mixed writers within this application. It does
not fence older processes or make a rolling mixed-runtime deployment safe. Run this
app against a dedicated integration dataset only. Production activation remains
blocked until shared platform route/client parity, explicit cutover/writer exclusion
and independent-process correctness are established. There is no claim of database-wide
writer exclusion in C3b.

Verification: 37 application/server/transport/auth tests passed, including real
PostgreSQL/WASM catalog creation/read via the application lifespan, startup failure,
legacy handler exclusion, default app behavior and browser/socket boundaries.
Next: C3c, explicitly compose shared authentication/profile and platform read routes
without bringing back legacy game or social mutation paths; audit remaining platform
mutations before live client binding. Client/LB and increment-8 gates remain open.


## C3c update

The C3b-only route table above records the earlier boundary. Reviewed shared account,
profile and player routes are now composed by `SharedPlatform`, plus native catalog,
invitation, membership and ledger reads. See the current
[platform compatibility contract](distributed-runtime-platform.md) for exact routes,
method allowlists, explicit guest configuration and remaining gaps. Production and
mixed-runtime activation remain blocked. Verification: 53 targeted tests passed.

## Executable isolated composition (C3h–C3i / increment 8)

The [integration guide](distributed-runtime-integration.md) supersedes the earlier
next-step notes. A factory now opens configured resources, verifies a dedicated dataset
marker/schema and starts the server. A separate initializer refuses existing data.
This branch's legacy startup refuses marked data and closes its pool on refusal;
older deployed binaries still require external credential/network exclusion.

Reviewed browser sign-in, manual settlements, shared phrases and expiring pokes are
now included. Separate two-gateway/nginx composition and real-process correctness
tests are provided. Production defaults remain legacy, with no automatic cutover.
