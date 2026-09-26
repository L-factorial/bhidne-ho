# Distributed runtime implementation plan

Status: implementation in progress on `bhidne-ho-scalability`; schema increments 1a–1c
and reconstruction/persistence increments 2a–2c complete. Inbox and game-lane
execution increments 3a–3b, ownership primitives 4a, lease coordination 4b1,
room recovery inventory 4b2, bounded recovery preparation 4b3a, and lobby table
execution 4b3b1 and durable lobby creation 4b3b2 are complete.
Table/controller executors, offer-expiry dispatch, and all three game settlement
workers and validators (4b3b) are complete as explicit capabilities. Transactional
activation and concrete execution/maintenance scheduling are complete within 4b3c.
Explicit owner wakeup routing and bounded quarantine/repair-retry policy are complete.
Coordinated drain/routing withdrawal and safe release are complete as explicit
capabilities. Bounded demand-driven owner selection/reacquisition is complete.
Explicit durable placement discovery/dispatch adapters and the endpoint capability
audit are complete. The audited C1 controller/lifecycle and C2 query/ingress backend slices are now
implemented as explicit components, including migration 21. Increment 5's explicit
Redis signalling, adaptive polling, shared presence and advisory owner cache are
complete. Increment 6a adds explicit outbox publication, authorized hosted-lane
catch-up and gateway delivery adapters. Increment 6b1 adds durable room/table/game
chat execution, history and authorized replay. Increment 6b2 completes explicit
conversation/recipient execution, social history and delivery permissions. Live
bindings, client integration and live cutover remain pending. Increment 7a adds an
explicit client pending/status lifecycle; 7b adds explicit stream discovery and
delivery reconciliation. Increment 7c1 composes explicit session ownership, bounded
subscriptions and reconnect recovery. Increment 7c2a adds the account/device-scoped
pending-command journal and session restoration. Increment 7c2b adds explicit web/native
storage bindings and account ownership. Increment 7c2c1 adds explicit command HTTP
and multiplexed delivery WebSocket adapters. Increment 7c2c2 adds explicit authorized
reads, bootstrap/discovery, history transport and command mapping primitives. Mounted
integration remains gated. Increment 7c2d1 assembles explicit authenticated root,
selected-view loading and reconnect lifetimes. Increment 7c2d2 adds explicit screen
controllers, game-specific leave and durable initial room creation; live bindings
and platform smoke validation remain pending. C3a composes the explicit server
lifecycle and authenticated socket presence; production assembly remains unmounted.

This document records the planning decisions agreed with the user. Read it before
each implementation increment, update its checklist and handoff notes afterward,
and record any material design changes explicitly. The user has authorized
incremental implementation and reserved this branch for this work. See `AGENTS.md`
for the persistent branch scope.

## Scope and targets

- Target 1,000 simultaneous WebSocket connections, 20,000 daily active users, and
  approximately 1.5 million registered users.
- These are sizing targets, not verified capacity guarantees.
- First deliver correct distributed execution, recovery, delivery, and client
  integration. Capacity validation and operational readiness form a later task set.
- Extend the existing application and versioned schema rather than introducing
  separate microservices or database sharding initially.

## Agreed architecture

- Any application instance can accept authenticated HTTP requests and WebSockets.
- An established socket stays on its receiving instance until disconnected.
  Reconnects and separate HTTP requests can reach another instance.
- One application instance owns a room and hosts all its tables and games.
- A room allows a configurable maximum of five open tables, counting both waiting
  and playing tables. Enforce creation atomically.
- Each table has one current game. A rematch gets a new game ID.
- Games at different tables execute concurrently. Commands within a game execute
  sequentially in transactionally assigned database order.
- PostgreSQL is authoritative for state, ownership, pending commands, receipts,
  deadlines, durable messages, and pending finalization.
- Redis supplies wake-ups, delivery notifications, routing caches, and ephemeral
  connection presence. It is not the authoritative command queue or ownership store.
- Room ownership bounds placement, not command ordering: ordinary gameplay must
  not share one exclusive room-wide execution lock.

## End-to-end command flow

1. A receiving instance authenticates the actor and validates the request shape.
2. In one transaction, deduplicate by actor/request ID, allocate the lane sequence,
   and insert the original request into the PostgreSQL command inbox.
3. Publish a Redis wake-up to the current owner. A failed or missed wake-up does
   not erase the committed command.
4. The owner schedules the corresponding lane and reads its pending commands in
   order. Different game lanes can progress independently.
5. Recheck authorization, ownership fencing, request fingerprint, expected game
   revision, and game rules at execution time.
6. Atomically commit state/events, command receipt, inbox completion, and outgoing
   notification records. Publish no speculative engine state.
7. Return the durable result to the requester. Notification delivery runs outside
   the game execution lock.
8. Redis alerts interested connection servers. They deliver authorized projections
   to their local sockets; clients reconcile using snapshots and catch-up cursors.

Queued is distinct from accepted by the game. If the HTTP request cannot wait for
execution, return an explicit pending result and command-status reference. Preserve
the same command ID until its durable accepted/rejected outcome is resolved.

## PostgreSQL schema work

Baseline: `app/database.py`, `app/durable_games/store.py`,
`app/durable_games/runtime.py`, and `app/test_games/service.py`.

The following are proposed logical tables/changes. Final column definitions and
migrations must be reconciled with existing constraints during each increment.

| Table/change | Required state | Indexes and constraints |
| --- | --- | --- |
| New `server_instances` | Instance ID, internal address, heartbeat, draining flag, runtime capabilities | Instance primary key; heartbeat index |
| New `room_ownership` | Room, owner instance, epoch, lease expiry, recovery status | Room primary key; owner index; lease-expiry index |
| New `room_tables` | Table, room, lifecycle status, configuration, revision | Table primary key; room/status index |
| Durable table state | Seats, waitlist, offers, rule proposals/votes | Unique table/seat and table/player constraints; ordered waitlist index |
| Extend `games` | Table relationship and recoverable runtime metadata | Table/history index; partial unique active-game-per-table index |
| New `command_lanes` | Lane ID/type, optional room association, next and processed sequence | Lane primary key; room index |
| New `command_inbox` | Lane, sequence, actor, command ID, original payload, fingerprint, status, outcome reference | Unique lane/sequence and lane/actor/command ID; partial pending-work index |
| Retain `game_commands` | Durable accepted/rejected receipts | Existing game/actor/command primary key |
| Retain `game_events` | Ordered canonical history | Existing game/sequence primary key |
| New `game_snapshots` | Versioned checkpoint, event sequence, revision | Game/sequence primary key |
| New `scheduled_actions` | Game, action type, generation, deadline, status | Unique game/action/generation; partial pending-deadline index |
| New `notification_outbox` | Event ID, destination, sequence, payload/reference, retry time, publication status | Event primary key; partial unpublished-work index |
| Durable room chat | Room, sender, message ID, sequence, text | Unique room/sequence and sender/request ID with appropriate scope |
| Extend direct messages/notifications | Stable request IDs, conversation/recipient sequences, catch-up support | Conversation/sequence and recipient/sequence indexes; deduplication constraints |
| Durable finalization jobs | Game/round, job type, retry state | Unique game/round/job type; pending-work index |

Retain existing authentication, membership, player reservations, and ledger data.
Reuse existing primary-key/unique indexes rather than duplicating them. Index
specific lookup and polling paths; do not add blanket indexes over JSON payloads.

### Transaction requirements

- Enforce the five-table limit with an atomic database-maintained allocation
  counter, updated in the table mutation transaction (see increment 1a notes).
- Allocate command order under a per-lane lock, with insertion in that transaction;
  timestamps, Redis arrival order, and unconstrained sequence allocation do not
  define authoritative execution order.
- Deduplicate before allocating new work. Fingerprints represent the original
  request, not the resulting engine state.
- Keep receipt lookup available for completed games and old matches. Terminal
  status must not prevent resolving a previously committed command.
- Start/rematch IDs must be stable across retries. Game creation, reservations,
  and replacement transitions must not leave duplicate games or leaked seats.
- Restore from a checkpoint plus subsequent events; do not replay full history
  for every gameplay command.
- Commit durable settlement/finalization intent with game completion. Retry effects
  with unique game/round keys.
- Define receipt retention before deleting history; pending retries and foreign-key
  dependencies must remain valid. Retention tuning is deferred.

## Execution and locking

Use independent lanes for room lifecycle, table lifecycle, each game, and room chat.
Use conversation lanes for direct messages and recipient ordering for platform
notifications. Those non-room lanes need database serialization/claims independent
of room ownership.

- Process one command at a time per lane, with bounded concurrency across lanes.
- Never skip an unresolved head command to execute a later command in its lane.
  Retry transient failures; record terminal rejection before advancing.
- Shared lifecycle operations coordinate with affected tables/games and database
  constraints. Ordinary moves need no exclusive room-wide execution lock.
- Use compatible shared protection for room fencing during ordinary game commits,
  exclusive protection on the affected game/lane, and conflicting protection for
  ownership transfer. Validate the exact lock modes and order in implementation.
- Integrate existing game fencing with room ownership; do not retain independent
  room/game ownership authorities that can disagree.
- Keep transactions short, bound lock waits, and do no socket delivery while
  holding game execution locks.
- Use an async scheduler and shared bounded database pool, not a thread, polling
  loop, or dedicated database connection for every game.

## Ownership and recovery

Initial configurable values: 30-second ownership lease, renewal every 5 seconds
with jitter, expired-ownership discovery approximately every 2 seconds, and a short
owner cache lifetime (approximately 5 seconds).

Every process incarnation gets a unique instance ID. PostgreSQL time governs lease
decisions. Lease renewal is independent of gameplay activity.

Takeover:

1. Acquire expired or explicitly released ownership atomically and increment epoch.
2. Mark the room recovering and renew its lease during reconstruction.
3. Restore tables, roster mappings, locked rules, engine versions, canonical state,
   receipts, deadlines, and pending finalization from a consistent committed view.
4. Validate revisions and event continuity; quarantine invalid/unsupported state.
5. Restore scheduled actions, mark the room serving, and advertise its owner route.
6. Resume each lane independently and refresh connected clients.

An owner with uncertain renewal stops starting authoritative work. A former owner
cannot commit after takeover and must discard its local runtime. Reacquisition
requires reconstruction; acquiring a lease does not validate cached engine state.
An RPC timeout alone never authorizes stealing a live lease.

Persist absolute timer deadlines and generations. Submit recovered timers as
idempotent commands, reject obsolete timers, and bound overdue catch-up work.
Preserve existing deadline semantics initially: outage grace is a separate game
policy, not an implicit countdown reset.

## Redis, polling, and delivery

- Commit inbox work before publishing its wake-up.
- Normal operation: wake immediately through Redis plus a slow safety poll,
  initially around 5 seconds.
- Redis outage: increase polling frequency, initially around 250–500 ms.
- Startup, takeover, and Redis reconnection: immediately drain pending work.
- Batch polls across owned rooms; tune values later with capacity measurements.
- Cache room owner/epoch and maintain expiring connection registrations including
  user, room, server, and connection ID.
- Register each socket separately. An old disconnect cannot remove a new socket
  or mark a multi-device user offline everywhere.
- Rebuild presence and caches after Redis loss. Unknown presence does not mean
  departed membership or a released seat.
- Publish only to interested servers. Prefer IDs/sequences in Redis messages;
  never broadcast canonical private game state.
- Outbox publication can repeat. Clients deduplicate by event/message ID and
  ignore stale game revisions.
- Publication is not client delivery acknowledgment. Keep durable message history
  and per-device/connection catch-up semantics rather than one consuming user queue.
- During Redis outages, connection servers batch catch-up for their connected
  users/rooms; game clients retain snapshot reconciliation.

Durable room, table and game chat is an intentional extension of earlier ephemeral
behavior. Room history is room-scoped; table history spans games; game chat uses the
durable game ID. Closed/deleted scopes lose normal chat access. History retention
and physical purge require an explicit policy; no automatic purge is enabled.
Transient pokes can remain ephemeral unless separately requested to be durable.

## Server and client components

- Connection manager: local sockets, serialized writes, bounded send queues.
- Command ingress: authentication, validation, durable enqueue, stable deduplication.
- Ownership manager: assignment, renewal, takeover, release.
- Lane scheduler: fair bounded execution across games and other lanes.
- Game runtime: rule checks, atomic state transition, receipts, private snapshots.
- Recovery manager: runtime reconstruction, timers, finalization recovery.
- Outbox publisher: retryable notification publication outside gameplay locks.
- Delivery/catch-up service: local pushes and missed-message recovery.
- Internal authenticated HTTP: owner-specific snapshot reads and required internal
  queries. Gameplay commands use the PostgreSQL inbox plus Redis wake-ups.
- Client: pending-command response/status handling, same-ID retries, revision checks,
  reconnect snapshots, and message catch-up.

Wait briefly for queued command completion to preserve existing synchronous action
responses where possible. Add an explicit pending contract and authenticated status
lookup for longer waits. Temporary ownership recovery must be retryable, not a
false game-not-found or final command rejection.

## Load balancing and deployment integration

- Begin integration with at least two instances behind a WebSocket-capable load
  balancer, TLS termination, upgrade support, and appropriate idle timeouts.
- Application heartbeats must be shorter than the idle timeout.
- No sticky sessions are required. HTTP requests cannot assume local game state.
- Add readiness/liveness endpoints and basic draining behavior. Draining stops new
  connections and room assignments and safely finishes/releases owned work.
- Redis outage alone must not remove all otherwise functioning instances from
  service; database fallback remains usable.
- Keep internal RPC, PostgreSQL, and Redis private and authenticated.
- Use a single PostgreSQL primary initially; authoritative reads stay on primary.
  Database unavailability pauses mutations, never triggers memory-only acceptance.

## Failure behavior to preserve

| Failure | Correct behavior |
| --- | --- |
| Player or connection server disconnects | Reconnect anywhere; preserve membership/seat; resolve original command IDs |
| Owner crashes or pauses | Lease-based takeover, reconstruction, fencing of old owner |
| Gateway cannot reach a still-live owner | Retry/refresh routing; do not steal ownership |
| Crash before command commit | No successful receipt; retry against committed state |
| Crash after commit before response | Return original durable receipt |
| Crash before outbox publication | Retry publication from committed outbox |
| Duplicate publication | Deduplicate and reconcile by sequence/revision |
| Redis unavailable or notification missed | Database polling and client catch-up |
| PostgreSQL unavailable/commit outcome unknown | Pause mutations; resolve receipts after reconnection |
| Completion interrupted | Durable idempotent finalization resumes |
| Unsupported/corrupt recovery data | Quarantine rather than reset the game |
| Slow socket or overloaded scheduler | Bounded buffers/work and retryable backpressure |

## Implementation increments

Complete each increment with relevant correctness checks and a handoff note. The
user has authorized incremental implementation within this branch's scope.

Checked implementation items describe the isolated distributed integration path,
including its mounted client and executable multi-gateway/LB stack. They do not
mean production cutover is enabled or that capacity/native-device/provider release
gates have passed. Those gates are listed separately after the checklist.

- [x] 1. Schema migrations and transactional constraints.
- [x] 2. Durable table/game reconstruction and stable receipt recovery.
- [x] 3. Inbox, per-game ordering, and lane scheduler.
- [x] 4. Room ownership, fencing, routing, and takeover.
  - [x] C3a. Explicit server lifecycle, receiver assembly and socket presence.
  - [x] C3b. Isolated integration application lifespan/bootstrap and native route boundary.
  - [x] C3c. Reviewed shared account/profile/player routes, native platform reads and compatibility audit.
  - [x] C3d. Durable friendship commands and transactional notification intents.
  - [x] C3e. Existing-socket session revocation and expiry.
  - [x] C3f. Browser/provider sign-in composition.
  - [x] C3g. Durable manual settlement commands.
  - [x] C3h. Executable isolated bootstrap and persistent dataset guard.
  - [x] C3i. Shared personal phrases and expiring table/private pokes.
- [x] 5. Redis wake-ups, polling fallback, and shared presence (explicit components;
  assembled in the isolated integration runtime).
  - [x] 5a. Explicit authenticated wakeup/placement transport, adaptive inbox polling,
    reconnect rescans and isolated Redis failure tests.
  - [x] 5b. Shared per-connection presence and advisory owner cache, including
    reconnect restoration and stale-disconnect protection.
- [x] 6. Outbox, room chat, direct messages, and notification catch-up (explicit
  components; assembled in the isolated integration runtime).
  - [x] 6a. Bounded outbox claims/publication, authenticated delivery hints,
    authorized hosted-lane replay, gateway backpressure and per-client ACK cursors.
  - [x] 6b. Scoped chat/conversation/recipient execution, durable social history and
    catch-up authorization, including legacy unsequenced-message handling.
    - [x] 6b1. Room/table/game chat lanes, durable messages, owner execution,
      scope authorization, history/replay and deletion access rules.
    - [x] 6b2. Conversation/recipient execution, direct-message/notification history
      and permissions, including legacy unsequenced social records.
- [x] 7. Client pending-command handling and load-balancer integration.
  - [x] 7a. Explicit stable-request/pending-status client lifecycle and focused tests.
  - [x] 7b. Explicit stream discovery, delivery cursors and snapshot/history reconciliation
    adapters; mounted in the integration client under 7c/C3.
  - [x] 7c. Mounted control/session integration and load-balancer composition.
    - [x] 7c1. Explicit session owner, bounded subscriptions/reconnect dispatch,
      native history loader, revision view and device-storage identity helper.
    - [x] 7c2. Platform identity ownership and concrete mounted control/transport
      mappings; then LB/C3 composition.
      - [x] 7c2a. Account/device pending-command journal, pre-send persistence,
        receipt restoration and storage/crash failure tests.
      - [x] 7c2b. Explicit platform storage/session ownership and duplicate-owner
        exclusion; browser/native smoke validation remains a cutover gate.
      - [x] 7c2c. Explicit authenticated HTTP/WS and view/control mapping components.
        - [x] 7c2c1. Explicit command routes/client transport and socket-local
          delivery handshake, multiplexing and ACK ownership.
        - [x] 7c2c2. Explicit authorized views/history/discovery and control mappings.
      - [x] 7c2d. Authenticated root composition, selected-view reconnection and
        concrete screen-control parity; socket presence and live assembly under C3.
        - [x] 7c2d1. Explicit root/session/socket/view composition and parity audit.
        - [x] 7c2d2. Explicit screen-facing controllers, combined leave and initial room creation.
      - [x] 7c2e. Mounted integration client, platform panels, scoped chat and all three game screens.
  - [x] 7d. Isolated nginx/two-gateway composition and actual HTTP/WS proxy checks.
- [x] 8. Multi-process correctness integration tests and regression verification.

Increment 1 is split into reviewable schema changes:

- [x] 1a. Instance registry, room ownership, durable table catalog, atomic room table
  allocation limit, and optional legacy-compatible game/table relationship.
- [x] 1b. Durable table recovery state and command lane/inbox schema with constraints.
- [x] 1c. Checkpoints, scheduled actions, outbox, durable chat/catch-up, and finalization
  schema changes, reconciled with existing social and ledger data.

Increment 2 is split into:

- [x] 2a. Versioned trusted checkpoint capture/decode and table-state reconstruction.
- [x] 2b. Rebuild hosted engine adapters and command sessions with stable receipts;
  validate restored public/private views and continuation behavior.
- [x] 2c. Transactional checkpoint persistence/loading and receipt recovery against
  the database, including consistent table positions and reservation checks.

Increment 3 is split into:

- [x] 3a. PostgreSQL inbox enqueue/deduplication, transaction-scoped lane-head claims,
  status lookup, and atomic completion hooks.
- [x] 3b. Per-game lane scheduler and engine execution integration, including
  reauthorization, bounded work, failure handling, and fair lane progress.

Increment 4 will be split into:

- [x] 4a. Server registry and room lease acquire/renew/release/takeover primitives,
  with fencing, recovery/serving transitions, and transaction tests.
- [x] 4b. Room recovery/activation and owner routing integration, including the
  remaining table/controller command executors needed before live cutover.

Increment 4b is further split to keep the coordination and cutover changes reviewable:

- [x] 4b1. Explicit-start heartbeat/lease maintenance, retained acquisition intents,
  and local execution admission that closes on uncertain ownership.
- [x] 4b2. Consistent room recovery inventory and validation, including all tables,
  engine compatibility, reservations, scheduled actions, and finalization work.
- [x] 4b3. Recovery/activation orchestration, owner routing, and remaining
  table/controller executors. Live cutover also requires durable delivery below.

Increment 4b3 is split into:

- [x] 4b3a. Bounded recovery preparation, transient retries, classified failures,
  and exact-fence cleanup; no activation or automatic quarantine.
- [x] 4b3b. Durable table/controller execution and runtime-specific scheduled-work
  and finalization reconciliation needed to make recovery complete.
- [x] 4b3c. Final recovery/activation boundary, quarantine policy, owner routing,
  and coordinated shutdown, gated on the required executors and reconciliation.

Increment 4b3c is split into:

- [x] Explicit transactional activation validation and confirmed local admission.
- [x] Concrete execution/maintenance scheduling and readiness binding, with pending-work resumption.
- [x] Explicit durable ingress and owner wakeup routing, including unavailable-owner handling.
- [x] Bounded quarantine transitions and explicit epoch-guarded retry after repair.
- [x] Explicit coordinated shutdown/routing withdrawal and exact-fence release.
- [x] Bounded demand-driven owner selection/reacquisition.
- [x] Bounded durable placement-demand discovery and explicit dispatch adapters.
- [x] Live placement triggers/dispatch bindings (gated on transport and endpoint audit).
- [x] Endpoint capability audit and cutover dependency checks; see [cutover audit](distributed-runtime-cutover-audit.md).
- [x] C1 backend slice: active waitlists, settings/votes, invitations/replacement, atomic
  room creation and fenced lifecycle commands with reliable native envelopes.
- [x] C2 backend slice: authorized read-only table/catalog/member/invitation/ledger
  adapters, stable IDs/revisions and actor-scoped pending/terminal status.
- [x] Mount compatible HTTP/WS/client bindings for those adapters with C3/C6; no
  legacy/distributed dual writing or implicit generic/Echo conversion.

Increment 4b3b begins with:

- [x] 4b3b1. Durable pre-game lobby seat/queue/roster-lock commands.
- [x] 4b3b2. Durable room-lane creation with stable table/match identities.
- [x] 4b3b3. Durable initial game start and controller contracts/execution.
- [x] 4b3b4. Active-game departure/rematch and scheduled-work/finalization
  reconciliation.

Increment 4b3b4 is split into:

- [x] 4b3b4a. Explicit table end and Call Break abandonment, with atomic release.
- [x] 4b3b4b. Marriage/Flush fold-and-leave, engine receipts, and settlement intent.
- [x] 4b3b4c. Rematch/round identity, roster rotation, and scheduled-work/finalization
  reconciliation (split further before implementation as needed).

Increment 4b3b4c starts with:

- [x] 4b3b4c1. Ready-roster Call Break/Marriage rematches and completed-match archives.
- [x] 4b3b4c2. Flush round restart identity/checkpoint/receipt contracts and execution.
- [x] 4b3b4c3. Remaining roster rotation/offers and scheduled-work/finalization
  reconciliation (split into bounded increments before implementation).

Increment 4b3b4c3 is split into:

- [x] 4b3b4c3a. Between-round Flush seating/queue transitions and empty-table closure.
- [x] 4b3b4c3b. Completed Call Break/Marriage seat release and queue transitions,
  including replacement-vacancy metadata.
- [x] 4b3b4c3c. Replacement offers, durable timer execution, and finalization
  reconciliation.

Within 4b3b4c3c:

- [x] Replacement-offer commands, FIFO selection, and persisted expiry deadlines.
- [x] Fenced offer-expiry dispatch/execution and opt-in deadline recovery validation.
- [x] Durable manual Call Break review continuation and audit of remaining game timers
  (no automatic game timers exist in the current manual hosted flow).
- [x] Call Break/Marriage finalization resolution and atomic ledger projection.
- [x] Flush round finalization and explicit settlement recovery validation.

Tests should accompany each increment; increment 8 consolidates end-to-end coverage.
Required cases include simultaneous sixth-table attempts, competing starts,
independent games, ordered commands, duplicate requests, unknown commits, rematches,
terminal receipts, owner kill/pause/takeover, stale-owner rejection, Redis loss,
missed notification, timer recovery, settlement retry, and private-hand isolation.

## Deferred next task set

- Representative traffic mix, capacity/load testing, 1K sustained connections,
  2K burst behavior, and seeded 1.5M-account database testing.
- Validate proposed p95 command acknowledgment under 300 ms within the region and
  ordinary owner recovery within 45 seconds; neither is currently demonstrated.
- Validate surviving-instance capacity after one application server fails.
- Autoscaling thresholds, placement tuning, and automatic room rebalancing.
- Metrics, dashboards, tracing, alerts, and operational runbooks.
- Database HA/replica deployment, promotion/fencing policy, and replication durability.
- Backups, point-in-time restoration, and regional disaster-recovery drills.
- Retention/archival tuning and production rollout readiness.

Basic bounds, security, recovery logic, and correctness tests remain in the first
implementation; deferring operational work does not defer application correctness.

## Increment handoff

Implementation increments **1–8 are complete for the isolated integration path**.
The production defaults remain legacy. Final work includes executable two-gateway
composition, real nginx HTTP/WS, mounted native-protocol game/platform controls,
manual settlements, shared phrases, expiring pokes and independent-process recovery.

Verification: broad Python run had 1526 passes and 13 optional skips; its nine old
migration-stub failures were corrected. All 65 affected/new targeted checks passed,
and the final marker-cleanup change also passed the nine migration checks. All 236
client tests, TypeScript, integration web build, iOS export and mounted Chromium
smoke (including all three game projections) passed. Ten real-Redis tests passed.
Three real PostgreSQL/Redis/nginx process cases passed together; strengthened game
continuation after pause/resume/kill and a fourth database stop/restart case also passed.
No application database or deployed service was changed.

Next task set: production cutover validation and the already deferred operational
readiness work. This includes native-device journal/lock checks, real provider callback
smoke, container execution and a reviewed existing-data migration/legacy credential
exclusion procedure. The isolated initializer intentionally refuses existing datasets.
No further routine increment approval is needed; production activation remains gated.

