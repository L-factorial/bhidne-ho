# Bhidne Ho client

Expo + React Native + TypeScript starter for web, Android, and iOS. The first
screen implements the midnight blue, copper, and ivory welcome design with
Apple, Google, Facebook, and guest buttons. It adapts from a two-column desktop
layout to a stacked phone layout, including safe-area padding and scrolling on
small screens.

## Run

Use Node.js 22.13 or newer and npm:

```sh
cd client
npm ci
npm run web
```

Start the backend in another terminal from the repository root:

```sh
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Open the local URL printed by Expo. The welcome screen needs no backend, but
**Play as guest** now calls the backend and opens the shared room directory.
Use Expo web port 8081 or 8083 for the configured local CORS origins.

The API defaults to the web page's hostname on port 8000. Set
`EXPO_PUBLIC_API_URL` to override it. A physical phone needs the computer's LAN
address and a backend bound to `0.0.0.0`; native apps don't use browser CORS.

For a phone, run `npm start` and open the QR code in an Expo Go version compatible
with SDK 57. `npm run ios` opens the iOS simulator on macOS with Xcode installed;
`npm run android` opens a configured Android emulator. Native device/simulator
rendering has not yet been manually verified.

## Scope

Guest sign-in, room creation, room discovery, and WebSocket room membership now
use the existing FastAPI APIs. After entering as a guest, choose **Create and
enter room**, select an available room, or enter its ID. Other browser sessions
see new rooms and presence counts within about two seconds. Leaving closes the
socket. Browser sessions and the selected room/game are saved per tab in sessionStorage, so
refreshing restores the same guest and seat. Reconnection runs automatically after
a network interruption; the table stays visible and actions wait for a fresh snapshot.
Native clients currently keep sessions in memory (network reconnection works, but
restarting the native app does not restore its identity). Backend restart clears all
rooms and sessions; expired credentials prompt sign-out rather than silently replacing the player. Accounts/social sign-in and the
Terms/Privacy controls still show placeholders.

The only backend change is CORS support for localhost/127.0.0.1 Expo web clients
on ports 8081 and 8083. Existing room authentication remains required.

Inside a shared room, compact game tabs select **Call Break**, **Flush**, or
**Marriage**. Call Break shows the shared game controls; the others show a
coming-soon message. There is one room header and one navigation action,
**All rooms**, which leaves the room and returns to the directory.

**Create game** opens four/five-player setup using the existing `/test-games`
backend. Other members use **Join game**; seated players see **Enter game**;
additional users see **Watch game**. The creator starts the game once all seats fill; the creator chooses **Player play** (the default selection) or **Autoplay** before starting.
Player play waits for each player to confirm their bid and tap a legal card, with no automatic
turns or time limit. Players also use the shuffle, cut, deal, and hand-review controls.
Autoplay retains the three-second fallback for inactive players. When the final seat fills, every seated
client automatically opens the live card table. **Enter game** reopens it
after returning to the room; **Watch game** opens a spectator view without hands.
The UI polls authorized snapshots every second and sends revision-checked game
actions to the backend. It displays the real private hand, legal card choices,
turn, bids, current/last trick, and scores. Shuffle, skip cut, deal, hand review,
bidding, and card-play controls are available to the appropriate player.
Only Autoplay uses three-second timers, including bidding; the ten-second
bid timer belongs to the separate local test preview.

Live games open in a full-screen overlay. The top-right **Collapse**
button returns to the room without leaving the game. History starts collapsed
on every screen size and opens with **Show game history**. Tabs show
completed tricks from the current deal and the recent public server activity log,
newest first. This is not a full archive of previous deals; the server log is bounded.

Entering a room with an open game automatically opens a join invitation with
available seats and **Join game**. The invitation is offered once per game;
dismissing it leaves the regular Join game button available without reserving a seat.

The **Invite your friends** panel shows the real, selectable **Table code**.
Friends choose **Join with code** on the room directory, paste it, then select
**Enter with table code → Join game**. **In the room** shows connected guests.
Room creation and joining share a compact tabbed form; available rooms appear
beside it on desktop and below it on phones.

Local test tools are under the collapsed **Developer previews** section. Choose
four or five players, then **Preview card table**. The table opens on its own
screen without stacked room navigation. It shows players in one compact row with played cards underneath and
your face-up hand at the bottom. Opponent card-count boxes are omitted. Card placement and the
10-second bidding/autoplay simulator remain local, separate from shared games.

The table's **Current deal** panel shows phase, trick progress, and the current or
next player. Expand **View bids and player status** to scroll through each
player's bid, tricks won, tricks still needed, and remaining card count. Swipe or
use the previous/next arrows. These values reflect the same local preview state
as the hand and table and reset with **Reset table preview**.

### Temporary autoplay testing

Choose **Testing only: open autoplay** on the card table. Each test deal opens a
10-second bidding window with a heuristic suggestion. Adjust your bid from 1 to
13 (four players) or 10 (five players), then confirm. If you don't confirm in time,
the original suggested bid is accepted automatically; editing does not extend
the deadline. Opponents use estimated bids immediately. After your bid is accepted,
autoplay starts and runs all seats every three seconds. Pause stops card play,
Step once advances one card (or clears a completed trick), and New test deal
reshuffles and opens a fresh bidding window. Exiting cancels the
timer. The test stops after one complete deal. Four players receive 13 cards each;
five receive 10 each, leaving two unused.

The disposable simulator in `src/testing/` mirrors the existing server test
heuristic: estimate bids from aces and J-or-higher spades, then choose the lowest
legal non-spade when possible. It follows suit and beats/trumps when required.
It is not the Python engine and does not simulate shuffle/cut phases, hand review,
redeals, match scoring, or networking. All test hands exist locally; only yours is
displayed face-up. Do not use it for real multiplayer or engine validation.

To remove it, delete `src/testing/` and `tests/autoplay.test.mjs`, then remove the
`AutoPlayTable` import, `testing` state, conditional render, and testing button
from `CallBreakTableScreen.tsx`. No backend changes are needed.

Run the heuristic checks with Node.js 22.13+:

```sh
node --experimental-strip-types --test tests/autoplay.test.mjs
```

The cards are drawn with native views, text, and gradients. Fonts ship with the
bundle, so the screen does not depend on a remote image or font service.

- `src/screens/WelcomeScreen.tsx`: responsive welcome layout and preview actions.
- `src/screens/SharedRoomsScreen.tsx`: real guest session, shared room directory, and WebSocket membership.
- `src/screens/GameRoomsScreen.tsx`: game selection and Flush/Marriage room previews.
- `src/screens/LobbyScreen.tsx`: sample lobby, create/join controls, and waiting room.
- `src/screens/CallBreakTableScreen.tsx`: local hand and card-placement preview.
- `src/components/CardTable.tsx`: shared player row, turn indicators, and played cards beneath each player.
- `src/components/SignInButton.tsx`: shared provider buttons.
- `src/components/CardFan.tsx`: decorative playing cards.
- `src/theme.ts`: colors and typography.

## Check and export

```sh
npm run typecheck
npm run build:web
```

The web export is written to ignored `dist/`. The client follows Expo's
[web setup](https://docs.expo.dev/workflow/web/) and uses SDK-compatible dependencies.


Room games now open a full-screen table once all four or five seats are filled.
The creator presses **Start game**; the server chooses the first dealer randomly.
**Collapse** returns to the room without leaving the game. Reopen with **Enter game**.
The hand stays in a bottom card row, while **Stats & bets**, **Rules**, and history
start collapsed. Stats show current bids, tricks won, total tricks, and all five
deal scores. The creator can save redeal options and placement payments in whole
units before starting. These are shared agreements, not payment processing.
Social sign-in buttons remain previews; guest entry connects to the backend.


Bidding displays a notification above the hand for each deal, with bid controls
on your turn and a reminder in the room if the table is collapsed. Stats & bets
shows bids / tricks won and scores for all five deals. The active deal is blue;
completed negative scores are circled in red to mark missed bids. History is
loaded from the server, so earlier deal bids remain available after reopening.

Collapsing the live table reveals **Go back to game**. New game revisions,
seat changes, settings updates, and game errors trigger a short pong and a
pulsing return button. Repeated timer polls do not retrigger alerts. Reopening
clears the pulse; reduced-motion users receive a static highlight. **Sound on**
toggles mute. Web audio is initialized by the Collapse button gesture; native
playback uses a bundled pong through Expo Audio. These are in-app alerts while
the room is open, not operating-system push notifications.

## Shared session and reconnect support

### Pokes and personal phrases

Tap another online player's seat at the live table to send a private poke. Tap
the played-card area or the table-talk hint to send a message to everyone in the
room. Choose a quick phrase or type your own, up to **25 characters**. Save it
with **Save to my phrases** in the composer. After login, open **Profile** to manage
**My goofy phrases**. Add, edit (tap a saved phrase), or delete entries, then reuse them across
Call Break rooms. Each player has up to 24 phrases. Collections currently reset
with backend restarts or a new guest identity.

Private mint and table-wide gold popups brighten, dim, and disappear within five
seconds without blocking card controls. Reduced-motion mode uses a steady popup.
Pokes do not change game state and are not replayed after reconnecting. See the
[poke guide](../docs/room-pokes.md) for delivery rules, APIs, limits, and testing.

### Connection lifecycle

`src/multiplayer/` owns guest identity, selected room/game, room membership polling,
connection retries, and heartbeats. This is independent of Call Break and reusable
for future games. Each game's client reloads its authoritative state after reconnecting.
Call Break restores the same seat and private hand and marks disconnected seats
from the shared room presence list. Manual games wait for that player's input;
autoplay keeps its existing timeout policy. Player commands carry a stable command
ID. An interrupted action is automatically reconciled after reconnecting using
the same ID and original revision; the server returns its recorded outcome without
applying it twice. Pending actions remain in memory while the room stays mounted.
See [Reliable game actions](../docs/reliable-game-actions.md) for the HTTP contract,
retry behavior, lifecycle limits, tests, and manual acceptance procedure.

Call Break now uses the shared `GameCommandClient` and HTTP transport. The server
uses the same `CommandRuntime` as the Echo test engine; game adapters supply rules,
rollback checkpoints, and snapshots. See [Shared command infrastructure](../docs/shared-game-runtime.md)
for the integration guide and common tests required for future games.

Web storage is scoped to both tab and API server. Separate fresh windows can host
separate guests. Browser tab duplication can copy sessionStorage and therefore reuse
the original guest; sign out in a duplicate if you want a different player. Leaving
a room removes the saved room but keeps the guest; signing out clears both. Private
hands and game snapshots are not stored in browser storage. Storage restrictions
fall back to an in-memory session.

Clients opt into server idle detection with `heartbeat=1` on the room WebSocket.
The client sends `HEARTBEAT` every five seconds and expects `HEARTBEAT_ACK`; a missing
ack triggers reconnect. The server removes opted-in sockets after 30 seconds without
a frame. Retries back off from one to eight seconds, and reconnect immediately when
the browser reports that it is online again. Presence is refreshed every two seconds;
silent network loss can take up to the server idle timeout to appear as offline.

Run connection and session checks with:

```sh
node --experimental-strip-types --test tests/reconnection.test.mjs
```


### Ending a game

The game creator can choose **End game** in the room, waiting lobby, or live table.
A confirmation offers **Keep playing** or **End game for everyone**. Ending stops
manual actions and autoplay for everyone, leaves the room open, and allows a new
game. An unfinished match has no declared winner or final placement payout.

`POST /test-games/{room_id}/end` takes `{match_id}` and requires the creator's
bearer token and room membership. The server serializes ending with game actions,
timers, and replacement, publishes an `ended` snapshot, and preserves the existing
state for inspection. Repeating the same end request is safe; a stale match ID
cannot end a replacement game. Other players see the ended state on refresh.


The browser regression in `tests/browser/end-game.cjs` starts a waiting game,
checks that repeated snapshot refreshes leave exactly one End game button, and
checks cancellation, confirmation, and starting another game. It mocks HTTP and
WebSocket data, so it does not create rooms on the backend. With Expo web running
at `http://localhost:8081` and Playwright available, run from `client/`:

