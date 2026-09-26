# Explicit distributed backend contract

These adapters are implemented but **not installed in the live application**.
The gateway must derive `actor` from its authenticated session, never request JSON.
Main increment 4 still has gated process/route bindings; Redis, delivery and client
integration are increments 5–7, and independent-process verification is increment 8.

## Mutations

`HostedCommandIngress.submit(actor, target, body)` commits to PostgreSQL before
attempting its optional, bounded wakeup callback. A failed/slow wakeup leaves the
command pending for the owner/scanner. A lost response requires retrying the exact
target/body/command ID, not manufacturing a new action.

```json
{
  "target": {"kind": "table", "room_id": "room", "table_id": "<uuid>"},
  "body": {
    "command_id": "stable-client-request-id",
    "command": "join-queue",
    "match_id": "<current-hosted-match-id>",
    "expected_revision": 12,
    "payload": {}
  }
}
```

Table commands use the **table revision**. Game targets additionally identify the
durable game/round UUID and use the **engine revision**. Flush keeps its hosted match
ID across rounds while changing the durable game UUID. Existing inbox match-scoped
deduplication resolves original round receipts. Room commands do not take an existing
match/revision. Unsupported families are refused before admission; executors still
check current membership, state, reservations and revisions after queue delay.
An active-state seating request that races a game start gets a durable rejection;
unknown executor capabilities/corrupt state still fail closed.

The return value contains `lane_id`, `sequence`, `command_id`, `status`, `outcome`,
and `status_reference: {lane_id, command_id}`. Pending has `outcome: null` and does
not mean accepted. `HostedCommandIngress.status(actor, lane_id, command_id)` exposes
only that actor's result and remains usable after room departure, closure or rematch.
No HTTP status endpoint or WebSocket message mapping is installed by these classes.

Supported added operations:

| Lane | Command | Payload |
| --- | --- | --- |
| Table | `join-queue`, `leave-queue` | Empty; includes active games without engine advancement. |
| Table | `settings`, `marriage-settings`, `flush-settings` | Existing validated settings fields, without nested `match_id`. Pre-game creator proposals only. |
| Table | `rule-vote` | `proposal_id`, `accept`; unanimous seated-player rules, roster-change cancellation. |
| Table | `answer-table-invitation` | `invitation_id`, `accept`; recipient can answer before membership, with execution-time access checks. Acceptance joins the room, not the table seat. |
| Room | `create-table` | `game_type`, `capacity`, `name`, optional `invitees` (at most 20). Optional paired `replace_table_id` and `replace_revision`. |
| Room | `enter-room`, `leave-room`, `delete-room` | Empty. Departure releases eligible seats/queues across bounded tables atomically; active/locked seats block it. |
| Room | `room-visibility` | `visibility`: `public` or `private`; room creator only. |
| Room | `invite-room` | `recipients`, at most 20; room creator only. |
| Room | `answer-room-invitation` | `invitation_id`, `accept`; invitation recipient only. |

Existing start/end/abandon/rematch, replacement-seat offers, gameplay,
`FOLD_AND_LEAVE`, and `NEXT_DEAL` contracts remain. A future `/leave` adapter must
choose the explicit table/game operation and freeze that target/envelope for retries:
waiting/completed roster departure is `leave-seat`; active Call Break departure is
`abandon`; active Marriage/Flush departure is game-lane `FOLD_AND_LEAVE`. Do not
reselect an operation based on newer state when retrying an unresolved request.
The legacy ID-less combined `/leave` handler is not enabled on this runtime.

Replacement identifies the observed old table/revision instead of ending whatever
table happens to be current at execution. Old closure, reservation release, new
creation, invitations, room counters and outbox effects commit together. It requires
the actor's replaceable completed table and its settlement intent. Old engine history
and receipts survive. Hosted invitation attempts use a PostgreSQL rolling one-minute
limit of 30, shared across servers and unaffected by duplicate command retries.