### Release gates outside the completed isolated implementation

- [ ] Verify native device SecureStore persistence and single-owner behavior, including restart/storage failure.
- [ ] Validate configured real provider callbacks through the deployed origin/proxy.
- [ ] Execute container composition and check full product navigation/visual parity before replacement of production UI.
- [ ] Review existing-data migration, stop old writers and revoke their database access; the current marker cannot fence old binaries.
- [ ] Complete the separately deferred capacity/observability/HA/operations task set.

### Increment 1a record

Changes:

- Added `server_instances`, `room_ownership`, and `room_tables` with lookup indexes,
  ownership-shape checks, immutable table identity, and lifecycle constraints.
- Added configurable `rooms.max_open_tables` (default 5) and database-maintained
  `open_table_count`. AFTER triggers atomically update the counter on actual table
  inserts, closes, reopens, and deletions. The room check constraint rejects excess
  allocation and reductions below the current count. Counter changes roll back
  with the mutation; conflicting inserts do not consume capacity.
- This refines the planned lock/count implementation: atomic counter updates avoid
  stale-count races across transactions without putting room locks on gameplay.
  Application code must not write the allocation counter directly. The limit only
  covers the new durable catalog until table creation is wired into it.
- Added nullable `games.table_id`, a composite FK to prevent cross-room association,
  a partial unique active-game-per-table index, and a table history index. Legacy
  games retain NULL; no table identity is guessed or backfilled.
- Added persistent branch-scope instructions in `AGENTS.md`.

Verification:

- `.venv/bin/python -m pytest -q`: 854 passed, two dependency deprecation warnings.
- `PGLITE_MODULE=/private/tmp/bhidne-schema-tests/node_modules/@electric-sql/pglite
  node tests/distributed-schema.cjs`: passed empty-schema and existing-data upgrade
  checks, capacity, closure/reopening/deletion, conflict insertion, rollback,
  configurable limit, rematches, cross-room rejection, and ownership constraints.
- PGlite was installed in a temporary directory only; project dependencies were
  not changed. The script accepts any installed PGlite path via `PGLITE_MODULE`.
- Migration-ledger tests cover upgrades from versions 11 and 12 and execute pending
  migrations only once. `git diff --check` passed.

Limitations:

- No hosted runtime, API, or Redis behavior has been switched. These tables are
  foundations, not functioning distributed ownership or table recovery yet.
- SQL was executed in embedded PostgreSQL/WASM, not against a deployed database.
  True concurrent multi-connection allocation and takeover tests remain required
  when the persistence/runtime paths are introduced.
- No application database was modified manually. Migration 13 will run through the
  existing migration runner on the next database-backed application startup.

### Increment 1b record

Changes:

- Migration 14 adds `table_recovery_state`: version, table revision, lobby/match ID,
  phase, capacity, and a JSON object for the remaining host recovery data. Waiting
  lobby IDs need not reference a started durable game.
- Adds `table_positions` with one row per table/user, exactly one seat or FIFO queue
  position, and unique table/seat and table/queue-position constraints. Multiple
  distinct queued users and seated users can coexist; the same user cannot be both
  queued and seated in one table.
- The versioned JSON document will hold historical roster mappings, departures,
  seat releases/offers with absolute expiry, rule proposals/votes, invitations, and
  table event history. Current seats/queue live in `table_positions`, not a second
  copy in the JSON document. This refines the proposed separately normalized
  offer/vote storage: recovery initially reads a whole table checkpoint, while SQL
  uniqueness is reserved for current positions. No per-offer query API is required
  yet. Codec validation and host reconstruction belong to increment 2.
- Existing `active_table_players` remains the authority for cross-table seat
  reservations. The future table store must write recovery state, positions,
  reservations, and the table revision together. Revision/capacity/phase agreement
  and JSON content validation are store/codec responsibilities, not yet implemented.
- Adds `command_lanes` for room, table, game, room chat, canonical two-user
  conversation, and recipient targets. Partial unique indexes permit one lane per
  target/type. Composite foreign keys prevent assigning a game lane to the wrong
  table or room. Targets are immutable across retries and rematches.
- Adds monotonic enqueued/processed lane cursors, an index of lanes with pending
  work, and a pending-command index ordered by lane/sequence.
- Adds `command_inbox` with original versioned request, actor-scoped command ID,
  expected revision, fingerprint, and pending/accepted/rejected result. Sequences
  and actor/request IDs are unique within a lane. Game requests must name their
  lane's game and supply an expected revision. Trusted internal actor IDs are
  supported; ingress must authenticate player identity and isolate system actors.
- Request identity/content cannot change after insertion. Final outcomes cannot
  be rewritten or reset to pending. Generic outcomes hold durable acknowledgment
  data, not private current snapshots. Game execution will still write the existing
  `game_commands` receipt in the same transaction; that integration is pending.
- The schema supports atomic allocation by updating a lane cursor and inserting
  its command within one transaction. The future store must deduplicate first,
  compare original fingerprints, never skip a lane's head, and advance its processed
  cursor with the outcome. The schema alone does not enforce gap-free allocation
  or head-only execution against arbitrary SQL writers.

Verification:

- `.venv/bin/python -m pytest -q`: 855 passed, two dependency deprecation warnings.
- The embedded PostgreSQL suite now applies migration 14 after the migration-13
  fixtures in both installation/upgrade cases. Checks cover recovery-document
  preservation, exclusive seat/queue positions, transaction rollback, all lane
  target types, target uniqueness and room/table integrity, independent game
  sequences, duplicate-ID rollback, immutable requests and final results, cursor
  regression rejection, pending queries, and rematch/terminal-outcome isolation.
- Run with `PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/distributed-schema.cjs`.
  New checks are in `tests/distributed-inbox-schema.cjs`, called by that runner.
- Migration-ledger tests now cover already-applied versions 11, 12, and 13.
- `git diff --check` passed.

Limitations:

- No runtime, API, client, or Redis behavior changed. Enqueue/execution, table
  persistence, receipt integration, and failover are not enabled by this migration.
- Recovery documents are stored and type-checked as JSON objects, but their full
  versioned codec has not been implemented. SQL round-trip checks are not a proof
  that a hosted engine can yet reconstruct itself.
- These SQL tests use embedded PostgreSQL/WASM. Live multi-connection concurrency
  and process-failure tests remain required with the transactional store/runtime.
- No application database was modified manually; migration 14 runs on the next
  database-backed startup through the existing migration runner.

### Increment 1c record

Changes:

- Added migration 15 through `app/distributed_schema.py`, imported by the existing
  migration registry. Earlier migration SQL remains unchanged.
- Added immutable versioned `game_snapshots`, keyed by game/event sequence, with
  revision, engine/event/snapshot versions, state and SHA-256 digest field. Insertion
  rejects sequence/revision beyond committed game metadata and mismatched stored
  engine/event versions. The primary key supports newest-checkpoint lookup.
- Added `scheduled_actions` with absolute deadlines, stable command IDs, generation
  uniqueness, pending/enqueued/cancelled states, and a pending-deadline index.
  Timers target existing lanes (including table lanes for pre-game offers).
  Enqueued timers must reference an inbox command with actor `system:timer` and the
  identical command ID/body, match, and expected revision. Dispatch and inbox insert
  can roll back together. Deadlines/content are immutable; rescheduling creates a
  new generation and cancels the obsolete timer.
- Added an independent monotonic `command_lanes.emitted_sequence`: command order
  cannot double as output order because one command can emit multiple events.
- Added `notification_outbox` with event identity/version, lane event sequence,
  optional private user audience, immutable content, retry time/count, expiring
  claim token, and publication timestamp. Pending publication has a partial index.
  Published rows cannot be reopened. A NULL audience means the lane's authorized
  audience, never everyone on the platform. Conversation/recipient targets are
  checked for consistency; room/game authorization remains a runtime responsibility.
- Added `delivery_cursors` keyed by user/client/lane, independent from read status
  and publication. Cursors cannot move backwards or exceed allocated emitted
  sequence. Conversation/recipient lanes reject another user's cursor. The delivery
  layer must authenticate clients and check room/game access before reads or writes.
- Added immutable `room_chat_messages` with room/sender/request deduplication,
  ordered stream identity, and room/sequence history lookup. This enables the
  already-agreed future durable chat behavior; today's chat service remains ephemeral.
- Extended existing `direct_messages` with nullable all-or-none lane/sequence/request
  metadata and partial unique indexes. New sequenced rows must match their canonical
  conversation participants and cannot be rewritten. Old rows and inserts remain valid.
- Extended existing `friend_notifications` rather than adding a second notification
  history. It now permits general notification kinds, optional system actors, an
  object payload, and nullable all-or-none stream/deduplication metadata. Sequenced
  rows must match their recipient lane and are immutable except `read_at`. The
  current friend APIs still produce the original kinds; general notification API
  support, including actor-less reads, belongs to increment 6.
- Added immutable-content `game_finalization_jobs` with retry metadata and unique
  game/round/job-type identity. Round zero denotes match completion. Existing
  `completed_games` and ledger tables remain the result/effect authorities; payloads
  carry stable effect IDs. Completed jobs cannot be reopened or rewritten.
- Message history deliberately has no FK to disposable outbox rows. Publishing or
  eventually pruning an outbox record must not erase history or claim client receipt.

Verification:

- `.venv/bin/python -m pytest -q`: 856 passed, two dependency deprecation warnings.
- `PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/distributed-schema.cjs`
  passed both installation and existing-data upgrade paths through migration 15.
  New checks in `tests/distributed-delivery-schema.cjs` cover preserved legacy social
  rows/inserts, checkpoint bounds/immutability, timer identity and dispatch rollback,
  outbox allocation rollback and retry/publication states, independent device cursors,
  message deduplication/catch-up, wrong private targets, and finalization retries.
- Migration-ledger tests cover already-applied versions 11–14 and one-time upgrades.
- `git diff --check` passed. No project dependencies were added.

Limitations and next-store contracts:

- No new worker, API, client, Redis path, or hosted runtime behavior is enabled.
  Schema support alone does not provide queue processing, failover, or durable chat.
- Snapshot digest format is checked, but calculating/verifying the digest and proving
  state corresponds to a particular journal prefix require the recovery codec/store.
- Allocate emitted sequences and write state/message/outbox changes in one transaction.
  Publish only authorized projections/IDs, never raw canonical hands. Multiple output
  rows from a command need distinct event sequences, including private projections.
- Future outbox workers must acquire/renew claims and mark publication with their
  claim token; claim columns alone do not implement that compare-and-set protocol.
  Catch-up must handle missed Pub/Sub delivery even for already-published rows.
- Future finalization workers must lock/claim jobs and commit idempotent ledger
  effects with job completion. No external side effect should be assumed exactly once.
- Legacy messages have NULL stream metadata. Define their catch-up cutover/backfill
  in increment 6; do not silently present them as already-sequenced messages.
- Per-device cursor acknowledgments do not authorize access. Recheck membership,
  conversation permissions, and private audiences when serving catch-up.
- Tests use embedded PostgreSQL/WASM; live multi-connection/process-failure checks
  remain required with the stores/runtime. No application database was manually
  changed; migration 15 runs on the next database-backed startup.

### Increment 2a record

Changes:

- Added `app/durable_games/checkpoints.py`, a pure trusted-only codec. Callers capture
  under the existing game lock; the module performs no I/O, registration, timer
  scheduling, ownership acquisition, or player delivery.
- Schema version 1 captures room/table/match identity, explicit table revision,
  positions, phase, historical roster, departures, rule configuration/proposals,
  offers with absolute timestamps, invitations supplied by the caller, event history,
  private query state, and a separately described engine checkpoint.
- Current seats and queue positions have one normalized representation. Replacement
  roster length preserves holes; an ended table retains its historical replacement
  roster without claiming those seats as current positions.
- Engine checkpoints preserve typed Call Break, Marriage, and Flush state. Marriage
  history carries explicit allow-listed event type names to avoid ambiguity between
  structurally similar events. No executable names are imported from stored data.
- Decoding checks strict envelope shape/version, canonical SHA-256 digest, field
  round-trip fidelity, engine revision/roster, rule reconstruction, table positions,
  offer identity/deadlines, and contiguous table events. Reuses Call Break's match
  audit and Marriage/Flush domain invariant validators.
- `restore_table_state` reconstructs detached table mechanics, including offers,
  queue ordering, release slots, and published event sequence. It does not expire
  offers or mutate the original host state.
- Flush historical seat IDs are intentionally not capped by table capacity: player
  replacements allocate new stable IDs. Occupied-seat count remains bounded. A
  finished Flush round can preserve its engine roster while the open table's users
  form the next roster; the complete historical seat map is retained.
- Locks, tasks, ownership tokens, receipt caches, local ledger retry timestamps, and
  derived reservation flags are excluded. Those must be rebuilt from the new owner
  and authoritative stores, not copied from an old process. A non-NULL legacy host
  deadline is rejected until translated to an absolute scheduled action.

Verification:

- Full backend suite: 875 passed, two dependency deprecation warnings.
- `tests/test_hosted_checkpoints.py`: 19 passed, also rerun after the last malformed
  checkpoint error-normalization adjustment.
- Covers waiting and active games (including four/five-player Call Break), private
  view equivalence, detached mutable data, Marriage terminal event types, Flush
  sparse seat IDs/next-roster formation, lobby offers/votes/invitations, retired
  seat state, digest corruption, unsupported versions, duplicate/invalid positions,
  malformed revisions/rosters, and unconverted process deadlines.
- `git diff --check` passed. No schema migration or dependency changes in 2a.

Limitations:

- This returns validated domain state and table mechanics, not a registered or
  serving `HostedGame`. Engine facade/adapter rebuilding and receipts are next.
- The codec is a trusted recovery envelope, not a client DTO. It includes hidden
  cards and private query data and must never be broadcast or logged wholesale.
- The envelope digest covers combined checkpoint data. The SQL store must split
  normalized table positions/metadata and game snapshot state correctly and compute
  the game snapshot's own canonical state digest; do not reuse the envelope digest
  as the SQL engine-state digest.
- Nested proposal/invitation/query payloads preserve JSON facts; their full lifecycle
  cross-checks and consistency with database membership/reservations belong to the
  transactional restore path. Domain audits are not proof of journal provenance.
- No database save/load, receipt restoration, timer worker, or automatic takeover is
  enabled. Receipt safety must be established before a reconstructed game can serve.

### Increment 2b record

Changes:

- Added `app/durable_games/recovery.py` to rebuild detached hosted games from a
  validated checkpoint and an explicit, complete receipt view. Reconstruction
  allocates fresh locks and adapters without registering games, acquiring leases,
  starting timers, broadcasting, or restoring process-local reservation flags.
- Added validated `from_state` constructors for Marriage and Flush. They copy
  committed state without starting, dealing, or replaying startup events. Future
  randomness uses a fresh generator; committed cards and history remain unchanged.
- Restored accepted and rejected command outcomes with their original-request
  fingerprints, actor/command identity, receipt count, and capacity limit. Reject
  inconsistent match/revision, truncated views, mismatched fingerprints, duplicate
  identities, and malformed outcomes before activation. Live execution and recovery
  share the same request fingerprint function.
- Added a trusted receipt lookup helper for terminal games, returning only a copied
  acknowledgment. A future endpoint must authenticate the actor and authorize access.
- Preserved Flush's finished-round player mapping while replacement players form
  the next roster. Re-capture verifies the rebuilt host reproduces its checkpoint.
- Fixed Call Break authorization to recognize any registered table in the room,
  rather than only the room's default game. Other game targets already do this.

Verification:

- Focused checkpoint/recovery/shared-command tests: 52 passed.
- Full backend suite: 895 passed, two dependency deprecation warnings.
- `git diff --check` passed.
- Recovery coverage includes all three games' public/private/spectator views,
  continuation, accepted/rejected retries, conflicting IDs, detached resources,
  waiting lobbies, malformed receipt views, full receipt capacity, terminal status
  lookup, sparse Flush roster replacement, and independent Call Break tables.
- No schema migration or dependency changes in 2b.

Limitations and next-store contracts:

- No database save/load, automatic startup recovery, takeover, or public status
  endpoint is enabled. Reconstruction remains off-registry until fenced ownership,
  membership, reservations, and scheduled work can be established transactionally.
- Receipt tests supply a simulated authoritative view. The database loader must
  read checkpoint, receipt rows, and their count from one consistent committed view;
  validation alone cannot prove rows originated from that view.
- The legacy hosted durable-store path still includes calculated authoritative
  state in its command payload/fingerprint. Increment 2c must reconcile this with
  original-request identity and persist rejected outcomes as well as accepted ones;
  existing database receipts are not yet wired into this recovery contract.
- The trusted checkpoint includes hidden game data and must not be exposed to
  clients. Authorization and projection checks remain required at activation/delivery.

### Increment 2c record

Changes:

- Added `app/durable_games/checkpoint_store.py`. It atomically creates/updates table
  recovery metadata, normalized positions, seat reservations, game journal events,
  engine snapshots, accepted/rejected receipts, and table/game lifecycle status.
  Its new path remains disconnected from live routing.
- Writes require a serving room lease with matching instance, epoch, and token.
  A shared ownership-row lock fences takeover while allowing independent tables
  to proceed; an exclusive table-row lock and expected table revision serialize
  each table. Recheck wall-clock lease expiry before returning from a write.
  Lease acquisition/renewal, startup activation, and takeover workers remain in 4.
- `save_in_transaction` requires an open transaction and lets the future executor
  include inbox completion and outbox writes in the same commit. `save` provides a
  standalone transaction for bootstrap/table persistence. Neither sends messages.
- Current positions live only in SQL position rows; engine checkpoints live in
  `game_snapshots`. Table documents retain the remaining metadata and envelope
  digest. Position ordering is canonicalized before capture. Each engine snapshot
  has its own digest, distinct from the combined checkpoint digest.
- Loads use a repeatable-read, read-only transaction for checkpoint metadata,
  engine state, receipt count/rows, membership, and reservations. Validate snapshot
  versions/digests against the contiguous committed checkpoint journal and current
  game boundary; refuse missing, inconsistent, or incompatible records.
- Reservation changes check canonical durable user IDs and room membership, lock
  users in stable order, and reject cross-table/game conflicts. Initial saves are
  revision zero; subsequent saves advance the table revision once. Started engine
  changes require an original command/outcome, and rejected commands cannot change
  engine state. Closed tables cannot be reopened through this API.
- Receipt retries resolve before revision checks and return the committed checkpoint
  without rewriting it. The caller must use that result before any delivery. Receipt
  limits, fingerprints, counts, and acknowledgment revisions survive reload. Old
  match receipts remain queryable after rematches; Flush round game IDs can change
  while retaining the hosted match's receipts.
- Migration 16 adds nullable `game_commands.original_request` and prevents receipt
  mutation. Existing rows remain NULL rather than guessing their original requests.
  New checkpoint storage refuses implicit import of existing/legacy game journals.
- The existing hosted durable path now records original-request fingerprints and
  requests separately from computed state, and durably records engine rejections
  before caching/delivery. Failed outcome commits restore in-memory state. Unknown
  commit retries that disagree with committed state fail closed and require reload,
  preventing publication of rerolled speculative cards. Generic durable games keep
  their existing fingerprint contract when no original request is supplied.

Verification:

- Full backend suite with PostgreSQL/WASM integration enabled: 911 passed, two
  dependency deprecation warnings. An additional Flush round-rollover test was
  added and passed separately afterward (912 passing tests in total).
- The integration harness executes the production Python stores' SQL against
  PostgreSQL/WASM, including transactions and constraints; it does not mock SQL
  outcomes. Run with `PGLITE_MODULE=/path/to/@electric-sql/pglite
  .venv/bin/python -m pytest -q tests/test_checkpoint_store.py`.
- Covers all three engines, detached reconstruction, accepted/rejected retries,
  request conflicts, independent tables, capacity rollback, waiting-to-started and
  rematch transitions, terminal lookup, membership/reservation mismatches, corrupt
  journal/receipt/position views, stale fences, lease expiry during a write, and
  full rollback when failure occurs after writes but before commit.
- Schema checks passed for fresh installations and existing-data upgrades through
  migration 16, including preserving legacy receipts and rejecting mutation.
- `git diff --check` passed.
- No project dependencies were added and no application database was manually
  modified. Migration 16 runs through the normal next database-backed startup.

Limitations and integration contracts:

- Tests execute embedded PostgreSQL, not multiple live database sessions/processes.
  Real competing writers, membership changes, owner pause/kill/takeover, and
  transport failure tests remain required in the distributed integration increment.
- No automatic registration, startup reload, room ownership worker, Redis path,
  timer dispatch, inbox execution, or outbox publication is enabled here. Explicit
  test fixtures supply serving leases; production must finish increment 4 first.
- Reconstructed invitations/offers retain their recorded facts; lifecycle workers
  must reconcile expiry, membership, and scheduled work under the acquired owner
  before activating a room. A codec/digest is not proof of a valid client command;
  the future executor must reauthorize and validate through the engine.
- Existing pre-migration receipts cannot be silently restored as original requests.
  Legacy hosted tables/journals are not automatically converted to the new format;
  define an explicit drain/cutover policy before activation. The live legacy path's
  per-game ownership model remains separate from the new room-fenced store.
- Legacy and distributed runtimes must not concurrently host the same room/users
  during cutover. New storage reserves seats even in waiting tables; legacy mixed
  writes do not yet share the new reservation locking protocol.
- Unknown-commit mismatch in the legacy live path now stops speculative delivery;
  automatic reload/continuation requires the later activation path. A trusted
  historical receipt lookup is available, but no authenticated status API is added.
- Current recovery reads the full checkpoint journal/receipt history for validation.
  Snapshot compaction, retention, and performance validation remain later work.

### Increment 3a record

Changes:

- Added `app/durable_games/inbox.py` with strict lane targets for room, table, game,
  room chat, conversation, and recipient lanes. Lane creation is idempotent by its
  immutable target; conversations require canonically ordered users.
- Enqueue locks the target lane, checks actor/request identity before allocation,
  and inserts the original request with its next sequence in one transaction.
  Failed inserts roll back allocation, so no sequence is consumed. Defaults bound
  each lane to 1,000 pending commands and each request to 64 KiB. Duplicates still
  resolve when the pending limit is reached.
- Added actor-scoped pending/terminal status lookup and bounded pending-lane queries.
  These are trusted store APIs, not authenticated public endpoints. Ingress must
  derive actor identity from credentials and authorize the requested target.
- Claims take a shared serving-room fence lock, then a lane row lock with
  `FOR UPDATE SKIP LOCKED`, and select exactly `processed_sequence + 1`. Missing,
  unsupported, or unexpectedly terminal heads fail closed rather than skipping.
  Conversation/recipient lanes use the transaction lock without room ownership.
- A claim stays inside one database transaction. Its connection is available for
  checkpoint, receipt, message, and future outbox writes. Completion records the
  final acknowledgment and advances the processed cursor atomically. Exiting a
  claimed context without completion, an exception/cancellation, or an expired
  final fence check rolls back all composed effects. Claims cannot be reused after
  context exit or completed twice. No network delivery belongs inside a claim.
- Game completion requires an identical original-request fingerprint, request body,
  actor/command identity, status, revision, and detail in `game_commands`, written
  by the checkpoint/receipt transaction. Generic outcomes are also restricted to
  acknowledgments, avoiding private snapshot payloads in command status responses.
- Migration 17 adds immutable `command_inbox.original_request` and an optional
  `dedup_match_id` with a unique hosted-match/actor/command index. Legacy rows retain
  NULL values and are not guessed into the new contract. Migration ledger tests now
  cover already-applied versions 11–16.
- Explicit identity refinement: a game inbox row's existing SQL `match_id` remains
  its durable game/round routing ID, as required by the lane constraint. The exact
  player-visible hosted match ID remains in `original_request`; `dedup_match_id`
  scopes retries across Flush round lanes. This preserves existing request bytes
  and receipt fingerprints even when a new round has a different durable game ID.
- A retry routed to a later round resolves the earlier inbox entry and returns its
  original lane/sequence/outcome without allocating work on the new lane. A fresh
  request to a no-longer-current round is rejected at ingress. Executors must still
  recheck lifecycle and permissions because they can change after enqueue.

Verification:

- Focused PostgreSQL/WASM inbox integration suite: 12 passed. It executes production
  store SQL, including rollback, real constraints, and atomic checkpoint composition.
- Covers all lane kinds, target idempotency, actor isolation, pending capacity,
  request-size limits, conflicting IDs, terminal retries, gap-free allocation,
  missing/legacy heads, incomplete claims, rollback after completion, stale/expired
  fences, all three games' accepted/rejected receipts, and Flush round rollover.
- Full backend suite with PostgreSQL/WASM integration enabled: 925 passed, two
  dependency deprecation warnings.
- Fresh installation and existing-data upgrade schema checks passed through
  migration 17. `git diff --check` passed. No project dependencies were added;
  migration 17 runs through the next normal database-backed startup.

Limitations and next-step contracts:

- No worker, HTTP/WebSocket ingress change, Redis wake-up, scheduler, or distributed
  runtime activation is enabled. The store's claims are database transaction locks,
  not persisted processing leases; a disconnected/aborted transaction leaves the
  head pending. Lost commit responses resolve via stable request lookup/deduplication.
- Do not retain speculative engine mutations after rollback or publish before the
  claim context successfully commits. The scheduler must restore/reload state on
  errors and handle uncertain commits before executing more commands.
- `enqueue_in_transaction` composes with future timer dispatch. Its caller must
  roll back/retry the whole transaction on a unique-key race; standalone `enqueue`
  retries once to resolve a hosted request racing across two round lanes.
- Claim completion proves that the matching game receipt exists; it does not
  perform domain validation, authorize the player, or synthesize game effects.
  Non-game effects/message/outbox writes must be composed by their future executor.
- Embedded PostgreSQL tests do not prove multi-connection lock contention, competing
  claimers, simultaneous rollover ingress, or process-kill behavior. Live-session
  concurrency checks remain in increment 8. Old pending rows without original
  requests require an explicit cutover policy before enabling a scheduler.

