# Table seating, waitlists and match rotation

## 1. Existing behavior

`RoomService` and `ConnectionManager` already separated membership from socket
presence. `TestGameService`, `HostedGame` and `CommandSession` hosted all three
engines, with per-user snapshots and serialized commands. Navigation only changed
view visibility. Call Break and Marriage engine rosters used positional IDs;
Flush maintained stable seat IDs between hands.

## 2. Problems found

There was no waitlist or replacement invitation state. Room departure rejected
waiting seats. Completed Call Break departure shared generic game-leave language,
and recreating a game discarded continuing seats. Marriage and Flush started
through one operation, without a separately reviewable locked roster.

## 3. Membership model

Room membership, table seating, FIFO queue membership and socket connections are
independent. Observers are room members without a seat; queued users can observe.
`TableState` belongs to the hosted table, with a stable `table_id`. Each match has
its own `match_id`. Existing engine rosters remain authoritative during play.
After completion, `next_seats` records the next roster independently, so replacing
a player cannot grant access to their historical private hand.

`GameTablePolicy` centralizes player counts, explicit locking, boundary replacement
and abandonment support. All three games support queues and pre-start promotion.
This is a single-process, in-memory design using existing catalog/match locks.

## 4. Four-player Call Break

The first four explicit joins get seats. Further joins return `GAME_FULL`.
Interested observers explicitly join the waitlist. Start requires all four seats.

## 5. Five-player Call Break

The same policy uses five required seats when configured for five players.
No engine changes are needed for either configuration.

## 6. Pre-start promotion

Explicit seat or room departure releases the waiting seat and fills vacancies
from the FIFO queue under the lifecycle lock. A changed locked formation reopens
and must be locked again. Disconnect, refresh and view navigation never invoke
this operation. Leaving a room removes a waitlist entry and cancels its offers.
An empty waiting table ends if no queued player can fill it.

## 7. Match completion

The existing engine determines completion after its final deal, producing
`MATCH_COMPLETED`. Continuing Call Break players retain their exact seat positions.
The host prepares the next match only once all required seats are occupied and
replacement transfers are complete. This retains the table and waitlist while
creating a new match/session. Generic recreation of a completed Call Break table
is rejected with `NEXT_MATCH_REQUIRED`.

## 8. Leave Seat

The completed Call Break action is **Leave Seat**. It releases ownership for the
next match, leaves room membership intact, and emits `SEAT_RELEASED`. It never
emits abandonment or applies a penalty. The completed scoreboard is unchanged.

## 9. Active abandonment

Active Call Break exposes **Abandon match**, with confirmation explaining that
it stops the match for everyone. It emits `PLAYER_LEFT_ACTIVE_MATCH` with reason
`ABANDON_MATCH` and `penalty_policy: DEFERRED`. The engine has no safe live-seat
replacement rule, so the host ends the match without changing scoring or handing
that seat to a waiter. The legacy active Call Break `/leave` route maps to this
same operation. Marriage and Flush retain their existing active-departure policies.

## 10. Replacement offers

Released completed-match seats are offered FIFO. Offers include identity, match,
seat, departing player, recipient, creation/expiry times and status. They expire
after 30 seconds; a background task advances expiry without requiring polling.
Declining or expiry removes that waitlist entry and offers the next eligible user
the seat. A user may rejoin at the tail. Multiple vacancies reserve distinct
recipients. Pending invitations survive disconnect and are restored in snapshots.

With an empty queue, the current host or the player who released that specific
seat can invite a non-seated room member. Acceptance revalidates membership,
recipient, match, vacancy and offer status, then atomically assigns the seat and
removes the accepted user from the queue. Duplicate acceptance cannot transfer
twice. Decline, expiry and cancellation never assign a seat.

## 11. Marriage formation

`OPEN → LOCKED → STARTED`: the host locks a roster containing at least two players,
up to the configured table maximum. Lock does not instantiate the engine or deal.
The client then exposes **Start game**. Start revalidates membership and count and
creates the existing Marriage engine using the actual roster size. Departures
before start reopen formation, promote waiters and require another lock.

## 12. Flush formation

