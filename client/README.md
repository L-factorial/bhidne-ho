# Bhidne Ho client

Expo + React Native + TypeScript starter for web, Android, and iOS. The first
screen implements the midnight blue, copper, and ivory welcome design with
Apple, Google, Facebook, and guest buttons. It adapts from a two-column desktop
layout to a stacked phone layout, including safe-area padding and scrolling on
small screens.

Apple, Google, and Facebook buttons remain visible but are dimmed and disabled.
The enabled first-party entry opens username/password **Sign in**, **Sign up**, and
**Guest** choices. `SOCIAL_SIGN_IN_ENABLED` in `src/screens/WelcomeScreen.tsx`
controls the provider placeholders only; it must remain false until a provider's
client flow and test application are configured.

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
The account and guest forms call the backend and then open the shared room directory.
Use Expo web port 8081 or 8083 for the configured local CORS origins.

The API defaults to the web page's hostname on port 8000. Set
`EXPO_PUBLIC_API_URL` to override it. A physical phone needs the computer's LAN
address and a backend bound to `0.0.0.0`; native apps don't use browser CORS.

For a phone, run `npm start` and open the QR code in an Expo Go version compatible
with SDK 57. `npm run ios` opens the iOS simulator on macOS with Xcode installed;
`npm run android` opens a configured Android emulator. Native device/simulator
rendering has not yet been manually verified.

## Scope

Account signup/signin, guest entry, room creation, room discovery, and WebSocket
room membership use the existing FastAPI APIs. After authenticating, choose **Create and
enter room**, select an available room, or enter its ID. Other browser sessions
see new rooms and presence counts within about two seconds. Leaving closes the
socket. Browser sessions and the selected room/game are saved per tab in sessionStorage, so
refreshing restores the same guest and seat. Reconnection runs automatically after
a network interruption; the table stays visible and actions wait for a fresh snapshot.
Native clients currently keep sessions in memory (network reconnection works, but
restarting the native app does not restore its identity). Backend restart clears all
rooms and sessions; expired credentials prompt sign-out rather than silently replacing the player. Social sign-in and the Terms/Privacy controls still show placeholders.

The only backend change is CORS support for localhost/127.0.0.1 Expo web clients
on ports 8081 and 8083. Existing room authentication remains required.

Inside a shared room, compact game tabs select **Call Break**, **Flush**, or
**Marriage**. Call Break shows the shared game controls; the others show a
coming-soon message. There is one room header and one navigation action,
**All rooms**, which leaves the room and returns to the directory.

**Create game** opens four/five-player setup using the existing `/test-games`
backend. Other members use **Join game**; seated players see **Enter game**;
additional users see **Watch game**. The creator starts the game once all seats fill.
Player play waits for each player to confirm their bid and confirm a selected legal card, with no automatic
turns or time limit. Players also use the shuffle, cut, deal, and hand-review controls.
When the final seat fills, every seated
client automatically opens the live card table. **Enter game** reopens it
after returning to the room; **Watch game** opens a spectator view without hands.
The UI polls authorized snapshots every second and sends revision-checked game
actions to the backend. It displays the real private hand, legal card choices,
turn, bids, current/last trick, and scores. Shuffle, skip cut, deal, hand review,
bidding, and card-play controls are available to the appropriate player.
All moves wait for explicit player input; there are no turn or bid timers.

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
your face-up hand at the bottom. Opponent card-count boxes are omitted. Card placement remains local, separate from shared games.

The table's **Current deal** panel shows phase, trick progress, and the current or
next player. Expand **View bids and player status** to scroll through each
player's bid, tricks won, tricks still needed, and remaining card count. Swipe or
use the previous/next arrows. These values reflect the same local preview state
as the hand and table and reset with **Reset table preview**.

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
Social sign-in buttons remain disabled previews; username/password accounts and guest entry connect to the backend.


Bidding displays a notification above the hand for each deal, with bid controls
on your turn and a reminder in the room if the table is collapsed. Stats & bets
shows bids / tricks won and scores for all five deals. The active deal is blue;
completed negative scores are circled in red to mark missed bids. History is
loaded from the server, so earlier deal bids remain available after reopening.

Collapsing the live table reveals **Return to game**. New game revisions,
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
from the shared room presence list. Games wait for that player's input. Player commands carry a stable command
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
game actions for everyone, leaves the room open, and allows a new
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
and persist when the backend is configured with PostgreSQL. Without a database URL,
the development fallback remains in memory and resets with the backend.