### Increment 3b record

Changes:

- Added `app/durable_games/executor.py`. A game command claims the next inbox head,
  locks its table, loads validated committed checkpoint/receipts, and reconstructs
  a detached host for that attempt. It never registers with the serving host or
  calls socket delivery, timer scheduling, or ledger APIs.
- Execution rechecks durable room membership, current match/round lifecycle,
  participant seating/departure, expected revision, and the existing game's command
  and payload validators. No-effect failures become durable rejected receipts and
  advance the inbox in order. Corrupt state and infrastructure failures instead
  leave the head pending; they are not mislabeled as player-command rejections.
- All three games reuse their existing synchronous engine/adapter hooks. Call Break
  uses the application's default round-review setting (8), configurable explicitly
  for matching owner configuration. Domain events retain adapter public/private
  routing. Completed games synchronize table phase; finished Flush rounds release
  pending departures and reopen the table without changing the historical engine.
- Added transaction-bound checkpoint loading and rejection recording. A request
  queued before a game ended or was replaced can receive a durable rejection
  without mutating the new game. Rejection-only writes update receipt-count metadata
  when appropriate, leaving engine/checkpoint facts and table revision unchanged.
- Accepted commands atomically save the checkpoint/receipt, advance the inbox,
  allocate ordered outbox events, and record settlement work when a match/round
  finishes. Rejections write only their receipt, inbox completion, and private ack.
  The outbox contains adapter projections, table events, and a public state-change
  reference; it never receives the trusted canonical checkpoint or a shared private
  snapshot. State-change references require authorized snapshot fetch on delivery.
- Table `published_sequence` in this path means handed to the durable outbox; it
  does not assert delivery to any socket. Outbox publishing and catch-up workers
  remain in increment 6. Settlement jobs use `hosted_settlement`, the durable game
  ID, and Flush round number (zero for a whole match); payload references identify
  the committed checkpoint for the future idempotent ledger worker.
- Enqueue now reserves match receipt capacity against committed receipts plus
  pending hosted-match commands under the table lock. This prevents an admitted
  command from becoming impossible to receipt after earlier commands consume the
  limit. Manually over-admitted/legacy queues still fail closed at the limit.
- Added `app/durable_games/scheduler.py` with explicit start/stop, fixed worker count,
  bounded tracked lanes, one command per turn, tail requeue for fair progress,
  coalesced hints, cooperative per-command timeout, and bounded exponential retries.
  Delayed retries use timer handles rather than occupying a worker. Different lanes
  can progress concurrently; the same lane is never offered to two local workers
  concurrently, and database claims provide the cross-process boundary.
- Stale fences and permanent failures stop that local lane attempt; transient DB
  failures/timeouts retry from committed state. Diagnostics retain bounded lane IDs
  and exception types, never raw private data. Shutdown cancels workers/retry timers
  and leaves unfinished durable commands discoverable. A newer fence supplied while
  an older attempt is active is checked by a fresh transaction.
- Pending-lane discovery supports kind filtering and a UUID pagination cursor, so
  a future owner poller can scan bounded pages and wrap without repeatedly selecting
  only the first hot lanes. `offer=False` means backpressure/stopped, not permission
  to drop a PostgreSQL command.

Verification:

- Focused executor/scheduler/inbox suites: 35 passed. SQL integration runs the
  production stores/executor against PostgreSQL/WASM; scheduler orchestration tests
  separately exercise overlap, fairness, backpressure, retries, and cancellation.
- Covers all three engines, public/private event addressing, stale revisions,
  spectators, membership revoked after enqueue, malformed game payloads, unsupported
  system actors, terminal/superseded commands, receipt admission, cancellation,
  rollback after effects, and a successful commit whose response is lost.
- A combined scheduler/store test drains independent game lanes, and a Flush chain
  continues from successive DB reloads through round completion with one settlement
  job. Tests verify source live hosts remain unchanged and no offer tasks start.
- Full backend suite with PostgreSQL/WASM enabled: 948 passed, two dependency
  deprecation warnings. The 8 scheduler tests also passed after the final explicit
  cooperative-yield adjustment. `git diff --check` passed.

Limitations and activation requirements:

- This increment has no schema migration, dependency addition, or application
  startup/HTTP/WebSocket wiring. No Redis, outbox publisher, settlement worker,
  actual room lease lifecycle, or automatic failover is activated.
- Every attempt reconstructs from storage to prioritize correctness. Caching or
  snapshot/journal compaction requires equivalent rollback/fencing guarantees and
  belongs to later performance work. Cooperative timeout cannot preempt synchronous
  Python engine computation; transaction/engine latency still needs load testing.
- Only player gameplay commands execute here. Room/table lifecycle, Call Break
  next-deal/controller commands, trusted timers, offers/expiry, and non-game lanes
  require their own executors before live activation. System actors currently get
  a stable unsupported-player rejection, not an impersonated player action.
- Existing malformed recovery data, inconsistent membership/positions, or corrupt
  heads require owner recovery/quarantine handling in 4; the scheduler never skips
  them. Exhausted retries/permanent failures remain durable pending work with a
  bounded local failure record. The owner/poller must decide resumption/quarantine.
- A successful or uncertain commit never installs speculative in-memory state.
  Subsequent attempts reload and inspect the inbox, so accepted random outcomes and
  outbox records are not rerolled/re-emitted. Integration must publish only from
  committed outbox records and keep legacy/distributed hosting isolated at cutover.
- Actual PostgreSQL multi-session contention, server/process kill, and simultaneous
  owner takeover still require live integration tests. The test SQL bridge serializes
  database access; scheduler overlap tests are not proof of live database contention.

### Increment 4a record

Changes:

- Added `app/durable_games/ownership.py` with explicit server registration,
  heartbeats, one-way instance draining, room acquisition/renewal/release, runtime
  transitions, and read-only inspection/routing hints. It starts no background work.
- Registrations identify a single process boot using a fresh instance ID and random
  boot credential. Only its hash is stored. A repeated registration must match the
  credential and original address/capabilities; it cannot replace another boot,
  refresh a heartbeat implicitly, or undo draining. Normal restarts use new IDs.
- Migration 18 adds nullable, 32-byte `registration_token_hash` and protects boot
  identity/configuration from updates while allowing heartbeat/draining updates.
  Legacy rows retain NULL credentials and cannot be adopted by a new registration.
- Room acquisition requires a fresh, non-draining registered instance. It locks
  the room and checks the caller's observed epoch. A free/expired room receives a
  new epoch/token and enters `recovering`; a live lease is never stolen based on a
  stale heartbeat. Quarantined rooms are excluded from automatic acquisition.
- Acquisition takes a caller-retained random token and expected epoch. If its commit
  response is lost, the same inputs recover the committed, still-live lease without
  incrementing epoch, extending expiry, or resetting state. A delayed acquire cannot
  reclaim a room after release. An expired retry requires a new acquisition intent.
- Renewal checks the exact owner/epoch/token and DB-clock expiry. It cannot revive
  an expired/released lease or shorten expiry. A draining instance can renew existing
  leases for shutdown but cannot acquire/activate rooms. Explicit release clears
  ownership while retaining the epoch; a repeated release is a no-op acknowledgment.
- Runtime transitions are explicit: `recovering -> serving`, `recovering/serving ->
  draining`, and an owned state to `quarantined`. Same-state retries are idempotent;
  draining/quarantined rooms cannot be reactivated by a delayed activation call.
  All transitions require a live matching fence. Release/reacquire is required for
  another recovery attempt after an intentional stop.
- The trusted `activate` primitive does not claim to perform recovery. Increment 4b
  must verify every required checkpoint, reservation, capability, and scheduled
  action before calling it. Only `serving` leases pass gameplay write fencing.
- Moved `RoomWriteFence` and shared write validation into the ownership module;
  existing imports through `checkpoint_store` remain compatible. Secrets are omitted
  from credential/fence representations and from routing metadata. Shared room locks
  allow concurrent game transactions while exclusive ownership updates fence them.
- DB wall-clock expiry is checked after row-lock acquisition, avoiding a validity
  projection computed before a lock wait. Renewal/transitions/release also predicate
  their final SQL update on wall-clock lease validity. No client/process clock
  participates in ownership decisions.
- Routing hints include only a serving, unexpired, fresh, non-draining destination;
  they contain no credential or hash. They are advisory reads: receivers/workers
  still require authoritative fencing, and missing hints do not authorize takeover.

Verification:

- Initial focused ownership SQL suite: 12 passed. A further clock-order test checks
  rejection when a simulated lock wait consumes the remaining lease time.
- Covers boot retry/credential isolation, immutable metadata, heartbeat/draining,
  explicit activation, renewal, release retry, expiry takeover, old-owner write and
  transition rejection, quarantine, lost acquisition responses, rollback before
  commit, and integration with existing checkpoint writes.
- Fresh installation and existing-data upgrade schema checks passed through
  migration 18, including preserved legacy registrations, rejected configuration
  mutation, and allowed heartbeat/draining updates. Upgrade ledger coverage now
  includes already-applied versions 11–17.
- Full backend regression suite: 962 passed, with two dependency deprecation
  warnings. `git diff --check` passed.

Limitations and next-step contracts:

- No heartbeat loop, automatic placement/takeover, room recovery coordinator,
  public/internal routing endpoint, or application startup activation is installed.
  The store APIs are trusted internal primitives, not proof of complete recovery.
- The coordinator must retain boot and acquisition secrets across unknown responses,
  use new boot identities after restart, schedule timely heartbeat/renewal, stop
  serving on fence loss, and check runtime/schema compatibility before activation.
- Expired quarantine remains quarantined. Explicit repair/release while the owner
  lease is live is supported; operator-authorized repair/reset after that lease has
  expired needs a separate recovery path. No automatic process clears corruption.
- Draining a server removes it from new acquisition/routing eligibility but does not
  forcibly revoke room leases or drain every scheduler. The coordinator must stop
  admission, transition/drain rooms, resolve in-flight work, then release leases.
- Row locks can delay takeover beyond lease expiry when an old transaction remains
  open. Before live activation, the coordinator/deployment needs bounded database
  waits and stale-session handling; no failover latency guarantee is established.
- Embedded PostgreSQL tests serialize SQL connections. Real competing owners,
  lock contention, long pauses, network partitions, and process death still require
  the live multi-session integration tests in increment 8.
- No dependencies were added or application database manually changed. Migration
  18 runs through the normal next database-backed startup. Legacy registry rows are
  preserved, not silently credentialed or enrolled into the new ownership APIs.

Next increment: 4b — coordinated room recovery/activation and owner routing, starting
with heartbeat/lease coordination and recovery validation. Remaining table/controller
executors and durable delivery are still mandatory gates before live cutover.

### Increment 4b1 record

Changes:

- Added `app/durable_games/coordination.py`. `RoomLeaseCoordinator` explicitly
  registers a fresh process boot and starts independent heartbeat and renewal
  loops. Defaults are a 30-second lease, five-second maintenance intervals,
  three-second operation timeout, one-second local safety margin, 128 tracked
  rooms, and four renewal workers. No application startup wiring was added.
- Room acquisition retains the same observed epoch and random token across lost
  responses, cancellation, and retries. Concurrent calls for the same intent
  serialize. A successful acquisition/retry is explicitly renewed before deriving
  a conservative local deadline, because acquisition retries do not extend SQL
  expiry. All acquired rooms still begin in `recovering`.
- Local admission requires a confirmed `serving` lease, exact matching fence,
  healthy heartbeat, and unexpired local confirmation. This component never calls
  `activate`; recovery validation remains a mandatory separate step.
- Heartbeat failure revokes all tracked rooms locally; uncertain renewal revokes
  the affected room. Cancellation, deadline gaps, and delayed maintenance replies
  cannot silently restore eligibility. A subsequent successful heartbeat permits
  new acquisitions but does not restore a revoked room. Explicit abandonment and
  a new acquisition/recovery are required; a still-live SQL lease cannot be stolen.
- Local deadlines use monotonic request-start time with a safety margin; they
  only remove permission. PostgreSQL wall-clock fencing remains the authority for
  every transaction. Room/worker counts and error history are bounded, and
  overlapping renewal cycles share the worker bound. Error records contain room
  identity and exception type, not SQL parameters, tokens, or game state.
- Added `OwnershipGuardedExecutor` for composition with `GameLaneScheduler`.
  Every queued/retried execution attempt rechecks local admission before reaching
  the existing detached, SQL-fenced executor. Lost-owner lanes stop locally;
  durable inbox commands remain available for later recovery/polling.
- Draining closes local admission immediately, even if the registry update's
  response is lost. Existing leases continue renewing while a future shutdown
  coordinator quiesces workers. Stop closes admission and cancels maintenance;
  it leaves SQL leases to expire instead of releasing ahead of in-flight work.
  A stopped coordinator cannot restart with the old boot identity.

Verification:

- Deterministic tests exercise uncertain renewal, heartbeat failure, pauses and
  delayed replies, lost/cancelled acquisition responses, concurrent acquisition,
  abandonment and stop races, bounds, background maintenance, drain retries, and
  scheduler rejection of queued work after ownership uncertainty.
- Production ownership SQL composed with the coordinator passed recovery/serving
  admission, draining, expired-owner takeover, epoch change, stale fencing, and
  refusal to revive ownership after a healthy heartbeat. These tests use embedded
  PostgreSQL/WASM; activation is explicit test setup, not recovery integration.
- Full backend regression suite: 980 passed, including 18 new coordination tests,
  with two existing dependency deprecation warnings. `git diff --check` and Python
  compilation of the new module passed.

Limitations and next-step contracts:

- Increment 4b remains incomplete. This subincrement is coordination infrastructure,
  not automatic failover. No room discovery/placement, recovery loader, activation,
  owner endpoint, Redis, or application lifecycle integration is enabled.
- Recovery must validate a consistent inventory of every table, supported engine
  and schema version, reservations, scheduled work, and finalization state before
  activation. A renewal observing `serving` trusts that explicit database transition;
  heartbeat success by itself is never recovery evidence.
- The future composition must wrap the lane executor with the guard and stop or
  drain its scheduler before explicitly releasing ownership. Already-started work
  relies on transaction fencing; local admission closure cannot undo committed work.
- Lost rooms and uncertain acquisition intents occupy bounded slots until explicit
  abandonment. The placement/recovery coordinator must resolve ownership from SQL
  and schedule retries without repeatedly replacing unknown acquisition intents.
- Fixed configurable maintenance intervals currently have no jitter. Placement and
  startup integration must add jitter and verify pool/renewal budgets. A saturated
  maintenance cycle may deliberately lose local eligibility; capacity and failover
  timing are not proven. Timeout cancellation also depends on the database driver
  honoring cancellation; live lock/partition tests remain in increment 8.
- No schema, dependencies, or application database were manually changed.

Next increment: 4b2 — consistent room recovery inventory and validation. Keep live
activation disabled until all required recovery and executor paths are implemented.

### Increment 4b2 record

Changes:

- Added `app/durable_games/room_recovery.py` with a read-only, repeatable-read room
  inventory transaction. It loads room membership, every catalog table (including
  closed tables), checkpoints/receipts/reservations, game identities, lane cursors,
  pending timers, and pending finalization jobs from the same committed view.
- Added `PostgresCheckpointStore.load_in_snapshot` so room recovery reuses the
  existing checkpoint/journal/receipt/reservation validation without opening a
  connection or transaction per table. Each table is also rebuilt off-registry
  through the existing engine codecs; private checkpoint and work payloads are
  excluded from inventory representations.
- Requires a live, exact `recovering` room fence before loading and checks it again
  in a fresh transaction after loading. The snapshot does not hold ownership locks
  during reconstruction and does not block normal lease renewal. The result is
  explicitly not an activation permit: concurrent changes and the final activation
  boundary still require orchestration/revalidation.
- Validates allocation count, table compatibility/configuration, engine state and
  versions, normalized reservations/membership, and active-game coverage. A live
  legacy game without recoverable table state cannot be silently omitted. Closed
  table history remains available for old lane work and finalization.
- Validates each lane's pending count and contiguous sequence range against its
  enqueued/processed cursors, including pending request-version compatibility.
  Lanes are read without creation, advancement, or command execution.
- Pending timer records retain their original IDs, deadlines, generations, request
  fields, and payloads. Pending finalization retains IDs, round, payload version,
  retry time, and attempt count, including jobs from historical games. Completed
  hosted games require the presence of a durable hosted-settlement intent.
- Unknown timer/job semantics fail closed with `UnsupportedRecoveryWork`. Explicit
  synchronous validators are keyed by timer lane-kind/action-type or job-type/
  payload-version; they receive detached copies. No production timer/finalization
  validator is enabled by default because the corresponding executors remain
  pending. Recovery never infers success or drops work it cannot understand.
- Pending seat offers and timed Call Break deal summaries currently fail closed
  because checkpoint-to-timer reconciliation is not yet implemented. Ordinary
  checkpoints remain loadable; these cases are not silently reset or resumed.
- Inventory query categories have a configurable row limit (default 4096) and
  reject overflow instead of truncating. `RecoveryLimitExceeded` distinguishes a
  recovery budget issue from malformed data. Unsupported and malformed data retain
  explicit failures; no automatic quarantine, repair, host installation, or
  activation occurs in this storage component.

Verification:

- PostgreSQL/WASM tests cover multi-table inventory, empty rooms, closed
  tables, unchanged host registries, corrupt/missing checkpoints, reservations,
  former members, unsupported game types, inventory limits, pending lane gaps,
  overdue timer identity/deadline preservation, validator isolation, finalization
  versions/retries, missing settlement intent, omitted legacy games, invalid work,
  and ownership expiry between the inventory and final fresh fence check.
- An explicit transaction test confirms checkpoint reads use the same read-only
  repeatable-read transaction and only the final fence check opens a second view.
- Full backend regression suite: 997 passed, including 17 new room recovery tests,
  with two existing dependency deprecation warnings. Python compilation and
  whitespace checks passed.

Limitations and next-step contracts:

- This is a validated inventory, not complete automatic room recovery. No schema,
  application startup, API, Redis, scheduler, or ownership activation was changed.
  No dependencies were added or application database manually modified.
- The activation coordinator must reconcile membership and work arriving after
  the snapshot, install every required executor/timer/finalization handler, and
  validate ownership at the activation boundary. It must distinguish transient
  database failures, insufficient budgets, unsupported capabilities, and corrupt
  data before retrying, abandoning, or quarantining a room.
- Runtime-specific validators still need to verify timer/checkpoint generation and
  deadline correspondence and finalization effect identities. The current default
  rejects all pending work requiring these validators; a validator registry is
  not evidence that its executor has been installed. Missing expected scheduled
  work must be checked during reconciliation before activation. Settlement intent
  presence alone is not proof of a correct or completed ledger effect.
- Table configuration other than the current empty default is rejected until its
  versioned recovery contract is implemented. This implementation reads all table
  history; retention/scoping changes must preserve old receipts and pending work.
- The row limit applies per inventory category, not to bytes or existing per-table
  journal/receipt scans. The coordinator must bound the overall recovery attempt
  and continue lease maintenance. Live multi-session snapshot/takeover races and
  recovery capacity remain unproven by embedded PostgreSQL tests.

Next increment: 4b3 — recovery orchestration and failure handling, followed by
runtime-specific work reconciliation, activation/routing, and the remaining
table/controller executors. Keep live activation disabled until these gates pass.

### Increment 4b3a record

Changes:

- Added `app/durable_games/recovery_coordinator.py`. `RoomRecoveryCoordinator`
  composes the already-running lease coordinator with the room inventory loader.
  It acquires recovering ownership, validates local eligibility before and after
  reconstruction, and returns an inventory without installing hosts or activating
  the room. Each preparation rebuilds from SQL; no cached inventory is reused.
- Bounded defaults: four simultaneous preparations, three attempts, ten seconds
  per attempt, and exponential retry delays from 100 ms up to one second. Admission
  returns `busy` immediately when full or another preparation targets the same
  room; it does not create an unbounded queue or one permanent task per room.
- Only transient database/connection/timeout/serialization/lock errors are retried.
  Acquisition retries retain their original epoch/token through the existing lease
  coordinator. Known ownership is reused only while it remains locally confirmed
  as recovering, and independent heartbeat/renewal maintenance continues during
  reconstruction and backoff.
- Structured outcomes distinguish prepared, busy, retryable, unsupported,
  budget-exceeded, invalid, ownership-lost, conflict, and unexpected failure.
  Results carry exception class names only; raw errors, private state, and inventory
  payloads are not included in result representations.
- Failed or cancelled preparations abandon only their exact known fence locally;
  they do not release SQL ownership ahead of other transactions. The SQL lease
  expires normally. A replacement acquisition cannot be discarded by delayed
  cleanup from an old attempt. Unknown acquisition outcomes retain their bounded
  intent so the caller can retry with the same inputs rather than minting a token.
- Successful preparations retain a recovering lease until the caller continues
  reconciliation or explicitly discards that prepared result. A recovery request
  targeting an already-serving lease returns a conflict without disrupting it.
- Added public local `confirms(fence, status=...)` and exact-fence abandonment to
  `RoomLeaseCoordinator`; existing gameplay admission delegates to the same guard.
  Local confirmation still grants no exemption from database fencing.

Verification:

- Focused tests cover transient retries/exhaustion, unknown acquisition responses,
  classified permanent failures, bounded/same-room admission, cancellation,
  timeouts, heartbeat loss, replacement-owner cleanup, already-serving conflicts,
  private error suppression, and lease maintenance during slow reconstruction.
- Production ownership/recovery SQL composition verifies expired-owner takeover,
  detached preparation without routing/activation, explicit discard, and invalid
  checkpoint/unsupported-job failures without deleting work or resetting state.
- Full backend regression suite: 1,017 passed, including 20 new recovery
  coordination tests, with two existing dependency deprecation warnings. Python
  compilation and `git diff --check` passed.

Limitations and decisions:

- This completes recovery preparation, not the full 4b3 activation workflow. No
  startup wiring, placement/discovery loop, routing endpoint, timer/finalization
  execution, schema migration, or application database change was made.
- Deliberately do not automatically quarantine on a generic `CheckpointError`:
  these errors can reflect concurrent membership changes or unsupported data as
  well as corruption. Durable quarantine needs a validated policy and a fresh
  authoritative check under the exact fence. Invalid/unsupported results currently
  stop local maintenance and let ownership expire; a future placement loop must
  avoid repeatedly assigning persistently failing rooms without such a policy.
- A prepared result is a snapshot, not permission to activate. Runtime-specific
  timer generations/deadlines, settlement effects, missing scheduled work, and
  changes after the snapshot still require reconciliation and final fencing.
- Placement callers must explicitly resolve/abandon exhausted unknown acquisition
  intents and inspect current ownership before changing intent. Known failed
  acquisitions have been abandoned; their original expected epoch is not a new
  acquisition authorization. Prepared results must be consumed or discarded;
  this component does not implement automatic prepared-result expiry.
- Timeouts are cooperative and depend on driver/callback cancellation. They are
  not CPU preemption or a proven failover latency bound. Live multi-session lock,
  process-death, and partition tests remain in increment 8.

Next increment: 4b3b — durable table/controller command contracts and execution,
then runtime-specific work reconciliation. Keep activation disabled until that
work and the final activation/quarantine/routing boundary are complete.

### Increment 4b3b1 record

Changes:

- Added `app/durable_games/table_executor.py` with a detached `TableLaneExecutor`
  for existing durable pre-game lobbies. Supported commands are `join-seat`,
  `leave-seat`, `join-queue`, `leave-queue`, and `lock`, with an empty payload,
  current hosted match ID, and required expected **table** revision. Engine
  revision is not the concurrency token for these commands.
- Claims the ordered table-lane head under the serving room fence, locks its table,
  reloads the committed checkpoint, and rechecks authenticated membership. User
  rows for the actor and affected positions are locked in stable order before
  checking cross-table/game reservations. Invalid/nonexistent system/user actors
  are rejected without attempting notification writes to nonexistent users.
- Reuses the existing synchronous seat allocation, FIFO promotion, game table
  policies, and rule-proposal synchronization. Does not call legacy asynchronous
  host publication, process timers, or mutate any registered live host.
- Lobby seat departure promotes queued players in FIFO order, preserving Flush
  seat identity rules. A promotion candidate reserved elsewhere causes a no-effect
  rejection; it cannot steal that reservation, partially release the actor, or
  silently reorder the queue. Queue departure remains possible when seated
  elsewhere. Closing the last unqueued lobby seat releases table allocation through
  the existing SQL trigger.
- Only the current host may lock an eligible Marriage/Flush roster; Call Break
  retains its implicit lock-at-start policy. Stale match/revision, nonmembership,
  nonempty payload, full/closed/locked seats, pending rule approvals, and reservation
  conflicts produce durable no-effect rejections for supported lobby commands.
- Successful commands atomically persist checkpoint/positions/reservations,
  table revision, outbox events, inbox outcome, and lane progress. Every accepted
  new command ID advances table revision once, including an accepted no-op; retrying
  the same ID returns its original outcome without advancing again. Table outcomes
  live in the inbox and do not pollute gameplay receipts or engine revisions.
- Extracted shared transactional outbox append into `app/durable_games/outbox.py`;
  the game executor retains its existing method boundary and behavior. Both paths
  append bounded, public table changes and actor-targeted acknowledgments before
  completing the claim. Checkpoints/private engine state are never broadcast.
- Unsupported command families, active games, rotation phases, and pending seat
  offers remain pending for a compatible executor instead of being consumed as
  permanent rejections. No ingress endpoint or startup dispatcher advertises this
  partial capability set.

Verification:

- Initial table/game executor SQL suite: 27 passed. Expanded lobby suite: 18 passed.
  Covers all three game types, FIFO promotion and queue compaction, host-only locks,
  stale revisions/matches, invalid actors, membership loss, malformed payloads,
  cross-table reservations, conflicting promotion, last-seat closure, actor-only
  acknowledgments, unsupported/active command preservation, and stale fencing.
- Fault tests cover rollback after checkpoint writes when outbox limits fail, and
  a commit that succeeds before its response is lost. Retry returns the original
  receipt without duplicate state changes or notifications. Existing game executor
  tests verify the shared outbox extraction preserves gameplay behavior.
