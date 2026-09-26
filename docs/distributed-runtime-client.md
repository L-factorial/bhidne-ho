# Distributed client contracts

## Increment 7a: command lifecycle

`client/src/multiplayer/DurableCommandClient.ts` is an explicit client component.
It is not installed in mounted screens and does not invent HTTP endpoints that the
server has not exposed. The legacy `GameCommandClient` and `PendingGameAction`
remain unchanged; their snapshot/ACK behavior is not the distributed contract.

Create one component per intention slot within one authenticated user session.
`begin(target, body)` generates the command ID and detaches the original target,
payload, match and revision from caller-owned objects. It refuses replacement while
the command is unresolved. Game, table, room and social inbox requests can use the
same lifecycle; command-specific validation and target construction belong to the
caller and authoritative ingress. Atomic room creation uses a different catalog
contract and is not covered by this lane-receipt adapter.

`reconcile(signal)` performs one bounded transport operation:

- Before any receipt arrives, submit the exact original envelope. A lost response
  may conceal a committed command; retrying the same ID retrieves that command.
- Once a pending receipt supplies the lane/status reference, use status lookup.
  A pending command is not accepted and cannot be replaced by a new intention.
- Only a matching accepted/rejected durable receipt resolves the request. Validate
  command ID, lane, sequence, status reference and terminal outcome consistency.
  Non-game outcomes need not contain a revision. Rejection details remain available
  through `latest`; return copies cannot mutate internal retry state.
- A newer snapshot, changed match, disconnect, HTTP error, malformed response or
  timeout never clears an uncertain request. In particular, 404 is not proof that
  a previously submitted command did not commit. An inaccessible/missing receipt
  needs explicit reconciliation in the mounted integration, not a fresh command ID.

The transport must bind authentication to the component's session and implement the
backend submit/status contract from `distributed-runtime-api-contract.md` (or the
chat/social ingress equivalent). It must not convert arbitrary HTTP errors into
terminal receipts. Both methods return untrusted data for receipt validation.
No bearer token or actor identity is stored in the envelope.

Only one reconciliation call runs at a time. The default ten-second deadline aborts
the transport and bounds the caller even if the transport ignores cancellation.
Late responses cannot settle a later attempt. The mounted integration should retry
on reconnect or with bounded backoff; this component starts no autonomous polling.
Transport cancellation does not cancel a durably queued server command.

Keep the instance alive across socket reconnections and table/match switches while
its intention is unresolved. On logout/account change, `close()` aborts work,
discards local state and permanently disables that instance. Never replace its
transport credentials with another user's credentials. Close does not undo a command
already admitted by the server.

## Remaining integration gates

This slice retains state in memory. It does not yet survive app-process termination,
a page reload or destruction of the owning component. Session-level ownership and
any persisted pending-request journal need explicit wiring before live cutover.
Do not claim crash/reload recovery based on these tests.

The explicit 7b adapters below now provide discovery and delivery reconciliation.
Remaining 7c/C3 integration work must map every mounted control to the correct native target/revision, expose
pending/error states, resolve definitive pre-admission errors without discarding
uncertain commits, bind HTTP/WS contracts under C3, and complete load-balancer
integration. Main increment 7 and C6 remain open. Independent-process correctness
remains increment 8; capacity and operational readiness are a later task set.

Verification for 7a: 37 Node tests across the new lifecycle and existing command
helpers, plus the full client TypeScript check. No application startup, route,
database, deployment or dependency change was made.

## Increment 7b: stream discovery and delivery reconciliation

`DurableDeliveryClient<T>` is an explicit per-device/lane/subscription component;
`discoverDeliveryStreams` collects a complete bounded authorized catalog before a
caller changes subscriptions. Neither mounts a WebSocket nor changes legacy screens.

### Subscription and reconnect contract

1. Bind the transport to the authenticated actor and a stable device/tab client ID.
   Bootstrap the own recipient lane and discover social lanes using
   `SocialHistory.streams`; hosted room/table/game scopes need the C3 route adapter.
   Discovery defaults to 128 streams, caps at 2,048 and has a ten-second deadline.
   Failure, duplicate lanes, cursor cycles or overflow never return a partial list.
   Refresh discovery periodically as well as on reconnect to find new conversations.
   Pagination is not a frozen catalog snapshot; later refreshes discover concurrent
   insertions. Every subscription and delivery remains independently authorized.
