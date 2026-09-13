# Reliable game actions across disconnects

The Expo Call Break client keeps one unresolved action and retries that exact
request until the server confirms acceptance or rejection. The server records
the outcome before sending events. Losing an HTTP response after a bid or card
play therefore does not cause the move to run twice.

The server implementation now lives in the [shared command runtime](shared-game-runtime.md)
and is used by both Call Break and Echo. The client uses the shared
`GameCommandClient` interface and HTTP transport.

For Call Break this applies to `POST /test-games/{room_id}/action`,
including shuffle, cut, distribution, hand review, bids, and card plays. It uses
the existing test host and authenticated room membership. Game creation, joining,
settings, and starting a match do not use this receipt protocol. Registered game
adapters also expose the same contract through `GET /games/{room_id}` and
`POST /games/{room_id}/action`; the latter requires a command ID. Echo is the
current registered example. See the integration guide for adding another game.

## Player experience

1. Submit a bid or tap a legal card. Controls are disabled while the action is
   unresolved, with “Sending your action…” and then “Confirming your action…”.
2. If the response is lost, the pending action stays in memory. Connection
   feedback explains that it will be checked automatically.
3. Once the room connection is available, the client fetches a fresh snapshot
   and resubmits the original request with the same command ID and revision.
4. An accepted receipt replaces the table with the server's current hand, turn,
   and scores. A rejected receipt also refreshes the table and shows its reason.
   A new player choice creates a new command ID.

An action that never reached the server can still succeed if its original
revision is current. If other players advanced the game, it is
rejected as stale. The client never changes an unresolved action's revision to
make it valid on a later turn.

## HTTP contract

Use the existing bearer token and connect that identity to the room WebSocket
before making game requests. The server derives the player from authentication;
the command ID is only a deduplication key.

Example request (substitute the active match and revision):

```json
{
  "match_id": "current-match-id",
  "command_id": "client-generated-unique-id",
  "expected_revision": 42,
  "command": "PLACE_BID",
  "payload": { "amount": 3 }
}
```

`command_id` must contain 1–128 ASCII letters, digits, underscores, or hyphens.
The Expo client generates one per intention and sends the same body on retries.
It uses `crypto.randomUUID` when available and a timestamp, counter, and random
suffix fallback on runtimes without it. IDs are not credentials.

A well-formed, authorized command with an ID returns HTTP 200 and the usual
requester-specific snapshot, plus one `action_ack` field:

```json
{
  "command_id": "client-generated-unique-id",
  "status": "accepted",
  "revision": 43
}
```

The example above is the `action_ack` field, not the entire response. A game
rejection uses the same field with `status: "rejected"` and a readable `detail`.
Acceptance and game rejection are both remembered. Clients must inspect the
acknowledgment rather than treating HTTP 200 alone as acceptance.

| Field or response | Meaning |
| --- | --- |
| `action_ack.command_id` | The submitted ID; verify it matches the pending action. |
| `action_ack.status` | `accepted` or `rejected`, unchanged on retry. |
| `action_ack.revision` | Revision when the outcome was recorded, including immediate controller transitions on acceptance. |
| Snapshot `game.revision` | Current authoritative revision; may be newer than the receipt. |
| HTTP 401 | Invalid credentials; the shared session flow handles sign-out. |
| HTTP 403 | Missing room membership or a spectator attempting to play. Membership may be transient during reconnect. |
| HTTP 404 | No hosted game in this room. |
| HTTP 409 | Wrong/inactive match, ID reused with different content, or receipt capacity reached. |
| HTTP 422 | Invalid request shape, command, payload, or command ID. |

Transport/authentication errors are not stored as receipts. Expected game-rule
and revision rejections are stored after match and seat authorization. Successful
HTTP action responses use `Cache-Control: no-store`. Ordinary snapshots and
WebSocket broadcasts do not contain receipts; the action response acknowledges
only the requesting identity's command.

### Compatibility

On the Call Break `/test-games` endpoint, `command_id` remains optional (and accepts null) for the disposable browser test
console and existing API callers. Requests without an ID retain the old snapshot
and HTTP rejection behavior and have no receipt guarantee. The Expo client always
sends an ID. The adapter receives that same ID for the player command, while
automatic host actions continue to receive server-generated IDs.

## Server processing and guarantees

Receipts belong to one hosted match and are keyed by authenticated user ID plus
command ID. Their fingerprint covers the match, original expected revision,
command, and payload using JSON with sorted object keys. The same ID with a
different fingerprint returns HTTP 409, without changing the recorded result.
Another player's receipt cannot be retrieved by guessing its ID.

Under the shared `CommandSession` lock, `CommandRuntime`:

1. Checks match identity and adapter authorization, after the HTTP host checks room membership.
2. Checks for a receipt **before** checking the current revision. A matching
   receipt returns its original outcome with a fresh private snapshot.
3. For a new ID, validates the revision and applies the player command and
   immediate controller transitions, buffering their outgoing events.
4. Records the outcome and updates the turn deadline without yielding to network
   I/O. Unexpected local failures restore the previous immutable state, log, and
   deadline before propagating the error.
5. Delivers buffered events and publishes snapshots. Delivery remains best effort.