- Full backend regression suite: 1,035 passed, with two existing dependency
  deprecation warnings. Final review added an explicit next-round roster/released
  seat capability guard and regression test; the affected lobby suite then passed
  all 19 tests. Python compilation and `git diff --check` passed.

Limitations and next-step contracts:

- This completes pre-game lobby execution, not all table/controller behavior.
  Creation, start/end, rules configuration/votes, invitations, active departures,
  rematches, timed offers, and finalization require their own durable contracts.
  No application startup, HTTP/WebSocket endpoint, migration, dependency, or
  application database was changed.
- Future ingress must route only supported capabilities and provide table revision
  separately from engine revision. A compatible lane dispatcher must handle the
  full advertised command family; unsupported heads are never skipped.
- Membership departure must coordinate table positions before removing membership.
  The loader intentionally rejects inconsistent positions instead of silently
  pruning them. Queue candidates who become reserved elsewhere need an explicit
  lifecycle policy; this increment preserves both existing reservations and FIFO
  state by rejecting a conflicting promotion.
- Events are committed but publication/client catch-up are still pending. No
  capacity, real competing-session reservation, or failover latency guarantee is
  established by the embedded PostgreSQL tests.

Next increment: 4b3b2 — durable creation/start/controller contracts and execution.
Keep live activation disabled until remaining table transitions, scheduled work,
recovery reconciliation, and delivery are integrated.

### Increment 4b3b2 record

Changes:

- Added `app/durable_games/creation_executor.py`. `RoomCreationExecutor` handles
  `create-table` on the room lifecycle lane, under the serving owner fence. The
  request supplies game type, capacity, and name; existing-match and expected-table
  revision fields must be absent. Only manual hosted lobbies are created.
- Stable table and match UUIDs derive from a versioned namespace and canonical
  lane/actor/command identity. The original request remains the inbox fingerprint
  authority; a changed payload under the same actor/request ID is rejected before
  execution. Actor-scoped requests cannot share creation IDs accidentally.
- Added optional paired table/match IDs to accepted `InboxOutcome` records. They
  survive durable outcome lookup and duplicate ingress. Rejections do not expose
  speculative IDs. This is an additive JSON outcome contract, not a schema migration.
- Execution rechecks canonical user identity, current membership, and global
  table/game reservations. It locks the creator's user row before the room's
  allocation-counter row, matching the users-before-room-counter ordering used by
  lobby closure. It reads the configurable table limit instead of hard-coding five.
- Normalizes whitespace and checks open-table names with the same Python casefold
  behavior as the existing host. Room lifecycle serialization protects concurrent
  creations; closed names can be reused. Catalog counter constraints remain the
  final protection against excess table allocation.
- Creates the initial versioned checkpoint, creator position/reservation, and
  table command lane in the same transaction as room-lane completion and outbox
  events. Flush initializes the creator's stable seat ID to one. No engine, game
  lane, live host registration, or timer is started.
- Publishes durable `TABLE_CREATED` metadata and an actor-only
  `TABLE_CREATION_ACK` through the shared transactional outbox. Retrying a committed
  request returns its original IDs/outcome without reallocating a slot or publishing
  another event. Rejected outcomes remain rejected even when room capacity changes;
  a new attempt after conditions change requires a new request ID.
- Existing catalog/recovery/game identity collisions stop execution instead of
  adopting or overwriting state. Malformed payload, missing membership, occupied
  creator, name conflict, and full room produce durable no-effect rejections.
- Invitations and explicit replacement options remain pending for a compatible
  capability. This creation contract does not implicitly close a replaceable table;
  callers must complete departure/end through the appropriate durable lifecycle.
  The existing live creation endpoint is unchanged.

Verification:

- Initial creation SQL suite: 19 passed. Expanded creation/inbox integration suite:
  34 passed before adding the canonical lane-UUID identity test.
- Covers recoverable initial state for all three games, normalized names and
  casefold conflicts, default/configured capacity, closed-name reuse, stable
  rejection receipts after capacity changes, actor-scoped request IDs, changed
  payload conflicts, invalid request shape, missing/nonmember/system actors,
  reservation conflicts, unsupported options, stale fencing, and identity collision.
- A forced post-checkpoint outbox failure rolls back allocation, catalog,
  checkpoint, positions, reservations, table lane, and outcome. A lost response
  after successful commit resolves the original receipt with exactly one allocation
  and one notification batch.
- Full backend regression suite: 1,059 passed, including 23 new creation tests,
  with two existing dependency deprecation warnings. Python compilation and
  `git diff --check` passed.

Limitations and decisions:

- Kept creation separate from engine start/controller work so its room allocation,
  request identity, and player reservation transaction is independently reviewable.
  Increment 4b3b2 now denotes creation; initial start/controller work is 4b3b3.
- Creation/start/end, automatic replacement of completed tables, invitation
  effects, rule changes, active departures, and rematches must not be conflated in
  ingress. Only the supported explicit creation contract may use this executor.
- Other future table creation/name-change writers must participate in the same
  room lifecycle serialization and lock order. Name uniqueness currently follows
  that application contract; allocation and player uniqueness additionally have
  database constraints. Live competing-session tests remain in increment 8.
- Existing receipt consumers remain compatible when IDs are absent. Distributed
  rollout must ensure participants understand creation outcomes before advertising
  this capability; old strict readers cannot parse the new optional identity fields.
- No startup, endpoint, migration, dependency, or application database was changed.
  Outbox delivery/client handling and full activation remain pending. Embedded
  PostgreSQL checks do not establish production capacity or failover timing.

Next increment: 4b3b3 — durable initial game start and controller execution, with
stable initial engine identity and atomic reservations/checkpoint/outbox/outcome.
Keep live activation disabled until the remaining lifecycle, timer, recovery, and
delivery gates are complete.

### Increment 4b3b3 record

Changes:

- Added `app/durable_games/initial_start.py` for detached manual initial starts of
  Call Break, Marriage, and Flush. Extended `TableLaneExecutor` with `start`, ordered
  on the same table lane as seating and roster locking. Its expected revision is
  the table revision, not the engine revision.
- Validates host authority, current membership, roster phase/player count, pending
  rule approvals, and global player reservations. Flush requires the saved rules
  revision. Unsupported payload fields and automatic play are rejected without
  changing the checkpoint. User locks follow the existing stable ordering.
- Uses the hosted match UUID as the first durable game UUID. Adapter startup uses
  the original table command ID. Call Break's existing synchronous startup
  controllers run against detached state; no live host, timers, or ledger effects
  occur during construction.
- Atomically saves the initial engine/checkpoint, active-game reservations, game
  command lane, table-command outcome, and outbox events under the serving fence.
  Engine initialization forms journal sequence zero; it is not a gameplay receipt.
  Subsequent player actions use the existing game-lane executor.
- Preserves private Marriage startup event recipients and includes public table
  and game state-change hints plus the actor-only table command acknowledgment.
  Initial random state becomes authoritative only when the transaction commits.
- Replaying a committed request returns its existing outcome without rebuilding
  the engine or duplicating notifications, including after a lost commit response.
  A different start request against an already-started game receives a no-effect
  rejection. An aborted transaction can retry engine construction safely.

Verification:

- Added 18 embedded PostgreSQL integration cases covering all three initial game
  types and subsequent gameplay, duplicate starts, malformed/stale/unauthorized
  requests, roster locking, pending rules, fencing, private startup recipients,
  and rollback after engine creation. Lost commit-response retries preserve the
  exact checkpoint and notification count.
- End-to-end coverage creates a room-lane lobby, rejects an undersized start,
  seats players through the table lane, starts, restores, and executes gameplay.
- Full backend regression suite: 1,077 passed, with two existing dependency
  deprecation warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- This increment handles the first engine only. Finished Flush round restart,
  rotation/seat offers, active departures, explicit end, rematches, scheduled
  next-deal work, and finalization reconciliation require their own contracts.
  Unsupported lifecycle states remain pending for a compatible executor.
- The current initial-start paths do not reach terminal settlement states.
  Synchronous startup controllers are included; persistent timer execution and
  settlement work are not enabled. Configure the same summary duration for table
  and game executors when the coordinator is eventually wired.
- No schema migration, dependency, live endpoint, startup wiring, or application
  database change. Durable publication/client catch-up and activation remain
  gated on the unfinished lifecycle and delivery work. These tests establish
  neither production capacity nor live competing-session/failover timing.

Next increment: begin 4b3b4 with durable explicit end and active-player departure,
including reservation release, engine/checkpoint consistency, fenced outcomes,
and transactional events. Keep rematch identity, timers, and finalization as
subsequent bounded steps; do not enable live activation yet.

### Increment 4b3b4a record

Changes:

- Extended the ordered table executor with explicit `end` and `abandon` commands;
  both require the current match/table revision and an empty payload. Added
  `table_closure.py` for closure policy and detached changes.
- End retains creator-or-sole-room-member authority. It closes lobbies and active
  tables for all games, rejects already-finished Call Break/Marriage matches, and
  allows closing Flush between rounds. Call Break abandonment is available to a
  seated player during an active match and applies no penalty, matching live policy.
  Marriage/Flush abandonment is rejected; their fold-and-leave is a separate command.
- Closure preserves the engine, historical roster, gameplay receipts, and journal
  sequence. It commits ended metadata, table capacity/player reservation release,
  cleared queue, cancelled pending offers/invitations/timers, table/game state hints,
  closure events, and the actor-only outcome in one fenced transaction.
- An already-ended table accepts an authorized fresh End/Call Break abandonment
  at its current revision without rewriting the checkpoint or emitting another
  closure. Same-ID retries resolve the original inbox receipt, including unknown
  commit responses. Unrelated tables and their scheduled work remain unchanged.
- Pending game commands are preserved and subsequently rejected by the game
  executor against the closed state; new game ingress is refused. Closure acquires
  no game-lane lock while holding the table row, preserving lane-before-table order.
- Ending a completed Flush round requires its existing settlement intent and
  leaves that job and the completed game status intact. Incomplete games become
  abandoned without a fabricated settlement. Recovery no longer demands a
  deal-summary timer capability for a Call Break table that has already ended.

Verification:

- Added SQL integration coverage for pre-game/active End across all three engines,
  no-effect authorization/revision/payload rejections, Call Break abandonment,
  queued gameplay after End, unknown commits, stale ownership, and transactional
  rollback of closure, capacity release, reservations, and timer cancellation.
- Covers duplicate/fresh End, sole-member authorization, completed Flush settlement
  preservation, finished Marriage rejection, invitation/queue cleanup, unrelated
  table isolation, and room recovery after End during Call Break's summary phase.
- Focused closure suite: 22 passed. Full backend regression suite: 1,099 passed,
  with two existing dependency deprecation warnings. Python compilation and
  `git diff --check` passed.

Limitations and decisions:

- Split 4b3b4 because Marriage/Flush departure can advance the engine and finish a
  round; it needs an explicit original-request/engine-receipt contract and atomic
  settlement intent. This increment only closes the whole table without advancing
  the engine. Rematch/rotation/seat-transfer execution remains unsupported.
- Membership must already agree with saved positions. End does not repair corrupt
  checkpoints or bypass recovery validation when memberships were deleted without
  first releasing seats. Sole-member authority uses committed logical room
  membership, not the number of connected sockets.
- Cancelled pending actions are retained for audit. Already-enqueued timer commands
  remain immutable; their future executor must reject stale/closed targets. Timer
  creation/dispatch must participate in table lifecycle serialization and validate
  that a target is open, including a consistent lock order, before live activation.
- Pending Flush departure flags are cleared on End, while engine roster mappings
  remain historical. No scores, chips, or ledger projections are performed here.
- No migrations, dependencies, live endpoint/startup wiring, or application database
  changes. Delivery, live activation, operational readiness, and capacity tests
  remain deferred. Embedded SQL tests do not establish real competing-session
  timing or production throughput.

Next increment: 4b3b4b — define and implement Marriage/Flush fold-and-leave with
stable original request identity, atomic engine receipt/checkpoint/outcome/events,
reservation release or pending departure, and terminal settlement intent. Keep
rematches, timer execution, and live activation disabled until their own gates pass.

### Increment 4b3b4b record

Changes:

- Added `app/durable_games/departure.py` and the `FOLD_AND_LEAVE` game-lane command.
  It uses the current engine revision, an empty payload, and the existing reliable
  request ID. This is an active Marriage/Flush game action, ordered alongside other
  gameplay; it is not a table-lane command or an implicit disconnect action.
- The executor rechecks room membership, current game identity/status, seat access,
  engine revision, and receipt capacity before applying departure. Call Break
  rejects this command and continues to use explicit table abandonment.
- The detached helper maps the operation to existing Marriage `FOLD` or Flush
  `FOLD_FOR_LEAVE` rules. It preserves command ID/revision but stores the ORIGINAL
  `FOLD_AND_LEAVE` envelope and fingerprint in both inbox and game receipt. No
  generated child request, second receipt, or untracked engine transition is used.
- Marriage marks the historical player departed and releases the table/game
  reservation immediately. Flush records a pending departure and retains the seat
  reservation until round completion. The existing game executor releases all
  pending Flush departures when either this fold or a later game action finishes
  the round, retaining historical engine seat mappings.
- An already-folded player can leave an active round without another engine
  transition: table metadata/revision and the accepted original receipt commit,
  while the engine revision/journal sequence remain unchanged. Private query caches
  for the departing player are cleared.
- The same transaction saves checkpoint/engine changes, reservations, the original
  receipt/outcome, private adapter events with their recipients, table departure
  events, table/game state hints, actor acknowledgment, and terminal settlement
  intent. Neither departure path projects the ledger or starts runtime work.
- Duplicate requests resolve the original accepted outcome even after a terminal
  transition or a lost commit response. A new request from a departed/pending player
  is rejected; it cannot reclaim the seat or advance the engine.

Verification:

- Initial departure suite: 14 passed. Expanded coverage includes off-turn and
  already-folded departure for both engines, normalized reservations, pending
  Flush departure recovery, later round completion, original request/fingerprint
  retention, private Marriage recipients, duplicate/changed requests, invalid
  payload/revision/actor, and pre-deal Flush rejection.
- Forced post-settlement outbox failure rolls back engine/checkpoint, reservations,
  receipt/outcome, events, and finalization intent. Lost commit-response retries
  preserve the saved state and exactly one settlement job.
- Additional cases cover queued commands after departure with a current revision,
  receipt-admission bounds, an expired/replaced owner, and execution of the pending
  original request by the successor owner.
- Expanded departure/game-executor suite: 31 passed, including 16 new departure
  tests. Full backend regression: 1,115 passed, with two existing dependency
  deprecation warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- Departure belongs on the game lane because it can advance engine state and must
  use the engine revision and gameplay receipt admission limits. Future ingress
  must route this explicit command there rather than rewriting a table request or
  invoking the legacy asynchronous leave handler.
- Same-ID retries are idempotent; a fresh request after departure is a durable
  rejection. Pre-game/post-game seat release, rematches, Flush round restart, and
  seat replacement remain separate table lifecycle capabilities.
- Flush preparation legality remains engine-controlled. Ordinary `FOLD` and
  `FOLD_FOR_LEAVE` actions alone still do not release table membership; only the
  explicit composite departure command adds that lifecycle effect.
- No migrations, dependencies, endpoint/startup wiring, schema changes, or
  application database changes. Terminal settlement intent is persisted, but ledger
  projection/retry workers, timer execution, delivery, and live activation remain
  gated. Embedded PostgreSQL tests do not establish production failover timing or
  simultaneous-session behavior.

Next increment: begin 4b3b4c with durable next-match creation for completed
Call Break/Marriage tables whose roster meets the existing readiness policy: a new
match identity on the same table, atomic checkpoint/reservation replacement, and
safe rejection of old-match commands. Keep Flush round restart, rotation/offers,
timer/finalization reconciliation, and live activation as subsequent bounded work.

### Increment 4b3b4c1 record

Changes:

- Added `app/durable_games/rematch.py` and the ordered table-lane `next-match`
  command for completed Call Break/Marriage tables. Requires an empty payload,
  current match/table revision, current seated host, and the existing ready-roster
  policy with no outstanding releases or pending offers. A Marriage rematch can
  open with one remaining player; normal minimum-player/lock rules still gate start.
- Generates the new match UUID from a versioned lane/actor/request/previous-match
  identity. Keeps the same table ID, capacity, name, settings, Marriage scoring,
  queue, event sequence, and receipt limit. Rebuilds the current roster from the
  completion seats, clears per-match engine/departure/query/receipt state, and
  records `previous_match_id`. No engine starts automatically.
- Returns paired table/new-match IDs in the existing additive inbox outcome and
  actor-only table acknowledgment. Publishes `NEXT_MATCH_READY` and a table-state
  hint through the same transactional outbox. The new lobby can lock/start and
  execute gameplay through the existing durable executors.
- Saves the archive, new checkpoint and reservations, pending-timer cancellation,
  outcome, and events in one fenced transaction. Table allocation stays unchanged,
  even when the room is at its table limit. Requests against the old match cannot
  mutate the new lobby; queued old gameplay drains to historical rejection receipts.
- Preserves old games, engine snapshots/journal, gameplay receipts, and settlement
  jobs. Checkpoint replacement now preserves an existing completion timestamp.
  A missing old settlement intent or generated identity collision stops execution
  without consuming the request. Pending settlement does not block a valid rematch.

Schema and historical state:

- Added migration 19, `hosted_match_archives`, keyed by game ID with unique match
  identity and an index on table/revision. Stores the versioned completed checkpoint
  before replacing the current document, preserving historical player/seat mappings,
  rules, engine state, resolved offers, and old invitations for future settlement.
- An insert trigger ties the archive to the current completed Call Break/Marriage
  checkpoint and game; content changes and deletion are prohibited. Checkpoint digest/schema
  validation remains required when trusted consumers read an archive. Archives
  contain private state and must never be exposed through client delivery APIs.
- The current-match receipt view resets, but historical receipts remain queryable
  from their game records and can receive rejections for previously admitted work.
  The archive intentionally stores checkpoint state, not a frozen receipt count.
- Old offers/invitations remain historical in the archive; they are not transferred
  into the new match. Future invitation handling must reject superseded match IDs.

Verification:

- Initial combined rematch/lobby/schema-upgrade suite: 37 passed. Expanded rematch
  suite: 16 passed. Covers both game types through new engine start and gameplay,
  full-room rematches, remaining-player host selection, original settings/history,
  old-lane draining, stale old-match table commands, queue preservation, invalid
  requests, active/closed/Flush rejection, and unresolved releases/offers.
- Forced outbox failure rolls back archive/checkpoint/reservations/timer changes;
  a lost successful commit response resolves the same new match without another
  archive or event batch. Also covers stale ownership, missing settlement intent,
  archive boundary checks and immutability, and migration ordering from version 18.
- Full backend regression: 1,132 passed, with two existing dependency deprecation
  warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- Added an archive because the existing current-table checkpoint would otherwise
  lose the old user-to-engine-seat mapping before asynchronous settlement completes.
  This is required rematch data preservation, not an operational retention policy.
  Archive retention and deletion workflows remain in the later operational task set.
- Requires schema 19 before advertising the rematch executor capability. The SQL
  declaration and tests were added; no application database was manually migrated.
- Ready-roster rematches do not resolve replacement offers, promote queued players,
  close/reopen ended tables, or run settlement. Flush is explicitly rejected by
  `next-match`; its continuing hosted match needs a distinct round contract.
- No endpoint/startup wiring, live activation, dependency, delivery, or ledger-worker
  changes. Historical settlement consumers still need to validate/read these archives;
  full reconciliation remains a prerequisite for activation. Embedded SQL tests do
  not demonstrate production concurrency, capacity, or failover latency.

Next increment: 4b3b4c2 — durable Flush round restart for a locked, ready roster,
including round identity, archival of the previous round, reliable command revision
and receipt continuity, and atomic reservation/checkpoint/outcome/events. Keep
remaining roster transitions/offers, timer execution, settlement projection, and
live activation gated on their own increments.

### Increment 4b3b4c2 record

Changes:

- Added `app/durable_games/flush_restart.py`. The table executor now accepts `lock`
  and `start` against a completed Flush round. Other post-start seating/queue/offer
  commands remain gated. Both operations use the current table revision; start
  retains host, minimum-player, saved-rules-revision, manual-play, membership,
  reservation, and pending-rule/seat-transfer checks.
- Restart preserves the hosted match ID, table ID, rules, historical stable seat
  mapping, round results, engine history, and reliable receipt limit/count. It uses
  the existing engine's `prepare_next_round` with the current roster; the previous
  winner deals if still seated, otherwise the current host does.
- The engine revision advances continuously by one, with `round_start_revision`
  recorded by the engine. Each round gets a distinct durable game UUID derived
  from the table lane/actor/request/previous durable game identity, and its own
  journal sequence-zero snapshot and game lane. The original table start outcome
  owns this transition; no synthetic gameplay receipt is created.
- Atomically archives the completed round, saves the new engine/checkpoint,
  reserves current players, cancels pending old table/round timers, creates the
  new lane, and commits table/game state hints, the table start event, acknowledgment,
  and inbox outcome. Completed-round settlement intent is required and retained;
  pending settlement does not block restart. Completed timestamps now also survive
  metadata-only writes such as locking the finished round.
- Match-wide receipt admission includes requests still pending on prior round
  lanes. Restart rejects an exhausted match instead of resetting its limit. Same-ID
  retries arriving on a later round lane resolve their original result; altered
  requests conflict. Previously queued old-round commands are rejected without
  advancing the new engine, and their receipts remain in the shared match view.

Schema:

- Added migration 20. Completed-match archives retain their primary key on durable
  game ID, while hosted match ID becomes a nonunique indexed lookup to accommodate
  multiple Flush rounds. The archive boundary trigger now also accepts a finished
  Flush round in its OPEN or LOCKED table phase. Existing archives and immutability
  protections remain intact. Readers must use the durable game ID for one specific
  round; a hosted match lookup may return several archives.
- Requires schema 20 before advertising this capability. No application database
  was manually migrated; tests apply the migration chain to embedded PostgreSQL.

Verification:

- Initial restart/initial-start/schema-upgrade suite: 39 passed. Tests exercise
  repeated round restart, continuous revisions/results/receipts, independent game
  identities/journal boundaries, multiple archives under one hosted match, immutable
  archives, old settlement jobs, stable seats after departure, and retry conflicts.
- Forced outbox failure rolls back engine, archive, lane, reservations, and outcome;
  a lost successful commit response resolves exactly one new round and event batch.
- Invalid actor, stale table/rules revision, unlocked roster, unsupported play mode,
  missing settlement intent, expired owner, and exhausted receipt capacity cannot
  create another round. Extra coverage checks pending receipt reservations and
  room recovery with both lanes and outstanding finalization work.
- Expanded Flush restart suite: 14 passed. Full backend regression: 1,147 passed,
  with two existing dependency deprecation warnings. Python compilation and
  `git diff --check` passed.

Limitations and decisions:

- The table `start` contract continues to use a TABLE revision. Player actions use
  the continuously increasing ENGINE revision and current durable round lane.
  Future ingress must resolve the current round from stored table state; clients
  continue to identify the hosted match. Rollover does not discard admitted work.
- A fresh start request during the new active round is rejected without effects;
  a duplicate original request returns its saved outcome. Completed-round departure
  reconciliation must already be consistent; restart never repairs corrupt metadata.
- Between-round roster editing and replacement offers remain separate work. The
  current ready roster can restart, including players retained after a previous
  fold-and-leave. No ledger projection, timer dispatch, automatic promotion, endpoint
  wiring, dependency, delivery, or live activation was added.
- Settlement consumers must validate/read the archived round by game ID. Full
  settlement/timer reconciliation remains an activation gate. Embedded SQL tests
  do not demonstrate real concurrent-session timing or production capacity.

Next increment: begin 4b3b4c3 with durable between-round Flush `join-seat`,
`leave-seat`, `join-queue`, and `leave-queue` transitions, preserving stable engine
seat mappings and FIFO/reservation rules. Keep completed Call Break/Marriage
replacement/rotation, offer timers, settlement workers, and live activation as
subsequent bounded work.

### Increment 4b3b4c3a record

Changes:

- Enabled table-lane `join-seat`, `leave-seat`, `join-queue`, and `leave-queue` for
  finished Flush rounds using the existing detached lobby transitions. Current
  match/table revision, membership, payload, room fencing, and reservation checks
  remain mandatory. Active rounds and other post-start game types remain gated.
- OPEN tables accept available seats and releases; LOCKED tables reject seat
  changes while still allowing queue changes. Departure promotes queued players
  in FIFO order under stable user locks. As with the durable lobby contract, an
  occupied promotion candidate causes a no-effect rejection rather than being
  silently skipped; that user can still explicitly leave the queue.
- New Flush players receive monotonically assigned stable seat IDs; returning
  players reuse their historical IDs. IDs may exceed table capacity while the
  number of current players remains bounded. Completed engine state, its original
  seat mapping, journal, receipts, and settlement jobs remain unchanged.
- Every supported roster mutation requires the completed round's settlement
  intent and consistent departure metadata. It commits positions/reservations,
  table revision/events, state hint, acknowledgment, and outcome atomically. No
  active-game reservation is created until the next round starts.
- When the last seated player leaves an OPEN table with no queued promotion,
  closure cancels pending invitations/timers, releases table capacity, and emits
  closure/state events in the same transaction. The finished engine stays completed
  and its outstanding settlement remains intact; a closed table cannot be rejoined.
- A completely replaced roster can recover, lock, and restart with the existing
  durable round executor. If the previous winner is no longer seated, the new host
  becomes dealer, matching the existing engine/host policy. The old seat mapping
  remains available in the completed-round archive after restart.

Verification:

- Focused Flush roster/restart/table suite: 46 passed, including 13 new roster
  cases. Added active-game command gating coverage for all three game types.
- Covers complete FIFO roster replacement followed by recovery/restart/gameplay,
  returning-player IDs, queue removal on seat join, locked-roster behavior,
  cross-table reservation conflicts, empty-roster closure and settlement retention,
  invalid requests, missing settlement intent, and expired ownership.