2. Establish an authorized gateway subscription. Its handshake must supply that
   subscription's initial persisted device cursor. Use a new client component per
   subscription incarnation. Do not use another device's cursor, Redis hints or the
   lane's emitted high-water mark as this cursor.
3. Call `recover(cursor)`. Its `load(signal)` callback fetches the current authorized
   game projection or social history/read state from the primary database, returning
   a detached materialized view. `install(view)` synchronously replaces that lane's
   view after the async load succeeds. Recovery sets local progress but sends no ACK.
4. Serialize page handling after recovery. Gateway pages now include additive
   `after_sequence` alongside `scanned_sequence`. Check lane, ordered event identities,
   supported version, safe integer positions and page bounds before processing.
   Missing frame boundaries fail with a reconciliation error. Gaps between visible
   events are allowed: private events may be hidden while the scan still advances.
5. New visible events invalidate the materialized view: load and replace it before
   ACKing the offered page boundary. Never execute old game deltas over a newer
   snapshot. Native/legacy social history stays separate and merges by stable record
   IDs, not unconditional append. The caller's history loader must complete the
   intended pagination or explicitly fail; a partial view must not pretend to be
   fully reconciled. ACK-only pages also refresh; command status remains handled by
   the 7a component independently of any incidental snapshot ACK.
6. Duplicate/overlapping old pages do not reload already-applied state. Empty pages
   can advance through hidden events without loading content. ACK only the received
   page's offered boundary, never a higher snapshot or locally remembered boundary.
   Lost ACKs can be retried without reapplying the current view. Reconnect always
   loads fresh state, including history already acknowledged by this device.

### Lifecycle, failure and ownership

The component permits one operation at a time, avoiding an unbounded internal event
queue. The mounted socket dispatcher must serialize pages with bounded buffering;
close/reconnect on overflow. Queue frames while initial recovery runs, or arrange
server-side subscription activation after the handshake. Do not ACK inline in the
server gateway's send callback while its stream lock is held.

On disconnect, subscription revocation, reset-required response or logout, close the
old component. Late loads cannot install private state or send a new ACK. The caller
must remove that lane's installed view on authorization loss/logout; the component
does not own UI storage. Supplied `load` callbacks must not mutate UI as a side effect;
only synchronous `install` may commit returned data. Use separate lane views or a
revision-aware aggregator when multiple lanes affect one screen, so independent
loads cannot overwrite each other. Closing does not retract an ACK already sent.

Default per-operation deadlines are ten seconds. Timeout/failed authorization/load
leaves new progress unacknowledged. Unknown versions, missing outbox history and
cursor-ahead failures require explicit reconciliation: there is no automatic cursor
jump to a snapshot boundary or outbox retention reset. No retention/pruning is enabled.
The gateway remains responsible for access checks and its offered-boundary ACK guard.
The client's receipt of a lane ID never grants access.

State is in-memory. This increment implements transport-independent reconciliation
and discovery contracts, not mounted history reducers, a subscription manager or
persistent client identity/cursor storage. Those are 7c/C3 integration tasks, together
with control routing and LB configuration. Use authoritative reads; there is no
replica consistency guarantee. Refresh-on-event prioritizes correctness; it is not
a measured throughput optimization or production capacity claim.

## Increment 7c1: session ownership and subscription composition

`DistributedSession<T>` composes the 7a/7b components above the screen lifetime.
It is explicit and unmounted. Its transport is permanently bound to one authenticated
account; use a new session after logout/account replacement. `command(slot)` returns
the same intention owner across component remounts and table navigation. At most 32
slots are retained; `releaseCommand` refuses unresolved slots. Disconnect retains
commands; close permanently closes them and clears all lane views.

`connect()` replaces the socket generation, starts bounded discovery and recovers
pending commands. It schedules another discovery/status pass after five seconds by
default, including after failures. An individual command lookup has a ten-second
deadline; command recovery is sequential, so many slow slots can delay the next
catalog pass. Discovery completion is not subscription readiness. Callers observe
installed lane views/errors while recovery progresses. `refresh()` permits explicit
catalog refresh; server close/revocation callbacks remove private views immediately.
A failed catalog leaves existing subscriptions intact; each gateway read still
independently checks authorization.