The signed-in directory has a Nepali brand header with Profile and Sign out.
Create room / Join with code and Available rooms are independent sections, both
collapsed by default and reset to collapsed when returning from a room. Profile
holds the display name and private phrase collection; visible game seats use each
player's saved name and mark the local seat You.
Profile also contains **Players and friends**. Users can search by username or
display name, send and manage friend requests, remove friends, and open a persistent
one-to-one conversation with an accepted friend. Friend lists poll every three
seconds and an open conversation polls every 1.5 seconds; room chat remains separate.
`tests/browser/display-names.cjs` checks default collapsed sections, form toggles,
four distinct profiles, and each saved name at all four tables using mocked data.


### Round flow

Each seat shows a larger player name with two stacked rows: Bid and Won. Turn
text is shown centrally instead of repeated in each seat; the active seat retains
its highlighted border. Won updates after the card-collection sequence.

During card play, a single notice appears beneath the played cards: bold green
Your turn for the active player, or Player N's turn for everyone else. It pulses until
the authoritative turn changes, pause during trick collection, and stay steady
when reduced motion is enabled. Snapshot refreshes do not restart the pulse.

Completed tricks hold their cards and winner highlight for 1.5 seconds, then
collect toward the winner's seat over 650ms. After the 2.2-second sequence, the
displayed trick count updates and the next leader is named. The final trick goes
to score review instead. Reduced motion skips card movement. Repeated snapshots
do not replay the sequence, and an incoming next-trick play immediately takes
priority. These are presentation timings; authoritative scoring and turns remain
unchanged on the server.