- Forced outbox failure rolls back promotion and checkpoint state. A lost
  successful commit response resolves the original receipt without allocating
  another seat or publishing another event batch.
- Full backend regression: 1,162 passed, with two existing dependency deprecation
  warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- Reused existing lobby policies rather than introducing a second promotion
  policy. Joining a queue alone does not auto-seat a player; FIFO promotion runs
  when a seated player leaves an OPEN roster, matching the existing hosted flow.
- The normalized current roster can differ from the finished engine's roster.
  Historical Flush seat mappings must never be pruned or reassigned while retained
  engine state and settlement history refer to them.
- Membership cleanup must remain coordinated with position removal. Corrupt
  membership/reservation snapshots and unreconciled completed-round departures
  fail closed; this executor does not repair them.
- No migration, dependency, endpoint/startup wiring, delivery, or application
  database change. Timer cancellation is supported; timer dispatch, settlement
  projection, replacement offers, and live activation remain gated. Embedded SQL
  tests do not establish simultaneous-session timing or production capacity.

Next increment: 4b3b4c3b — durable completed Call Break/Marriage `leave-seat`,
`join-queue`, and `leave-queue`, preserving the historical engine roster and
recording replacement vacancies where required. Keep offer creation/acceptance/
expiry, timer execution, finalization reconciliation, and live activation as
subsequent bounded work.

### Increment 4b3b4c3b record

Changes:

- Enabled completed Call Break/Marriage table-lane `leave-seat`, `join-queue`,
  and `leave-queue`. Commands retain current match/table revision, membership,
  ownership fencing, reservation checks, atomic outbox, and durable outcomes.
- Releases change the next-match roster and departed metadata without changing
  the historical engine roster, journal, gameplay receipts, or settlement intent.
  Call Break records the original seat and leaving player as a replacement vacancy;
  Marriage permits the remaining host to create a rematch under existing policy.
- Queue eligibility now uses current table seats rather than historical engine
  membership, so a released player may join the queue. Repeated releases are
  harmless; request retries return the original outcome.
- Every completed-roster command requires the match's settlement intent. Vacancies
  and next-seat metadata no longer block these supported commands. Pending offers
  still require the forthcoming offer capability and leave requests pending.

Verification:

- Focused completed-roster/rematch/table/Flush-roster/closure regression: 83
  passed, including 11 new completed-roster cases. Covers historical state and
  settlement retention, reservation release, queue eligibility, full roster
  departure, Marriage rematch, Call Break vacancy gating, invalid requests,
  stale ownership, missing settlement intent, rollback, and lost-commit retries.
- Python compilation and `git diff --check` passed. The full backend suite was
  not rerun in this increment; the previous full run passed 1,162 tests.

Limitations and decisions:

- No automatic promotion or offer generation for completed rosters in this step.
  Call Break vacancies continue blocking rematch until accepted replacements exist.
- Releasing the last completed seat retains a COMPLETED table, matching existing
  lifecycle behavior; it does not apply Flush's empty-roster closure policy.
- No migration, live endpoint/startup wiring, dependency, or application database
  changes. Live distributed behavior remains disabled. Embedded PostgreSQL tests
  do not establish simultaneous-session behavior or production failover timing.

Next increment: begin 4b3b4c3c with durable replacement-offer transitions and
persisted expiry deadlines: FIFO offers, explicit invitations, acceptance/decline,
and queue-withdrawal cancellation. Define stable offer IDs and atomic reservation,
checkpoint, outcome, and outbox behavior before adding timer dispatch. Then finish
scheduled-work/finalization reconciliation and recovery activation/owner routing
before marking increment 4 complete and beginning increment 5.

### Replacement-offer record (within 4b3b4c3c)

Changes:

- Added `seat_offers.py` and table-lane `invite-seat`, `accept-seat`, and
  `decline-seat` commands. Strict payloads are respectively `{seat_id, recipient}`
  and `{offer_id}`; all use the current match and TABLE revision. Only completed
  Call Break tables support replacement offers; other game types reject them.
- Successful completed-roster commands offer vacancies to eligible FIFO queue
  members. Each recipient has at most one pending offer; the leaving player cannot
  receive their own vacancy, consistent with the stored offer invariant. Offers
  remain pending until explicitly resolved or a future expiry command executes.
- The current host or the vacancy's leaving player may invite a room member when
  the queue is empty. Acceptance verifies recipient authority, PostgreSQL time,
  vacancy identity, room membership, and global player reservations under stable
  user locks. Only the next-match roster changes; historical engine users persist.
- Decline removes the recipient from the queue and advances the next eligible
  candidate. Queue withdrawal cancels that user's pending offer and advances FIFO.
  These actions remain available while the recipient is seated at another table.
- Offer IDs derive from a versioned lane/actor/request/match/seat/recipient identity.
  Creation and expiry use PostgreSQL time. Each offer inserts a `seat_offer_expiry`
  scheduled action with a stable action/command ID, its original absolute deadline,
  `expire-seat-offer` command, `{offer_id}` payload, and the monotonic table-event
  sequence as generation. Table-lane expiry has no expected table revision: future
  execution must verify offer identity/status/deadline instead of unrelated edits.
- Checkpoint, reservation changes, scheduled-action insertion/cancellation, table
  events, outbox, and inbox outcome commit atomically. Accepted/declined/cancelled
  offers cancel still-pending expiry actions. Already-enqueued expiry commands must
  become harmless no-ops in the upcoming system-command executor.

Verification:

- Focused offer/completed-roster/rematch/table/Flush-roster/closure run: 89 passed
  and one obsolete unsupported-command expectation failed because `accept-seat`
  is now supported. Updated that test to use the still-unsupported
  `expire-seat-offer`; its focused rerun passed (90 cases verified in total).
- Seven new offer tests cover FIFO decline/withdrawal/acceptance through rematch,
  authority and strict payloads, database deadlines, expired acceptance, multiple
  vacancies, stable pending deadlines, replacement departures, cross-table
  reservation conflicts, creation/acceptance rollback, and unknown-commit retries.
- Updated completed-roster expectations for automatic FIFO offers. Python
  compilation and `git diff --check` passed. Full backend suite was not rerun.

Limitations and decisions:

- Uses existing schema 20; no migration or application database changes.
- Expired acceptance is a durable rejection with no roster effect. This increment
  persists expiry intent but does not dispatch it, expire offers opportunistically,
  or run background tasks. Expired pending offers therefore await the next capability
  before the queue advances; their original deadlines are never extended.
- Whole-room recovery still fails closed on pending offers until deadline validation
  and expiry execution are implemented. Live routing/startup remain disabled.
- Invitation alone does not reserve the recipient globally; acceptance performs the
  authoritative reservation check. An occupied FIFO candidate is not silently skipped.
- Historical event/offer retention and production capacity testing remain deferred.

Next: implement fenced, idempotent scheduled-action dispatch to inbox and table-lane
`expire-seat-offer` system execution. Verify absolute deadlines, stale/resolved offers,
FIFO advancement, cancellation races, takeover recovery, and duplicate dispatch.
Add offer/deadline recovery validation before lifting the pending-offer recovery gate.
Then port game timers and finalization reconciliation, followed by activation/routing.

### Offer-expiry execution and recovery record (within 4b3b4c3c)

Changes:

- Added explicit `OfferExpiryDispatcher`: one bounded due action per selected table
  lane, PostgreSQL due-time checks, live owner fencing, and atomic inbox insertion
  plus scheduled-action linkage. Uses schema's trusted `system:timer` identity and
  stable original command ID. Repeated dispatch/unknown-commit retry sees the same
  enqueued action without allocating another command. No polling task starts.
- Lock order is fence, table lane, then deadline. Dispatch never holds a timer row
  while waiting for its lane, avoiding a cycle with table mutations that cancel
  timers. Busy lanes can be skipped; inbox backpressure leaves the timer pending.
  Batch dispatch commits each lane independently and propagates failures; callers
  must retry pending work and isolate lane failures when integrating the scheduler.
- Table-lane `expire-seat-offer` requires the exact scheduled-action/inbox sequence,
  trusted actor, request, and elapsed deadline. A player-submitted or unlinked expiry
  receives a durable rejection. The stored offer ID, generation/creation event,
  match identity, and deadline are checked before applying effects.
- Expiry removes the old queued candidate, records EXPIRED, creates the next FIFO
  offer/deadline, and atomically saves checkpoint/outbox/outcome. It preserves the
  engine and settlement intent. Resolved offers and superseded matches produce
  accepted no-ops without a table revision or outbox event. Already-enqueued timers
  need no cancellation write; their eventual lane execution observes current state.
- Added explicit `offer_expiry=True` recovery capability. Validates pending offers
  against both pending deadlines and already-dispatched inbox work, including
  creation generations, original deadlines, vacancy identity, unique seat/recipient
  assignments, and linked request/sequence/status. Missing, cancelled, malformed,
  or mismatched required deadlines fail closed. No deadline resets on recovery.
- Recovery remains read-only and does not activate an owner. Without the explicit
  capability, pending offers remain unsupported. Other timer/finalization work still
  requires its own validators. Current game timer and settlement gates remain.

Verification:

- Focused expiry/offers/completed-roster/room-recovery/recovery-coordinator/table
  suite: 71 passed, including 12 new expiry cases. Initial expiry-only suite passed
  11 cases before adding the owner-takeover case.
- Covers duplicate dispatch, FIFO advancement, non-due work, stale fences, queued
  withdrawal before expiry, forged player requests, backpressure, dispatch and
  execution unknown commits, outbox rollback, pending/dispatched recovery,
  missing/cancelled/mismatched deadlines, and takeover by a new owner that fences
  the previous owner before continuing the original inbox work.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment. Finalization validation in recovery tests remains an
  explicit test stub; production settlement execution is still pending.

Limitations and decisions:

- No migration, dependency, application database change, live startup, Redis, or
  delivery integration. This dispatcher handles offer expiry only; remaining game
  timer command contracts/executors still need implementation.
- Recovery scans pending/enqueued offer actions within the existing inventory bound;
  retained historical dispatched actions count toward that bound. Retention and
  production tuning remain deferred. Deadline catch-up is bounded per call.
- Embedded PostgreSQL tests verify transactional behavior and owner-epoch fencing,
  not simultaneous real PostgreSQL sessions, production latency, or capacity.

Next: durable Call Break deal-summary deadlines and trusted advance execution,
including obsolete revision/generation rejection and recovery continuation. Audit
remaining game-controller timers, finish finalization/settlement reconciliation,
then complete recovery activation/owner routing before increment 5.

### Call Break manual review record (within 4b3b4c3c)

Correction to the previous handoff:

- Source inspection and existing `test_manual_round_summary_holds_scores_and_creator_advances_once`
  confirm that Call Break review is creator-controlled. `round_summary_seconds=8`
  causes controllers to pause at DEAL_COMPLETE; it does not set a deadline or
  automatically prepare another deal. The existing `next_deal` endpoint performs
  continuation. Adding a timer would change the agreed preserved gameplay behavior.
- Audited hosted service/adapters/lifecycle for sleep, task creation, and deadline
  assignments. Seat-offer expiry is the only active background game/table timer.
  Flush/Marriage preparation and round transitions remain player commands. Existing
  deadline fields are inert in this manual hosted flow. Future automatic play would
  need a separately defined policy and durable timer contract.

Changes:

- Added `callbreak_review.py` and game-lane `NEXT_DEAL`, with strict payload
  `{deal_number}` and the ENGINE revision. Requires the current active match,
  room membership, a seated creator, enabled review policy, and the current completed
  deal number. Other game types, system identities, stale revisions/deals, and
  malformed payloads cannot advance the engine.
- Runs existing synchronous controllers with `advance_deal=True` under the normal
  game-lane/table/fence transaction. Commits engine checkpoint/journal, the original
  request receipt, table revision, outgoing events, acknowledgment, and inbox result
  atomically. No async host hooks, timer, or network effects are invoked.
- Same-ID retries return the original receipt. A fresh current-revision request for
  an already continued deal is accepted without another engine advance, matching
  legacy behavior; it still consumes its own receipt and metadata revision. A stale
  expected revision is rejected, preserving the reliable command contract.
- Added explicit `callbreak_review=True` to recovery inventory. This recognizes
  the paused state as awaiting creator input, rather than requiring a fictitious
  deadline. Default recovery retains its unsupported-capability gate when review
  is enabled in the host. Reconstruction never starts the next deal automatically.

Verification:

- Initial continuation suite: 13 passed. Expanded game-lane/room-recovery/table
  closure/legacy manual-review regression: 69 passed, with two existing dependency
  deprecation warnings. Includes 4- and 5-player legacy review behavior.
- Covers durable transition into review without timers, creator continuation and
  following gameplay, original receipt retries, current-revision repeated commands,
  stale deal/revision, malformed payload, nonhost/spectator/system rejection,
  disabled policy, cross-game rejection, rollback, unknown commit, and takeover
  recovery of a queued creator command while fencing the old owner.
- Python compilation and `git diff --check` passed. The full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No schema migration, application database change, dependency, live endpoint, or
  startup wiring. Future ingress must translate the legacy next-deal request into
  this reliable game-lane command with a stable command ID and engine revision.
- Review configuration must remain consistent across owner instances, as with
  existing detached controllers. This step does not introduce per-table policy
  migration or automatically enable either recovery capability.
- Settlement workers and recovery activation remain pending. Embedded SQL tests
  validate transactions/fencing, not simultaneous production sessions or capacity.

Next: implement finalization checkpoint resolution (current state or immutable
archive), strict job/payload validation, and idempotent transactional ledger/result
projection for completed Call Break/Marriage matches. Validate rollback, duplicate
execution, rematch-before-settlement, and takeover before expanding to Flush rounds.

### Match finalization record (within 4b3b4c3c)

Changes:

- Added `MatchFinalizationWorker` for version-one `hosted_settlement` jobs with
  round number zero and Call Break/Marriage engines. Explicit bounded pending-job
  selection respects `next_attempt_at`; no worker loop starts automatically.
- Validates job payload and game identity/revision/status, resolves the current
  checkpoint or immutable completed-match archive, checks its digest/schema/engine
  invariants and historical roster, and verifies the engine against the committed
  snapshot and journal. Archives allow settlement after rematch without consulting
  the new roster or requiring historical players to remain current room members.
- Marriage uses engine-authored scoring and historical player IDs. Call Break uses
  saved placement payments only if all final scores differ; ties deliberately
  produce no ledger result, matching the existing policy, and complete the job.
  Stored four-entry payment configuration remains valid for four-player games;
  only the three applicable placements are used.
- Extracted `PostgresLedgerStore.record_game_in_transaction` so ledger insertion
  and job completion share one transaction. Existing `record_game` delegates to it.
  The small roster's rows use individual inserts inside that transaction. Existing
  canonical identity/amount conflict checks remain; identical prior projections
  are reused and conflicting projections leave the job pending.
- Worker lock order is serving fence, table, then finalization job. It matches
  lifecycle operations and rechecks the fence before commit. Job completion and
  successful attempt count commit with ledger writes; failed attempts roll back
  everything and remain eligible for caller-controlled retry. Unknown-commit retry
  observes completed work without duplicating entries.
- Added explicit `match_settlement=True` recovery validation for Call Break/Marriage
  jobs using the same resolver and scoring projection. Recovery remains read-only;
  it validates pending inputs without executing settlement or activating ownership.
  Flush and unknown work still require their own compatible capabilities.

Verification:

- Initial match finalization suite: 9 passed. Expanded finalization/rematch/room
  recovery/ledger regression: 55 passed, including 14 new finalization cases, with
  two existing dependency deprecation warnings.
- Covers current and archived settlement parity with the legacy scorer, exact
  distinct-placement payments, tied policy, duplicate execution, identical/conflicting
  pre-existing ledger results, ledger rollback, unknown commit, read-only recovery,
  missing/corrupt archives, mismatched job revision, stale fences, and new-owner
  settlement of departed historical players after rematch.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No migration, application database update, dependency, payment transfer, settlement
  batch creation, endpoint change, or live startup wiring. Results use the existing
  `ledger_games`/`game_ledger_entries` authority; no second result format is invented
  in the unused `completed_games` table. User-managed payment/confirmation flows
  remain unchanged.
- This worker projects game obligations; it does not send money or mark transfers
  paid. A tied Call Break job completes without payment rows, preserving policy.
- Ledger reads remain the existing refresh path; notification delivery integration
  is deferred to its planned increment. Retry scheduling/backoff and activation
  coordination still need the runtime integration step; this explicit worker
  propagates failures and does not advance retry timestamps on rollback.
- Recovery checks checkpoint/job inputs; ledger conflicts are checked at projection.
  Historical journal reads follow existing recovery validation. Production retention,
  capacity, and real simultaneous-session failover testing remain deferred.

Next: Flush round finalization, preserving the legacy result UUID derived from
hosted match ID and round number while resolving the distinct durable round game
ID. Validate historical stable seat mappings, restart-before-settlement, repeated
rounds, rollback/unknown commits, and recovery before completing finalization scope.

### Flush finalization record (completion of 4b3b components)

Changes:

- Added `FlushFinalizationWorker` using the same fenced table/job transaction and
  idempotent ledger writer as match settlement. It selects only positive-round,
  version-one hosted Flush jobs; match workers continue selecting round-zero
  Call Break/Marriage jobs. Both remain explicitly invoked and bounded.
- Shared current/archive resolution now selects by the durable game ID rather than
  hosted match ID. This distinction is mandatory for Flush: several durable round
  records and archives share one hosted match. Every checkpoint still passes
  digest/schema/engine validation and comparison with its committed journal.
- Flush resolution verifies job round number, finished engine state, final round
  result number, stored room/table/match identity, and engine revision. Projection
  uses only that round's net changes and the historical stable user-to-seat map,
  never the current table roster. Missing or mismatched history fails closed.
- Preserves the existing ledger UUID derived from `bhidne-ho:{match_id}:flush:{round}`.
  It deliberately differs from the durable round storage ID, so old and distributed
  paths deduplicate the same ledger result. Each round projects once independently,
  including when jobs execute out of order after multiple restarts.
- Added opt-in `flush_settlement=True` recovery validation using the same resolver
  and projection. All three game types now have concrete settlement validators;
  recovery no longer needs test-only finalization stubs when these are enabled.
- Current, archived, closed, and wholly replaced rosters are supported. Ledger
  projection/job completion never advances or replaces the current round's engine.

Verification:

- Initial Flush/match finalization suite: 23 passed. Expanded Flush/match
  finalization/restart/roster/recovery/ledger regression: 79 passed, including
  13 new Flush finalization cases, with two existing dependency warnings.
- Covers current/archive parity with legacy results, replaced historical rosters
  before and after restart, closure, three independently settled rounds in reverse
  order, original ledger IDs, rollback, unknown commit, malformed round/match jobs,
  missing archives, identical/conflicting prior projections, read-only recovery,
  and takeover while a later round remains active.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No migration, dependency, application database change, external payment, endpoint,
  or startup integration. Existing settlement batches/payment confirmations remain
  separate user actions. No ledger publication transport was added.
- Shared match settlement retry/backoff limitations remain: failures roll back and
  propagate to the caller; runtime work scheduling and activation must coordinate
  retries and isolate failed jobs. Recovery validates inputs without applying jobs.
- This completes the bounded executors and recovery validators in 4b3b, not the live
  distributed runtime. Their integration, serving admission, quarantine policy,
  routing, and shutdown belong to 4b3c. Redis/delivery/client cutover remains later.
- Embedded SQL verifies correctness of transactions and epoch fences, not real
  concurrent-process timing, production performance, or operational readiness.

Next increment: 4b3c recovery activation and owner routing, beginning with an
explicit activation coordinator that consumes a fully validated inventory, checks
capabilities and current fencing, and gates execution admission. Keep live startup
and endpoints disabled until pending-work scheduling and delivery/client dependencies
are satisfied; document any remaining endpoint capability gaps before activation.

### Activation boundary record (within 4b3c)

Changes:

- Added `PostgresRoomActivationStore`, which revalidates the entire room using all
  concrete recovery capabilities inside a SERIALIZABLE transaction. It locks and
  verifies the recovering owner/instance, checks versioned advertised capabilities,
  validates tables/lanes/timers/settlement, and commits the serving transition only
  while the lease remains live. An older preparation inventory is never an activation
  permit. Concurrent ingress is durable and must be rescanned after activation.
- Known unsupported lanes, room-command families, and pending table commands block
  activation. Extracted the table executor's state-dependent capability gate for
  shared use, so supported names in unsupported active states also fail closed.
- Added bounded `RoomActivationCoordinator` requiring a successful preparation and
  a synchronous runtime-readiness hook before and after the SQL transition. There
  is no default-ready hook or production binding. Its `admits` check combines local
  ownership and runtime readiness; readiness loss abandons only the matching fence.
- Added explicit `RoomLeaseCoordinator.activate` and a local activation-confirmed
  flag. Activation serializes with renewal for the same room and checks heartbeat,
  acquisition identity, deadline, drain/stop state, and generation before admitting
  work. Renewal discovering an unconfirmed serving state loses local ownership
  instead of opening admission or renewing that acquisition indefinitely.
- Timeout, cancellation, lost activation response, and post-commit readiness loss
  keep local admission closed. If SQL committed serving but confirmation was lost,
  the local acquisition is lost and is not renewed; fresh recovery/takeover follows
  expiry. No uncertain activation is retried into admission on a heartbeat alone.
- Existing SQL routing hints remain advisory. Runtime consumers must use the
  activation admission gate for execution; future routing handlers must reject
  unavailable local runtime even if a short-lived SQL hint still says serving.

Verification:

- Expanded activation/lease coordination/recovery coordination/table/offers/Flush
  roster regression: 96 passed, including 17 new activation cases. Updated older
  serving-state fixtures to use explicit activation instead of renewal adoption.
- Covers normal activation and execution, ingress after preparation, changed/corrupt
  inventory, missing capabilities/readiness, unsupported lanes/commands/states,
  unknown activation commit, unconfirmed external serving status, cancellation,
  timeout, expired lease, stop/drain overlap, concurrent activation attempts, and
  readiness loss before/after SQL commit and after local admission.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No migration, application database changes, dependency, live startup, endpoint,
  route publication, automatic quarantine, or scheduler/maintenance integration.
  Readiness hooks in tests are explicit fixtures, not a production-ready runtime.
- Activation propagates validation/conflict/transient failures. Bounded recovery
  preparation and exact-fence cleanup remain separate; automatic activation retry
  and quarantine policy are later integration work. Unknown commits intentionally
  prioritize closed admission over immediate availability.
- Admission is evaluated per execution attempt. A prepared inventory is not installed
  as mutable authoritative state; existing executors reload/check the database.
- Capability audit found active-game table roster commands and room creation with
  invitations/replacement options remain unsupported. Those must stay gated until
  explicitly ported or assigned a compatible executor. Rules/settings, invitations,
  room membership, query routing, and every legacy ingress path need a full audit
  before live cutover. This boundary does not claim end-to-end endpoint coverage.
- SERIALIZABLE conflicts must be retried through fresh preparation. Embedded SQL
  tests do not demonstrate multi-session isolation races or production timing.

Next: bind concrete room/table/game executors and bounded inbox/timer/settlement
work resumption to activation readiness; gate every attempt and close on runtime
failure or shutdown. Keep live entrypoints off, then implement owner routing and
quarantine/drain policy before declaring increment 4 complete.

### Concrete execution runtime record (within 4b3c)

Changes:

- Added explicitly started `RoomExecutionRuntime`, assembling recovery, activation,
  room/table/game executors, lane scheduling, offer expiry, and both settlement
  workers. Readiness requires running scheduler workers, a live maintenance task,
  and the exact staged fence. Each command and maintenance attempt checks admission;
  existing SQL transactions independently enforce ownership fencing.
- Added bounded room maintenance concurrency and per-pass batch limits. UUID keyset
  cursors rotate through inbox lanes, due offers, and settlement jobs so a full first
  page does not hide later work. A failed maintenance item retains its cursor for
  bounded retry; successful scans wrap. Queue saturation leaves commands durable.
- Added scheduler health and terminal failure callbacks. Transient command and
  maintenance errors receive bounded exponential backoff. Permanent errors or retry
  exhaustion abandon only the affected local room fence, preserving pending work.
  Typed inbox capacity errors let due-offer dispatch retry temporary backpressure.
- Shutdown closes admission before cancelling maintenance and command workers, then
  stops lease maintenance. SQL leases expire naturally; a fresh owner reconstructs
  and resumes pending commands. Start/stop lifecycle operations are serialized.
- Made the embedded SQL harness consume an outstanding response on cancellation
  before reusing its single connection; BEGIN cancellation also enters rollback
  cleanup. This prevents shutdown tests from reading another query's response.

Verification:

- Ten new runtime cases cover automatic room/table/game execution, chained offer
  expiry, match/Flush settlement, transient command retry, settlement retry/exhaustion,
  cancellation followed by fresh-owner recovery, room failure isolation, and scheduler/
  maintenance task loss. Added a three-round, one-job-page settlement cursor check.
- The first focused regression run had 103 passes and one intermittent checkpoint
  digest mismatch during an existing offer-expiry fixture's setup. All 12 expiry
  cases passed on isolated rerun; the three-round cursor check also passed. The second
  focused runtime/scheduler/inbox/expiry/settlement/activation/lease run passed all
  104 tests. The intermittent fixture mismatch remains a verification limitation;
  its underlying cause has not been established.
- Python compilation and `git diff --check` passed.

Limitations and decisions:

- No migration, dependency, application database change, live startup, endpoint,
  Redis transport, or delivery integration. This is an explicit runtime assembly.
- The local periodic scan currently provides correctness and pending-work resumption.
  Redis wakeups and the agreed outage-dependent inbox polling policy are increment 5;
  this development scan is not the final healthy-Redis polling policy. Due-timer and
  settlement scheduling remain separate from command wakeup transport.
- Local admission closure is not persistent quarantine. Automatic owner selection,
  reacquisition, route publication/withdrawal, graceful draining and SQL release,
  and administrative retry policy remain to be integrated. A SQL serving hint may
  outlive local admission until expiry; routing must check the local runtime.
- Maintenance retries are counted across consecutive failed room passes. Unsupported
  commands arriving after activation close that room and stay pending for resolution.
  Existing unsupported endpoint/state capabilities remain gated.