Flush uses the same explicit lock/start policy, minimum two and configured maximum.
Lock fixes the roster; start invokes existing dealer/shuffle/cut preparation.
After a hand, existing Flush boundary behavior reopens seating. The next hand also
requires explicit lock and start. Unsaved/stale rule drafts block those controls;
saved rules remain editable until start, when the existing revision check applies.

## 13. Privacy and restoration

Existing per-player engine projection remains in use. Observers and waiters do
not receive hands, private Marriage/Maal data, or another Flush player's seen
cards. Departed players and newly accepted replacements cannot act as historical
participants. Room metadata exposes seating, queue position and capabilities,
without private engine state. Reconnect restores authoritative membership, seat,
queue, pending offer and permitted game state; it does not implicitly join a game.

## 14. API, events and UI

Existing create/join/start/leave routes remain. The new authenticated endpoint is
`POST /test-games/{room_id}/table/{command}`, with `match_id` and command fields:

- `join-queue`, `leave-queue`, `lock`, `leave-seat`, `abandon`, `next-match`.
- `invite-seat`: `seat_id`, `recipient`.
- `accept-seat`, `decline-seat`: `offer_id`.

Lifecycle broadcasts use `TABLE_EVENT`, alongside existing private
`TEST_GAME_STATE` snapshots. Events include `QUEUE_JOINED`, `QUEUE_PROMOTED`,
`GAME_LOCKED`, `GAME_STARTED`, `ROSTER_OPEN`, `MATCH_COMPLETED`, `SEAT_RELEASED`,
`SEAT_OFFERED`, `SEAT_OFFER_ACCEPTED/DECLINED/EXPIRED/CANCELLED`,
`PLAYER_LEFT_ACTIVE_MATCH` and `NEXT_MATCH_READY`.

Snapshots include `table.phase`, policy, seated players, queue, released seats,
offers and `current_user` capabilities. Shared `TableControls` uses these for
waitlist, lock/start, seat release, invitation/response and next-match actions.
Room exit during active Call Break explicitly confirms abandonment.

## 15. Implementation files

- `app/multiplayer/table.py`: policy, state, offers and capabilities.
- `app/multiplayer/table_lifecycle.py`: serialized commands, promotion and expiry.
- `app/multiplayer/lifecycle.py`: room departure and table metadata.
- `app/test_games/service.py` and `http.py`: host integration and routes.
- Call Break host and Marriage adapter: reject departed-player actions.
- `client/src/components/TableControls.tsx`, `RoomGameControl.tsx`,
  `RoundSummary.tsx`: shared lifecycle controls and completed-match presentation.
- Game screens and multiplayer session/API modules: snapshot types, separate
  lock/start, rule-draft protection and explicit abandonment confirmation.

The working card engines are unchanged. The existing local Marriage “Poke the
room” toolbar adjustment is preserved.

## 16. Tests added and updated

`tests/test_table_formation.py` adds 27 parameterized cases covering the requested
37 scenarios in grouped assertions: four/five seats, FIFO, duplicate commands,
pre-start promotion, disconnect/reconnect, real completed matches, clean rotation,
acceptance/decline/expiry/invitation, concurrent acceptance, multiple vacancies,
autonomous expiry, queue-vs-room-departure races, abandonment, lock/start validation
and observer/waiter privacy. Existing affected fixtures now explicitly lock before
starting and assert the new departure/next-match behavior.

`client/tests/browser/table-formation.cjs` exercises real backend and browser
sessions for all three games, with desktop and narrow-screen views, separate
lock/start, waitlisting, refresh, promotion and room departure. Existing browser
flow scripts are adjusted to the explicit formation controls.

## 17. Validation

The full Python suite passes: 646 tests, with two existing dependency deprecation
warnings. TypeScript checking and all 43 frontend unit tests pass. The real-browser
table-formation smoke test passes for Call Break, Marriage and Flush. The other
updated browser scripts are retained regression tools and have not all been rerun
for this change.

## 18. Deferred work

`Penalty policy intentionally deferred.` No abandonment penalty, bot replacement,
forced-loss rule or credit deduction is implemented. State, offers and queues are
lost when the server process restarts, as intended for this prototype. Persistence,
distributed operation and configurable offer duration can be added later.