`PostgresRoomCreation.create(actor, body)` is a separate atomic catalog operation
before any room owner exists. Body requires stable `command_id`, `name`, optional
`visibility` and `invitees`. Deterministic room ID, creator membership and invitations
commit together. The original accepted room ID remains resolvable by exact retry,
including after deletion; retry never resurrects a tombstone. No pending owner work
or socket audience exists for this initial catalog operation.

## Reads

`PostgresHostedQueries` supplies:

- `room(room_id, actor, table_id=...)`: coherent room metadata/previews/membership
  and an optional explicitly selected table projection, including table/match/game
  identities and table revision. No fallback to another match on a missing target.
- `catalog(actor, after_room_id=..., limit=...)`: visible public, owned, joined or
  invited rooms; keyset cursor.
- `members(room_id, actor, after_user_id=..., limit=...)`: authorized member page.
- `invitation_eligibility(room_id, actor, recipients)`: advisory availability;
  execution rechecks under transaction locks.
- `invitations(actor, after_table_id=..., limit=...)`: recipient-scoped hosted
  invitations with public metadata/current table revision and table-page cursor.
- `room_invitations(actor, after_id=..., limit=...)`: pending room invitations.

State projections reconstruct detached engines and use existing public/private
projection rules. Canonical checkpoints, another player's cards and acquisition
credentials are never response objects. Membership and projections share a
read-only repeatable-read snapshot on the authoritative PostgreSQL database;
replica reads require a separate consistency contract. A departure committed before the snapshot
denies access; a concurrent departure may finish after the read's snapshot.
Delivery must independently reauthorize queued private projections in increment 6.
Reads never acquire ownership, run timers/controllers, cancel proposals, or settle
games. Presence is a separate Redis/gateway concern; absence of a local connection
is not represented as authoritative disconnection.

`PostgresLedgerQueries.snapshot(room_id, actor)` reads committed ledger effects,
settlements, table names and profiles from one authorized read-only snapshot. Pending
game settlement remains the finalization worker's responsibility. The configurable
history bound defaults to 1,000 games/batches and fails explicitly rather than
returning truncated balances. Large-history aggregation/pagination and capacity
validation are still required before production rollout.

Migration 21 adds room-creation deduplication columns/unique index, a targeted GIN
index for recovery-state invitation lookup, and bounded per-user invitation-rate
state. No migration was applied to an application database by this increment.

## Integration gates

HTTP/WS request/response mapping, client ID/revision retention, generic/Echo and
ad-hoc room compatibility decisions, audience-safe publication, and composition
startup/shutdown remain gated integration work. Shared presence and authenticated
Redis transport now exist as explicit increment-5 components; mounting them remains
part of the gated assembly. Increment 6a also supplies explicit authorized hosted
delivery/catch-up adapters, extended by [6b1 scoped chat](distributed-runtime-chat.md).
[6b2 social adapters](distributed-runtime-social.md) add conversation/recipient
execution, history and replay. Mounted delivery still requires the remaining gates. See [delivery contracts](distributed-runtime-delivery.md).
Do not run legacy and distributed mutations on the same state.
Component SQL tests use embedded PostgreSQL; they do not establish independent
process locking behavior, production performance, or the 1K-connection target.

Increment 7a supplies the explicit [client command lifecycle](distributed-runtime-client.md)
for these lane receipts. It remains unmounted; authenticated HTTP/WS mappings and
client stream/session recovery are still required before live cutover.

Increment 7c2c1 now supplies an unmounted [HTTP/WebSocket router and client transports](distributed-runtime-transport.md).
The mappings above remain explicit components; no production route selection changed.

Increment 7c2c2 adds optional authorized read/history/bootstrap routes and client
control mapping primitives; see the [transport contracts](distributed-runtime-transport.md).
Selected hosted scopes are bootstrapped explicitly rather than discovered by scanning
all historical games. Actual screen/root binding remains 7c2d/C3.
