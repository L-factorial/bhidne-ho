# Room and game lifecycle audit and implementation report

For current seating, departure and formation semantics, see [Table seating and
rotation](table-seating.md). That extension supersedes the waiting-seat departure,
completed Call Break recreation and single-step start behavior described here.

Navigation, room membership, table membership, connection state, and engine state
are separate. All state remains in memory in one process.

## 1. Problems found before implementation

- `RoomService` held sets of user IDs per room. `ConnectionManager.connect` implicitly
  entered a room, but the final socket disconnect called `RoomService.leave`.
  Game seats survived that removal, leaving players seated without room membership
  and denying their HTTP snapshots/actions until another socket connected.
- The hosted games already shared `TestGameService`, `HostedGame`, `CommandSession`
  and `/test-games/{room_id}` routes. A room has at most one hosted table; `match_id`
  identifies that table/session. Creating a game intentionally seats its creator.
- `HostedGame.users` tracked seats. Call Break and Marriage use positional, fixed
  seat IDs; Flush maintains stable IDs in `flush_seats` across roster changes.
- `RoomGameControl.collapseGame` already only changed local visibility. It did not
  fold, forfeit, remove players, or send a leave command. Returning opened a locally
  cached snapshot while polling later refreshed it.
- No explicit room-leave API existed. The main client closed its socket and only
  attempted a game leave for Flush. Waiting/active seats could become orphaned.
- The host rejected every mid-game departure. Flush allowed roster changes between
  hands; Call Break and Marriage have no engine forfeit/drop/bot-replacement rule.
  Completed or creator-ended fixed-roster games also incorrectly rejected leave.
- Presence displays and targeted-poke checks assumed membership meant connectivity.
- Existing command retries already protected game actions, and duplicate joins
  already returned the existing seat. These mechanisms were preserved.

## 2. Architectural changes

`RoomLifecycle` coordinates room state, explicit room entry/departure, and lookup.
It depends on the game's membership query and serialization guard, not card rules.
`ConnectionManager` tracks connections independently of durable-in-process membership.
Disconnect, heartbeat expiry, failed sends and stale socket cleanup remove only sockets.

`TestGameService.membership` derives game ID, table ID, game type, status, active flag,
participation and seat from authoritative host state. No duplicate game registry or
UI-location record was added. The catalog and game locks serialize room departure
against game creation, joining and starting; membership is rechecked after locks.

`PlayerDeparture.handle_player_leave` is synchronous and invoked under the match
lock once for a held seat. Duplicate successful leaves skip it. Waiting tables use
a no-op hook because no engine exists yet. Active games use their hosted adapters.
Finished fixed-roster games retain historical seat numbering while `departed`
records released membership; departing players no longer receive private views.

## 3. Files/classes changed

- `app/multiplayer/lifecycle.py`: new `RoomLifecycle`.
- `app/games/lifecycle.py`: new `PlayerDeparture` protocol and waiting-game hook.
- `app/test_games/service.py`: `HostedGame`, shared membership lookup, departure,
  snapshots, locking and fixed-roster departure tracking.
- `app/adapters/callbreak/host.py`, `app/test_games/marriage.py`,
  `app/test_games/flush.py`: game-specific departure callbacks.
- `app/multiplayer/connection_manager.py`: preserved membership, online lookup,
  explicit socket revocation, and resume validation.
- `app/models/room.py`, `app/multiplayer/presence.py`,
  `app/multiplayer/room_pokes.py`: distinguish members and connected users.
- `app/main.py`, `app/transport/http.py`, `app/transport/websocket.py`: composition,
  lifecycle endpoints, reconnect metadata and socket authorization after departure.
- `client/src/components/RoomGameControl.tsx`: fresh snapshot on Return and explicit
  game-leave control across games.
- `client/src/multiplayer/{RoomConnection,useRoomSession,GameCommandClient,api,session}`:
  reconnect mode, explicit departure sequence, structured errors and room types.