The session opens subscriptions with the stable client ID and buffers pages during
handshake/history recovery. Defaults bound subscriptions to 128, workers to four,
queued pages to eight per lane and encoded pages to 256 KiB (conservative UTF-16
size accounting). One worker processes a lane's initial recovery or one page at a
time; scheduling rotates between ready lanes. Queue overflow, malformed pages,
failed authorization or timeout drops the stream and clears its view; subsequent
discovery may retry. Old callbacks are tied to the old entry and cannot affect a
replacement. A late handshake handle is closed even if transport ignores abort.
Callbacks for errors/removal cannot strand other cleanup when they throw.

The authenticated transport must supply:

- Paginated authorized catalog (including own recipient bootstrap and selected
  hosted scopes), using the 7b shape.
- `open(lane, clientId, page, revoked, signal)` returning the subscription's persisted
  starting cursor, its handle-bound ACK function and synchronous local close. Pages
  may arrive before the open promise resolves; the session buffers them. Do not
  resolve until the authenticated cursor is known. Closing must detach callbacks
  and arrange server unsubscribe; close/abort during establishment must not leak
  a subscription.
- `load(lane, signal)` for authorized view reconstruction. `loadSequencedHistory`
  now concretely walks the chat/social `items/next_sequence` contract with stable-ID
  validation and a 1,000-record default bound. Oversize/incomplete history fails
  explicitly rather than ACKing a truncated view. Legacy timestamp/UUID history
  remains a separate reader to bind in the mounted transport.

`RevisionView` provides detached replacement and rejects lower revisions or results
for another selected match. Select the current durable identity before installation;
clear it on revocation/logout. Table and engine revisions require separate view
instances. Hosted snapshot extraction, per-lane view selection and actual HTTP/WS
URLs remain C3/7c2, since those routes are not yet mounted. Equal revisions can
replace the view (for example authorized presentation changes); socket generations
and serialized lane loads prevent obsolete subscription results from installing.

### Device identity and reload policy

`deliveryClientId` reads/writes a non-secret ID in a caller-provided device/tab-scoped
store and fails on storage errors. Browser composition should use an independently
owned tab namespace/sessionStorage; native composition must hydrate the installation
store first. Distinct concurrent tabs must not share a namespace, including duplicated
tabs that clone sessionStorage. Tab ownership/clone detection and actual platform
storage binding are still mounted-integration responsibilities, not guarantees of
this storage helper. Server authentication remains separate from the client ID.

A stable delivery ID may survive reload; recovering subscriptions always reloads
current authorized views before replay. Pending command state currently survives
screen remounts/socket reconnects only, while the session object lives. The policy
for reload/process death is **no automatic reconstruction or resubmission with new
IDs**. Before live native mutations are enabled, add an account-scoped durable
pending-command journal, persisted before submission and restored before accepting
new intentions. Do not discard uncertain requests on logout and silently recreate
them for another account. No private snapshot/history persistence is introduced.
This journal is an explicit next implementation gate, not claimed as completed here.

Verification: 71 client tests across session, delivery and command components and
legacy command helpers; full TypeScript check passed. Includes buffered ordering,
late handshakes, concurrent recovery bounds, stream revocation, discovery failure,
logout, history bounds and revision protection. These are mocked transport/component
tests, not deployed WebSocket or independent-process evidence. Live screens, routes,
Redis services, databases and load balancer remain unchanged.

## Increment 7c2a: durable pending-command journal

`CommandJournal` supplies optional persistence to `DurableCommandClient` and is
accepted as the final constructor argument of `DistributedSession`. This supersedes
the earlier in-memory-only limit when a conforming durable storage adapter is supplied.
The old unjournaled constructor remains available for existing explicit tests; live
native mutation composition must supply persistence.

The journal stores one versioned document per authenticated account and device/tab
namespace, with at most 32 command slots and a conservative 1 MiB encoded bound.
It saves original target, command ID, revision/match, payload and the last validated
receipt. `begin` commits the envelope before exposing a sendable request. A pending
or terminal receipt is saved before updating the client result. Completed outcomes
remain until replacement by a new intention or explicit terminal-slot release.
Unresolved slots cannot be discarded through release.

On session construction, restore every saved slot before allowing interaction,
including intentions belonging to screens that are not mounted. With no saved receipt,
retry the identical envelope. With a pending receipt, query status. With a terminal
receipt, return the result without network submission. Reconnect recovery uses the
same session loop. A matching device ID is required; the caller must construct the
journal using the same authenticated account as its transport (the session does not
infer identity from bearer-token contents).