```mermaid
sequenceDiagram
    participant C as Client
    participant H as Game host
    C->>H: Action (ID A, revision R)
    H->>H: Commit move and receipt under game lock
    H--xC: Response lost
    C->>H: Fetch current private snapshot
    H-->>C: Snapshot at revision R or later
    C->>H: Same action (ID A, original revision R)
    H->>H: Find receipt; do not apply again
    H-->>C: Original acknowledgment + current private snapshot
```

A duplicate does not replay events, extend a deadline, rerun random shuffling,
or advance a trick/deal. Cancellation during delivery can leave recipients with
only part of an event batch; polling/reconnection restores their current state.
There is no promise of exactly-once event delivery.

The host retains up to 10,000 receipts per match, including game rejections.
It never evicts individual receipts: at capacity it rejects new IDs before
mutation, while existing IDs still resolve. A finished match keeps its receipts
until a replacement match is created or the process stops. Old match requests
cannot affect a replacement match.

## Client lifecycle and retry policy

`client/src/multiplayer/GameCommandClient.ts` owns submission, snapshot fetching,
and recovery through a common transport. It delegates pending requests and
acknowledgment validation to `PendingGameAction.ts`. `RoomGameControl.tsx` uses
that interface with polling, the room connection, buttons, and status feedback.

- Only one action is unresolved at a time; double taps cannot replace it.
- Submission wakes the polling effect immediately. A fresh snapshot precedes
  each attempt. Retries run on the existing one-second polling loop after each
  request completes, with a ten-second timeout per HTTP request.
- Network errors, timeouts, HTTP 403/408/429, and server failures preserve the
  action. When the room socket is disconnected, attempts wait for reconnection.
- HTTP 400/401/404/409/422 from the action endpoint resolve the request as a
  failure and display the server reason. Game rejections use the stored receipt.
- Missing, malformed, unrelated, or wrong-match acknowledgments do not falsely
  confirm an action. The request stays pending for reconciliation.
- Effect cancellation ignores late responses. The next connection retries the
  same pending request. A failed snapshot refresh disables actions until a fresh
  snapshot arrives.
- If a fresh snapshot identifies a different or missing match, the old request
  is cleared with an explanation and is never sent to the replacement match.

### Persistence limits

Pending actions live only in the mounted room game component. Collapsing the
table and a network reconnect preserve them. Leaving the room, signing out,
switching away so that the component unmounts, refreshing the browser, or
restarting the native app discards them. No card payloads or hands are written
to browser storage. A browser refresh restores the existing guest/seat and
fetches the server state, but does not recover an unsent intention or its receipt.

All server state remains in memory in one process. Backend restart clears
credentials, matches, and receipts together. This increment does not provide
durable recovery, multiple-worker coordination, or a production game runtime.
Those require committing match state and receipts together in durable storage.

## Verification

After the shared-runtime extraction, validated on September 11, 2026: the full
249-test backend regression suite passed, followed by the expanded 13-test shared
runtime suite. All 27 client tests, TypeScript checking, and the Expo web export
passed. The backend reported two
dependency deprecation warnings. Client tests ran with `--test-isolation=none`
because the restricted Windows environment blocked test-worker spawning.
The manual browser interruption procedure and native-device UI checks below
have not been performed for this increment.

From the repository root:

```sh
python -m pytest -q
```

From `client/`:

```sh
npm run typecheck
node --experimental-strip-types --test tests/*.test.mjs
npm run build:web
```

On Windows, use `.venv/Scripts/python.exe` and `npm.cmd` if activation or the
PowerShell npm wrapper is unavailable. In restricted environments where Node
cannot spawn test workers, add `--test-isolation=none` to the Node command.

The backend suite includes complete four- and five-player matches with every
move retried, concurrent duplicate submissions, cancellation during event
delivery after shuffle/bid/play, disconnect/rejoin with the same identity,
unchanged state/deadlines/event counts on retries, fresh private views and
scores, identity isolation, stale rejections, ID conflicts, replacement matches,
receipt capacity, transaction rollback, and HTTP validation/acknowledgments.

Client tests cover lost responses before and after acceptance, identical retry
bodies, stale-turn rejection, canceled responses, changed matches, double taps,
transient/definitive failures, and unrelated acknowledgments. These are automated
service/protocol tests; native UI behavior and real network interruption timing
still benefit from the manual check below.

### Manual browser acceptance check

1. Start the backend and Expo web client. Open four or five independent guest
   sessions, join one room, and start a manual Call Break match.
2. On a player's turn, enable network throttling in browser developer tools,
   submit a bid/card, and switch that tab offline while the request is pending.
   Observe disabled controls and connection feedback.
3. Restore networking. Confirm that the same seat returns, the pending notice
   clears, and the hand, turn, and score agree across the other tabs. The move
   should occur at most once. If it never reached the server and is still legal
   at the original revision, the retry should apply it once.
4. Repeat with a long interruption after an accepted move. If the table has
   advanced, expect an authoritative snapshot without the old move executing
   on the new turn.
5. Repeat while the table is collapsed, then reopen it. Separately refresh a tab
   to verify seat restoration, keeping the pending-action persistence limits above
   in mind. Network timing is nondeterministic; the automated cancellation tests
   deterministically exercise the lost-response-after-commit case.
