# Durable scoped chat: increment 6b1

This is the first reviewable slice of 6b. It implements room, table and game chat
through durable ingress, execution, history and delivery in the explicit distributed
runtime. Direct messages and recipient notifications are covered by [6b2](distributed-runtime-social.md). Existing application
routes and WebSockets still use the legacy composition; nothing enables this path
in live startup.

## Scope and access

| Scope | Identity | Send | Read/history | Closure |
| --- | --- | --- | --- | --- |
| Room | `room_id` | Current room member, subject to existing active-play chat pause | Same room membership/pause policy | Deleted room |
| Table | `table_id` plus room | Currently seated player | Currently seated or queued player | Closed/deleted table or deleted room |
| Game | Durable `game_id` plus table and room | Current seat and active-game reservation | Same current-player rule; spectators excluded | Game finishes/is replaced, table closes, or room is deleted |

Room chat preserves the existing Call Break deal-review exception and game-specific
pause behavior through detached checkpoint reconstruction and the existing projection
policy. Table chat preserves existing seated-send/queued-read permissions. Game chat
is a new, distinct conversation for active players. Chat never changes an engine,
seat, membership, room ownership or settlement state.

Table history continues across successive games. Game chat uses the durable game
identity, not just a displayed match ID: Flush can retain a hosted match ID across
rounds, so clients must use the snapshot's `durable_game_id`. Old game history remains
stored but normal access closes at completion/replacement. Archive access is not
implicitly granted to new players or spectators. Normal table/room deletion similarly
closes reads and writes without erasing receipts/history in this increment.

## Persistence and ordering

Migration 23 adds independent `table_chat` and `game_chat` lane kinds alongside
`room_chat`, with target foreign keys and one lane per scope. The existing
`room_chat_messages` table now stores all three scopes using nullable table/game IDs;
its name is retained for upgrade compatibility. Scope/sequence validation, immutable
records, per-lane sender/request deduplication and a recent-sender index protect writes.
Existing durable room-chat rows retain their IDs, text, order and original room scope.

`ChatIngress.submit(actor, target, body)` accepts an authenticated canonical actor and
an explicit `LaneTarget`. The native command is:

```json
{
  "command_id": "stable-client-generated-id",
  "command": "send-chat",
  "payload": {"text": "Hello"}
}
```

Chat commands have no gameplay revision or hosted match field. The game target already
contains its durable identity. Text uses the existing `ChatInput` contract: 1–500
characters, whitespace trimming and control-character rejection. The fingerprint
retains the original request; reusing an ID with changed contents is a conflict.

Ingress commits the inbox row before its optional bounded wakeup. Execution rechecks
access, including changes after admission. The room owner runs `ChatLaneExecutor`
under its PostgreSQL fence and the chat lane lock. A scoped chat lane does not enter
the gameplay command queue. Short table read locks protect coherent execution-time
access/checkpoint reads; they can briefly contend with table/engine writes, but no
socket or external call holds these locks.

Accepted execution atomically commits:

1. A deterministic message ID derived from lane, sender and request ID.
2. Its ordered history record and `CHAT_MESSAGE` outbox event.
3. The actor's `CHAT_COMMAND_ACK` and terminal inbox outcome.

A failure rolls the entire transaction back. Same-ID retries resolve the original
receipt even after departure or deletion, without granting access to chat contents.
A rejected command consumes its inbox position and emits an actor-only ACK; a sender
removed from the user catalog is rejected without an invalid-recipient outbox row.
The same sender can send at most once per second within a conversation, using database
time and the serialized lane rather than a server-local rate limiter. Different
scopes are independent. This does not replace future platform abuse controls.

History sequences share the outbox lane sequence, so ACKs introduce intentional gaps
between message sequence numbers. `ChatHistory.page(actor, lane_id, after, limit)`
performs authorized bounded keyset reads in a repeatable-read snapshot. History
survives publication and does not depend on retained Redis notifications. Stored text
is plain text, not trusted HTML. Native message/history records expose canonical
sender IDs; the client composition must resolve display names through authorized
profile data and escape text when rendering.

## Runtime and delivery integration

The explicit room runtime advertises `durable_scoped_chat: 1`, executes all three chat
lane kinds, revalidates supported pending chat commands during activation, and discovers
chat-only rooms needing placement. Room wakeups route chat lanes through the same
fenced owner mechanism. Recovery drains admitted commands after takeover; old owner
fences cannot execute them. Room/table/game chat share room ownership but not their
command-ordering locks.

`PostgresDeliveryStore` rechecks scope permissions for every replay page. It allows
former participants to retrieve only their own safe ACK projection after losing chat
access. A table queue member can receive table messages but cannot send; unrelated
room spectators never receive table/game chat payloads. During room-chat pauses,
clients may advance past hidden events and must refresh authorized history when chat
reopens. Publication may signal room-connected gateways, but signals carry IDs only;
presence and room connectivity are never delivery authorization.

`OutboxPublisher`, Redis delivery hints and `GatewayDelivery` provide the existing
bounded, retryable publication and per-client catch-up/ACK behavior from 6a. Native
composition must use `ChatIngress`, bind its wakeup to `RoomCommandRouter.wake`, resolve
explicit authorized lane subscriptions, and implement the client contracts. A direct
call to the generic router is not an authentication/authorization boundary.

## Upgrade and remaining work

- Migration 23 is code only here. No application database, live route, Redis service,
  client or deployment is switched by this slice. Older executors lack the advertised
  chat capability; drain/upgrade them before enabling native chat ingress in cutover.
- Legacy room/table chat is ephemeral. There is no fabricated backfill of prior
  in-memory messages, and legacy handlers are unchanged. Durability starts with
  commands admitted through this new path. Existing database room-chat rows are
  preserved by the upgrade.
- No message purge or retention duration is enabled. Closed scopes deny access now;
  physical deletion requires an explicit retention policy and a reconciliation
  boundary for pruned outbox history. Do not interpret retention as indefinite access.
- Direct-message/conversation permissions, recipient notification commands and
  legacy unsequenced social-history handling are complete as explicit
  [6b2 components](distributed-runtime-social.md). Live bindings remain gated.
- Client/LB mounting and independent-process correctness remain increments 7–8/C3.
  The embedded PostgreSQL tests do not prove multi-process lock races or capacity.
  Operational readiness remains the later task set.
