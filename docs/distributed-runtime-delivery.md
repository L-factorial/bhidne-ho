# Durable delivery adapters: increment 6a

These explicit components are not mounted HTTP/WebSocket routes or application
startup bindings. PostgreSQL remains authoritative. Increment 6a supports existing
hosted room/table/game outbox lanes. Increment 6b1 adds scoped chat; see the
[chat contract](distributed-runtime-chat.md). Increment 6b2 adds
[conversation/recipient execution and authorization](distributed-runtime-social.md).

## Publication and recovery

`PostgresDeliveryStore.claim` acquires a bounded batch using `FOR UPDATE SKIP LOCKED`
and commits a random claim token, lease expiry and attempt increment before any
external call. `renew` and `finish` require the same unexpired token. A dead publisher's
claims expire; a replacement can retry, and stale completion cannot finish its claim.
Retry stores only a generic error category, with capped backoff. No SQL transaction
spans presence lookup, Redis publication or a socket write.

`OutboxPublisher` claims at most its worker count (four by default), then observes
user presence for targeted events or room presence for lane-wide events. It deduplicates
boot IDs and sends bounded concurrent delivery hints only to those servers. Defaults
are four fanout workers per event, 128 destinations, a three-second operation deadline
and ten-second claim leases. Timeout/partial failure/unknown or overflowed presence
leaves publication retryable. Shutdown joins background work; uncertain work is
reclaimed after lease expiry.

A delivery hint carries only the destination boot ID, lane ID, event ID and sequence.
The existing authenticated `RedisSignalTransport` now supports `delivery` envelopes,
`send_delivery(destination_boot_id, notice)` and an optional `delivery_receiver`.
Its signature/freshness/size checks and bounded dispatch apply to these hints too.
Receivers only schedule local catch-up; hints never advance a client cursor or supply
a payload. Lane order comes from PostgreSQL, regardless of publication arrival order.

`published_at` records a completed advisory publication attempt, not socket receipt.
An observed empty or incomplete presence list can miss connected gateways, even after
a successful publication attempt. Every gateway therefore keeps safety polling its
actual subscribed streams. Catch-up reads published and unpublished rows alike.
A crash between publishing and completion may repeat the same event ID/sequence.

## Authorized replay

`PostgresDeliveryStore.page(actor, lane_id, after=..., limit=...)` reads authorization
and a bounded event page in one read-only repeatable-read PostgreSQL snapshot. Use
the authoritative database; no replica consistency contract is supplied here.

- Room/table/game lane-wide events require current room membership and a room that
  has not been deleted. Private events require the exact stored recipient.
- Private engine history additionally requires a current seat in the same match;
  when a private payload identifies a seat, it must match the current seat. Historical
  cards are not delivered into a replacement match or to former/spectating players.
- Actor-only command acknowledgements use a strict `InboxOutcome` projection. A
  departed actor with a submitted command on that lane can receive their own ACKs,
  without regaining access to room or game payloads. Migration 22 adds the
  `(lane_id, actor_id)` inbox index for this check.
- Targeted table invitation metadata is visible only to the named current room
  member. Invitations outside room membership remain accessible through existing
  authorized invitation queries; social notification delivery is described in 6b2.
- Room/table/game chat replay now rechecks its scoped membership, seat/queue and
  lifecycle contract. Conversation lanes require accepted friendship; recipient
  lanes require the exact user, with safe own-ACK access after friendship revocation.
  Presence never grants any of these permissions.

Authorization linearizes at the read snapshot. Revocation committed before the read
is observed; a revocation concurrent with an already-authorized socket write cannot
retract bytes. Gateways queue lane identities, not materialized private payloads, so
waiting for a wakeup or stream lock does not preserve stale authorization.

Pages contain stable event IDs, lane IDs, sequences, event types/versions and authorized
payloads. `scanned_sequence` includes events hidden from this recipient, permitting
progress through private sequence gaps without exposing their payloads.
`has_more` refers to more stream rows, not necessarily more visible events. No claim
of cross-lane total ordering is made; clients retain revision/snapshot reconciliation.

Missing history, a cursor ahead of the stream or an unsupported event version returns
`DeliveryResetRequired`; it never silently skips a hole. No outbox pruning or automatic
snapshot-based cursor reset is implemented. The client/reconciliation increment must
define an authorized snapshot boundary before retention is enabled.