- Embedded PostgreSQL tests establish transaction behavior, not real multi-session
  races, production capacity, or operational readiness. The full suite was not rerun.

Next: implement owner routing and unavailable-owner handling behind explicit gates,
then quarantine/retry and coordinated drain policy. Keep live entrypoints disabled
until the endpoint audit and delivery/client dependencies are complete.

### Owner wakeup routing record (within 4b3c)

Changes:

- Added explicit `RoomCommandRouter.submit`: resolve a room/table/game lane, enqueue
  with existing stable deduplication, then wake its owner. Terminal duplicate requests
  return the original outcome without waking an executor. The returned entry is a
  durable receipt, not proof of command execution or player delivery. Unknown enqueue
  responses propagate so callers retry the same command identity.
- Routing uses fresh PostgreSQL ownership metadata. Unowned, recovering, draining,
  quarantined, expired, stale-heartbeat, and unreachable owners leave commands pending.
  No route failure can acquire, release, or steal a lease. Failure/refusal triggers at
  most one metadata refresh and a second notification only for a changed destination.
- Added bounded routing concurrency and an overall timeout with no unbounded waiting
  queue. Saturation and failures after enqueue return a deferred reason. Cancellation
  propagates and preserves durable work; there are no detached notification tasks.
- Added credential-free `RoomWakeup` and `RoomWakeupReceiver`. Receivers check the
  local admitted fence against the addressed process boot and epoch, verify that the
  lane belongs to the room and supported command family, and recheck admission when
  offering work. Wrong/stale hints cannot enqueue another room's lane or revoke a
  newer owner. Receiver concurrency and lookup time are also bounded.
- Added a trusted runtime `admitted_fence` accessor for local adapters. The local
  secret never enters a routing payload. Local and injected remote notification paths
  share the same receiver checks; transport acknowledgements only mean wakeup admission.

Verification:

- Focused routing/runtime/activation/ownership/inbox regression: 71 passed, including
  19 routing cases. Covers local and remote owner notification, terminal duplicates,
  unavailable ownership states, one-time route refresh, post-enqueue database/transport
  failures, timeout, saturation, cancellation, unknown enqueue commit, invalid lane/
  boot/epoch hints, and admission loss during receiver lookup.
- The extended unavailable-owner test also passed separately: after expiry, a fresh
  runtime resumes the pending command once and rejects a delayed old-owner wakeup.
- Full backend suite was not rerun. The earlier offer-fixture digest intermittency
  remains documented in the preceding increment; these checks do not resolve it.
- Python compilation and `git diff --check` passed.

Limitations and decisions:

- No schema/migration, dependency, live startup, HTTP/WebSocket endpoint, application
  database change, or network transport. Redis wakeup/cache transport remains increment
  5. Tests use two runtime objects and an in-process sender against embedded PostgreSQL;
  they do not establish real multi-process timing or network behavior.
- Trusted ingress must authenticate the actor, authorize the target, and isolate system
  identities before calling this adapter. Executors retain command authorization.
  The adapter deliberately excludes chat/conversation/notification lanes until their
  executors and delivery dependencies are ready. Query routing is part of the remaining
  endpoint audit; this increment routes command wakeups only.
- Deferred work is resumed by the existing explicit runtime scans or a later wakeup.
  An unreachable live owner is never stolen from. Expired/unowned results are signals
  for a future bounded acquisition coordinator, not automatic acquisition in ingress.
- Existing quarantine states are respected, including after lease expiry. Creating
  durable quarantine on runtime failures, repair/retry controls, automatic owner
  selection, and coordinated graceful drain/release remain separate required work.
- No route cache or per-notification retry queue is added. A successful wakeup can race
  ownership loss; durable inbox state plus SQL execution fences provide correctness.

Next: quarantine/retry policy with uncertain-transition handling, followed by
coordinated drain/routing withdrawal and bounded owner acquisition. Keep live
entrypoints disabled until the endpoint audit and delivery/client work are complete.

### Quarantine and repair retry record (within 4b3c)

Changes:

- Added `RoomFailurePolicy` with bounded pending fences, worker concurrency,
  coalescing, per-attempt timeout, exponential backoff, and attempt limits. It starts
  no background tasks; the explicit runtime maintenance loop drives it. Results
  contain room/epoch, outcome classification, and exception type only.
- Permanent lane/maintenance failures first remove local room admission and abandon
  lease renewal, then schedule quarantine. Failed recovery inventories (invalid,
  unsupported, budget-exceeded, unexpected failure) and permanent activation errors
  use the same policy. Existing bounded transient work retries are retained.
- Transient failure exhaustion, inbox backpressure, cancellation, and stale ownership
  do not automatically quarantine. Scheduler failure records now carry the transient
  classification so subclasses of database errors are not misclassified by name.
  Generic recovery acquisition conflicts are left closed without quarantine because
  they may refer to a room already serving under the same coordinator.
- Quarantine validates registration and the exact boot/epoch/fencing secret. A lost
  transition response can be retried after expiry only to acknowledge an already
  committed quarantine under that identical fence. Expired unquarantined leases and
  replacement owners cannot be changed by delayed failures.
- Added trusted `retry_quarantined(room_id, expected_epoch)` control. It locks the
  ownership row, checks the inspected epoch/status, clears ownership to unowned, and
  requires a fresh acquisition and full recovery before activation. Repeated requests
  acknowledge an unchanged unowned epoch; stale requests cannot clear a newer room.
  Commands, checkpoints, timers, and settlements are never deleted or skipped.
- Runtime stop attempts one bounded policy sweep after command workers stop, then
  stops lease maintenance even if that sweep is cancelled. Full coordinated drain
  and routing withdrawal remain the next increment.

Verification:

- Failure policy/runtime/routing/ownership/activation/recovery/scheduler focused
  regression: 99 passed. Two subsequently added activation and permanent maintenance
  quarantine cases also passed separately (101 checks in total).
- Fourteen new cases cover lost quarantine responses confirmed after expiry, exact
  secret checks, repair retry epoch guards, expired/replaced-owner rejection, bounded
  retry exhaustion, cancellation after commit, queue/worker bounds and overlapping
  sweeps, timeout uncertainty, unsupported commands kept pending, failed recovery,
  activation/maintenance failures, and transient database subclasses kept retryable.
- Python compilation and `git diff --check` passed. The earlier offer-fixture digest
  intermittency remains documented; this increment does not claim to resolve it.

Limitations and decisions:

- No migration, dependency, live startup, public/internal endpoint, repair UI, Redis,
  or application database operation. Repair authorization is a required responsibility
  of a future trusted control entrypoint; no runtime calls repair retry automatically.
- Quarantine persistence is not guaranteed when PostgreSQL remains unavailable, the
  lease expires before the write, the bounded queue is full, or the process stops
  before a transition commits. Local admission stays closed, uncertain results are
  explicit, and durable work remains. A later owner must fully revalidate recovery;
  it cannot assume a failed quarantine attempt repaired or consumed anything.
- Exhausted/unknown transition results are retained in bounded local diagnostics,
  not a new persistent audit/reason schema. Durable status remains authoritative.
  Cancellation retains the exact pending fence within the attempt budget; completed
  quarantine remains effective after lease expiry until explicit repair retry.
- Recovery conflicts and infrastructure failures are not proof of corrupt data.
  Unsupported capabilities and inventory limits require explicit compatibility/
  capacity correction before repair retry. The control itself does not repair data
  or certify it; fresh recovery performs validation and can quarantine again.
- Embedded PostgreSQL tests exercise SQL and fencing behavior, not real simultaneous
  sessions or production timing. The full backend suite was not rerun.

Next: coordinated drain and routing withdrawal, stopping admitted work before lease
release and resolving uncertain release responses without reopening admission. Then
integrate bounded owner selection/reacquisition and complete the endpoint audit.

### Coordinated drain and release record (within 4b3c)

Changes:

- Added explicit `RoomExecutionRuntime.drain_and_stop()`. It snapshots known eligible
  fences while synchronously closing acquisition/admission, withdraws the instance
  from SQL routing through its draining flag, stops maintenance/command workers,
  flushes one bounded quarantine pass, stops lease maintenance, then releases leases.
  Both serving and prepared recovering rooms are included; uncertain acquisitions
  without locally confirmed fences are left to expire.
- Added bounded parallel release workers and three same-input attempts per registry/
  release transition, with timeout/backoff and credential-free result classifications.
  Unknown outcomes stay retryable on repeated drain calls; confirmed releases are
  retained as results. A delayed retry cannot release a newer ownership epoch.
- Added `RoomLeaseCoordinator.begin_drain()` for synchronous admission closure and
  known-fence capture. Shutdown lifecycle calls serialize with start/stop. Cancellation
  during withdrawal or worker cleanup still joins workers and stops renewal; release
  is skipped when cleanup is cancelled, and a later call can finish safely.
- Added an atomic `preserve_quarantine` release option. Quarantine observed during
  release, including expired quarantine, requires explicit repair retry. Permanent
  work failures observed while draining remove that fence from the release set even
  if their quarantine write cannot be confirmed. Drain never clears failed work.
- Normal `stop()` continues to use lease expiry. It now joins cleanup despite caller
  cancellation. Neither path restarts a closed runtime. No detached shutdown tasks
  are left running after a call exits.

Verification:

- Focused shutdown/failure-policy/runtime/routing/lease/ownership/activation/recovery
  regression: 103 passed. After strengthening cleanup cancellation, all ten shutdown
  cases and ten runtime cases passed again, including the new cleanup-cancellation case.
- Covers serving and prepared-room release, routing withdrawal before cleanup, pending
  command takeover, same-fence lost-response retry, retry exhaustion and replacement
  fencing, failed registry withdrawal, cancellation during withdrawal/release/cleanup,
  raced quarantine, and failed quarantine persistence without unsafe release.
- Python compilation and `git diff --check` passed. Full backend suite was not rerun;
  the previously recorded offer-fixture intermittency remains unresolved.

Limitations and decisions:

- No migration, dependency, application database action, live shutdown hook, endpoint,
  load-balancer change, Redis cache invalidation, or socket/client migration. Routing
  withdrawal here is the PostgreSQL instance draining flag plus closed local admission;
  future transport hints remain advisory and must use the existing receiver checks.
- Drain cancels admitted worker attempts and joins their transaction cleanup; it does
  not wait for the entire inbox to empty. Atomic SQL work either committed or remains
  pending, and a replacement owner recovers under a fresh epoch. No command is erased.
- SQL attempts have deadlines, bounded retries and worker concurrency. Joining worker
  cleanup assumes cooperative coroutine/driver cancellation; this is not a guaranteed
  process-kill deadline. No lease is explicitly released before cleanup finishes.
- An uncertain registry update may temporarily leave a stale SQL serving hint, but
  local admission remains closed. Unreleased leases expire naturally; quarantine
  remains persistent. Lost acquisition responses without a confirmed local fence
  are never guessed at or force-released. Calling normal stop before the first drain
  discards its known lease set and deliberately retains the expiry fallback.
- Already failed/abandoned rooms are excluded from release. New permanent failures
  during drain are reported as repair-required. Administrative retry remains explicit.
- Embedded SQL tests do not establish simultaneous-process lock timing, deployment
  termination grace periods, or production performance. Operational rollout remains
  in the later task set; this increment does not enable the live runtime.

Next: bounded owner selection/reacquisition behind the existing recovery, activation,
quarantine, and draining gates. Then finish the endpoint capability audit before live
cutover, which also depends on delivery/client work.

### Demand-driven owner placement record (within 4b3c)

Changes:

- Added explicitly invoked `RoomOwnerCoordinator.ensure_owner(room_id)`. Existing
  admitted local ownership is reused; live ownership elsewhere and quarantine are
  returned without mutation. Unowned/expired rooms select a fresh non-draining
  compatible registered boot with spare advertised room capacity, using utilization
  and a deterministic room/boot hash to break ties. Remote selection returns an
  advisory destination; it does not grant ownership or send a network request.
- Local selection calls the concrete runtime's recovery preparation and transactional
  activation gates. Failed inventories remain closed and use the quarantine policy.
  Existing prepared acquisitions can resume; expired failed local acquisitions can
  be discarded and reacquired under the observed new epoch.
- Unknown acquisition responses and cancellation retain the original token/input
  epoch through lease coordination. A locally known recovering acquisition is retried
  even if its committed lease consumes the last capacity slot. Unconfirmed serving
  ownership is not adopted; fresh acquisition waits for lease expiry.
- Added versioned-capability filtering, bounded candidate reads, active request limits,
  same-room coalescing, lookup timeouts, and bounded cooldown bookkeeping. An oversized
  registry snapshot fails closed instead of silently selecting from a truncated fleet.
  Lost local intents can be pruned without discarding uncertain uncommitted intents.
- Runtime registration now advertises `room_capacity`. Acquisition locks the registered
  instance row exclusively and checks live owned-room count before a new lease write,
  serializing competing acquisitions for that instance. Idempotent retries resolve
  before this capacity check. Legacy registrations without this field preserve their
  existing store behavior but are ineligible for automatic placement.

Verification:

- Focused placement/ownership/runtime/shutdown/quarantine/activation/lease/recovery
  regression: 96 passed. The expanded placement suite passed 13 cases, followed by
  both parameterized expired-owner and no-ownership-row cases (14 placement cases
  now covered in total).
- Covers real recovery and pending-command resumption, live/quarantined owner guards,
  deterministic remote selection, SQL capacity enforcement, lost/cancelled acquisition
  commits with original-intent reuse, retry at full capacity, local reacquisition after
  expiry, lookup coalescing/backoff, drain admission closure, incompatible/oversized
  registries, missing rooms, and corrupt recovery quarantined instead of activated.
- Python compilation and `git diff --check` passed. Full backend suite was not rerun;
  the previously recorded offer-fixture intermittency remains unresolved.

Limitations and decisions:

- No migration, dependency, endpoint, application startup, periodic fleet scanner,
  remote dispatch, or application database operation. The placement service is an
  explicit capability, matching the other gated runtime components.
- This increment selects/reacquires on demand. Durable discovery must still find rooms
  with pending commands/timers/settlements after owner loss even without new ingress;
  otherwise those rooms would wait for another explicit placement request. That is the
  exact next increment, followed by the endpoint capability audit and dispatch contract.
- Candidate snapshots are advisory and can race. PostgreSQL epoch/lease checks choose
  the winner; losers return a classified preparation failure/backoff and retry later.
  Routing to a still-live owner with an unavailable heartbeat never authorizes stealing.
- Capacity is a room-count limit, not measured CPU/game load or proof of the production
  connection target. Candidate utilization and hashing do not rebalance live rooms.
  Unknown local intents reserve coordinator memory until resolved/discarded; SQL
  capacity alone does not imply free local recovery slots.
- Cooldowns are bounded local bookkeeping, not a persistent retry schedule. Returned
  remote selections need a future authenticated internal transport consumer that
  rechecks eligibility on the selected server. No acquisition credential is returned.
- Embedded SQL verifies queries/transactions but not real multi-session acquisition
  races or performance. The existing instance-row lock order is preserved; game
  command execution does not acquire that exclusive instance lock.

Next: bounded durable placement-demand discovery and explicit dispatch contracts,
then the endpoint/state capability audit. Keep live entrypoints disabled until
transport, delivery, and client dependencies are satisfied.

### Durable placement-demand discovery record (within 4b3c)

Changes:

- Added `PostgresPlacementDemandStore.page`, reading a bounded materialized keyset
  page of rooms before evaluating durable demand. Eligible work includes supported
  room/table/game inbox backlog, pending due scheduled actions, due unfinished game
  finalization jobs, and active games attached to durable tables. Idle lobbies and
  unsupported chat/platform lanes do not trigger this game-owner scanner.
- Discovery excludes quarantine and live foreign owners regardless of heartbeat.
  A local live recovering lease remains discoverable so an unknown acquisition
  response can be resolved with the coordinator's original intent. Eligibility is
  advisory; the coordinator and SQL acquisition still recheck all ownership gates.
- Added explicitly started `RoomPlacementDiscovery` with bounded pages and workers,
  serialized sweeps, lookup/dispatch timeouts, cursor wrap, and bounded failure
  diagnostics. Idle pages and refused placements advance the cursor so later rooms
  are reached. Cancelled/query-failed scans retain the cursor. Durable work remains
  and is revisited on later cycles; there is no in-memory demand queue to lose.
- The background loop pauses without querying when runtime admission/health is
  unavailable and resumes if it recovers. Stop cancels/joins its background task and
  joins any outstanding manual sweep, even if the stop caller is cancelled. It does
  not stop the owning execution runtime or release acquired rooms.
- Added credential-free `PlacementDemand` and `PlacementDemandReceiver`, plus an
  optional async sender adapter. The receiver checks the selected boot and reruns
  placement eligibility/recovery/activation. It never recursively forwards stale
  selection. Notification acknowledgement is not proof of ownership or execution;
  refusal/failure/timeout leaves durable demand for the next scan.

Verification:

- Focused discovery/placement/runtime/routing/shutdown/quarantine regression:
  85 passed. After shutdown hardening, all 19 expanded discovery cases passed.
- Covers command recovery without new ingress, live/quarantined owner exclusion,
  idle-page pagination and wrap, due versus future timers, settlement-only demand,
  active durable games, unsupported chat exclusion, actual remote receiver activation,
  uncertain local acquisition reuse, failed query/cancelled dispatch cursor retention,
  runtime-health pause/resumption, refused/failed/timed-out dispatch revisits, and
  cancelled stop joining an outstanding manual sweep.
- Python compilation and `git diff --check` passed. The earlier offer-fixture digest
  intermittency remains documented; this increment does not claim to resolve it.

Limitations and decisions:

- No migration, dependency, application database operation, application startup hook,
  authenticated transport, Redis, load-balancer change, or client delivery integration.
  Production wiring must start/stop this service with the gated execution runtime.
  Each eligible server can discover demand; remote dispatch remains an injected
  adapter until the authenticated internal transport is implemented.
- This scan reads PostgreSQL to discover rooms needing ownership; it is separate from
  healthy-owner command inbox polling. The agreed Redis/outage-dependent command
  polling policy remains increment 5. Ownership discovery cannot depend solely on a
  new player command after an owner crash.
- Page size bounds rooms evaluated per sweep, not SQL planner work or fleet recovery
  latency. The scan walks idle rooms too; worst-case discovery delay grows with room
  count and scan interval/page size. Capacity testing and index/scan tuning must
  validate recovery targets before rollout. Existing indexes and query timeouts are
  used; no performance or production failover-latency claim is made here.
- Future-due timers/jobs become eligible on a later cycle. Enqueued timer actions are
  found through their pending command lane. Legacy games without durable table IDs
  and chat/conversation/notification work are outside this scanner's capability.
- Cooldown/capacity/refusal does not remove work. Multiple scanners can race or send
  duplicate hints; acquisition epoch checks and inbox deduplication remain authoritative.
  Cursor state is local and can restart from the beginning without losing demand.
- Embedded PostgreSQL tests verify SQL and real runtime composition, not independent
  process timing or a production network transport. The full backend suite was not run.

Next: endpoint/state capability audit with a concrete live-cutover dependency matrix,
including placement discovery/dispatch lifecycle and transport, authorization, query,
chat/notification, and delivery/client gaps. Keep live entrypoints disabled.

### Endpoint capability and cutover audit record (within 4b3c)

Changes:

- Added [distributed-runtime-cutover-audit.md](distributed-runtime-cutover-audit.md)
  with a service/endpoint matrix, state-specific executor coverage, ingress/query/
  delivery contract requirements, and C1–C7 cutover dependencies.
- Inventoried all 69 HTTP/WS route declarations across the 11 routers installed by
  the composition root, with source/handler links. Audited dynamic table commands,
  WS frame families, client gameplay retries and table controls separately from
  static route patterns. Static asset mounts are explicitly outside the API table.
- Confirmed that the existing durable runtime environment setting does not install
  the new distributed runtime. Highlighted side-effecting hosted/membership/ledger
  reads, local table/query selection, room departure/deletion locks, and socket/
  social state as concrete blockers to a routing-only cutover.
- Recorded contract gaps: missing stable IDs/table revisions on lifecycle controls,
  state-dependent leave translation, explicit creation versus invitations/implicit
  replacement, unsupported active waitlists/settings/votes, public/private query
  projection, pending outcome/status lookup, and delivery/catch-up semantics.
- Selected active-game join-queue/leave-queue as the next bounded implementation
  increment. Earlier completed executor records describe their bounded state families,
  not complete parity with every live endpoint; the audit makes that remaining work
  explicit rather than treating existing tests as end-to-end readiness.

Verification:

- Python AST extraction verified method/path uniqueness and exact coverage of every
  mounted router module: 69 API/WS declarations across 11 routers. Source inspection
  covered composition, transport, lifecycle, executor gates, social/delivery services,
  and client retry/control behavior without starting the application.
- Local audit links and route handler references checked; `git diff --check` passed.
- Documentation-only increment: no behavior, API, schema, migration, database, or
  dependency changes. No behavioral tests or application startup were run.

Limitations and decisions:

- This is a source capability audit, not execution proof or approval for live cutover.
  Real multi-process correctness remains increment 8; capacity/observability/HA and
  operational readiness remain the later task set. Previous test limitations stand.
- PostgreSQL-backed membership/social/auth services are not described as wholly
  in-memory. Their local coordination, cache, rate-limit and publication dependencies
  must be reconciled individually; unrelated platform operations need not be forced
  through room ownership.
- Durable room chat was already authorized by the baseline plan despite the legacy
  service's ephemeral comment. Transient pokes can remain transient. The audit does
  not authorize silently discarding any existing invitation/settings/room behavior.
- Main increment 4 remains open: controller/lifecycle/query parity and gated live
  bindings remain. Redis, durable delivery, client/LB and multi-process checks remain
  separate increments 5–8, not work implicitly completed by this audit.

Next: active-game table-lane waitlist commands with shared execution/recovery capability
checks and focused correctness coverage. Keep HTTP/WS bindings disabled; then work
through the other C1–C2 gaps before completing cutover integration.

### C1 controller/lifecycle and C2 query/ingress backend completion (within 4b3c)

The user requested both remaining increment-4 backend slices together. They are now
implemented as explicit components; main increment 4 remains open only for its gated
live integration. The [API contract](distributed-runtime-api-contract.md) records
the concrete envelopes, query adapters, limits and remaining compatibility bindings.

Completed C1 scope:

- Active-game waitlist join/leave for Call Break, Marriage and Flush retains FIFO,
  table revisions, receipts and unchanged engine state. A seating command racing
  game start is a durable state rejection rather than a permanently blocked head.
  Unknown commands and unsupported/corrupt recovery structures still fail closed.
- Table-lane settings and rule votes reuse existing validation and unanimous
  proposal semantics. Proposal IDs are deterministic per command; creator/seat/
  membership, pending proposal, game type and revision checks remain authoritative.
  Roster changes cancel pending proposals in mutation transactions.
- Room-lane creation supports up to 20 hosted invitees and explicit completed-table
  replacement with the observed old table/revision. Old closure, new identities,
  reservations, capacity accounting, invitation state and outbox effects commit
  together. Engine history/receipts and settlement intent remain intact.
- Hosted invitation eligibility is rechecked with locked users. Recipient answers
  may precede room membership, but validate invitation ownership and room access;
  acceptance joins the room without reserving a seat. A PostgreSQL per-user rolling
  window preserves the existing 30 hosted invitations/minute limit across servers.
- Fenced room commands cover enter/leave/delete, visibility and room invitation
  issue/answer. Departure locks bounded table lanes, then tables, then users; it
  releases eligible waiting/completed seats and queues atomically across tables,
  blocks active/locked seats, and schedules replacement deadlines on the table lane.
  Ordinary game commands never take the room lane. Deletion retains durable history
  behind the existing tombstone instead of deleting referenced games/receipts.
- Atomic catalog creation before owner assignment uses stable request identity and
  deterministic room ID; creator membership and invitations commit together. Retry
  after deletion resolves the original result without recreating the room.
- Explicit runtime registration now advertises room-creation and table-command
  capability version 2; activation validates those versions and new command families.

Completed C2 scope:

- `PostgresHostedQueries` reads coherent detached table projections, room metadata,
  previews, catalog/member pages, invitation eligibility and recipient invitation
  pages on any server. Existing per-player/spectator projection rules and database
  profile names are retained. Queries do not install hosts or run controllers,
  timers, ledger projection or proposal cancellation.
- Membership and private snapshots share a read-only repeatable-read view. Stable
  table/match/durable-game identities and separate table revision are exposed; an
  explicit missing target is not replaced with a different local match. Presence
  remains a separate gateway/Redis contract, not an inferred empty local list.
- `HostedCommandIngress` validates the supplied canonical actor identity,
  rechecks target access, requires stable IDs/revisions and rejects unsupported
  native families before admission. The actual authentication session is the
  transport's responsibility. Optional wakeup is bounded and happens after commit;
  failure leaves durable pending work. Actor-scoped status remains available after
  departure/rematch and never exposes another actor's request or engine state.
- `PostgresLedgerQueries` reads committed ledger/settlement effects and durable
  table names from one authorized read-only transaction. Finalization never runs
  from this read path. Histories beyond the configured bound fail explicitly rather
  than returning truncated balances.

Schema and API decisions:

- Added append-only migration 21: optional room-creation request/fingerprint columns
  with a per-creator unique request index, a targeted recovery-invitations GIN index,
  and bounded per-user invitation attempt arrays. No application database migration,
  dependency installation, application startup, live endpoint replacement or Redis
  connection was performed.
- Native durable contracts require explicit replacement identity and persistent
  departure/game targets. Legacy combined `/create` and `/leave`, field aliases,
  generic/Echo and ad-hoc room paths require explicit compatibility handling when
  routes/clients are bound. Do not regenerate request IDs or silently switch an
  unresolved request to a newer game. Existing live behavior remains unchanged.

Verification:

- Broad embedded-PostgreSQL regression: **216 passed** across creation, table/game
  execution, activation/runtime, room recovery, roster/closure, schema upgrade,
  placement/discovery and the new backend adapters.