- `client/src/screens/SharedRoomsScreen.tsx`, `app/test_ui/app.js`: departure UI,
  room-leave notifications and accurate online/member labels.
- Tests listed below; this document and `README.md`.

## 4. Commands and messages

Existing `/test-games/{room_id}` create, snapshot, `/join`, `/start`, `/action`,
`/leave`, `/end`, settings and next-deal routes remain. Reliable game action IDs,
revision checks and receipts remain unchanged. The legacy generic WebSocket
`GAME_COMMAND`/Echo runtime remains separate from the real hosted-game APIs.

| API/message | Meaning |
| --- | --- |
| `POST /rooms/{room_id}/enter` with `{}` | Idempotent explicit room membership; no game join |
| `GET /rooms/{room_id}` | Room membership, online users and viewer's game/seat metadata |
| `GET /memberships` | All rooms the authenticated user belongs to, with current game/seat metadata |
| `POST /rooms/{room_id}/leave` with `{}` | Explicit room departure; rejects active/waiting table seats |
| `POST /test-games/{room_id}/leave` with `{match_id}` | Explicit game departure; keeps room membership |
| `GET /test-games/{room_id}` | Private, authoritative game resync for this authenticated room member |
| `CONNECTED.membership` | Initial/reconnect room and game membership snapshot |
| `ROOM_STATE` | Room membership and connected-member update after explicit entry/departure |
| `ROOM_LEFT` | Explicit membership loss; clients stop socket retry and clear the room view |
| WebSocket `resume=1` | Resume existing room membership; never recreate membership removed by leave |

`active_game` is included in room and hosted-game snapshots:

```json
{
  "game_id": "existing-match-id",
  "table_id": "existing-match-id",
  "game_type": "flush",
  "status": "playing",
  "active": true,
  "player_is_participant": true,
  "seat": 2
}
```

It is null when there is no table. A finished/ended table can still have metadata
with `active: false`; historical seats do not block room departure.

Room departure while seated in a waiting/active table returns HTTP 409:

```json
{
  "detail": {
    "code": "ACTIVE_GAME_EXISTS",
    "detail": "Leave the game explicitly before leaving this room.",
    "game_id": "existing-match-id",
    "match_id": "existing-match-id",
    "requires_leave_game": true
  }
}
```

Game-policy rejection returns HTTP 409 with structured `detail.code` and
`detail.detail`. The clients display the explanation. No backend navigation
commands were introduced.

## 5. Back to Room

Back/collapse changes local modal visibility only. The room connection and snapshot
polling remain mounted. Game actions/turns continue normally, including existing
turn notifications. No membership mutation or departure hook runs.

## 6. Return to Game

Return performs an authenticated snapshot GET before opening the view. It does not
create a game or invoke join. Match ID, seat, hand, turn, phase and revision come
from server state. Duplicate join of an existing participant remains idempotent.

## 7. Explicit Leave Game

The shared host verifies membership and match identity, locks the game, invokes
its departure hook, releases the seat, and broadcasts snapshots. Repeated successful
requests have no additional effect. Rejected departures leave membership and engine
state unchanged. Game-private cached query results are cleared on departure.

## 8. Explicit Leave Room

A spectator or user without an active/waiting seat can leave immediately. A held
seat causes `ACTIVE_GAME_EXISTS`, including between Flush hands. The main client
asks whether to leave the game and room, then calls game leave and only on success
room leave. Cancellation has no membership effect. Game-rule rejection leaves the
user in the room. Successful room leave removes membership and revokes every live
room socket for that user. Duplicate room leave is safe.

## 9. Disconnect/reconnect

The same authenticated identity retains room and game membership without a grace
expiry. HTTP snapshots/actions remain authorized without a live WebSocket. Existing
heartbeat/backoff logic remains. Reconnected sockets receive membership metadata;
the client resumes snapshot polling without allocating a seat or restarting play.

