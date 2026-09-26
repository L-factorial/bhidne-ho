# Distributed runtime cutover audit

Status: implementation increments 1–8 are complete in the **isolated distributed
integration path** on `bhidne-ho-scalability`. Production remains legacy. See the
[current implementation plan](distributed-runtime-plan.md) and
[executable integration guide](distributed-runtime-integration.md).

The route inventory below records the legacy production surface. It is historical
input to the migration audit, not a claim that those bindings are still missing
from the isolated integration app. Current integration uses native contracts and
explicitly rejects unsupported legacy aliases and Generic/Echo/ad-hoc paths.

## Finding

Ownership, recovery, execution, placement, quarantine and drain have explicit tested
components. **The live application still uses the legacy composition.** Setting
`BHIDNE_HO_GAME_RUNTIME_MODE=durable` selects the existing `DurableCommandRuntime`;
it does not install `RoomExecutionRuntime`, inbox routing, discovery or distributed
delivery. Running additional current application instances would still split local
hosted tables, connection state and chat state.

Evidence: [composition root](../app/main.py), [hosted HTTP routes](../app/test_games/http.py),
[WebSocket handler](../app/transport/websocket.py), [shared game runtime](../app/runtime/game_runtime.py).
All readiness claims below concern the explicit new components, not live endpoints.

## Endpoint and service matrix