- After final catalog/ledger/rollback additions, **24 focused tests passed**;
  strengthened complete player/spectator projection comparisons passed **5 tests**.
  Final completed-game departure/offer coverage passed **11 room-command tests**.
  These runs overlap; counts are not summed as unique tests.
- Covers private recipient answers, unauthorized reads/status, FIFO/revisions,
  duplicates, rules cancellation, failed wakeup with committed pending work, room
  tombstone retries, atomic multi-table departure rollback, all-three-game replacement
  at capacity, replacement/outbox rollback, invitation rate limits, and ledger reads
  leaving pending settlement untouched.
- Python compilation and whitespace checks passed. Full application/client suite
  was not run. The previously recorded offer-fixture intermittency is not claimed
  resolved. Embedded PostgreSQL uses one connection and does not prove independent
  process races, live network failover, or production capacity.

Limits and next step:

- C1/C2 backend components are complete; mounted routes, startup/shutdown assembly,
  transport dispatch and audience-safe delivery remain C3–C7 integration gates.
  The legacy `durable` setting still does not install this distributed runtime.
- Query/room-mutation bounds default to five open tables; configuration must remain
  consistent with room limits when binding services. Ledger snapshots default to
  1,000 games/batches; large-history aggregates/pagination need validation before
  rollout. Read replicas need a separate consistency contract; current adapters
  require the authoritative database. Delivery must reauthorize private audiences
  after queued membership/seat changes.
- **Exact next increment: 5**, explicit Redis wakeups/placement signalling,
  healthy-versus-failed command polling, recovery rescans and per-connection presence.
  Keep all live distributed bindings disabled until their delivery/client/correctness
  dependencies are ready. Capacity, observability, database HA and operational
  readiness remain the later task set.

### Increment 5a record: Redis signals and adaptive polling

Completed:

- Added explicit `RedisSignalTransport` for authenticated, targeted room/lane
  wakeups and placement demands. PostgreSQL receivers retain ownership/admission
  validation. Messages contain identities/epoch only, with signed freshness
  envelopes; no command payloads, private state or lease tokens enter Pub/Sub.
- Bounded queue/workers, operation timeouts, subscription round-trip probes,
  reconnect backoff and cancellation-safe shutdown bound notification work.
  Known outages skip foreground publication attempts. Missed/overflowed hints
  remain recoverable through PostgreSQL scanning and placement discovery.
- Added optional `RedisPollingPolicy` to the explicit room runtime: default
  healthy safety polling at 5 seconds and outage polling at 350 ms, both jittered.
  Health transitions request immediate rescans. Timer/settlement maintenance
  cadence, leases and database retry backoff remain independent of Redis health.
  A database scan failure resets its inbox deadline so retries use DB backoff
  instead of waiting for the healthy safety interval.
- Added optional `redis` dependency extra, lazy client construction and explicit
  composition/lifecycle documentation in [Redis notes](distributed-runtime-redis.md).
  No schema changes, live bindings, application startup or application database
  migration were performed. Existing runtime behavior is preserved when the
  optional polling policy is not supplied.

Verification:

- Redis codec/transport/polling plus runtime, routing, discovery and shutdown
  regression: **82 passed** before the final database-retry edge-case fix.
- After that fix and its regression test, polling/runtime checks: **20 passed**.
  These runs overlap; counts are not summed as unique tests.
- Isolated real Redis integration: **3 passed**, covering actual subscription
  dispatch, restart/reprobe and durable PostgreSQL command execution during Redis
  loss without changing the owner fence. Used redis-py **8.1.0** installed into
  the project virtual environment and Redis **7.4.2** built in a temporary test
  directory. The server used a temporary Unix socket with TCP/persistence disabled;
  no application Redis service was contacted. Sandbox socket binding required
  an approved elevated test run. These tests preceded the final DB-retry fix.
- Python compilation and whitespace checks passed. Real-server tests are opt-in;
  component tests exercise silent loss, saturation, stale/bad messages, reconnect
  rescans, cancellation cleanup and real PostgreSQL receiver paths.

Limits and exact next step:

- Increment 5 remains open. **Next: 5b**, shared per-connection presence and
  advisory owner cache, including TTL refresh/rebuild after Redis loss, protection
  from stale disconnects deleting newer connections, and authoritative PostgreSQL
  revalidation/invalidation of cached owner hints. Unknown presence is not offline.
- No presence, outbox/chat/notification delivery, client integration or production
  lifecycle assembly is enabled by 5a. Placement discovery retains its periodic
  catalog scan. Redis publication is advisory, never an execution acknowledgement.
- Embedded PostgreSQL uses one connection. Independent-process split-owner races,
  full failover integration and live cutover remain later gates; these tests do
  not establish production capacity. Capacity/observability/HA readiness remain
  the separate later task set.

### Increment 5b record: shared presence and advisory owner cache

Completed scope:

- Added `RedisPresenceStore` with expiring per-connection user/room indices and
  bounded atomic Redis scripts. Redis server time controls record expiry; reads
  filter expired records even when other sockets retain the index. Index cardinality
  and read sizes are bounded, and overflow is explicit rather than silently truncated.
- Added explicit `ConnectionPresenceRegistry` lifecycle: fresh socket IDs, bounded
  local inventory and refresh workers, TTL refresh, reconnect rebuild, periodic repair
  after lost keys, and joined shutdown. Exact-handle disconnects cannot erase another
  device or replacement socket. Known in-flight refreshes serialize with detach;
  uncertain Redis results may leave stale observations only until expiry.
- Presence is advisory: `observed`, `unknown`, and `overflow` never authorize
  membership, seat release or private delivery. User/room indices update separately
  and may be partially rebuilt; an empty successful read is not proof of offline
  users. Reads crossing reconnection return unknown. Platform sockets may omit room
  membership and still register in the user index.
- Added `RedisOwnerCache` and optional router integration. Serving/fresh PostgreSQL
  inspection results populate short-lived hints. A cached wakeup refusal/error
  compare-deletes that exact hint and revalidates through PostgreSQL; a cache miss,
  timeout or unavailable Redis uses the existing database route. Atomic writes reject
  older epochs/conflicting boots, and stale invalidations preserve newer routes.
  Reconnection bypasses reads for one cache TTL to rebuild authoritative hints.
- Added composition/security/lifecycle guidance to the Redis notes and updated
  cutover/API documentation. The same transport health callback must fan out to
  polling, presence and owner caching in the eventual process composition.

Verification:

- Final combined suite: **76 passed**, covering presence/cache units, real Redis
  state/transport integration, PostgreSQL-backed routing, signals and adaptive polling.
- Real Redis tests exercise socket isolation and expiry, multiple boot IDs, index
  overflow/corruption, restart rebuild, key-loss repair, atomic cache update/delete,
  cache timeout/expiry, and cached stale-owner refusal followed by actual PostgreSQL
  takeover routing. Lifecycle tests cover refresh/disconnect races, cancellation,
  bounded concurrency and observations crossing reconnects.
- Used the existing isolated temporary Redis 7.4.2 server and redis-py 8.1.0, with
  TCP/persistence disabled. Unix-socket test execution required approved elevation.
  PostgreSQL checks used the existing single-connection PGlite harness. Python
  compilation and whitespace checks passed.
- No schema/dependency changes, application database migration, application startup,
  live socket/route binding, commit or deployment occurred in this slice.

Decisions, limits and next step:

- Increment **5 is complete as explicit components**. Production composition remains
  gated under main-4 C3 and delivery/client/correctness dependencies. An owner-cache
  hit avoids the gateway lookup, never receiver/executor fencing. Redis subscriber
  count cannot detect every stale destination; PostgreSQL safety polling still
  recovers missed wakeups. Cache hints can remain briefly during drain/takeover.
- Presence metadata requires trusted Redis ACL access and gateway authentication/
  authorization. It cannot establish a complete fleet-wide offline list after
  failure. Defaults are 30-second presence TTL, 10-second refresh, eight workers,
  2,048 local sockets, 4,096 entries/index, 512 read limit, and 2-second owner-cache
  TTL. Consistent fleet configuration is required; these are bounds, not measured
  capacity claims. No global Redis key scanning is introduced.
- **Exact next increment: 6a**, bounded durable outbox publication/catch-up and
  authorized gateway delivery adapters. Recheck audiences when delivering, retain
  stable event IDs/sequences, handle duplicate publication, and support durable
  catch-up when presence is unknown/partial/overflowed or Redis hints are lost.
  Then implement room chat, direct-message and notification execution/catch-up
  within increment 6. Do not enable live distributed bindings yet.
- Independent-process locking/failover remains increment 8. Capacity testing,
  observability, database HA deployment and operational readiness remain the later
  task set.

### Increment 6a record: durable hosted outbox delivery and catch-up

Completed scope:

- Added `PostgresDeliveryStore` with bounded `SKIP LOCKED` publication claims,
  claim-token/expiry checks for renewal and completion, retry scheduling and attempt
  tracking. No database transaction spans Redis or socket I/O. Expired claims can
  be reclaimed; uncertain publication/completion can repeat stable event IDs.
- Added `OutboxPublisher` with bounded claim/fanout workers and presence-directed
  boot-ID deduplication. Signals contain only lane/event identities and sequences.
  Unknown/overflowed presence and partial/failed fanout remain retryable. Publication
  status never records client acknowledgement; empty/partial observed presence can
  miss gateways, so published rows remain readable through safety catch-up.
- Extended authenticated Redis envelopes with a validated `delivery` kind and
  optional gateway receiver. Existing wakeup/placement behavior remains supported.
  Receipt of a hint schedules local work only; ordering and content come from SQL.
- Added authorized hosted room/table/game replay in a read-only repeatable-read
  snapshot. Membership, deleted-room status, exact recipients, current seats and
  match identity gate payloads. Departed command actors retain access to their own
  strictly projected ACKs without retaining room/game access. Pages advance a scan
  boundary over other recipients' events without exposing those payloads.
- Added explicit `GatewayDelivery`: bounded subscriptions/workers/pages, per-stream
  serialization, healthy/failure safety polling, duplicate-hint coalescing and
  bounded unacknowledged windows. Socket send success advances only local progress.
  Explicit authenticated ACKs must be within that stream's offered boundary, then
  advance independent user/client/lane cursors monotonically. Lost ACKs replay stable
  IDs on reconnect; slow/failed streams close/reconcile without acknowledging work.
- Added append-only migration **22**, `command_inbox_lane_actor_idx`, for bounded
  index lookup of prior lane participation during departed-actor receipt access.
  Existing lane/sequence outbox and cursor keys cover replay and ACK lookups.
  No application database migration was applied.

Verification:

- Broader component regression: **112 passed** across delivery/store/lifecycle
  bounds, Redis signals/polling/presence/cache, room routing, game execution and schema
  upgrade tests, using the existing single-connection PostgreSQL/WASM harness.
- Real Redis delivery plus bounds checks: **8 passed** (seven bounds tests overlap
  the broader run). The real-server case verifies healthy Redis wakeup catch-up,
  continued SQL delivery after Redis stops, and replay after a missing client ACK.
  It used the existing private temporary Redis server with TCP/persistence disabled;
  Unix-socket binding required approved elevated test execution.
- Tests cover claim expiry/renewal/reclaim, stale completion rejection, failed finish
  retries, partial fanout, published-row replay, audience sequence gaps, device cursor
  isolation, revoked membership/seats/matches, unknown presence, missing history,
  slow sockets, bounded outstanding sends and cancellation-safe shutdown.
- Python compilation and whitespace checks passed. No live application startup,
  endpoint/socket binding, dependency installation, commit or deployment occurred.

Decisions and remaining limits:

- Authorization linearizes at the replay snapshot: a revocation committed before
  that read denies access; concurrent revocation cannot retract an already-authorized
  socket write. Gateways queue identities rather than private payloads. Clients still
  need revision-aware snapshot reconciliation and duplicate-event handling in 7.
- `published_at` is an advisory attempt marker, not proof of complete fleet fanout.
  Catch-up remains necessary for partial presence, missed hints and disconnected
  clients. These adapters do not promise exactly-once network delivery.
- Unsupported social lanes fail closed. Targeted table invitation replay currently
  requires room membership; existing authorized invitation queries remain available.
  Social notification delivery outside room membership is part of 6b.
- Missing outbox history/unknown event versions require explicit reconciliation;
  no retention pruning or automatic snapshot-bound cursor reset is enabled. The
  socket composition must bind actor/client/handles, serialize socket writers and
  implement the close/reconcile callback instead of keeping a failed stream silent.
- Defaults bound active streams, rows, workers and unacknowledged windows. Queries
  are per subscribed stream; no production throughput/capacity claim or independent
  process-locking proof follows from the component tests.
- **Exact next increment: 6b**, durable room-chat/conversation/recipient command
  execution and history/catch-up authorization, with stable request/message IDs,
  recipient permissions and an explicit treatment of legacy unsequenced messages.
  Extend publisher/reader social routing only alongside that access contract.
  Increment 6 remains open. Live C3 bindings, clients/LB and independent-process
  correctness remain later integration gates. Capacity/observability/HA readiness
  remain the separate later task set.

### Increment 6b1 record: durable room, table and game chat

Scope decision:

- The user expanded durable chat to room, table and game scopes and confirmed
  durability despite short-lived/deleted tables. Split 6b into reviewable slices:
  scoped chat (6b1), then conversation/recipient execution and social history (6b2).
  Durability protects delivery/reconnects; it does not imply permanent history access.

Completed:

- Added migration **23**: separate `table_chat`/`game_chat` lanes and scoped foreign
  keys/uniqueness. Extended existing `room_chat_messages` with optional table/game
  identities, scoped stream validation, per-lane sender/request deduplication and
  a recent-sender index. Existing durable room rows retain their identities/content.
- Added `ChatIngress`, `ChatLaneExecutor` and `ChatHistory`. Commands retain stable
  original fingerprints and actor-scoped receipts. Accepted messages, deterministic
  IDs, ordered history, outbox events and outcomes commit atomically. DB-timed
  per-conversation rate limits survive restarts; retries do not duplicate messages.
- Preserved room-chat active-play pauses and Call Break break exceptions, plus
  seated-send/queued-read table permissions. New game chat requires a current seat
  and active game reservation. Authorization is rechecked at execution and replay.
  Table read locks protect coherent execution-time checks without external I/O;
  chat has independent lane ordering and never mutates the engine/checkpoint.
- Table history spans real rematches. Game identity is the durable game ID, including
  successive Flush rounds; normal game-chat access closes on completion/replacement.
  Room/table deletion closes normal access without erasing durable history/receipts.
  Same-request retries and safe actor-only ACKs remain available after departure.
- Registered scoped chat executors and the explicit `durable_scoped_chat: 1`
  capability. Activation validates supported chat work; placement discovery includes
  chat-only demand; owner wakeups and fallback scanning execute all three chat lanes.
  A replacement owner recovers pending chat, and stale fences cannot execute it.
- Extended publisher/catch-up authorization for chat; Redis still carries IDs only.
  Spectators cannot receive table/game content, queued users cannot send table chat,
  and revoked participants can receive only their own safe ACKs. Deleted senders
  receive a durable rejection without an invalid-recipient outbox row poisoning the
  lane. Added [scoped chat contracts](distributed-runtime-chat.md).

Verification:

- Broader regression: **127 passed** across scoped chat, schema upgrade, activation,
  room runtime/routing, placement discovery, delivery, inbox and real rematch behavior.
- After the final deleted-sender guard and regression addition, focused chat/upgrade
  checks: **13 passed**. Runs overlap; counts are not summed as unique tests.
- Covers all three games, atomic rollback before completion, dedupe conflicts,
  durable rate rejection, seat/queue/membership changes, unchanged engine checkpoints,
  table closure, room deletion, rematch history, replacement-owner recovery and
  preservation/immutability of pre-migration durable room-chat records.
- Python compilation and whitespace checks passed. SQL runs use the existing
  single-connection PostgreSQL/WASM harness; they are not independent-process race
  or capacity evidence. No Redis protocol changed in this slice.
- No application database migration, dependency installation, live startup/route
  binding, client change, commit or deployment occurred.

Limits and exact next step:

- **6b1 is complete as explicit components; 6b and main 6 remain open.** Next is
  **6b2**, conversation/direct-message and recipient-notification execution, durable
  history/catch-up permissions and explicit treatment of legacy unsequenced records.
  Extend social publisher/reader routing only with those access rules.
- Legacy room/table chat remains ephemeral in its existing live handlers. There is
  no invented backfill of in-memory messages. Native durability starts at admission
  through the new path; previously persisted room-chat rows are preserved.
- No purge duration/job or archival permission is enabled. Closed scopes are already
  inaccessible through normal reads; physical retention cleanup needs an explicit
  policy and a safe outbox reconciliation boundary. Old game chat is retained but
  inaccessible after completion/replacement; table chat remains available to current
  eligible participants across rematches.
- Native chat records expose sender IDs; mounted clients must resolve display names,
  escape text, retain request IDs, subscribe to the correct durable scopes, and fetch
  history when chat permission reopens. Older executors lack the new capability and
  must be drained/upgraded before native chat ingress is enabled.
- Live C3 composition, clients/LB and independent-process correctness remain later
  integration gates. Capacity, observability, database HA and operational readiness
  remain the separate later task set.

### Increment 6b2 record: durable direct messages and notifications

Completed:

- Added `SocialIngress`, `NotificationProducer`, `SocialLaneExecutor`,
  `SocialRuntime` and `SocialHistory`. Stable request fingerprints, deterministic
  message IDs, message/outbox/receipt atomicity and durable read-state commands
  extend the existing inbox; platform lanes are serialized independently of rooms.
- Preserved accepted-friend send/read policy, including execution-time friendship
  locking and authorization on replay. Revoked participants retain only own safe
  ACK/status access. Notification creation is trusted-service-only and transaction
  composable; read/history access is recipient-only.
- Added bounded shared-worker polling and local wakeups. Platform pending scans run
  even with healthy Redis because these lanes have no pinned owner. Existing Redis
  delivery hints now address both conversation users with gateway deduplication.
- Added authorized stream bootstrap/discovery, native sequenced history and separate
  timestamp/UUID pagination for legacy rows. No fabricated legacy event sequences.
- Migration **24** adds targeted pending/history/discovery indexes and non-cascading
  native notification origin metadata. Upgrade preserves durable notification IDs,
  content/read state and legacy behavior. Added [social contracts](distributed-runtime-social.md).

Verification:

- **85 passed** across social schema upgrade, social commands/history, scoped chat,
  delivery/bounds, inbox, room schema upgrade, player behavior and Redis signals.
- Covers retry conflicts, revoked friendship, private recipient access, foreign-ID
  read rejection, atomic rollback, room-independent recovery, legacy pagination,
  stream discovery, two-user gateway deduplication and notification origin deletion.
- Earlier focused runs overlap this suite and are not added to its count. SQL tests
  use the single-connection embedded PostgreSQL harness, not independent processes.
- Compilation and whitespace checks passed. No application migration, live route or
  startup binding, deployment, commit, or dependency installation occurred.

Limits and exact next step:

- **6b2, 6b and main 6 are complete as explicit components.** C3 must still mount
  routes/workers and wire notification producers into source business transactions.
  Live handlers remain legacy. Upgrade all workers before enabling native ingress;
  do not permit competing legacy/native writers.
- Clients must discover new streams, resolve sender profiles, retain request IDs,
  reconcile history and distinguish notification read state from delivery ACKs.
  Native notifications require the new readers; old actor inner joins are unsuitable.
- **Next: 7a**, reliable client command lifecycle and focused client tests, starting
  with the existing pending-action helper. Remaining 7 slices cover social delivery
  discovery/reconciliation and load balancing. C3 live assembly and increment-8
  independent-process correctness remain gates. No retention/purge policy is enabled;
  capacity, observability, HA and operational readiness remain the later task set.

### Increment 7a record: reliable client command lifecycle

- Added explicit `DurableCommandClient` for inbox-backed game/table/room/social
  envelopes. IDs, targets, matches, revisions and nested payloads stay unchanged
  across retries. Pending receipts lead to status-only queries; only validated
  matching terminal receipts resolve the intention. New intentions are blocked
  while unresolved. This adapter does not cover atomic room-catalog creation.
- Transport/HTTP errors, rematches and malformed responses preserve uncertainty.
  Ten-second default deadlines, cancellation and one concurrent reconciliation
  bound client work; late responses cannot settle a subsequent attempt. Logout
  permanently closes the session without implying server-side command cancellation.
- Kept legacy helpers/live screens unchanged because distributed server endpoints
  are still unmounted. The caller supplies an authenticated submit/status transport.
  No dependency, migration, startup, commit or deployment changes.
- Verification: **37 passed** in the new lifecycle and existing client-helper suites;
  full client TypeScript check and whitespace checks passed. Tests cover lost
  commits/responses, pending/rejected status, malformed or foreign receipts,
  HTTP errors, timeout/abort/concurrent reconnects, payload isolation, late responses,
  logout and ID generation without native Web Crypto. These are client component
  tests, not live backend integration or independent-process correctness evidence.
- State is in-memory and must outlive socket/table components; app termination/page
  reload persistence and mounted ownership are still integration work. HTTP errors
  do not automatically release an uncertain request; definitive pre-admission error
  mapping requires a concrete route contract. Added [client contracts](distributed-runtime-client.md).
- **7a complete as an explicit component; main 7/C6 remain open. Next: 7b**, stream
  discovery/subscriptions, delivery cursors and snapshot/history reconciliation.
  Then 7c mounted controls/session recovery and LB composition; C3 live cutover stays
  gated on complete compatibility and increment-8 correctness. Operational work
  remains the later task set.

### Increment 7b record: delivery discovery and reconciliation

- Added explicit `DurableDeliveryClient` and bounded `discoverDeliveryStreams`.
  Recovery loads authorized current views before replay; new visible events refresh
  state/history instead of applying stale game deltas. Installed progress and
  durable ACK are distinct, allowing lost-ACK retries without duplicate application.
- Added `after_sequence` to gateway pages and verified initial/reconnect/subsequent
  boundaries in backend tests. Clients reject missing frames, wrong lanes, malformed
  events and unsupported versions, while allowing private-event sequence gaps.
- Bounded serialized per-lane operations and discovery; close/timeout invalidate
  late async loads. Catalog failure/overflow does not produce partial subscription
  replacement. Each subscription incarnation and device has independent progress.
- These are explicit adapters: mounted session ownership, subscription handshake,
  frame buffering, concrete authorized snapshot/history loaders and UI reducers
  remain 7c/C3. No automatic retention-boundary reset, reload persistence, routes,
  startup binding, migration, dependencies, commit or deployment were introduced.
- Verification: **57 client tests passed** across delivery and command lifecycles
  and legacy command helpers; full client TypeScript check passed. Backend delivery
  regression: **21 passed** (delivery and bounds). Whitespace and Python compilation
  checks passed. Tests do not establish independent-process
  correctness or capacity. Updated client/delivery contracts with exact caller duties.
- **Next: 7c1**, authenticated session ownership and bounded subscription/reconnect
  composition, including concrete history/snapshot loaders and reload policy; then
  mounted native control mappings and LB integration. Main 7/C6 and C3 remain open.
  Operational readiness remains the later task set.

### Increment 7c1 record: session ownership and bounded subscriptions

- Added `DistributedSession` above screen lifetimes. Stable command slots retain
  original intentions across remount/reconnect. Disconnect removes subscriptions;
  logout permanently closes commands and clears lane views. No credential rebinding.
- Composed complete authorized discovery with periodic refresh, bounded subscription
  workers, per-lane ordered buffering, handshake recovery, offered-boundary ACKs
  and revocation cleanup. Obsolete callbacks/late opens cannot install private views.
  Overflow/timeouts drop streams for later rediscovery instead of growing queues.
- Added device/tab-scoped storage identity helper, native sequenced-history pagination
  and revision-aware detached view replacement. Reused bounded delivery deadlines.
- Defined reload policy: never reconstruct uncertain commands with new IDs. Persistent
  account-scoped journaling before send is required before native controls go live.
  Current session state survives remount/reconnect, not process death. Platform store
  binding and duplicated-tab ownership remain explicit integration duties.
- Verification: **71 client tests passed**, full client TypeScript check and whitespace
  checks passed. Covers page buffering/order, command preservation, catalog changes,
  failed discovery, overflow, revocation, logout, late opens, timeouts, worker bounds,
  history truncation and stale revisions. Transport is mocked; no production load or
  independent-process correctness claim follows. No dependencies, migrations, live
  bindings, commits or deployments changed.
- **7c1 is complete as explicit composition; main 7/C6 remains open.** Next: **7c2a**,
  durable pending-command journal and crash/reload isolation tests. Then platform
  identity/session integration, concrete hosted/social/legacy loaders and mounted
  HTTP/WS control mappings, followed by LB/C3 composition. Increment-8 correctness
  remains required for cutover; operations/capacity remain the later task set.

### Increment 7c2a record: durable pending-command journal

- Added versioned `CommandJournal` scoped to authenticated account/device, bounded
  to 32 slots/1 MiB. Saves original envelopes before admission to client send work;
  validates and saves receipts before local resolution. Restores all session slots,
  including offscreen requests, with exact retry or status-only recovery as appropriate.
- Storage read/write/read-back failures block further work rather than assuming no
  commit. Reopening inspects the persisted truth. Corrupt/version/scope mismatches
  remain untouched and fail closed. Terminal slot release is allowed; unresolved
  work cannot be released. Closed accounts retain uncertain disk records without
  leaking them into another account's namespace.
- Added optional persistence to existing command/session components. Logout aborts
  late work and closes journal access. Sequential stale-owner detection is included;
  true exclusive cross-tab/platform ownership remains 7c2b. Storage must synchronously
  complete atomic durable writes; async write-behind adapters are not supported.
- Verification: **87 client tests passed**, full TypeScript and whitespace checks
  passed. Includes crash before send, lost server response, pending/terminal reload,
  write failures before/after commit, corrupted receipt, stale ownership, storage
  bounds, logout/account isolation and restoration through session composition.
  Storage/transport are mocked; physical durability and live correctness are not proven.
- No dependency, application migration, live route/screen, platform storage install,
  commit or deployment changes. Earlier unjournaled constructors remain explicit;
  live native mutation wiring must supply persistence. No automatic uncertain-work
  deletion or private snapshot storage is enabled.
