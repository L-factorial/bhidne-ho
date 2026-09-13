# Marriage UI and room integration

Marriage is selectable beside Call Break in the shared room UI. This is a first
playable interface for the standalone V1 engine: a complete Dublee round and
normal meld qualification, and configurable final-round points. Normal-hand winning,
wildcard partitions, monetary settlement, and multi-round matches are not implemented.

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
2. Each player receives 21 private cards. Tap to reveal cards in received order
   or reveal all, then choose Grid or Suit groups. Arc is available only with
   15 or fewer uncommitted cards, including during reveal. Shown groups remain
   in the Stats overlay and leave the main hand. Hide/Show cards provides
   local screen privacy. Physical copy numbers distinguish repeated faces across
   the three packs; they do not change meld rules.
3. On your turn, take stock or an eligible discard. Select one card and confirm
   Discard to pass the turn. Available moves come from the engine's player view.
   The center has separate Last discard, Deck, and Maal spots. Draws travel from
   the source pile into the acting player's tile and fade away; discards travel
   from that tile to Last discard. Stock draws stay face down for every viewer.
   The central Maal card shows Tiplu only to entitled players with cards revealed
   and not hidden. The private Maal panel also shows Jhiplu and Poplu.
4. Once all cards are revealed, the client checks for seven disjoint Dublees and
   three disjoint sequences/Tunnelas. Review either suggested route, inspect or
   adjust the staged groups, then explicitly show it during your action window.
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
   when the engine offers a valid eighth Dublee. A winning-discard claim requires
   finishing immediately. The result names the winner and offers a new game.

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
