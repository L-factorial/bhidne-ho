# Marriage UI and room integration

Marriage is selectable beside Call Break in the shared room UI. This is a first
playable interface for the standalone V1 engine: a complete Dublee round and
normal meld qualification. Normal-hand winning, wildcard partitions, scoring,
settlements, and multi-round matches are not implemented.

## Playing

1. Choose Marriage, create a game with 2–5 seats, and invite room members to join.
   Players can leave before starting. The creator starts once every seat is full.
   Autoplay is selected by default for testing; choose Player play before starting
   to make all moves manually. Autoplay waits ten seconds after dealing, then
   drives every seat at the host timeout interval (normally three seconds).
2. Each player receives 21 private cards. Tap to reveal cards in received order
   or reveal all, then choose Grid or Suit groups. Arc is available only with
   15 or fewer uncommitted cards, including during reveal. Shown groups remain
   in the Players panel and leave the main hand. Hide/Show cards provides
   local screen privacy. Physical copy numbers distinguish repeated faces across
   the three packs; they do not change meld rules.
3. On your turn, take stock or an eligible discard. Select one card and confirm
   Discard to pass the turn. Available moves come from the engine's player view.
4. Once all cards are revealed, the client checks for seven disjoint Dublees and
   three disjoint sequences/Tunnelas. Review either suggested route, inspect or
   adjust the staged groups, then explicitly show it during your action window.
   Suggestions never submit themselves in Player play. Alternatively, select
   cards, choose Dublee, Sequence, or Tunnela, optionally check the meld,
   then Add group. Stage seven Dublees or three sequences/Tunnelas and submit
   them together. Draft groups stay local until submission. The server validates
   ownership, distinct physical cards, meld legality, and the action window.
5. Qualifying unlocks your private Maal panel. Shown groups appear publicly under
   Players and are unavailable for discarding or reuse. Finish round appears
   when the engine offers a valid eighth Dublee. A winning-discard claim requires
   finishing immediately. The result names the winner and offers a new game.

Player tiles send personal pokes; Poke the table broadcasts a room phrase.
Active participants cannot use room chat. The creator can end the game from the
header. Narrow screens stack the table and details; wide screens place Players /
Rules in a right column. Reload restores authoritative cards and turn state;
unsubmitted groups, selections, and reveal progress reset locally.

## Integration boundaries

- `marriage/`: independent rules, legal actions, validation, and private projections.
- `app/adapters/marriage/`: typed command/event catalogs and engine translation.
- `app/test_games/marriage.py`: authenticated seats, room lifecycle checks,
  transactional checkpoints, and per-user query results.
- `app/test_games/marriage_autoplay.py`: removable test policy using only the
  acting seat's safe view. Prefers finishing, then Dublee qualification, then
  normal qualification, and preserves matching cards when discarding. It does
  not guarantee a win; normal completion remains unsupported.
- `app/test_games/service.py`: common create/join/leave/start/end host, membership,
  notifications, participation, and reliable runtime delivery.
  Autoplay submits the same revisioned commands as a client, stops when the game
  ends, and is cancelled during server shutdown. No automation enters the engine.
  The driver uses the fixed seated roster, so disconnected browsers do not stop
  turns. Human HTTP actions still require room membership; both paths use the
  same adapter authorization, revision checks, receipts, and lock.
- `client/src/multiplayer/marriage.ts`: view types and display/group helpers.
- `client/src/screens/MarriageTable.tsx`: table, hand, drafts, and controls.
- `RoomGameControl.tsx`: shared requests, receipts/retries, snapshots, and social UI.

Creation posts `{game_type: "marriage", player_count: 2}` to
`/test-games/{room_id}`. The existing `/action` route accepts the Marriage
command envelope, including match ID, command ID, and expected revision.
Snapshots identify `game_type` and contain `marriage.public` and
`marriage.private` (null for spectators). The shared `game` metadata carries
revision and turn for existing client synchronization. Queries return a
requester-only `query_result`; mutation acknowledgments use `action_ack`.
No client-side calculation can grant a move or reveal another player's hand.

## Verification

```text
python -m pytest tests/test_marriage_room.py tests/test_marriage_adapter.py tests/marriage -q
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