- **Next: 7c2b**, platform storage binding and exclusive device/tab/session ownership,
  then concrete mounted control/HTTP/WS/view adapters and LB/C3. Main 7/C6 remains
  open; increment-8 correctness and later operational work retain their scope.

### Increment 7c2b record: platform storage and exclusive ownership

- Added explicit web localStorage/Web Locks and native synchronous SecureStore
  bindings, plus shared owner construction and authenticated `OwnedSession` lifecycle.
  Journal restoration follows lock acquisition; close invalidates journal access
  before release. No memory/unlocked fallback on storage or lock failure.
- Browser policy deliberately chooses one active same-account session per profile/
  origin; duplicate tabs are refused rather than given a new identity that bypasses
  pending work. Handoff restores the stable device ID and original journal. This
  replaces the earlier unrestricted per-tab-identity proposal. Different devices
  and accounts retain independent namespaces.
- Native registry guards the app's single JS runtime, including module reloads;
  it is not a cross-process OS lock. SecureStore errors block sends. Large-value
  limits and platform lifecycle semantics require device validation; no full 1 MiB
  native capacity claim is made. No new dependencies or native build edits.
- Verification: **101 client tests passed**, full TypeScript and whitespace checks
  passed. Covers duplicate ownership, preserved handoff, storage failures/corruption,
  account isolation, late acquisition, logout and session-before-lock cleanup order.
  Tests inject browser locks/native storage; real browser termination and native
  keychain smoke validation remain cutover gates.
- No application migration, live mounting, commit or deployment occurred. Platform
  acquisition remains explicit; screens still use legacy routes. No uncertain-work
  purge or automatic duplicate-tab identity regeneration was introduced.
- **Next: 7c2c**, explicit authenticated server/client HTTP/WS mapping, subscription
  handshake/ACK ownership and concrete hosted/social/history adapters; then mounted
  root/control compatibility and LB/C3. Main 7/C6 remains open. Independent-process
  verification stays increment 8; operational work remains the later task set.

### Increment 7c2c1 record: command and delivery transport

- Split 7c2c into reviewable transport and view/control slices. Added an explicit
  unmounted `/distributed` router factory for bearer-authenticated submit/status and
  first-frame-authenticated multiplexed delivery WebSockets. Request JSON cannot set
  actor identity; ingress selection preserves hosted/chat/social authorization.
- Added socket-local aliases, bounded serialized sends/frames/subscriptions, origin
  allowlist, heartbeat timeout, ACK offered-boundary checks and disconnect cleanup.
  Paused gateway admission sends the durable initial cursor before activating pages;
  default existing subscriptions retain immediate activation behavior.
- Added client HTTP and multiplexed socket transports matching these contracts.
  Commands retain original envelopes; HTTP failure never becomes a terminal receipt.
  Socket handshake/ACK confirmations, cancellation, heartbeat and obsolete-alias
  handling compose with journaled session components.
- Verification: **106 client tests**, **28 backend transport/delivery tests**, full
  TypeScript, Python compilation and whitespace checks passed. Includes authenticated
  routing, actor injection rejection, wrong origins/credentials, foreign/unoffered
  ACKs, cleanup and paused-handshake ordering against embedded PostgreSQL delivery.
  Router/client transport doubles are not full network or multi-process evidence.
- No application migrations, live mounts, dependency changes, commits or deployment.
  Socket presence registration, root reconnect/credential lifecycle, concrete reads
  and mounted controls remain integration gates; gateway safety polling still applies.
- **Next: 7c2c2**, authorized projections/history/stream discovery and concrete control
  mappings, then authenticated-root/presence/C3 integration and LB. Main 7/C6 stays
  open; platform smoke and increment-8 correctness still precede cutover. Operational
  readiness remains the later task set.

### Increment 7c2c2 record: authorized reads and control mappings

- Added `DistributedReads` and optional unmounted read routes for selected hosted
  snapshots, recipient/selected-scope bootstrap, social catalogs, native chat/social
  history and separate legacy timestamp/UUID pages. Bootstrap checks membership,
  table/game relationships, scoped chat permissions and accepted friendship before
  creating a lane; no game state, commands or owner leases are created.
- Added `DistributedReadClient`: pins selected tables, walks bounded native history,
  preserves separate legacy cursors and merges recipient/social/selected stream IDs.
  Discovery fails as a whole on permission/error/overflow; optional scope eligibility
  remains an explicit root responsibility. No historical-game fanout scan is added.
- Added journal-compatible game/table/room/chat/notification command mappings with
  separate engine/table revisions and durable game/match identities. Scoped chat
  maps to send-chat, conversations to send-message. Retry keeps the original target.
  Actual UI event bindings, combined leave policy and room-catalog creation remain
  audited mounted integration work rather than implicitly changing live controls.
- Verification: **111 client tests**, **39 backend tests** (reads/routes, existing
  chat/social and hosted-query ingress), full TypeScript, Python compilation and
  whitespace checks passed. Covers actor-bound bootstrap, rejected foreign scopes,
  revoked friendship/membership, route bounds/cursors, history pagination, independent
  revisions and Flush-style durable-round preservation. SQL uses embedded PostgreSQL;
  route/client doubles are not live-network or independent-process evidence.
- No application migrations, dependencies, live mounts, commit or deployment changes.
  Completed 7c2c as explicit adapters; main 7/C6 remains open. **Next: 7c2d**,
  authenticated root/selected-view reconnection composition and actual screen-control
  parity, then C3 socket presence/live assembly and LB. Platform smoke and increment-8
  correctness stay cutover gates; operational work remains the later task set.

### Increment 7c2d1 record: authenticated root and selection composition

- Added `DistributedRootRuntime` and owner-supervisor factory composing journaled
  session, authenticated command/read transports, multiplexed sockets and selected
  room/table/game/chat views. Selection/socket changes preserve pending identities;
  logout/auth expiry closes work and journal ownership. Retry is bounded with capped
  delay; old callbacks/selections cannot commit into replacement subscriptions.
- Added selected-snapshot identity/revision checks and serialized bounded primary
  snapshot reads across hosted lanes sharing a screen. Root control admission uses
  installed table/game revisions and exact durable identities. Scoped histories and
  social bootstrap/catalog loading use production client adapters.
- Introduced typed HTTP status errors for auth expiry without converting errors into
  durable rejections. Fixed receipt recovery being skipped when catalog discovery
  failed; the two paths now progress independently.
- Audited live room/table controls: combined leave, initial room creation, lifecycle
  shortcuts and receipt-driven navigation still require screen-facing parity. Split
  7c2d into this explicit root composition and 7c2d2 controllers; no partially
  implemented distributed behavior is mounted.
- Verification: **119 client tests**, full TypeScript and whitespace checks passed.
  Covers composed view discovery/loading, socket retry/replacement, selection changes,
  old-callback cancellation, persisted request preservation, stale revisions, auth
  expiry and command recovery during discovery failure. Peers/storage remain test
  doubles; no browser/native or multi-process server proof is claimed.
- No application migrations, dependency changes, live mounts, commits or deployment.
  **Next: 7c2d2**, screen-facing lifecycle controllers, deterministic leave mapping
  and atomic initial room creation, then C3 socket presence/server assembly and LB.
  Main 7/C6 stays open; platform smoke/increment-8 correctness remain cutover gates;
  operations and capacity remain the later task set.

After each increment record:

- Completed scope and touched components.
- Migrations or API contract changes.
- Verification performed and remaining limitations.
- Decisions/deviations from this baseline, with rationale.
- Exact next increment and any dependencies.

### Increment 7c2d2 record: screen controllers and catalog creation

- Added explicit session-owned screen command controllers with pending/busy/error
  state, immediate reconciliation and matching accepted-receipt callbacks. Unmount
  cancels the screen wait without deleting the journal. Background receipt recovery
  can update a mounted observer; rendering/navigation failures cannot change outcomes.
- Added deterministic combined leave: eligible open/completed/ended tables use
  `leave-seat`; active Call Break uses `abandon`; active Marriage/Flush uses
  `FOLD_AND_LEAVE`. Locked/unseated cases fail before admission. Retries retain the
  original operation and observed identities/revisions despite changed views.
- Added lobby mappings and explicit gameplay, room, chat and notification controls.
  Root `screen(slot, callbacks)` binds controllers to persisted session slots.
- Added journaled catalog creation and optional authenticated `POST /distributed/rooms`
  using existing atomic `PostgresRoomCreation`. Lost-response retries use the same
  request ID and return the same room. Accepted catalog receipts carry a room ID,
  not a lane/sequence/status reference. No migration or live route mount is added.
- Verification: **134 client tests**, **11 backend transport/catalog tests**, full
  TypeScript checking passed. Backend tests include atomic catalog retry/conflict,
  tombstone behavior and invite rollback. Two existing Starlette deprecation warnings
  remain. Python compilation and whitespace checks passed.
- Limits: these are explicit adapters with mocked client peers, not live UI or
  independent-process evidence. Accepted navigation is once per controller lifetime;
  explicit recovery after remount may navigate again, so destinations must be
  idempotent. Journal version remains 1 with a target-specific catalog receipt;
  older clients cannot interpret that receipt and must fail closed on rollback.
  Transport failures retain uncertain catalog intentions; they do not certify rejection.
- Exact next step: **C3a**, explicit server startup/shutdown and authenticated socket
  presence composition. Main 4/7 and 7c2d live integration remain open. Do not enable
  partial distributed behavior or competing legacy/native writers.

### Increment C3a record: explicit server lifecycle and socket presence

- Added `build_server`/`DistributedServer`: one boot identity, ordered registration,
  room runtime, presence, gateway, social, signal receivers, publisher and discovery
  startup. Composes real command/read/catalog routes without importing/mounting them
  in the legacy application. Pool/Redis are borrowed unless explicitly transferred.
- Added bounded router admission for HTTP and socket tasks. Partial/cancelled startup
  cleans attempted components; shutdown fences admission, stops discovery/dispatch,
  joins requests, drains room work and closes owned resources last. Failed component
  cleanup keeps resources open for retry. Exposes the existing drain uncertainty report.
- Bound Redis health to adaptive inbox polling, delivery reconciliation and presence
  refresh. Redis unavailability does not block startup or durable command execution.
- Added authenticated user socket presence and server-resolved room hints shared by
  subscriptions. Unsubscribe/revocation/disconnect removes hints without mutating
  membership or seats. Former-member ACK access does not imply room presence.
  Shutdown attempts socket close code 1012 and joins cleanup before closing the pool.
- Verification: 86 targeted server/transport/delivery/presence/shutdown/Redis tests
  passed; final server/transport run passed 25 tests after socket shutdown coverage
  (87 distinct tests). Includes assembled HTTP catalog/table creation through owner
  discovery/execution during Redis outage, against PostgreSQL/WASM. Python compilation
  and whitespace checks passed. Two existing Starlette deprecation warnings remain.
- Limits: controlled broker/socket peers and embedded SQL do not establish independent
  process failover or capacity. No live runtime switch, migration, client edit or
  deployment. Presence bounds count registrations, including distinct subscribed rooms;
  hints never grant authorization. Optional owner caching remains unbound.
- Exact next step: **C3b**, application lifespan/bootstrap and route compatibility
  boundaries with explicit writer exclusion. Main 4/7, mounted clients/LB, platform
  smoke and increment 8 remain open; operational readiness remains the later task set.

### Increment C3b record: integration application and compatibility boundary

- Added explicit `create_app(runtime_mode='distributed-integration',
  distributed_server=...)` selection. Requires a fresh preconfigured assembly; no
  environment flag or default changes activate distributed behavior. Production
  `distributed` selection and mixed legacy/server arguments fail before startup.
- Added isolated ASGI lifespan that starts/stops C3a components, including cleanup on
  startup failure. Mounts the native router and lifecycle health endpoint only;
  borrows/transfers resources according to the supplied server configuration.
- Added protocol boundary that rejects old HTTP routes with a structured 409 and
  old sockets with 1008 before dispatch. No Echo/ad-hoc/legacy game services or
  static client are constructed. Exact captured CORS/socket origin allowlists agree.
- Verification: **37 application/server/transport/auth tests** passed, including
  PostgreSQL/WASM native creation/read through the real application lifespan,
  unavailable-before/after-lifespan behavior, partial startup cleanup, accidentally
  mounted legacy handler exclusion, origins and unchanged legacy default behavior.
  Python compilation and whitespace checks passed. Two existing Starlette warnings
  remain; no client edits, migrations, deployments or live runtime switch occurred.
- Scope decision: writer exclusion is within the integration app. It cannot stop
  older external writers; dedicated integration data is required and production
  activation stays blocked. Authentication issuance/profile/friendship/ledger and
  other legacy platform routes are explicitly unavailable here, not silently reused.
- Exact next: **C3c**, shared authentication/profile/platform routes and remaining
  compatibility audit, then live client bindings/LB and increment-8 correctness.
  Main 4/7 stay open until production integration/cutover dependencies are complete.

### Increment C3c record: shared platform routes and native read bindings

- Added `SharedPlatform` to the explicit server factory, using the same pool/auth
  service as native commands. Reviewed exact account/profile/player GET/POST/PATCH
  routes are mounted with lifecycle admission; guest login is an explicit disabled-
  by-default option. Middleware admits only matching shared method/path contracts
  outside the native prefix, adds no-store, and preserves legacy writer rejection.
- Added PostgreSQL-backed player search/public reads to avoid serving stale gateway
  caches after another service updates a profile. Own-profile validation and existing
  account/session contracts are reused without constructing legacy game services.
- Exposed bounded native catalog, room/table invitation and membership reads plus
  the existing authorized read-only ledger projection. No legacy finalization-on-GET
  or unsequenced message/notification mutation handlers are mounted.
- Recorded route mappings and remaining compatibility gaps in
  `docs/distributed-runtime-platform.md`: friendship notifications, browser/provider
  login, active-socket revocation, manual settlements and client read-shape mappings.
  Shared account/profile writes retain existing semantics, not game-inbox receipts.
- Verification: **53 targeted tests passed**, including real PostgreSQL/WASM account
  issuance/revocation, actor-bound profiles, cross-service freshness, guest/method
  boundaries, catalog privacy, authorization and bounds. Existing ledger tests verify
  no read-triggered finalization. Added datetime parameter support to the SQL test
  harness for authentication sessions. Python compilation and whitespace checks passed;
  two existing Starlette deprecation warnings remain.
- No client edits, migrations, deployment or production runtime switch. Writer
  exclusion is still within the isolated integration application, not older external
  processes. Exact next increment: **C3d**, durable friendship commands with atomic
  notification production. Main 4/7 and the other cutover gates remain open.

### Increment C3d record: durable friendship commands

- Added request/accept/remove friendship commands on the existing conversation pair
  lane. Participants/users and empty payloads are validated without requiring an
  already accepted relationship; DM/history authorization retains that requirement.
  Pair-lane FIFO now orders friendship changes and direct messages together.
- Added explicit pending-request cancellation/rejection and accepted-friend removal
  semantics. Invalid transitions complete rejected receipts; same-ID retries retain
  original outcomes even after later relationship removal. No receipt schema changes.
- Friendship changes, actor ACK/receipt and deterministic recipient notification
  intents commit atomically. Unexpected failures after effects begin propagate and
  roll back the claim, including validation errors from downstream effects. Recipient
  capacity exhaustion leaves commands pending. Notifications materialize asynchronously
  using existing social workers and sequenced outbox delivery, not legacy inserts.
- Both users receive change records: actor `friendship_changed`, other user a specific
  requested/accepted/rejected/cancelled/removed notification. Client rendering/mapping
  remains later work; historical payloads do not replace current friendship reads.
- Verification: **40 targeted tests passed**, including 13 new friendship tests,
  existing social/transport/platform/schema regressions, rollback on second-notification
  and receipt failure, backpressure, ordered removal-before-message rejection, own-ACK
  privacy and real HTTP-to-worker catch-up while Redis is unavailable. PostgreSQL/WASM
  is not independent-process concurrency evidence. Python compilation and whitespace
  checks passed; two existing Starlette deprecation warnings remain.
- No migrations, client edits, deployment or production selection changes. Old
  friendship mutation aliases remain blocked. Exact next: **C3e**, existing-socket
  session revocation/expiry, followed by browser/provider auth and remaining platform/
  client compatibility. Main 4/7 and increment 8 remain open.

### Increment C3e record: established-socket authentication lifetime

- Added `SocketSession` with a periodic watchdog and a serialized freshness gate for
  incoming operations/outbound frames. Uses the exact original token and shared
  authenticator; identity changes are rejected. Default checks are five seconds apart
  with a two-second timeout. Slow/outdated results cannot extend authorization.
- Revocation/expiry closes 1008; verification outage/timeouts close 1011 rather than
  retaining stale authentication indefinitely. Session failures interrupt idle sockets
  without Redis or heartbeat dependence. Independent tokens for one user stay valid.
- Cleanup joins the watchdog, unsubscribes delivery and removes presence. Stopped
  sessions reject late delivery callbacks. Existing server shutdown retains 1012 and
  cancellation-safe joining. No seats, memberships or durable commands are changed.
- Verification: **43 targeted tests passed**, including eight new tests with actual
  PostgreSQL/WASM session issuance/revocation/expiry through separate service objects,
  identity/outage/timeout failures, idle cleanup, late callbacks and token isolation.
  Existing server/application/transport/platform tests also pass. Python compilation
  and whitespace checks passed; two existing Starlette warnings remain.
- Limits: bounded eventual checks, not atomic or instantaneous database/socket logout;
  already sent frames cannot be recalled. One check stream per socket, no batching or
  capacity claim. SQL/ASGI tests do not replace independent-process evidence. Legacy
  production sockets stay unchanged; no migration, client edit or deployment occurred.
- Exact next: **C3f**, reviewed browser/provider sign-in composition. Manual settlements,
  client mappings, main 4/7 and independent-process/LB/platform gates remain open.

### Increment C3f record: browser sign-in composition

- SharedPlatform now creates BrowserSocialAuth from existing validated environment
  configuration using PostgresBrowserAttempts and PostgresSocialIdentityStore bound
  to the same auth/profile services. Only reviewed provider-list/start/callback/
  completion routes are mounted with lifecycle admission and no-store responses.
- 19 tests passed: cross-gateway SQL-backed attempt completion, wrong-secret/replay
  rejection, native token usability and existing browser/platform regressions.
  Provider exchange is mocked; real provider smoke remains external validation.
- No new credentials, migration or runtime activation. Next C3g: durable manual
  settlement commands; continue sequentially without further routine confirmation.

### Increment C3g record: durable manual settlements

- Added create-settlement and settlement-action commands on the fenced room lane.
  Creation claims 1–1000 completed unclaimed ledger games, checks zero-sum balances
  and requires an outstanding participant. Actions enforce payer/payee identity and
  OPEN → MARKED_PAID → RESOLVED transitions. No transfer of money is performed.
- Settlement batches, game claims, transfers/action audit, actor receipt and room
  change event commit together. Stable IDs preserve retries; unexpected persistence
  failures roll back effects. Legacy mutation routes remain blocked.
- Advertised manual_settlement version 1 in activation capabilities. No migration
  or receipt schema change. Clients refresh the existing ledger after acceptance.
- Verification: 18 settlement/activation tests passed, including rollback on receipt
  failure, deduplication, conflicting request identity, authorization and transitions.
  Fifteen server tests also passed in the preceding run. PostgreSQL/WASM coverage
  does not establish independent-process locking. Production remains unchanged.
- Next: 7c2e client platform mappings and mounted integration, then LB/process tests.

### Increment 7c2e1 record: native platform client mappings

- Added separate bounded catalog/member/room-invitation/table-invitation read cursors
  and authorized ledger reads. Added canonical friendship pair targets and manual
  settlement controls through the existing persisted controller lifecycle.
- Verification: 22 mapping/controller tests and full client TypeScript checking passed.
  Retries retain their original target/payload; unauthorized reads are not empty pages.
- Next: 7c2e2 mounted integration entry using the existing game screens and one
  authenticated journal/session. No production client selection changed.

### Increment 7c2e2 record: mounted integration client

- Added EXPO_PUBLIC_RUNTIME_MODE=distributed-integration as an explicit build entry;
  production selection remains unchanged. One deployment/account-scoped persistent
  journal owns commands across room/table navigation, disconnects and reloads.
- Mounted native catalog/create/enter/leave, table creation/lifecycle/rules and game
  actions using existing Call Break, Marriage and Flush screens. Room chat uses its
  own durable command slot. Legacy room services/sockets are never mounted here.
- 120 targeted client tests, TypeScript checking and integration web export passed.
  Chromium smoke verifies sign-in, room creation, persisted command ID, reload and
  room selection without legacy room traffic. It exposed an illegal browser fetch
  receiver; the read client now binds fetch to globalThis with a regression test.
- Limits: this is an integration client, not full production screen parity. Platform
  panels, table/game chat selection and transient pokes still need integration.
  Native hardware storage/lock and real provider smoke remain validation gates.
- Next: C3h/7d isolated launcher/LB and real process tests; close remaining parity
  before enabling the distributed production selection.

### Increment C3h/7d record: isolated launcher and actual load balancer

- Added explicit integration bootstrap with empty-dataset-only initialization,
  persistent runtime marker, exact schema verification and owned resource lifetimes.
  This branch's legacy Database.open refuses marked datasets under the migration
  lock. No implicit conversion of existing data and no production selector added.
- Added separate integration Dockerfile/compose and nginx configuration. HTTP has
  no affinity requirement; existing WebSockets stay on their gateway. Upgrade and
  timeout configuration is explicit; the proxy does not retry mutations.
- Verification: 9 bootstrap validation/SQL tests passed. An actual temporary nginx
  process with two independent ASGI gateways, real PostgreSQL and Redis passed HTTP
  distribution, stable room retry and WebSocket delivery/ACK during Redis failure.
  Docker itself is unavailable here; compose/container image execution is unverified.
- Temporary PostgreSQL/nginx were built for tests, without global installation or
  touching application data. Old deployed binaries still require credential/network
  exclusion at cutover; a marker cannot fence code that does not check it.
- Next: finish independent-process pause/kill/takeover tests and client platform
  bindings, then consolidated regressions and remaining browser/native gates.

### Increment 7c2e3 record: native platform and scoped chat bindings

- Bound existing friendship and ledger components through optional native transports;
  their legacy default behavior is retained. Durable controllers govern pending,
  rejected and accepted effects, and message drafts clear on delayed acceptance.
- Added profile/phrase, native notification read and paged room/table invitation
  controls, room settings/invitations and explicit room/table/game chat selection.
  Client reads have cancellation/time bounds. Revoked sessions clear private views.
- Fixed browser fetch receiver binding and optional paused-chat discovery isolation.
  The latter prevents a denied room chat from suppressing an authorized game view.
- Verification: 236 client tests passed; TypeScript, integration web build and iOS
  export passed. Mounted Chromium smoke covers persisted room creation/reload plus
  all three existing game screens using generated authorized projections. These are
  mocked transport/browser composition tests, not native hardware or provider proof.

### Increment C3i record: shared phrases and expiring pokes

- Reviewed phrase routes share the existing SQL service across gateways. Actor-scoped
  phrase mutation/read tests passed. The legacy poke handler is never mounted.
- Added fenced send-poke table commands with stable receipt/outbox effects, member/
  seat/recipient validation, 1.5-second cooldown and 15-second queued-intent expiry.
  Migration 25 adds the cooldown lookup index. No game/checkpoint mutation occurs.
- Poke presentation expires after five seconds, but normal outbox retention still
  applies. Redis presence does not gate private sends or imply recipient delivery.
  Existing overlays deduplicate IDs and reject expired/wrong-recipient messages.
- Eighteen targeted poke/activation SQL tests passed, including audience, retry,
  cooldown, spectator denial, unchanged checkpoints and atomic receipt rollback.
  Delivery-client coverage verifies validated, once-per-cursor transient presentation
  and ACK progress even when the UI callback fails. See the dedicated poke contract.
- Next: final increment-8 regression/correctness audit. Production activation and
  external/native/provider checks remain explicitly unverified.

### Increment 8 record: independent processes and consolidated regressions

- Added disposable real PostgreSQL/Redis plus independent uvicorn gateway fixtures,
  actual nginx configuration validation and HTTP/WS tests. No application service or
  database is used. Binary environment variables make skips explicit.
- Verified cross-gateway authentication/projections and actor hand isolation; one
  receipt/sequence for duplicate game requests; FIFO stale-revision rejection; Redis
  outage chat progress; real owner SIGSTOP beyond lease expiry; higher-epoch takeover;
  old-process resume; engine continuation on replacement; owner SIGKILL; and resumed
  gameplay after another takeover. No forced lease timestamp edits are used.
- Real concurrent creation yields exactly five tables and rejects the sixth. Current
  legacy Database.open refuses the dedicated dataset and closes its pool on failure.
  nginx distributes HTTP without affinity; sockets upgrade and deliver/ACK through
  the proxy while Redis is stopped. Automatic proxy mutation retries are disabled.
- A real PostgreSQL stop/restart returns no false durable acknowledgement; original-ID
  retry completes once after gateway pools recover without intervention. The test's
  own inspection pool is refreshed separately before final SQL assertions.
- PostgreSQL/nginx binaries were compiled only in temporary directories. A macOS/
  Python asyncio child-watcher waitpid hang on SIGSTOP required a Popen-backed gateway
  test wrapper with thread-based waiting; production code was not changed for it.
- Three process cases passed together in 180.79 seconds. Strengthened gameplay
  continuation passed in 123.69 seconds; database restart passed in 4.22 seconds.
  Ten additional real-Redis tests passed. Broad Python: 1526 passed, 13 optional skips,
  nine migration fake failures fixed; all 65 affected tests and nine final schema
  checks passed. Client: 236 passed, TypeScript/web/iOS exports and mounted Chromium
  smoke passed. Two existing Starlette deprecation warnings remain.
- These are correctness checks, not a 1K-connection/1.5M-account capacity result. Native
  hardware, real provider exchange, container execution and existing-data production
  cutover are explicitly not claimed. Implementation is complete in the isolated path;
  release validation and operations remain the next task set.