| Surface | Current behavior/evidence | Distributed capability and remaining work |
| --- | --- | --- |
| Hosted game `GET /test-games/{room_id}` | `TestGameService.snapshot` selects from local tables, advances table state and retries ledger projection under a local lock. | `PostgresHostedQueries.room` now provides authorized committed table projections on any server. It never runs maintenance or falls back to an unrelated local match. Public endpoint binding remains gated. |
| Hosted create `POST /test-games/{room_id}` | Local create uses `player_count`, invitations, and implicit replacement of a replaceable occupied table. | `create-table` now supports invitations and explicit old table/revision replacement atomically. The reliable contract uses `capacity` and stable IDs; legacy combined payload mapping is part of the gated client/route integration. |
| Hosted `/join` | Local roster join, returns snapshot; request has match ID only. | `join-seat` table executor exists for supported lobby/round states. Add stable ID, table revision and target resolution; preserve access/seat conflicts. |
| Hosted `/action` | `GameAction` permits legacy missing command ID; current service returns snapshot plus acknowledgement. | `HostedCommandIngress` requires stable IDs, persists before bounded wakeup, returns pending/terminal status and provides actor-scoped outcome lookup. Mounting the adapter remains gated. |
| Hosted `/leave` | Chooses leave-seat, abandonment or generated gameplay departure from current local state; can generate a new action ID server-side. | Departure primitives exist (`FOLD_AND_LEAVE`, table closure/abandonment), but no durable endpoint orchestration. Persist the original intent and target; do not regenerate a new command identity on retries. |
| Hosted `/start`, `/end`, `/table/{command}` | Local controller calls; bodies lack stable command IDs/table revisions. | Table executors exist only for their documented states; see state matrix below. Add reliable ingress and outcome/snapshot reconciliation before wiring. |
| Hosted `/next-deal` | Match ID plus completed deal number; local review controller. | Manual game-lane `NEXT_DEAL` exists with `deal_number` payload. Requires original command ID and engine revision; it is not a table-revision command or an automatic timer. |
| Hosted `/settings`, `/marriage-settings`, `/flush-settings`, `/rule-vote` | Local rules/settings/proposal state. | Durable pre-game settings/proposals and seated-player votes now execute under the table revision with persisted events, unanimous approval and roster-change cancellation. Route binding remains gated. |
| Hosted invitations list/eligibility/accept/decline | Reads or mutates local hosted-game invitation state. | Creation and recipient answers are durable; indexed recipient queries and advisory eligibility are available. Acceptance joins the room without reserving a seat; cross-room occupancy and shared invitation-rate limits are enforced. |
| `/games/{room_id}` and `/games/{room_id}/action` | Shared engine registry and `CommandRuntime`, independent of the hosted routes. | Reliable action model alone does not connect this path to the room inbox. Explicitly migrate or gate the generic/Echo path; do not leave a second writer. |
| WebSocket `GAME_COMMAND` and `MESSAGE` | Generic local engine execution and local room relay; authenticated room entry. | Separate legacy/generic command compatibility from hosted game actions. Route supported mutations durably; retain local socket handling with cross-server delivery. No implicit hosted-game protocol conversion. |
| WebSocket `TABLE_CHAT_SEND`, `TABLE_CHAT_HISTORY`, `TABLE_POKE_SEND` | `TableSocialService`: local bounded history/receipts, local roster authorization and fanout. | Stable social command IDs already exist, but no distributed executor/history/delivery binding. Reauthorize against durable roster; preserve read-vs-send audience rules. Pokes may remain transient. |
| `/rooms`, `/rooms/{room_id}`, `/active-tables`, `/memberships`, members/enter/leave/delete | Catalog-backed persisted membership mixed with local hosted table summaries, local connectivity, and local lifecycle locks. Lifecycle snapshot advances tables; leave/delete consult local game participation. | Explicit room commands serialize lifecycle changes with durable tables; read adapters provide catalog/member pages and committed previews. Cross-server presence, broadcasts and endpoint binding remain later integration work. |
| Room create/update/invite/answer | Catalog writes, local Echo provisioning, invitation/membership side effects. | Atomic idempotent catalog creation includes invitations and creator membership. Existing-room mutations use fenced room commands; retries preserve original identities. Echo/ad-hoc provisioning and HTTP compatibility remain gated. |
| Room chat GET/POST | `RoomChatService` has per-process last-100 history, rate limits and game-participation checks. | Schema exists; executor/read/delivery wiring does not. Durable room chat is already authorized by the plan, superseding the legacy ephemeral-service comment. Do not mix it into engine checkpoints or game journals. |
| Friends, direct messages, notifications | PostgreSQL store selected in production; service also has local rate-limit/profile caches. | Existing persisted data remains authoritative. Conversation/recipient lanes and catch-up schema need execution, idempotent ingress and cross-server delivery bindings. A persisted notification row is not proof of recipient delivery. |
| Profiles, appearance, phrases, player search/directory | PostgreSQL implementations selected with a database; service-local cache effects still exist. | No demonstrated need to route independent profile reads through the room owner. Review cache invalidation, shared rate limits and any room-view publication dependencies during integration. |
| `/test-games/{room_id}/poke` | Local hosted-game authorization and room-poke publication. | Needs owner-aware authorization and remote recipient delivery; transient semantics can remain. |
| Ledger GET and settlement mutations | Ledger GET calls `retry_completed_ledgers` and reads local table names. Settlement commands use existing ledger service/store. | `PostgresLedgerQueries` reads one authorized committed snapshot without running finalization or consulting local table names. History bounds fail explicitly. Existing settlement mutations and live GET binding remain integration concerns. |
| Guest/account/social/browser auth, signout, health, static assets | Existing auth/session stores and ordinary transport endpoints. | Not game-owner commands. Verify shared session configuration and revocation/connection effects when wiring gateways. Current `/health` is not distributed readiness. Static delivery is unchanged by this audit. |

Sources: [room HTTP](../app/transport/http.py), [room lifecycle](../app/multiplayer/lifecycle.py),
[room service](../app/multiplayer/room_service.py), [table social](../app/multiplayer/table_social.py),
[room chat](../app/multiplayer/room_chat.py), [player HTTP](../app/players/http.py),
[player service](../app/players/service.py), [ledger HTTP](../app/ledger/http.py).

## Table and game state coverage

This is a capability matrix, not permission to ignore ordinary command validation.
The authoritative gate is [TableLaneExecutor.check_capability](../app/durable_games/table_executor.py).
Payload, actor, membership, reservation, phase and revision validation still run afterward.

