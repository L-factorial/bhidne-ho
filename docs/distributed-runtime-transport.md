# Explicit HTTP and WebSocket adapters: 7c2c1

`app.durable_games.transport.create_router` builds an unmounted `/distributed`
router from explicit auth, hosted/chat/social ingress, gateway and exact browser
origin allowlist dependencies. `app.main` never imports or mounts it. Existing live
routes and writers remain unchanged. These endpoints do not start worker lifetimes.

## Commands

- `POST /distributed/commands`: bearer authentication plus the original `{target,
  body}` envelope. Body parsing is bounded to 64 KiB and rejects extra actor fields.
  Target kind selects hosted, scoped-chat or social ingress. Notification creation
  remains unavailable to public actors through SocialIngress.
- `GET /distributed/commands/{lane_id}/{command_id}`: bearer-authenticated actor's
  original inbox receipt. The generic hosted status primitive is actor-scoped and
  works for all inbox lane kinds, including after membership changes.
- Success returns the native receipt with no-store caching. Pending is returned as
  pending, never synthesized into accepted. Expected access/not-found/conflict/input
  failures map to 403/404/409/422; operation timeout maps to 503 with unknown outcome.
  HTTP errors are not durable rejected receipts. Unclassified server/database errors
  also leave client uncertainty intact.

`distributedHttpTransport` maps these URLs, sends bearer headers and preserves the
original envelope. It forwards the command component's AbortSignal and rejects any
non-success response without clearing the journal. `DurableCommandClient` supplies
operation deadlines and receipt validation. Do not call this low-level transport as
an alternate path around journal admission. Initial room-catalog creation remains a
separate contract and is not mapped here.

## Delivery socket

One `/distributed/delivery` socket multiplexes at most 128 subscriptions. Browser
Origin must match the supplied allowlist; native clients may omit Origin. A token
is sent in the first frame, not the URL. The first frame must arrive within five
seconds, and authentication is bounded to five seconds:

```json
{"type":"AUTH","token":"<session-token>","client_id":"<stable-device-id>"}
```

After authentication the server sends `READY`. Subsequent messages:

| Client message | Server response |
| --- | --- |
| `SUBSCRIBE` with `subscription_id`, `lane_id` | `SUBSCRIBED` with the same alias/lane and initial durable device `cursor`. |
| `ACK` with `subscription_id`, `scanned_sequence` | `ACKED` with the offered sequence and durable monotonic `cursor`. |
| `UNSUBSCRIBE` with `subscription_id` | Removes only that socket's local alias; no receipt needed. |
| `PING` | `PONG`. |

`DELIVERY_PAGE` includes the local subscription alias and the existing authorized
page contract. `STREAM_CLOSED` marks a revoked/failed subscription requiring recovery.
Aliases map to opaque gateway handles held only on that socket; raw gateway handles
are never accepted from clients. Unknown aliases or ACKs beyond offered progress fail
closed. Backend authorization still runs at subscribe, delivery and ACK.

Gateway subscriptions can now start paused. The socket reads the initial persisted
cursor from that paused handle, sends `SUBSCRIBED`, then activates delivery. Even a
running safety scanner cannot send pages before this handshake. Existing subscribe
callers remain immediately active by default. All socket writes share one bounded
send lock. Disconnect/failure removes all owned gateway handles. Incoming text frames
are limited to 64 KiB after ASGI reception; deployment must also bound WebSocket frames
at the server/proxy to prevent oversized raw-frame allocation. Idle sockets time out
at 45 seconds. No game execution lock spans socket I/O.

`DistributedSocketTransport` implements this protocol on one authenticated-device
socket. It authenticates before subscribing, validates lane/cursor handshakes, routes
pages to the session's bounded queues and resolves ACK promises only after `ACKED`.
Abort, close or revocation rejects pending work; late responses to closed aliases are
ignored. It sends ten-second heartbeats and closes after 30 seconds without READY/PONG.
A different client ID cannot reuse the connection. The session layer supplies open/
ACK deadlines; callers must pass its signals rather than leaving operations unbounded.

