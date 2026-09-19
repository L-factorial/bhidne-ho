# Lobby, room, and table navigation

The Expo/React Native app keeps its existing state-based navigation: `App` opens
`SharedRoomsScreen`, which handles sign-in, the lobby, and the selected room.
`RoomGameControl` opens the existing table views in a modal. There is no new router
or framework. Invitation URLs continue to use `?room=…&match=…`.

Room cards are visible immediately and open on a single tap. Enter opens an
existing membership; Join calls the membership endpoint before opening the room.
Create Room opens a compact modal with a name and optional privacy/invitations,
then opens the created room. Room pages devote the central area to tables. A persistent Chat / Members / More
toolbar provides secondary actions. Members opens presence and invitation controls;
More opens the ledger and the existing owner/departure controls. These sheets and
the toolbar are hidden while a game view is open. The empty state has one centered
Create Table action; populated rooms keep creation beside the Tables heading.

Table cards show game, phase, occupied seats, names, and queue status. Actions
come from backend permissions: Take Seat, Watch, Join Queue, Return to Table,
and View Results for ended/completed tables. Results entry uses the existing
table/end view; this change does not redesign gameplay or result presentation.
Create Table uses one modal with game selection, capacity where applicable,
and optional name/invitations. Advanced game rules remain in the existing
pre-game table controls with their existing approval requirements.

## Reused contracts

- `/auth/signin`, `/auth/signup`: unchanged authentication.
- `/rooms`, `/rooms/{id}/enter`: room creation, discovery, and joining.
- `/memberships`: lobby activity and a direct return link for preserved seats.
- `/test-games/{id}` and `?match_id=…`: create/read a selected table.
- `/test-games/{id}/join`, `/table/join-queue`: direct seat/queue actions.
- Existing room WebSocket: presence and reconnect; game snapshots still poll.

The only backend addition is safe, viewer-specific metadata in snapshot `tables`:
phase, queue size, seated display names, and current-user permissions. No engine,
mutation contract, or lifecycle semantics change. No extra summary endpoint is
needed. Activity counts are shown when membership data is available; friend-room
cards do not invent counts or names that the API has not provided.

Selected-match polling is pinned explicitly, including after creating tables or
starting a next match. Back closes the table or exits the room UI; it does not
invoke leave-seat, leave-queue, or leave-room. A rejected seat attempt stays on
the room page, displays the server error, and refreshes the cards.

## Validation

`client/tests/browser/navigation.cjs` runs against a FastAPI server serving the
Expo export (`TEST_WEB_URL`, default `http://127.0.0.1:8096`). Set
`PLAYWRIGHT_MODULE` if Playwright is installed outside the client. It uses isolated
test accounts and checks login, create room/table, code-based joining, taking a
seat, watching, queueing, Back without departure, reload/return, multiple-table
selection, and a last-seat race at mobile width, plus a desktop screenshot.

Focused unit tests cover action selection and selected-match requests; backend
tests verify viewer-specific directory fields and queue/lock transitions.

`client/tests/browser/room-floor.cjs` checks the empty state and toolbar geometry,
Members/invitations, direct ledger entry, owner-delete cancellation, explicit
non-owner departure, chat draft/unread retention, paused-chat permissions, and
the gameplay boundary. It also captures mobile and desktop room layouts.
The room-floor refactor does not change backend contracts or gameplay components.