```sh
node tests/browser/end-game.cjs
```

For an external Playwright installation, set `PLAYWRIGHT_MODULE` to its absolute
module path. Chrome is used by default; set `CHROME_EXECUTABLE` for a custom path.
The test also rejects React duplicate-key warnings. The end control and live
table must have distinct sibling keys, even when they belong to the same match.


### Game display names

Open **Profile**, enter **Display name**, and choose **Save name**. Names are at
most 25 Unicode characters; whitespace is normalized and control characters are
rejected. Clear the field to return to the default player number. Names appear
on live seats, turn notices, and winner announcements, updating on the next game
snapshot without changing seat ownership or game state. Names need not be unique.

`GET /me/profile` reads `{display_name}`; `PATCH /me/profile` updates it using the
same shape. Authentication determines whose profile changes. Display names are
public to fellow room players through game snapshots; saved phrase collections
remain private. Names are keyed by user identity across rooms and account sessions,
but are currently in memory and reset with the backend.


The signed-in directory has a Nepali brand header with Profile and Sign out.
Create room / Join with code and Available rooms are independent sections, both
collapsed by default and reset to collapsed when returning from a room. Profile
holds the display name and private phrase collection; visible game seats use each
player's saved name and mark the local seat You.
`tests/browser/display-names.cjs` checks default collapsed sections, form toggles,
four distinct profiles, and each saved name at all four tables using mocked data.
