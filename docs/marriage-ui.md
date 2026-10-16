# Marriage UI and room integration

Marriage is selectable beside Call Break in the shared room UI. This is a first
playable interface for the standalone V1 engine: a complete Dublee round and
normal meld qualification, and configurable final-round points. Normal-hand winning
and wildcard partitions are now supported under the [normal-finish contract](marriage-normal-finish.md).
Monetary settlement and multi-round matches are not implemented.

The thin Stats / Rules / Points row opens closable overlays. Before starting, the
creator can select House bonus (default), Simple points, or edit every scoring value
in Rules and save. Everyone sees the saved rules; they lock on start. Points shows
the final server-calculated itemization, Maal exchange, winner payments, and net
points for every player. During play it shows a pending message; a manually ended
game has no settlement. See [scoring](marriage-scoring.md) for exact rules.

## Playing

1. Choose Marriage, create a game with 2–5 seats, and invite room members to join.
   Creating a game immediately seats the creator and opens the waiting table.
   The creator can collapse back to the room while keeping their seat; when all
   seats fill, the room shows the ready notification and return-to-game control.
   Players can leave before starting. The creator starts once every seat is full.
   Marriage uses manual multiplayer only. Each seated player makes their own
   moves; there are no automatic turns or timeout moves. If a player disconnects,
   their seat and turn remain reserved until they reconnect.
2. Each player receives 21 private cards. Before seeing Maal, Your view starts
   in received order and supports dragging a card before another card. Its manual
   order survives polling and switching tabs; draws append and removed cards
   disappear. Sequence / Tunnela and, with four or more players, Dublee provide
   automatic arrangements without dragging. After that player sees Maal, the tabs
   disappear: remaining cards start grouped by suit and support manual dragging.
   This transition does not change other players' views.
   The compact header combines the turn and action on one line, with an extra
   eligibility line only when applicable. A compact turn box shares a row with
   one Maal eligible/ineligible control before Maal, or Marriage eligible/ineligible
   control afterward. Existing natural unseen finishes remain accessible through
   Win without seeing maal when detected. The draw piles have no extra turn row;
   the drawn card retains its green border/arrow without a separate message.
   Fold and Hide/Show cards occupy the last three slots beside a 21-card hand,
   or a separate row below other hand sizes. Hide/Show is local screen privacy.
   New tables first open a Tunnela declaration layout. Reveal cards, tap the
   glowing detector to select natural triples, or tap Declare none. Normal play
   waits until every active player responds; each responding player returns to
   their regular hand view. The rule can be disabled in game-rule configuration.
3. On your turn, take stock or an eligible discard. Select one card and confirm
   Discard to pass the turn. The draw phase prompts Take a card. During discard,
   Select card to discard pulses above the expanded hand, including after reopening
   it; selecting a legal card changes the prompt to Confirm discard and pulses the
   discard button. Tapping another card replaces the discard selection; tapping the
   selected card clears it. Hand tools > Select cards for meld enables explicit
   multiple-card selection for manual groups; detected-group suggestions still
   select their full group. Reduce Motion keeps these cues static. Available moves come from the engine's player view.
   The center has separate Last discard, Deck, and Maal spots. Draws travel from
   the source pile into the acting player's tile and fade away; discards travel
   from that tile to Last discard. Stock draws stay face down for every viewer.
   The central Maal card shows Tiplu only to entitled players with cards revealed
   and not hidden. The private Maal panel also shows Jhiplu and Poplu.