Storage reads/writes are synchronous and must be atomic durable replacements before
returning; a write-behind cache does not satisfy the contract. Read-back checks catch
silent write failures, not power-loss guarantees. Async-only native storage needs an
awaited lifecycle adapter before integration; this increment does not install one.
Storage exceptions—including a write that committed before throwing—poison the
journal/client for further work. Close that session and reopen storage to determine
the actual saved state. Never generate a replacement ID to work around the error.
Corrupt, oversized, unsupported-version or wrong-scope records fail closed and remain
untouched for explicit recovery. Storage eviction/deletion across app restarts cannot
be reconstructed by this client alone; platform retention is a cutover requirement.

Logout aborts commands, closes the journal and clears in-memory state while retaining
uncertain disk records for the same account/device. A different account uses a separate
key and never restores them. Persisted requests can include chat text, so platform
storage access and deletion policy must cover outgoing payloads; this is namespace
isolation, not encryption. No bearer credentials, game snapshots or incoming private
history are stored. There is no automatic purge of uncertain requests.

A journal binds each slot once and checks the stored document before writes/sends to
detect stale sequential owners or external changes. This is not a cross-process
compare-and-swap primitive. One active platform owner per account/device namespace
is still required; duplicated-tab ownership is the next slice, 7c2b. Live routes,
controls, storage installation and load-balancer changes remain gated.

Verification: **87 client tests**, including all earlier lifecycle suites, and the full
TypeScript check passed. Tests simulate crash/reload boundaries, pre-send storage
failure, committed-but-throwing writes, lost responses, receipt persistence, corrupt
records, stale owners, offscreen restoration and logout/account isolation. They do
not establish physical storage durability or live backend correctness.

## Increment 7c2b: platform journal ownership

`journalPlatform.ts` (web) and `journalPlatform.native.ts` (Metro native resolution)
now provide explicit `acquireJournal(account, signal)` bindings. Import the platform
module without a suffix in mounted composition so Metro selects the native file.
These modules have no acquisition/startup side effects and are not imported by live
screens yet. `OwnedSession` owns account transitions around these bindings: close the
old session before releasing its journal, acquire the next owner, then construct the
new session with the returned device ID/journal. Construction restores journal slots
before any native control is admitted. Obsolete asynchronous acquisitions are closed
without invoking their session factory. Cleanup releases ownership even if session
close throws. Logout never deletes unresolved records.

For example, the future authenticated root composition can supply:

```ts
const root = new OwnedSession<DistributedSession<View>>(acquireJournal);
const session = await root.select(authenticatedUserId, owner =>
  new DistributedSession(owner.clientId, authenticatedTransport, viewCallbacks, {}, owner.journal));
// Only after a current session is returned:
await session?.connect();
// Logout/account replacement must close this root; screens do not own it.
```

### Web policy: one active account owner per browser profile/origin

The platform uses persistent `localStorage`, with an exclusive Web Lock acquired
before reading/creating the account's stable device ID or journal. The lock callback
stays pending for the full owner lifetime. `ifAvailable` refuses a second owner;
there is no lease expiry, lock stealing or automatic new identity to bypass it.
A duplicated tab therefore cannot independently resubmit or overwrite unresolved
commands. On explicit close or browser-context destruction another tab can acquire
and restore the same journal. A close/reacquire attempted before the browser finishes
releasing the lock may report busy; retry acquisition after release rather than
inventing another namespace. Different accounts use independent namespaces.

This intentionally narrows the earlier per-tab-ID proposal to **one active distributed
session per account in the same browser profile/origin**. It avoids duplicated-tab
cloning and preserves unresolved work across tab closure. Multiple devices/browser
profiles still have independent IDs. Supporting simultaneous tabs for the same
account would require separate tracked journals plus orphan recovery; it is not
silently enabled here. Mounted UX must surface the busy-owner result.

Missing Web Locks/storage, quota errors or corrupt stored identity/journal fail closed.
No unlocked fallback or automatic corrupt-record reset is provided. Browser storage
is not encrypted; browser site-data clearing/eviction can remove it. localStorage
completion/read-back is not a hardware power-loss guarantee. Web Lock lifecycle
follows the browser's [request contract](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request).
The tab origin must support this API before native distributed controls are enabled.

### Native policy and limitations