Socket disconnect requires the root to call `DistributedSession.disconnect()`, close
the obsolete socket transport and create a replacement before reconnecting. Automatic
root reconnection/credential renewal is not mounted here. Session command journals
remain owned across those socket replacements; disconnect is distinct from logout.

## Remaining gates

Next **7c2c2** maps authorized hosted projections, social stream bootstrap/discovery,
native and legacy histories, and concrete control targets/revisions. Then bind the
root account lifecycle and all mounted controls under C3 compatibility gates.
The new delivery route does not yet register Redis presence; C3 must connect that
socket lifecycle to the presence registry and start the gateway/publisher. Until
presence wiring exists, gateway safety polling is the recovery mechanism in explicit
composition, not evidence that full routed live delivery is enabled.

No runtime, application DB, Redis service, client screen or load balancer is switched.
Multi-process correctness, platform smoke validation and LB wiring remain required.
Verification: **106 client tests**, **28 backend transport/delivery tests**, TypeScript,
Python compilation and whitespace checks passed. Router tests use a standalone test
app and stub ingress/auth; delivery regression uses embedded PostgreSQL. These are
not deployed network or independent-process correctness tests.

## 7c2c2: authorized reads and control mappings

The router accepts an optional `DistributedReads(primary_pool)` dependency. Without
it, the original transport-only test composition is unchanged. With it, these routes
are registered in the still-unmounted factory. They authenticate the actor from the
bearer token and return no-store responses:

| Route | Contract |
| --- | --- |
| `GET /rooms/{room_id}?table_id=...` | Existing authorized hosted room projection, optionally pinning the selected table. No fallback to a newer match/table. |
| `POST /streams/recipient` | Idempotent bootstrap of the authenticated actor's notification lane. Client JSON cannot choose another recipient. |
| `POST /streams/open` | Strict `LaneTarget` body; authorize and create/resolve an empty lane. Table/room/game relationships are verified; closed tables fail. Chat uses scoped read permissions; conversations require accepted friendship. |
| `GET /streams/social?after=...&limit=...` | Existing bounded authorized conversation/recipient catalog. |
| `GET /history/{chat|social}/{lane_id}?after=...&limit=...` | Existing sequenced history adapters with current authorization on every page. |
| `GET /legacy/direct?other=...&before_at=...&before_id=...` | Accepted-friend legacy DM history using paired timestamp/UUID cursor. |
| `GET /legacy/notifications?before_at=...&before_id=...` | Only the authenticated recipient's legacy notification history. |

Bootstrap is a POST because it may create a lane. It creates no game, command, chat
message or ownership lease. It does not grant future access: subscription, delivery,
history and command execution still recheck permission. No table/game history scan
is used for hosted discovery. The selected room/table/game scopes are explicitly
opened from the current hosted projection. The client must refresh selection when
rematch/round identity changes; journaled commands retain the original selection.

`DistributedReadClient` pins snapshot selections, walks native history through the
existing bounded loader and exposes legacy pages separately. `discover(selected)`
bootstraps the own recipient lane, reads all bounded social catalog pages and opens
up to 16 explicit selected scopes, returning one deduplicated catalog of at most
128 streams. Failure never returns partial success. Selected scopes must be ones the
screen is entitled to read; an unauthorized optional chat target fails discovery,
so root composition must handle permission changes explicitly instead of requesting
all possible chat scopes. Native history over the 1,000-item materialization bound
fails explicitly; legacy pages are user-paged, not silently marked fully caught up.
The session's operation deadlines/AbortSignals bound these transport calls.

`DistributedControls` supplies the following journal-compatible intention mappings:

- `gameControl`: selected durable game ID and match ID, engine revision. Flush round
  ID is not inferred from the match ID. Use for gameplay such as `PLAY_CARD`.
- `tableControl`: selected table/match and table revision; use for `join-queue`,
  settings, rule votes, start/rematch and other supported table commands.