## Gateway streams and acknowledgements

`GatewayDelivery.subscribe(actor, client_id, lane_id, send, on_close=...)` requires an
already authenticated actor and client identity, verifies access and loads that
client's durable cursor. The transport adapter retains its opaque subscription handle;
it must not accept a handle belonging to another socket. Use distinct stable client
IDs for independent devices/tabs, and persist them across reconnects. Each active
client/lane has one local subscription; the configurable total is 2,048 streams.

`start()` enables four bounded catch-up workers. The normal safety interval is five
seconds; Redis failure uses 350 ms. Health changes request immediate scans. Delivery
hints mark only locally subscribed lanes dirty. `sweep_once`/`pump` also support
explicit invocation for composition/testing. Timer/engine/lease execution is unaffected.

The send callback receives a `DELIVERY_PAGE` envelope with `after_sequence` (the subscription's previous offered
position) and `scanned_sequence`, including an empty visible
page when its scan passed other recipients' events. Reads happen immediately before
the bounded socket send, under a per-stream lock. Defaults are 100 scanned rows/page,
a three-second read/send deadline and 1,000 unacknowledged sequence positions per
stream. Slow or failed streams do not block other workers. A failed authorization,
read or send removes that subscription and calls the optional bounded `on_close` with
a generic reconciliation reason. The socket composition must provide this hook to
close/reconcile, or monitor `active(handle)`; it must not silently keep a dead stream.

A successful send advances only local offered progress. The socket's authenticated
ACK calls `acknowledge(handle, scanned_sequence)`, which rejects sequences beyond what
that stream was offered, rechecks access, and persists a monotonic per-user/client/lane
cursor. Do not call ACK inline from the send callback while its stream lock is held.
Publication, failed sends and disconnects do not acknowledge anything. A lost ACK
replays stable IDs after reconnect; clients must deduplicate before applying them.
The store-level `acknowledge` is a trusted primitive and must never be exposed directly
without the gateway's offered-boundary check.

## Explicit composition

1. Construct `PostgresDeliveryStore` with the primary database pool.
2. Construct `GatewayDelivery` with the registered process boot ID. Install it as
   `RedisSignalTransport(delivery_receiver=gateway)`.
3. Fan subscription health changes to `gateway.observe_health` alongside the runtime
   polling policy, connection-presence registry and owner cache.
4. Construct `OutboxPublisher(store, presence_registry, transport.send_delivery)`.
   Start it explicitly after its dependencies; it does not need room ownership.
5. Authenticate/authorize actual sockets, register presence and subscribe only their
   intended lanes. Socket writes must be serialized with any other writers. Retain
   handles and implement ACK, duplicate handling, close/reconcile and reconnect replay.
6. Stop accepting streams, stop/join publishers and gateway workers, detach presence,
   stop Redis transport, drain runtime, then close shared clients/pools. Callers using
   manual `pump`/`sweep_once` tasks own and must join those tasks as well.

No process starts these components automatically. Existing live routes/clients remain
gated on complete delivery/social, client compatibility and independent-process tests.

## Verification and limits

Component tests use the production store SQL in the single-connection PGlite harness.
They cover claim expiry/renewal/takeover, retry duplicates, published-row replay,
per-client cursors, audience gaps, membership/seat/match revocation, slow sockets,
bounded outstanding delivery, reconnect replay and Redis failure polling. Opt-in
real Redis tests use a private temporary server with TCP/persistence disabled.

```sh
PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite \
  .venv/bin/python -m pytest -q tests/test_delivery.py tests/test_delivery_bounds.py
REDIS_TEST_SERVER=/path/to/redis-server \
  PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite \
  .venv/bin/python -m pytest -q tests/test_delivery_live.py
```

Claims use production PostgreSQL locking syntax, but independent-process race evidence
remains increment 8. Polling/recipient reads are bounded by active subscriptions and
page/worker limits; no 1K-connection capacity claim is made. Durable social history and
legacy unsequenced-message handling are covered by 6b2. Retention, mounted endpoints
and client/LB integration remain unfinished. See the explicit
[7b client reconciliation contract](distributed-runtime-client.md). Operational readiness remains the later task set.
