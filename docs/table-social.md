# Table chat and targeted pokes

Live Call Break, Marriage and Flush tables share a social pill above the hand or
action dock. Chat is table-local: seated players can send and read; players in
that table's queue can read only. Other room members and spectators cannot read.
Targeted pokes require a seated sender and a different connected seated recipient.
Only the recipient receives a targeted poke. The sender receives an acknowledgment.

The pill and the hamburger's Table Chat entry open the same conversation. The
existing room chat and legacy hamburger poke composers remain available. Room
chat keeps its existing access policy. Legacy table-wide phrase pokes retain
their previous behavior; the pill always sends targeted pokes.

## Wire contract

Social requests use the authenticated room WebSocket, independent of game
commands, game revisions, durable receipts and gameplay locks:

```json
{"type":"TABLE_CHAT_SEND","match_id":"match-id","command_id":"unique-id","payload":{"text":"Nice hand!"}}
{"type":"TABLE_CHAT_HISTORY","match_id":"match-id","command_id":"unique-id","payload":{}}
{"type":"TABLE_POKE_SEND","match_id":"match-id","command_id":"unique-id","payload":{"recipient_player_id":2,"text":"👋"}}
```

Every response is `TABLE_SOCIAL_ACK`, with `room_id`, `match_id`, `command_id`,
`status` (`accepted` or `rejected`) and optional `detail`. Accepted history responses
include `messages`; accepted chat sends include `message`; accepted pokes include
`poke_id`. Live chat messages arrive as `TABLE_CHAT_MESSAGE` with ID, room and match,
authenticated sender/user and seat IDs, display name, text, and timestamp.
Pokes reuse the existing private `ROOM_POKE` event and expiry contract.

The server validates current seat/queue membership for history, sends and delivery.
Flush recipients resolve through stable seat IDs, which can exceed player capacity.
Seated users can chat during all active game phases; no game state changes occur.

## Ephemeral bounds and retries

No database migration or chat archive is introduced. Each table keeps its most
recent 100 messages and 512 successful social-command receipts. At most 256 table
buffers are retained, with a one-hour idle expiry checked on social access.
All data disappears on backend restart. These are process-local guarantees, not
cross-worker delivery or deduplication guarantees.

The client retries the same social command ID up to three times over 12 seconds,
then reports uncertain delivery. Leaving the view cancels its retries. Receipt
reuse with different content is rejected; current access is checked even on retry.
Sending is limited to one chat message per second and existing poke cooldowns.

Initial history does not create unread badges or seat bubbles. Subsequent live
messages update unread while closed; opening chat clears it. Effects expire after
about 3.5 seconds and never take focus or reset card selection. Poke selection
ends on a recipient tap, another pill tap, outside interaction, disconnect,
navigation, Escape, or a 15-second timeout. Reduced motion suppresses fades.

## Checks

- Backend: `python -m pytest -q tests/test_table_social.py tests/test_room_pokes.py`
- Frontend: `node --test client/tests/*.test.mjs`
- Types/build: `cd client && npm run typecheck && npm run build:web`
- Browser: export fixtures with `.venv/bin/python scripts/social_browser_fixtures.py`,
  serve `client/dist`, then run `node client/tests/browser/table-social.cjs`.
  Set `TEST_WEB_URL` (default `http://localhost:8087`) and optionally
  `PLAYWRIGHT_MODULE` to an installed Playwright module. Browser tests use mocked
  social commands and real engine-generated snapshots; backend tests separately
  exercise the real WebSocket route and authorization.