| Operation | Explicit executor coverage | Gap before preserving the live feature |
| --- | --- | --- |
| New table | Room-lane explicit creation with atomic room limit and stable table/match IDs. | Creation now supports atomic invitations and explicit completed-table replacement. Stable replacement revision/ID replaces unsafe retry-time implicit selection. |
| Lobby roster/queue/lock | `join-seat`, `leave-seat`, `join-queue`, `leave-queue`, `lock` in supported pre-engine states. | Live request envelopes and ingress mapping. |
| Active-game queue/roster | Active waitlist mutations and state-aware seating rejection are implemented. | Active waitlists are supported for all three games without engine advancement. Seating that races start receives a durable state rejection; unknown commands/corrupt state still fail closed. |
| Completed Call Break/Marriage roster | Completed-state leave-seat, join/leave queue, supported replacement offers. | Does not imply arbitrary active roster mutation or completed `join-seat` support. |
| Flush between rounds | Finished-round roster, lock/start and archived round settlement support. | Finished-round roster/lock/restart and active-round waitlists are supported. In-round seat departure remains the explicit gameplay departure command. |
| Seat offers/expiry | Supported offer lifecycle and durable system-generated expiry commands with inbox/timer verification. | State gates still apply; clients cannot submit `system:timer` identities or synthesize expiry links. |
| Start/end/abandon/rematch | Bounded explicit executors and recovery validators exist. | Map each live control to the correct state/target and revision; no partial invitation/rules integration. |
| Gameplay/departure/review | Game-lane execution, durable receipts, supported fold-and-leave, manual Call Break review continuation. | Reliable endpoint and client mapping, including old-round retries after Flush rollover. |
| Settings/rule proposals/votes | Table-lane proposal/vote execution persists checkpoint state and events atomically. | Table-lane settings/votes are implemented and tested. Live controls still need the reliable envelope. |

## Request, query and delivery contracts

1. Authenticate at the gateway; derive actor from the session, authorize target access,
   and reject reserved system identities before inbox allocation. Executors must
   reauthorize after queue delay. Internal receiver adapters require authenticated
   transport; knowledge of a room/boot ID is not authentication.
2. Resolve room/table/match/game-round identity explicitly. Current room-default
   selection from a local dictionary cannot identify a remote table. Table controls
   use **table revision**; game actions use **engine revision**. Initial creation has
   neither an existing match nor expected table revision.
3. Require client-stable command IDs for retries, including lifecycle controls.
   A routed inbox receipt is pending until terminal completion; a wakeup acknowledgement
   only acknowledges signalling. Define status lookup and HTTP/WS response mapping
   before changing public endpoints. Do not invent a terminal failure after an unknown
   enqueue/commit response or generate a new ID to retry the same intent.
4. Gate unsupported command/state combinations before durable admission. Existing
   activation validation and quarantine are recovery safeguards, not substitutes for
   a compatible ingress capability contract. Leave rejected unsupported requests out
   of the durable head until their executor exists.
5. Define authorized read-only snapshot/catalog adapters. Queries must not call legacy
   table advancement, offer timers, ledger retries or engine controllers. Use a fenced
   owner query or a coherent committed database view; never broadcast canonical private
   state. Membership/seat changes must invalidate audience eligibility.
6. [Outbox append](../app/durable_games/outbox.py) exists inside command transactions.
   Publication, audience rechecks, per-connection/device cursors, missed-message
   catch-up and duplicate suppression are not installed. Socket location must be
   separate from room ownership; reconnect on another gateway must not lose private
   results or consume another device's delivery stream.
7. [PendingGameAction](../client/src/multiplayer/PendingGameAction.ts) preserves an
   unresolved gameplay request while mounted, but expects snapshot plus accepted/
   rejected acknowledgement. It clears on selected HTTP errors or a changed match.
   [RoomConnection](../client/src/multiplayer/RoomConnection.ts) reconnects with
   heartbeat/resume behavior, not durable lane delivery cursors. Table controls in
   [RoomGameControl](../client/src/components/RoomGameControl.tsx) do not yet share
   the game-action reliability envelope. Increment 7 must handle pending outcomes,
   retryable unavailability, mounted/unmounted lifecycle and catch-up explicitly.

## Cutover dependencies and completion evidence