The main client calls `/enter` only when the user selects a room, and uses
`resume=1` for every connection, including restoring saved state on a full reload.
A tab that missed `ROOM_LEFT` while offline cannot recreate removed membership on
retry or reload. The shared connection helper also upgrades automatic retries to
resume mode after a successful legacy first connection. Legacy socket URLs without
`resume=1` still intentionally enter the specified room for compatibility.

## 10. Remaining game differences

| Game | Explicit departure during play | Other departure behavior |
| --- | --- | --- |
| Call Break | `LEAVE_NOT_ALLOWED`; no existing forfeit/bot rule was invented | Waiting, completed and creator-ended games can be left |
| Marriage | `LEAVE_NOT_ALLOWED`; no existing drop/forfeit rule was invented | Waiting, completed and creator-ended games can be left |
| Flush | Existing `FOLD` action when legal; already-folded players can leave without another fold | Preparation, another player's turn and pending show/side-show validation remain engine-owned; roster changes remain allowed between hands |

A Flush leave does not bypass turn validation. If a fold is currently illegal,
leave is rejected until it becomes legal or the hand/table ends. Remaining hand
participants, contributions, settlement and historical seat IDs stay intact.

## 11. Tests added/updated

`tests/test_room_lifecycle.py` adds 14 cases covering all three games: idempotent
entry and joining, room navigation/resync, unchanged private state and seat IDs,
disconnect/reconnect and duplicate tabs, explicit game/room separation, structured
room-leave rejection, callbacks exactly once, no callback for Back/disconnect,
active departure policies, stable historical seats, Flush fold-on-leave, room-only
reconnect, multi-tab room departure, leave-versus-seat races and rejected resume
after explicit membership removal.

Existing Python connection, heartbeat, room-chat and Marriage reconnect tests now
assert retained membership and separate online state. Targeted-poke offline tests
continue to pass using live connection lookup.

`client/tests/reconnection.test.mjs` verifies same-token resume and that `ROOM_LEFT`
stops reconnect without a game command. A pre-existing poke-parser test incorrectly
rejected seat 9; it now checks invalid seat 0 and verifies large stable Flush seat
IDs, without changing the parser.

`client/tests/browser/lifecycle.cjs` exercises real Call Break, Marriage and Flush:
Back, Return, refresh, no game POST during navigation, stable match/seat/state,
room-leave rejection/cancellation, and successful waiting-game leave followed by
room leave, rejection of stale saved-room restore, and intentional re-entry without
a game seat.

## 12. Validation results

- Baseline Python suite: **594 passed**.
- Final `.venv/bin/python -m pytest -q`: **608 passed**, two existing dependency
  deprecation warnings (FastAPI/Starlette/httpx/AnyIO).
- `cd client && npm run typecheck`: **passed**.
- `cd client && node --test tests/*.test.mjs`: **43 passed**.
- Real Chrome lifecycle browser test: **all three game flows passed**.
- `git diff --check`: **passed**.
- Before pushing, integrated newer remote Flush layout/replacement and abandoned-game
  recovery changes. The combined Python suite passed **619 tests**; TypeScript and
  all **43 client tests** also passed. The recovery control uses full room membership,
  separately from online-player indicators.

Browser test invocation, with backend port 8000 and Expo web port 8081:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node client/tests/browser/lifecycle.cjs
```

## 13. Intentionally unchanged

No card engine, scoring, betting, shuffle/deal, privacy or turn rule was rewritten.
No database, Redis, background eviction, distributed synchronization or server-side
UI-location persistence was added. State and sessions still disappear on server
restart. Offline memberships persist for the process lifetime or until explicit
leave. Existing multiple-room membership is supported; lookup returns a list rather
than silently moving a user out of another room. Native session persistence remains
in-memory as before. The terminal client's `/quit` remains disconnect-only; explicit
departure is available through the HTTP lifecycle API and web clients.
