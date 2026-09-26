# C3d: durable friendship commands

Friendship changes use the existing `conversation` lane for the sorted user pair.
That lane now orders `request-friend`, `accept-friend`, `remove-friend` and direct
messages together. No new schema, lane kind or scheduler is required. Social workers
on any server execute these commands through PostgreSQL claims; room ownership and
Redis availability are not prerequisites.

## Public contract

Submit to `POST /distributed/commands` with the existing stable command envelope:

```json
{
  "target": {
    "kind": "conversation",
    "user_low": "00000000-0000-0000-0000-000000000001",
    "user_high": "00000000-0000-0000-0000-000000000002"
  },
  "body": {
    "command_id": "persist-this-original-request-id",
    "command": "request-friend",
    "payload": {}
  }
}
```

The authenticated actor must be one of the pair, both users must exist, and the pair
must contain two distinct users in UUID order. The payload must be empty; the actor
and other user are derived from authentication and the lane. Gameplay match/revision
fields are forbidden. Commands return the standard pending/accepted/rejected receipt;
no new receipt fields or client journal format are introduced.

| Command | Required state | Result |
| --- | --- | --- |
| `request-friend` | No row for the pair | Pending request made by the actor. |
| `accept-friend` | Pending request from the other user | Accepted friendship. |
| `remove-friend` | Accepted friendship | Remove friendship. |
| `remove-friend` | Actor's outgoing pending request | Cancel request. |
| `remove-friend` | Other user's incoming pending request | Reject request. |

Invalid transitions produce durable rejected receipts without changing friendship
state or producing notifications. Simultaneous opposite requests are ordered; the
first can succeed and the second is rejected, not automatically accepted. Repeating
an accepted original command ID returns its original receipt even if the relationship
has since been removed. A new intention requires a new ID; changing contents under
an existing actor/lane command ID conflicts.

Friendship admission does not require an accepted friendship. This exception applies
only to these three commands: message ingress/execution and message history still
require an accepted relationship. Pair commands are executed in inbox order. For
example, a message admitted while users are friends is rejected if a preceding queued
removal executes first. Actors can still recover their own command receipts after
removal; they do not gain access to the other user's receipts or private history.

## Transaction and notification behavior

Execution validates before performing effects. The friendship write, both notification
intents and the actor's `SOCIAL_COMMAND_ACK`/terminal receipt commit in one transaction.
Any failure after effects begin escapes, rolling back the whole claim. Notification
capacity exhaustion also leaves the friendship command pending for retry; it does not
commit a partial friendship or turn infrastructure failure into rejection.

Notification intents use the trusted `NotificationProducer`, with deterministic keys
from pair lane, actor, original command ID and recipient. Both recipient lanes are
locked/enqueued in sorted user order. Recipient workers subsequently materialize the
notification rows and outbox events. Thus acceptance guarantees durable notification
intents, not immediate socket delivery or already-materialized notification rows.

The other user receives `friend_requested`, `friend_accepted`, `friend_rejected`,
`friend_cancelled` or `friend_removed`. The acting user receives `friendship_changed`
so their other devices can reconcile too. Both use payload fields `other_user_id`,
`status` (`pending`, `accepted`, `none`), `requested_by`, `change` and `command_id`.
These are durable notification records with normal read-state semantics; the client
still needs rendering/reconciliation mappings for the new kinds. Historical change
payloads are not a replacement for the current `/friends` snapshot.

Recipient history/subscriptions supply catch-up independently of whether a friendship
is pending or removed. Pending/removed pair lanes need not be discoverable as message
streams for command status recovery. Redis notices only accelerate existing delivery;
notification materialization/replay still works with Redis offline.

## Integration boundaries and verification

The isolated distributed app exposes these commands through its native social ingress.
Old `/friends/requests/...`, DELETE `/friends/...` and other legacy mutation aliases
remain blocked. There are no new frontend bindings, migrations or production switches.
Legacy writers in another process are still unsupported on an integration dataset.

Tests cover transition distinctions, wrong actors/self/missing users, strict envelopes,
retry/fingerprint conflicts, pair ordering, rollback on notification/receipt failure,
notification backpressure, receipt privacy after removal and HTTP-to-worker notification
catch-up with Redis unavailable. PostgreSQL/WASM exercises production SQL, but cannot
prove independent-process lock contention or failover; those remain increment 8.

Next: **C3e — existing-socket session revocation and expiry**. Then browser/provider
login composition, manual settlement compatibility and client bindings remain open,
along with production writer exclusion, platform checks and load-balancer integration.

Verification result: **40 targeted tests passed**, including 13 new friendship tests
and existing social/platform/transport/schema checks. Python compilation and whitespace
checks passed; two existing Starlette deprecation warnings remain.