| Gate | Required implementation/evidence | Plan task |
| --- | --- | --- |
| C1: Capability parity | Hosted lifecycle, rules, queues, replacement, rooms and durable command envelopes. | Implemented and bound in isolated integration. Generic/Echo/ad-hoc remain explicitly unsupported. |
| C2: Read paths | Authorized committed catalog/table/member/invitation/ledger queries. | Mounted native reads and integration client mappings complete; no read-triggered game maintenance. |
| C3: Process composition | Unique boot identity, lease/placement/recovery, receiver assembly and ordered drain/resource closure. | Executable isolated factory, shared auth/platform, active-socket revocation, manual settlements and dataset marker complete. Existing-data/old-binary exclusion remains a production release gate. |
| C4: Redis and fallback | Authenticated hints, shared advisory presence/cache and PostgreSQL fallback. | Assembled and exercised with actual Redis stop/restart; never the command/state authority. |
| C5: Delivery/social | Sequenced outbox, actor-safe replay, scoped chat, DMs and notifications. | Mounted server/client flows, expiring poke presentation and shared phrase storage implemented. |
| C6: Client/LB | Durable journals/controllers, reconnect/catch-up and HTTP/WS proxy. | Explicit integration build mounts all three game screens and platform controls. Chromium smoke and web/iOS exports pass; actual nginx distribution/WS checks pass. Native-device and product parity smoke remain release gates. |
| C7: Correctness | Real split gateways, duplicate/FIFO requests, owner pause/kill/takeover, Redis/DB outages and private projection isolation. | Independent-process cases and regression tests pass; exact evidence and limits are in the increment-8 record. This is not load/capacity or DB HA proof. |

Keep the current runtime selection unchanged until these gates are satisfied. Do not
run legacy and distributed writers for the same hosted state. Selecting a limited
feature cohort would require an explicit compatibility boundary, not silently losing
settings, invitations, chat or membership behavior.

Capacity/load testing, production observability, PostgreSQL HA/replica promotion,
backup/restore and deployment readiness remain the later task set. They are not
silently promoted into this implementation increment. No 1K-connection performance
claim follows from the component correctness tests.

## Remaining implementation sequence

- C1 and C2 explicit backend slices are implemented; see the
  [adapter/API contract](distributed-runtime-api-contract.md) and latest plan record
  for scope, verification, migration 21 and limits. The live routes in the inventory
  below still use the legacy composition.
- Increment 5a/5b explicit Redis signals, adaptive polling, connection presence and
  advisory owner cache are implemented. PostgreSQL remains authoritative.
- Increment 6a delivery adapters and 6b1 durable room/table/game chat are implemented.
  Increment 6b2 also supplies direct-message/notification execution/history and
  legacy-message handling. Continue increments 7–8 with reliable client/LB
  integration, and independent-process correctness checks.
- Complete the remaining increment-4 C3 composition/route bindings together with their
  transport/delivery/client dependencies. Generic/Echo and ad-hoc room paths require
  explicit compatibility gates. Do not enable competing legacy/distributed writers.

## Route inventory and verification scope

The inventory below is extracted from Python AST router prefixes and route decorators,
then checked against the routers included by `app/main.py`. It lists the mounted
API/WS declarations; dynamic command values and WS frame families are audited above.
The conditional `/` page and static mounts `/test-ui` and `/` are outside the API table.
This audit does not import/start the app or access an application database. No runtime
behavior or API contract was changed. No new behavioral tests are warranted for these
documentation-only artifacts; source coverage/link checks are recorded in the plan.

<!-- ROUTE_INVENTORY -->

69 API/WS declarations across 11 mounted routers.