The native binding uses installed Expo SecureStore's synchronous `getItem`/`setItem`
and device-only, when-unlocked keychain accessibility, matching the existing auth
adapter's approach. Journal keys are encoded to SecureStore-compatible names. Writes
are completed and read back before command submission; no AsyncStorage write-behind
cache is used. Platform write errors propagate and stop admission. Large journal
values may exceed a platform's SecureStore limits even below the logical 1 MiB journal
bound; do not claim full 32-slot/1 MiB capacity without native-device verification.
A transactional native database may be required if those bounds prove inadequate.

A global single-JavaScript-runtime registry prevents overlapping native account
owners and survives module re-evaluation. This is not an OS cross-process mutex.
App extensions, headless secondary runtimes or multi-process writers must not share
this journal without a native locking implementation. Device identity and pending
records survive ordinary app restart subject to SecureStore platform behavior; no
uninstall/backup or power-loss recovery guarantee is claimed. No new dependency or
native build configuration was introduced.

### Verification and next step

**101 client tests** across ownership, journal, session, delivery and existing command
helpers passed, plus the full TypeScript check. Tests exercise lock exclusion,
handoff/reload, storage failure, corrupt-record preservation, account isolation,
native single-runtime locking, obsolete account acquisition and cleanup order.
Web Locks and storage are injected test doubles; tests do not emulate OS keychain
limits or real browser termination. Browser/native smoke validation remains required
before live cutover.

Next: **7c2c**, authenticated HTTP/WS contract mapping and concrete hosted/social view
adapters, beginning with explicit server subscription handshake/ACK ownership and
command-status routes. Mount only when C3/client parity and increment-8 correctness
gates are satisfied. LB composition follows. Live legacy behavior is unchanged.

## Increment 7c2d1: authenticated root composition

`DistributedRootRuntime` now assembles the previously separate journaled session,
command/read transports, multiplexed socket and selected view loaders. The explicit
`distributedRoot(acquireJournal)` factory returns an `OwnedSession` supervisor; its
account factory constructs a runtime using the acquired owner and authenticated token.
No live React hook or screen imports this runtime yet.

The root owns the following lifetimes:

- Account/device journal and command slots persist across screen and socket changes.
  HTTP 401 errors close the runtime and its owner; the auth layer must select a fresh
  authenticated root. Other transport errors retain uncertain commands.
- `select({room, table, chat})` copies a selection, clears command-ready snapshot state,
  disconnects old streams and reconnects without closing the journal. Hosted views
  pin selected identities. Optional chat scopes must be authorized; a failed optional
  chat bootstrap is surfaced, not silently subscribed or treated as empty history.
- Discovery bootstraps recipient/social lanes, reads the selected table projection,
  then opens room/table/current durable game lanes and explicitly requested chat.
  Periodic discovery follows rematches/Flush rounds. A complete catalog replaces
  descriptors only after the operation is still current. Room/table snapshot loads
  sharing one screen are serialized with bounded primary reads; revision guards
  prevent older engine/table state from replacing newer state.
- Socket failure immediately disconnects subscriptions and clears installed views,
  then schedules replacement with exponential retry capped at eight seconds. The
  journal owner remains held. Old socket callbacks, aborted loads and obsolete
  selections cannot commit into new subscriptions. Logout cancels retry and closes
  work before the owner supervisor releases its lock.
- Root `game`, `table` and `room` helpers admit commands through the session's persisted
  slots using the currently installed authorized selection. They report admission,
  not execution. Mounted handlers should immediately call that slot's `reconcile`
  for responsiveness; periodic session recovery is the fallback. Snapshot ACKs do
  not resolve command receipts. Receipt recovery now continues even when stream
  discovery fails, including after losing membership in an old room.

Views passed to callbacks are tagged `snapshot`, `chat` or `social`. Native history
uses the bounded materialized loader; legacy paging remains available through
`root.reads.legacy` and is not auto-appended to native history. A selected table's
controls wait until a current snapshot is installed. Consumers must remove the
corresponding lane view on the remove callback; they must not keep an independent
stale private-state cache after selection/logout.

### Screen parity audit and remaining work

Inspection of `useRoomSession` and `RoomGameControl` confirms these remaining live
shortcut mappings. They must be completed before replacing the legacy hook:

| Existing control | Required native binding |
| --- | --- |
| Game action | Root game intention + immediate durable receipt reconciliation. |
| Join/queue/settings/rule vote/start/end/rematch | Explicit table or room operation selected from the committed view; table revision retained. |
| Combined `/leave` and cross-room abandon | Select `leave-seat`, `abandon` or game `FOLD_AND_LEAVE` once according to game/state; preserve the original operation on retry. |
| Create room | Separate atomic catalog operation, not an existing lane command; add durable catalog client/route contract. |
| Create/replace table | Room command with explicit observed replacement table/revision. |
| Room entry/exit/delete | Journaled room command; navigate only on the matching terminal receipt. |
| Chat and notification reads | Exact scoped chat/recipient target; read-state separate from delivery acknowledgment. |
| Legacy snapshot polling/navigation | Selected-view subscriptions with explicit busy/error/pending state; no competing mutation path. |

**Next: 7c2d2**, screen-facing controller parity for these operations, including
initial room creation and deterministic combined leave. C3 must still register socket
presence and compose server lifetimes; LB integration and increment-8 correctness
remain cutover gates. Do not mount a partial replacement of `useRoomSession` or run
both writers. No live runtime selection, database or deployment changed here.

Verification: **119 client tests** and full TypeScript check passed. New tests compose
real session/journal/read/control logic with mocked HTTP/socket peers and cover
selection, socket replacement/retry, persistent request identity, revision guards,
auth expiry and receipt recovery independent of discovery. They do not constitute
real browser/native lifecycle or independent-process server evidence.

## Increment 7c2d2: screen controllers and room creation

`root.screen(slot, callbacks)` creates a `DistributedScreenController` over a
session-owned journal slot. Use one slot for each unresolved screen intention.
Controllers expose idle/pending/accepted/rejected state, busy state and errors, and
immediately reconcile submitted controls. Pending intentions block replacement;
network errors retain the exact request. The session can reconcile in the background.
`dispose()` removes UI observers and cancels the screen wait, preserving the journal.
`recover()` explicitly resumes a retained intention, including after remount.

Accepted callbacks match the armed command ID and fire once per controller lifetime.
They never run for pending or rejected receipts. Explicit recovery in a new controller
can invoke navigation again; destinations must tolerate repeat navigation. Exceptions
in UI callbacks cannot alter command outcomes. This is not durable exactly-once UI.

Combined leave is selected once from the authorized view:

| Table/game state | Native operation |
| --- | --- |
| OPEN/COMPLETED/ENDED with leave permission | Table `leave-seat` |
| STARTED Call Break with abandon permission | Table `abandon` |
| STARTED Marriage/Flush, active participant | Game `FOLD_AND_LEAVE` |
| Locked or otherwise ineligible | Reject locally before journaling |

Lobby join/start/end/settings/votes map to table controls; next-deal maps to the game
lane. Explicit game/table/room/chat/read helpers preserve the existing contracts.
Room creation uses the client-only catalog target and a pre-send persisted request
ID. Its terminal receipt is `{command_id, status: 'accepted', room_id}`. It has no
synthetic lane, sequence or status reference. Lost responses retry the original
`POST /distributed/rooms`; the atomic catalog service deduplicates creator/request ID.
The journal remains version 1 with target-specific receipt validation. Older clients
must fail closed rather than discard an unfamiliar catalog receipt on rollback.

These controllers are unmounted. Live screen bindings, cross-room navigation flows,
platform smoke tests, C3 server composition and LB integration remain cutover work.
Verification: 134 client tests and full TypeScript checking passed.

## Mounted integration entry (7c2e/7d)

`EXPO_PUBLIC_RUNTIME_MODE=distributed-integration` now selects a separate mounted
room/platform composition in App. It owns one durable journal/session per canonical
server/account identity and uses native command/read/stream contracts. Existing
Call Break, Marriage and Flush game screens use durable table/game controllers;
friendship and ledger panels receive explicit transports instead of legacy writes.
Profile phrases, invitations, room settings, scoped chat and short-lived pokes are
bound. Optional denied chat discovery cannot block an authorized game view.

Production selection remains unchanged. Read the [integration guide](distributed-runtime-integration.md)
for build/test setup and external gates. Mounted Chromium login/create/reload and
three-game projection smoke, 236 client tests, TypeScript and web/iOS exports passed.
The iOS export is not a physical-device persistence/lock test. This separate UI still
requires product navigation/visual parity validation before replacing production.
