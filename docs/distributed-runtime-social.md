# Durable direct messages and notifications: increment 6b2

These are explicit backend components, not mounted routes or startup bindings.
PostgreSQL owns commands, ordering, message history, outcomes and delivery cursors.
Redis carries only delivery hints. Legacy application handlers remain unchanged.

## Admission and execution

`SocialIngress.submit` accepts `send-message` on a canonical two-user conversation
lane and `read-notifications` on the authenticated user's recipient lane. Both use
stable command IDs and original-request fingerprints. Changed contents with the
same ID conflict; identical retries return the original pending or terminal receipt.
Social commands have no game revision or match ID.

Direct messages require accepted friendship at admission, execution and history or
outbox reads. Execution locks the friendship row for shared access so revocation
cannot race an accepted write. Senders have a database-timed one-second rate limit
per conversation. Rejection is durable; a new attempt needs a new command ID.
After friendship ends, participants may still resolve their own submitted commands
and receive safe actor-only ACKs, but cannot read conversation content.

`NotificationProducer.enqueue_in_transaction` is a trusted service API. Call it in
the same transaction as the source business mutation, using a stable recipient/key
and bounded JSON payload. It submits as `system:notification`; ordinary clients
cannot create notifications. Changed contents for an existing key conflict.
Notifications are visible only to their recipient. Origin metadata grants no access.

`SocialLaneExecutor` atomically commits deterministic message IDs, sequenced history,
outbox events and command completion. Unexpected failures roll back all effects and
leave the head retryable. `read-notifications` takes up to 100 explicit IDs, including
legacy notifications, and rejects the whole operation if any ID is unavailable or
belongs to another user. Reading a notification and acknowledging transport delivery
are independent operations; delivery ACKs never mark notifications read.

## Scheduling and delivery

Conversation and recipient lanes have no room owner. `SocialRuntime` uses existing
PostgreSQL lane claims with `FOR UPDATE SKIP LOCKED`; one command executes at a time
within a lane. Different lanes can execute concurrently on any platform worker.
Defaults are four workers, 32 lanes per kind per sweep, eight commands per lane and
a three-second operation deadline. Keyset cursors prevent a busy low-ID lane from
permanently hiding later lanes. Failed heads stay pending while other lanes progress.

A coalesced local wakeup accelerates submission. An indexed pending-lane scan runs
on a configurable 500 ms interval even when Redis is healthy, so losing the submitting
process cannot strand work. This is intentionally separate from the room owner's
Redis wakeup/adaptive polling policy: platform work has no pinned remote owner.
Redis failure does not prevent social execution. Timings are defaults, not capacity
measurements; startup/shutdown integration must start and drain this worker explicitly.

The outbox publisher resolves both users' presence for conversation-wide events and
deduplicates gateway boot IDs. Targeted notifications and ACKs use recipient presence.
Unknown presence leaves publication retryable. Gateway replay rechecks authorization;
Redis hints and presence never authorize reads. Existing device cursors, bounded
catch-up, publication retry and safety polling apply to social lanes too.

## Bootstrap, history and compatibility

`SocialIngress.open_stream` authorizes and creates an empty recipient or accepted
conversation lane. `SocialHistory.streams` discovers currently authorized existing
streams with bounded lane-ID pagination. Client integration must bootstrap the own
recipient stream and refresh the stream catalog on connect/reconnect and periodically
for newly arriving conversations. A delivery hint alone does not subscribe a gateway
to a previously unknown stream.

`SocialHistory.page` returns native records ordered by stream sequence; event ACKs
can create gaps between message sequences. `legacy_direct` and `legacy_notifications`
return separate unsequenced pages using timestamp/UUID cursors. No synthetic event
sequence or outbox backfill is invented for old records. Legacy DM history still
requires accepted friendship; notification history requires the exact recipient.
History reads neither acknowledge delivery nor change notification read state.

Migration **24** adds pending social-lane, recent-sender, legacy pagination and
conversation-discovery indexes. It adds `source_actor_id` metadata without a cascading
foreign key for native notifications. Existing sequenced notifications move origin
metadata from `actor_id` to that field, preserving IDs, content, sequence and read
state. Legacy unsequenced rows retain their existing foreign-key behavior. Deleting
an origin user does not erase native recipient notifications; clients must tolerate
missing origin profiles. A source deleted before execution is represented as null.

## Cutover gates and limits

- Migration 24 is code only; no application database migration was run.
- C3 must compose worker lifetime, authenticated routes, delivery subscriptions and
  trusted producers with source business transactions. Existing friendship handlers
  do not yet use the new producer. Legacy inner-join notification readers cannot
  serve native records with null `actor_id`; switch their read adapters together.
- Upgrade all platform workers before enabling ingress. Never run legacy and native
  mutation paths concurrently for the same operation. These components add no new
  platform-worker capability negotiation.
- Increment 7 must supply reliable client IDs/status handling, discovery, replay,
  display-name resolution and notification read commands. Increment 8 must verify
  independent-process races and failure recovery before live cutover.
- No retention policy or purge job is enabled. Embedded PostgreSQL integration tests
  establish component behavior, not independent-process locking or production scale.
  Capacity, observability, HA and operational readiness remain the later task set.