| Method | Path | Source / handler |
| --- | --- | --- |
| GET | `/rooms/{room_id}/ledger` | [app/ledger/http.py](../app/ledger/http.py) · `ledger` |
| POST | `/rooms/{room_id}/ledger/settlements` | [app/ledger/http.py](../app/ledger/http.py) · `create_settlement` |
| POST | `/rooms/{room_id}/ledger/settlements/{batch_id}/transfers/{transfer_id}/{action}` | [app/ledger/http.py](../app/ledger/http.py) · `settlement_action` |
| GET | `/players/search` | [app/players/http.py](../app/players/http.py) · `search_players` |
| GET | `/players/directory` | [app/players/http.py](../app/players/http.py) · `search_directory` |
| GET | `/players/{player_id}` | [app/players/http.py](../app/players/http.py) · `player` |
| GET | `/friends` | [app/players/http.py](../app/players/http.py) · `friends` |
| POST | `/friends/requests/{target_id}` | [app/players/http.py](../app/players/http.py) · `request_friend` |
| POST | `/friends/requests/{requester_id}/accept` | [app/players/http.py](../app/players/http.py) · `accept_friend` |
| DELETE | `/friends/{other_id}` | [app/players/http.py](../app/players/http.py) · `remove_friend` |
| GET | `/notifications` | [app/players/http.py](../app/players/http.py) · `notifications` |
| POST | `/notifications/read` | [app/players/http.py](../app/players/http.py) · `read_notifications` |
| GET | `/friends/{friend_id}/messages` | [app/players/http.py](../app/players/http.py) · `message_history` |
| POST | `/friends/{friend_id}/messages` | [app/players/http.py](../app/players/http.py) · `send_message` |
| GET | `/auth/social/browser/providers` | [app/social_auth/browser_http.py](../app/social_auth/browser_http.py) · `providers` |
| POST | `/auth/social/browser/{provider}/start` | [app/social_auth/browser_http.py](../app/social_auth/browser_http.py) · `start` |
| POST | `/auth/social/browser/complete` | [app/social_auth/browser_http.py](../app/social_auth/browser_http.py) · `complete` |
| GET | `/auth/social/providers` | [app/social_auth/http.py](../app/social_auth/http.py) · `providers` |
| POST | `/auth/social/{provider}` | [app/social_auth/http.py](../app/social_auth/http.py) · `social_login` |
| GET | `/test-games/invitations` | [app/test_games/http.py](../app/test_games/http.py) · `invitations` |
| POST | `/test-games/invitations/{invitation_id}/accept` | [app/test_games/http.py](../app/test_games/http.py) · `accept_invitation` |
| POST | `/test-games/invitations/{invitation_id}/decline` | [app/test_games/http.py](../app/test_games/http.py) · `decline_invitation` |
| POST | `/test-games/{room_id}/invitations/eligibility` | [app/test_games/http.py](../app/test_games/http.py) · `invitation_eligibility` |
| GET | `/test-games/{room_id}` | [app/test_games/http.py](../app/test_games/http.py) · `state` |
| POST | `/test-games/{room_id}` | [app/test_games/http.py](../app/test_games/http.py) · `create` |
| POST | `/test-games/{room_id}/join` | [app/test_games/http.py](../app/test_games/http.py) · `join` |
| POST | `/test-games/{room_id}/action` | [app/test_games/http.py](../app/test_games/http.py) · `action` |
| POST | `/test-games/{room_id}/leave` | [app/test_games/http.py](../app/test_games/http.py) · `leave` |
| POST | `/test-games/{room_id}/marriage-settings` | [app/test_games/http.py](../app/test_games/http.py) · `marriage_settings` |
| POST | `/test-games/{room_id}/settings` | [app/test_games/http.py](../app/test_games/http.py) · `settings` |
| POST | `/test-games/{room_id}/start` | [app/test_games/http.py](../app/test_games/http.py) · `start` |
| POST | `/test-games/{room_id}/end` | [app/test_games/http.py](../app/test_games/http.py) · `end` |
| POST | `/test-games/{room_id}/next-deal` | [app/test_games/http.py](../app/test_games/http.py) · `next_deal` |
| POST | `/test-games/{room_id}/flush-settings` | [app/test_games/http.py](../app/test_games/http.py) · `flush_settings` |
| POST | `/test-games/{room_id}/table/{command}` | [app/test_games/http.py](../app/test_games/http.py) · `table_command` |
| POST | `/test-games/{room_id}/rule-vote` | [app/test_games/http.py](../app/test_games/http.py) · `rule_vote` |
| GET | `/games/{room_id}` | [app/transport/game_actions.py](../app/transport/game_actions.py) · `snapshot` |
| POST | `/games/{room_id}/action` | [app/transport/game_actions.py](../app/transport/game_actions.py) · `action` |
| GET | `/health` | [app/transport/http.py](../app/transport/http.py) · `health` |
| POST | `/auth/guest` | [app/transport/http.py](../app/transport/http.py) · `guest` |
| POST | `/auth/signup` | [app/transport/http.py](../app/transport/http.py) · `sign_up` |
| POST | `/auth/signin` | [app/transport/http.py](../app/transport/http.py) · `sign_in` |
| GET | `/auth/me` | [app/transport/http.py](../app/transport/http.py) · `me` |
| POST | `/auth/signout` | [app/transport/http.py](../app/transport/http.py) · `sign_out` |
| GET | `/rooms` | [app/transport/http.py](../app/transport/http.py) · `list_rooms` |
| GET | `/active-tables` | [app/transport/http.py](../app/transport/http.py) · `active_tables` |
| POST | `/rooms` | [app/transport/http.py](../app/transport/http.py) · `create_room` |
| GET | `/room-invitations` | [app/transport/http.py](../app/transport/http.py) · `room_invitations` |
| POST | `/room-invitations/{invitation_id}/{answer}` | [app/transport/http.py](../app/transport/http.py) · `answer_room_invitation` |
| GET | `/memberships` | [app/transport/http.py](../app/transport/http.py) · `memberships` |
| GET | `/rooms/{room_id}` | [app/transport/http.py](../app/transport/http.py) · `room_state` |
| GET | `/rooms/{room_id}/members` | [app/transport/http.py](../app/transport/http.py) · `room_members` |
| POST | `/rooms/{room_id}/enter` | [app/transport/http.py](../app/transport/http.py) · `enter_room` |
| POST | `/rooms/{room_id}/leave` | [app/transport/http.py](../app/transport/http.py) · `leave_room` |
| DELETE | `/rooms/{room_id}` | [app/transport/http.py](../app/transport/http.py) · `delete_room` |
| PATCH | `/rooms/{room_id}` | [app/transport/http.py](../app/transport/http.py) · `update_room` |
| POST | `/rooms/{room_id}/invitations` | [app/transport/http.py](../app/transport/http.py) · `invite_room` |
| GET | `/me/profile` | [app/transport/player_profiles.py](../app/transport/player_profiles.py) · `profile` |
| PATCH | `/me/profile` | [app/transport/player_profiles.py](../app/transport/player_profiles.py) · `update_profile` |
| GET | `/me/profile/appearance` | [app/transport/player_profiles.py](../app/transport/player_profiles.py) · `appearance` |
| PATCH | `/me/profile/appearance` | [app/transport/player_profiles.py](../app/transport/player_profiles.py) · `update_appearance` |
| GET | `/rooms/{room_id}/chat` | [app/transport/room_chat.py](../app/transport/room_chat.py) · `history` |
| POST | `/rooms/{room_id}/chat` | [app/transport/room_chat.py](../app/transport/room_chat.py) · `send` |
| GET | `/me/phrases` | [app/transport/room_pokes.py](../app/transport/room_pokes.py) · `phrases` |
| POST | `/me/phrases` | [app/transport/room_pokes.py](../app/transport/room_pokes.py) · `add_phrase` |
| DELETE | `/me/phrases/{phrase_id}` | [app/transport/room_pokes.py](../app/transport/room_pokes.py) · `remove_phrase` |
| POST | `/test-games/{room_id}/poke` | [app/transport/room_pokes.py](../app/transport/room_pokes.py) · `poke` |
| PATCH | `/me/phrases/{phrase_id}` | [app/transport/room_pokes.py](../app/transport/room_pokes.py) · `update_phrase` |
| WEBSOCKET | `/ws/rooms/{room_id}` | [app/transport/websocket.py](../app/transport/websocket.py) · `room_socket` |