- `roomControl`: selected room with no invented gameplay revision; use for room
  lifecycle operations such as `leave-room`.
- `chatControl`: `send-chat` for scoped chat, `send-message` for conversations.
- `readNotifications`: bounded IDs on an exact recipient target, independent of ACKs.

These helpers call `DurableCommandClient.begin`, so persistence and unresolved-action
replacement guards still apply. They are explicit mapping primitives, not mounted
UI event handlers. Command names/payload schemas and authorization remain authoritative
on the server. The combined legacy leave control must still select the correct
explicit operation for game/state once at admission; never recompute it on retry.
No catalog room-creation mapping or automatic screen-specific leave mapping is added.

Next: **7c2d**, authenticated root composition: assemble platform ownership, command
and socket transports, selected-scope discovery, view installation and reconnection;
register socket presence under C3 and audit actual UI control mappings before enabling
live paths. Legacy endpoints/screens remain unchanged. Independent-process correctness,
platform smoke checks and LB integration remain cutover gates.

7c2c2 verification: **111 client tests**, **39 backend read/route/chat/social/hosted-query
tests**, full TypeScript, Python compilation and whitespace checks passed.

## Increment 7c2d2: optional catalog creation route

`create_router(..., catalog=...)` optionally exposes authenticated
`POST /distributed/rooms`. It binds the actor from authentication and validates the
strict `CreateRoom` body within a 64 KiB streaming limit. Existing timeout/error
mapping applies. The supplied catalog service must provide atomic creator/request-ID
deduplication; `PostgresRoomCreation` already implements that contract.

The client journals a catalog intention before sending the flat creation payload
with its original command ID. Accepted replies contain command ID, accepted status
and room ID; they do not represent an inbox lane. Uncertain transport failures retain
the original request for retry. No live router mount is added. Verification: 11
backend route/catalog tests passed, including authenticated actor binding, retries,
strict field validation and existing atomic catalog behavior.

## C3a: lifecycle admission and socket presence

The router optionally accepts a lifecycle admission dependency and a presence registry
with an authorized room resolver. The explicit server factory wires these together;
legacy mounts are unchanged. Authentication precedes user presence; authorized paused
subscriptions resolve room hints server-side. Multiple lanes share one room hint per
socket. Unsubscribe/revocation/disconnect clean up registrations; cancellation attempts
close code 1012 and waits for cleanup. Presence failure never changes seats/membership
or grants event access. See [server assembly](distributed-runtime-server.md) for bounds,
startup/shutdown ordering, ownership of resources and remaining compatibility gates.


## C3c: shared platform and native read bindings

The integration application now mounts reviewed account/profile/player routes with
server admission and an exact method/path allowlist. The native read adapter adds
catalog, invitation, membership and read-only ledger GET routes. See the
[platform contract](distributed-runtime-platform.md) for parameters and remaining
compatibility gates. Legacy friendship/message/notification/settlement writers remain
blocked; no production runtime selection changed.


## C3d: friendship command mapping

`POST /distributed/commands` accepts `request-friend`, `accept-friend` and
`remove-friend` on a sorted-user conversation target with an empty payload and no
match/revision fields. Authentication supplies the actor. These retain the standard
receipt/status contract and share pair ordering with messages; friendship command
admission does not relax message/history authorization. See the
[friendship contract](distributed-runtime-friendship.md) for transitions, atomic
notification intents and retry behavior. Legacy friendship aliases remain blocked.


## C3e: established-socket session checks

Delivery sockets now reauthenticate the original token periodically (five-second
default interval, two-second timeout) and require fresh confirmation for incoming
operations/outbound frames. Invalid/changed identity closes 1008; verification failure
closes 1011. Token-specific cleanup joins the watchdog and removes subscriptions and
presence; normal server shutdown retains 1012. This has a bounded detection window,
not instantaneous logout. See the [session contract](distributed-runtime-socket-session.md).