4. Once all cards are revealed, the client checks for seven disjoint Dublees and
   three disjoint sequences/Tunnelas. Review either suggested route, inspect or
   adjust the staged groups, then explicitly show it during your action window.
   A pulsing Review cue also detects individual Dublees and natural melds before
   a full declaration is ready. On mobile it remains accessible above the collapsed
   hand. Tap an option to select its physical cards, then Stage selected Dublee/meld.
   Remove staged groups locally or Review declaration and Show once the required
   three melds or seven pairs are ready. Options may overlap; staged and committed
   cards are excluded from new hints. Hidden/unrevealed hands do not expose hints,
   and Reduce Motion disables the pulse. These controls never discard a group.
   Suggestions never submit themselves. Select
   a suggested route to open a centered, private preview of the actual grouped
   cards. Confirm Show to submit; accepted groups appear in the central table
   area for everyone. The cards move into a
   temporary central overlay and fade away after about four seconds; they do
   not reserve a permanent section or block table controls. Existing declarations
   are not replayed on reload. Shown groups remain available in Stats.
   Alternatively, select
   cards, choose Dublee, Sequence, or Tunnela, optionally check the meld,
   then Add group. Stage seven Dublees or three sequences/Tunnelas and submit
   them together. Draft groups stay local until submission. The server validates
   ownership, distinct physical cards, meld legality, and the action window.
5. Qualifying unlocks your private Maal panel. Shown groups appear publicly under
   Stats and are unavailable for discarding or reuse. Finish round appears
   when the engine offers a valid eighth Dublee or normal-hand partition. Normal
   wins open a private review of the 21 grouped cards and final discard; Confirm
   finish submits it. Rejections keep the preview open. Normal winning groups
   become public in the Points overlay after finishing. A restricted Dublee
   winning-discard claim requires finishing immediately. The result names the
   winner and offers a new game.

Player tiles send personal pokes; Poke the table broadcasts a room phrase.
When someone creates the next game, players still viewing the old table receive
an invitation inside the game overlay and can join directly without collapsing it.
Active participants cannot use room chat. The creator can end the game from the
header. A slim Stats / Rules row below the header opens scrollable overlays with
a Close button at the top right. Stats shows each player's turn situation, card
count, Maal entitlement, qualification route, and public shown groups.
Player cards use a centered wrapping grid on every screen size, with uniform
140px height and up to 176px width. Narrow screens fit two equal columns; wider
screens fit more cards in a row without stretching the final row. Each card shows
card count, Maal status, qualification route, and turn situation.
There is no separate bottom or side Players/Rules panel.
Reload restores authoritative cards and turn state;
unsubmitted groups and selections reset locally. Reveal progress is retained
for the same player and match in the browser session.

## Integration boundaries

- `marriage/`: independent rules, legal actions, validation, and private projections.
- `app/adapters/marriage/`: typed command/event catalogs and engine translation.
- `app/test_games/marriage.py`: authenticated seats, room lifecycle checks,
  transactional checkpoints, and per-user query results.
- `app/test_games/service.py`: common create/join/leave/start/end host, membership,
  notifications, participation, and reliable runtime delivery. Marriage starts in
  manual mode and rejects autoplay requests. All player commands require room
  membership and use adapter authorization, revision checks, receipts, and a
  shared lock. Disconnected players keep their seats and can resume on reconnect.
- `client/src/multiplayer/marriage.ts`: view types and display/group helpers.
- `client/src/screens/MarriageTable.tsx`: table, hand, drafts, and controls.
- `client/src/components/MarriageCardArea.tsx`: three pile spots and measured
  card flights between the piles and player tiles; respects reduced motion.
- `RoomGameControl.tsx`: shared requests, receipts/retries, snapshots, and social UI.

Creation posts `{game_type: "marriage", player_count: 2}` to
`/test-games/{room_id}`. The existing `/action` route accepts the Marriage
command envelope, including match ID, command ID, and expected revision.
Snapshots identify `game_type` and contain `marriage.public` and
`marriage.private` (null for spectators). The shared `game` metadata carries
revision and turn for existing client synchronization. Queries return a
requester-only `query_result`; mutation acknowledgments use `action_ack`.
`marriage.moves` retains the latest 20 public `CARD_DRAWN` / `CARD_DISCARDED`
projections from the existing adapter events. Stock identities remain null.
The room target checkpoints this list alongside the engine and query results.
Clients queue new sequences once, skip existing history on mount/reload, and do
not replay movements on receipt retries or unchanged polls. Animations are
presentation only; the authoritative game state advances independently.
No client-side calculation can grant a move or reveal another player's hand.