C3c platform route audit and remaining gaps are tracked in the
[platform compatibility contract](distributed-runtime-platform.md). Password/guest
login, own profiles and reviewed platform reads are now available in the integration
app. Friendship writes, provider/browser login, active-socket session revocation and
manual settlements remain explicit compatibility gates; no legacy writer fallback is
mounted to fill these gaps.


C3d closes the friendship mutation gap with native pair-lane commands and atomic
recipient notification intents; legacy friendship writers remain blocked. See the
[friendship contract](distributed-runtime-friendship.md). Active-socket session
revocation/expiry is the next explicit compatibility slice (C3e).


C3e now enforces established-socket token validity with periodic checks, freshness
checks on sends/operations, token-specific closure and cleanup. See the
[socket session contract](distributed-runtime-socket-session.md) for the detection
window and test limits. Browser/provider sign-in (C3f) is next; other cutover gates
remain open.

## Current handoff

The later C3f–C3i, 7c2e/7d and increment-8 records supersede earlier next-step notes
above. Code implementation is complete for the dedicated integration environment.
The production selector stays legacy. Outstanding work is release validation and the
separately deferred operational task set: native storage/lock behavior, live provider
callbacks, container execution, product navigation parity, existing-data cutover with
old credential revocation, capacity, observability and database HA.