Live Call Break shows compact preparation instructions and central turn notices, offers a
midpoint cut, briefly highlights each trick winner, and shows a score summary
between deals. The creator starts the next deal. Final scores appear after deal five. See the
[round-flow guide](../docs/callbreak-playing-loop.md#live-round-flow-and-score-review).

### Room invitations and leaving

Room controls use separate Create a game and Join a game cards, collapsed by
default. A joinable game shows other room members a highlighted notification
with View game and Dismiss. View game expands the join card without taking a
seat automatically. Dismissal lasts for that match while the room screen stays
open; a new match can notify again. Notifications use the existing game snapshot
refresh (about one second). Leave room disconnects the room connection and returns
to the directory without signing out or ending the game for everyone.

### Hand views

On live tables at widths of 1000px or more, Stats and Rules share a 360px right
column beside the table and hand. Stats opens by default; tabs switch the column
content, which scrolls independently. Narrow screens keep the collapsible inline
controls. Rule editing remains limited to the creator before the game starts.

Last trick is anchored as a slim collapsed row directly above the hand. It expands
upward over the table without moving the hand. Expand it to see each player's card
in play order, with the winner highlighted. A new trick starts collapsed again.
The hand display area is 250px tall, giving the cards more vertical room.

Choose a view using the controls below your cards:

New hands start face down in a single arc, preserving the hand order received
from the server. During this reveal stage, tap any card or Reveal next to turn
up exactly the next card in dealt order; Flip all reveals the remaining cards.
These actions never play cards. View/suit controls stay hidden until all cards
are revealed, then the previously selected view returns. Each new deal or redeal
starts another reveal stage. This is local presentation state, not a change to
dealing or game rules; reopening the app starts with hidden cards again.

During bidding, reveal the full hand to unlock Make your call. The selected bid
is highlighted and only Confirm bid submits it. After confirmation, the panel
names the player whose bid is awaited. When bidding ends, the hand area announces
who leads first until the first card is played. The reveal step gates the manual controls.

- **Sorted fan** keeps the full hand in its existing arc, ordered by suit and rank.
- **Suit fan** adds suit buttons with card counts. Select a suit to show just its
  cards in an arc, or select All to see the full hand. Empty suits are disabled.
- **Grid** shows compact cards with rank, suit symbol, and the full suit name.

Suit groups start in a randomized order each deal. After revealing the hand,
Shuffle suits changes their order again across the sorted fan, grid, and suit
selector. Cards stay in rank order within each suit, and a selected suit stays
selected. Shuffling groups is local to your hand and never submits a game action.
The initial reveal arc still follows dealt order.

During play, tapping a legal card only selects it. The selected card is raised and
highlighted; Play shows its rank and suit and submits it only on confirmation.
Tap another legal card to change the choice, or Cancel to clear it. Hiding cards,
changing view/suit filter, a new deal/trick/turn, and losing play eligibility clear
the selection. Illegal cards remain disabled in every view.

As soon as a hand is fully revealed, it offers Hide cards, including during hand
review and bidding. This hides all cards
in a face-down arc and replaces every hand control with Show cards. Hidden cards
cannot be played. Show cards restores the selected view, suit filter, and shuffled
suit order without restarting the reveal stage. The option is unavailable during initial reveal; a new deal resets the hidden
state. Moving from review to bidding or play does not turn hidden cards face up.

The view stays selected through score review and subsequent deals while the table
is open. The suit filter resets to All on each new deal or redeal. Every view uses
the same turn and legal-card restrictions; changing views does not play a card.
Clubs use green to distinguish them from spades.

`tests/browser/round-flow.cjs` checks all three views at 360px width, suit counts,
legal-card restrictions, playing a card from the grid, and view/filter behavior
across a score review. It uses mocked room data and requires the web dev server.

### Room group chat

See [chat and rule approval](../docs/chat-and-rule-approval.md) for the current
chat overlay, between-deal access and unanimous rule-change workflow.

Backend architecture and integration instructions are documented in
[room chat and participation](../docs/room-chat.md). Chat policy and storage live
in `app/multiplayer/room_chat.py`; game hosts supply the common participation
query, and the HTTP transport only translates requests, responses, and errors.

Chat is for goofy lines, friendly challenges, and getting people into the game.
It is intentionally ephemeral: keep it in bounded memory even when accounts and
games gain database persistence. Do not store chat messages in database tables,
game history, backups, or analytics payloads. A durable chat archive is outside
the product scope.

The Room chat card starts collapsed and works independently of the selected game.
Opening it expands an inline panel sized to the remaining viewport (with a 260px
minimum body on short screens). Message history scrolls inside the fixed panel;
the composer stays visible. Use Close chat to dismiss the overlay and keep the draft.
New messages follow the bottom only when you are already near the latest message.
New messages from others add an unread count and highlighted nudge to the closed
card, with a short ping where browser audio is permitted. Chat has a sound toggle.
History loaded on entry does not ping, and opening chat clears the unread count.
Seated players cannot read or send chat during active play. Call Break chat
reopens between deals and closes when the next deal starts. The server enforces this.
Room members who are not playing can still chat.

Before start, Leave game releases a seat without leaving the room. If the creator
leaves, the next seated player becomes creator; if everyone leaves, the waiting
game ends. `POST /test-games/{room_id}/leave` accepts `{match_id}` and serializes
with start/join so a started game cannot lose a seat. Repeated leaves are harmless.

Connected room members can send messages up to 500 Unicode characters, with a
one-second per-sender cooldown. Messages show the sender's display name at send
time (Guest if unset), and the local sender is labeled You. Failed sends keep the
draft. Leaving the room stops chat refreshes.

Authenticated `GET /rooms/{room_id}/chat` returns the last 100 messages;
`POST /rooms/{room_id}/chat` accepts `{text}`. Both require current room membership.
Clients refresh every second, including while the card is collapsed. History is
shared with members joining later, stays isolated by room, and resets on backend
restart. Chat does not change game state or use personal poke phrases.

`tests/test_room_chat.py` covers authentication, room isolation, sender identity,
validation, rate limiting, bounded history, and access after leaving.

The play screen omits the phase breadcrumb and verbose guidance panel to keep
space for cards. Trick winner announcements appear in the central notice area.

## Appearance

Use the sun/moon button on the welcome screen, in the lobby or profile, or at
either game table to switch between light and dark mode. The initial theme follows
the device setting; a browser choice is saved across refreshes. Switching themes
preserves the current game and card selection.

`src/theme.ts` owns the shared surface, text, status, and playing-card colors.
Use `useTheme()` for inline colors and `useThemedStyles()` for stylesheet factories
so screens and overlays update together. Both games use `CardBack`; card faces,
red/black suits, and selected-card colors stay consistent across themes.

### Flush rooms

Choose Flush to create a 2–5-player game. The creator can configure boot, starting
chips, blind/seen thresholds and multiplier, show permissions/cost, Ace order, and
tie policy before starting. Everyone can review saved rules. Rules lock for the
round, and show always requires the final two active players. Manual Bet, See,
Fold, and Show controls use the shared reliable command client. See the
[Flush adapter and rules guide](../docs/flush-adapter.md) for APIs and verification.

Flush now uses an ellipse of player eye icons, completed-bet counters, a central
pot with coin flights, a Bet grid, and a three-card flip arc. Enable private
side-show in pre-game Rules to request the previous active seen player. Acceptance
reveals opponent cards only to those two players; the loser folds and the winner
stays. The final-two SHOW requirement remains unchanged.

### Guest display names

Fresh guest entry asks for a display name before issuing a session. The backend
validates and saves that profile with the credentials; reload uses the saved
session. Names appear in all hosted game rosters, room chat, and private/table
pokes. The profile editor can change the name later. Legacy API callers may still
omit the name, so older unnamed profiles retain fallback labels.

Run `client/tests/browser/guest-name.cjs` with the backend on 8000 and Expo on 8081
to check required entry, profile storage and refresh recovery.

### Invitation links and action cues

Room and game views offer a single **Copy link** control with a copy icon. Paste
the copied invitation into any messaging app. Expo Clipboard supports copying
on web and native. No player token is included in a link. Seating and link controls sit in a scrollable bottom footer beneath the game
content. Chat has its own compact screen-edge dock: bottom bar on mobile and
bottom-right panel on wide screens. It expands upward without a full-screen
backdrop; minimize/close preserves drafts and unread alerts remain on the bar.

Links use query parameters on the deployed web root, so static hosting requires
no custom route rewrite:

- `?room=<room-id>` opens a preview and waits for **Join room**.
- `?room=<room-id>&match=<match-id>` validates the game, enters its parent room,
  and opens the table. Joining a seat remains an explicit player action.

New guests enter their display name first; the invitation remains pending through
sign-in. Missing rooms and obsolete game links show an error without registering
a room membership. Once handled/dismissed, invitation parameters are removed from
the browser address so refresh cannot silently re-enter a room after departure.

Native builds also recognize `bhidneho://invite?room=...&match=...`. Shared links
use HTTPS so recipients can open them without installing the app. Native share
links default to `https://bhidne-ho.lfactorial.com/`; set `EXPO_PUBLIC_WEB_URL` for
another web deployment. Adding the scheme/clipboard module requires rebuilding
installed native binaries. Native device behavior has not been manually tested in this environment.

Available Lock, Start, Deal, Cut/Skip, Accept hand, Request redeal and Start next
deal controls use the shared slow pulse, respect Reduce Motion and stop when
disabled. Redeal eligibility still comes from the game engine.

Verification: invitation unit tests cover parsing, invalid links, deployment paths
and stripping credentials. `tests/browser/invitations.cjs` verifies real room/game
membership, copying/sharing, stale-link rejection and refresh after departure.
`tests/browser/action-cues.cjs` checks actual changing opacity, disabled actions
and Reduce Motion against real Flush play.

The chat controller is shared between room and game views, preserving the draft
and notification state during navigation and reconnect. The dock reserves bottom
space so its collapsed bar does not cover the final controls. Existing server
chat restrictions still apply; active players see a compact “Paused” label.


### Mobile Flush controls

Flush uses one header with a three-line Table menu on the right for Back to room,
theme and End table, with no profile button. Below 900px, the menu also holds bet
history, rules and in-play seating controls. During play, Poke the table appears
only in Your card area. Lock game and Start game remain visible above the table during
setup and between rounds. The creator also gets a pulsing button in the table's
center; after a round it reads "Lock the table to start another game". It respects
Reduce Motion and the same seating/rule checks as the other start controls.
Deal cards and Cut in half / Skip cut also pulse in the center for the acting player.
Shuffling is part of Deal cards; there is no separate shuffle action.
Invitation copying stays in the room. Paused chat and its reserved space are hidden.
The bottom **Your card area** bar expands like a social-app message sheet over the
fixed header and table, with a dimmed dismissible backdrop, solid cards, and action
buttons. When collapsed, only the dock label is visible. A new private decision
collapses and pulses the dock with “Action needed”; the player taps it to open.
Confirmed bets/show/fold actions collapse it, rejected actions keep
it open, and seeing or peeking at cards leaves it open. Private side-show results
reopen it. Desktop Flush retains its table and cards layout; other games are unchanged.

Run `tests/browser/flush-mobile.cjs` with the backend on 8000 and exported web
client served on 8083 (`TEST_WEB_URL` can override the web URL). It checks mobile
controls, accepted/rejected actions, card peeking, paused chat and desktop resize.


### Marriage and Call Break table controls

Marriage and Call Break use the same three-line header menu (Back to room, theme,
End game), without a profile button. Below 900px, statistics/rules and active
seating controls move into the menu; invitation copying stays in the room, and
paused chat does not reserve space. Setup seating controls remain visible.

The creator's Lock/Start and Prepare next match controls pulse centrally, as does
Call Break's Start next deal. Call Break also centers the acting player's Shuffle,
Cut/Skip and Deal controls. Marriage deals automatically when started; its draw
controls pulse when eligible. Existing seat, rule-approval and replacement rules
still govern every action.

Mobile **Your card area** expands over the fixed header/table viewport and preserves revealed cards and hand
view choices when collapsed. Each new bid, play, draw, or discard decision collapses
and pulses the dock. It also collapses after a confirmed action. Rejections stay
visible. Marriage starts with Your card area collapsed on mobile. Its reveal/draw controls
are inside the expanded sheet, so the collapsed dock remains label-only. Table and private pokes are available
only inside Your card area during active play. Desktop keeps its permanent hand and
Call Break statistics sidebar.

`tests/browser/game-mobile.cjs` runs against the local backend on 8000 and web
client on 8083 (override with `TEST_WEB_URL`); `TEST_GAME` optionally selects
`marriage` or `callbreak`. It exercises real setup and play, card reveal persistence,
rejected/confirmed actions, menu controls, paused chat and desktop resizing.