## Verification

```text
python -m pytest tests/test_marriage_manual.py tests/test_marriage_room.py tests/test_marriage_adapter.py tests/marriage -q
cd client
npm run typecheck
node --experimental-strip-types --test tests/*.test.mjs
node tests/browser/marriage.cjs
node tests/browser/marriage-declarations.cjs
node tests/browser/end-game.cjs
npm run build:web
```

Browser scripts require Expo web on localhost:8081 and Chrome/Playwright.
Set `PLAYWRIGHT_MODULE` if Playwright is installed outside the client.
`marriage.cjs` also requires the backend on localhost:8000 and creates an
ephemeral room for two independent sessions; it exercises real draw/discard,
privacy controls, reconnect, and end-game flows on mobile and desktop sizes.
The declaration script uses deterministic HTTP fixtures to verify exact group
payloads, private Maal rendering, and finishing controls. Engine/adapter tests
independently verify actual declaration and finish legality.

### Completed-game results

Completing Marriage keeps the existing table mounted and sized in place, with a
Game result button at its center. It does not render a second waiting table or
open the old winning-hand announcement automatically. The result sheet has a
fixed wrapping tab grid: Game results, Points computation, then each player's
name. Game results labels the Maal indicator (Tiplu), Jhiplu and Poplu with card
faces, separates previously shown groups from the final winning combination,
and identifies any final discard. Fold wins show their reason without inventing
a winning combination. Points computation separates Maal counts/settlement,
win/loss payments and final totals. Player tabs show their final physical cards.

The public query now includes `result_maal` and `final_hands` only for a finished
round (empty/null during play). All players' final hands, including folded hands,
are revealed at completion as requested; stock order and undealt cards remain
private. This is a presentation projection, without a checkpoint/schema change.
Legacy snapshots missing the fields display an unavailable message rather than
reconstructing cards or guessing an indicator. Release backend and client
together to provide the complete result tabs.

### Maal eligibility preview

When both routes qualify, the preview offers Sequence / Tunnela and Dublee tabs;
with one eligible route it shows that route directly. Normal qualification uses
one outlined box with exactly three group rows, each holding at most five cards.
The remaining-card grid follows immediately below. Maximum group-length shapes
share a page, and their unique sub-options are always available in a horizontal
strip. Selecting a sub-option updates the groups, remaining cards and existing
Confirm & show payload. Switching routes/pages resets the sub-option selection
and horizontal scroll position. Dublee keeps its seven-pair display. Server turn
and command permissions still control confirmation; no qualification rule changed.

The Maal preview now opens in a dedicated sheet overlay. Its top-right close
control returns to the hand without submitting. The old Back to your cards
button is removed. Route tabs and centered option/combination metadata sit above
sub-options; option arrows appear only for multiple pages. Cards to show is
centered inside the group box. Confirm & show is centered in a fixed safe-area
footer, outside the scrollable card content, with permission hints/errors nearby.

The eligibility sheet is inset 16px inside the measured hand area, keeping its
bulging yellow outline visible on every edge. Its position updates with viewport
changes. Horizontal swipes over the preview advance/reverse option pages;
vertical swipes still scroll the cards, and horizontal sub-option gestures are
handled independently without changing the page. Arrow buttons remain available
when there are multiple pages. An open preview keeps the hand expanded through
turn changes so its containing frame stays stable.

A sole qualification route has a centered Dublee or Sequence / Tunnela caption
instead of tabs. Dublee alternatives use a plain Option 1/n pager with left/right
arrows and swipe navigation. Its combinations count and repetitive pair-length
sub-option strip are omitted; every alternative seven-pair selection remains
reachable. Sequence / Tunnela retains its group-length sub-option strip.
