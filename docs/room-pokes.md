# Room pokes and punchlines

Call Break players can send short private pokes or messages to the whole table.
Every custom message and saved phrase is limited to **25 characters**, including
spaces and punctuation. The UI counts Unicode characters without splitting
ordinary emoji; the server enforces the same limit.

## Player flow

- Tap another online player's seat to open **Private poke**. Only that player
  receives the message. Your own seat and offline seats do not open this action.
- Tap the central played-card area, an empty card slot, or the table-talk hint
  below the seats to open a message for **everyone** in the room.
- Choose a quick phrase, choose a saved room punchline, or type your own text.
  Sending is explicit: the button names the target player or everyone.
- Use **Save to room** in the composer to keep a custom phrase for later.
- In the room, expand **Room punchlines** to create phrases and remove your own.
  Other room members can see and reuse them. The collection updates within about
  two seconds and is shared across matches in the same room.

The composer can be dismissed with its close button, the backdrop, or Escape on
the web. Closing it after sending does not undo a message already dispatched.

Private messages appear in a bright mint popup labeled **Just for you** with the
sender's player number. Table messages use a gold popup labeled **Table talk**.
The popup enters brightly, dims, fades, and disappears within five seconds. It
does not capture pointer input or pause play. At most three recent messages are
shown at once. Reduced-motion mode uses a steady, softer message that disappears
without animation. The sender gets brief dispatch feedback after sending.

## Audience and limits

Private delivery targets the recipient's sockets **in this room only**, including
another tab using that same identity. It does not broadcast a copy to the sender,
spectators, other players, or that recipient's tabs in other rooms. Table delivery
includes all currently connected room members, including the sender and spectators.

Only seated players can send a Call Break poke. Any connected room member can
create or reuse room phrases; only the creator can delete a phrase. Each room can
hold 24 custom phrases. Duplicate phrases, compared without case, reuse the
existing entry rather than filling another slot. Short built-in quick phrases
are also available and do not consume custom slots.

The server allows one poke per sender per room every 1.5 seconds. Empty/oversized
messages, a stale match, an empty or offline target seat, self-pokes, and requests
without room membership are rejected with a readable error. This short cooldown
keeps repeated taps from flooding the table.

## Implementation and wire contract

Social messages are independent of gameplay commands. They do not change the
match revision, bids, cards, scores, history, turn deadlines, or command receipts.
`RoomPokeService` owns shared phrases and room-scoped delivery. The Call Break host
only validates the match/roster and maps seat numbers to authenticated user IDs.

All endpoints require the existing bearer token and a connected room socket:

| Endpoint | Behavior |
| --- | --- |
| `GET /rooms/{room_id}/phrases` | Return `{id, text, created_by}` entries for this room. |
| `POST /rooms/{room_id}/phrases` | Create/reuse a phrase from `{text}`; HTTP 201. |
| `DELETE /rooms/{room_id}/phrases/{id}` | Delete the requesting user's own phrase. |
| `POST /test-games/{room_id}/poke` | Send `{match_id, recipient_player_id, text}`. Null/omitted recipient means table broadcast. |

For example:

```json
{
  "match_id": "current-match-id",
  "recipient_player_id": 2,
  "text": "Your move, legend!"
}
```

The poke response is `{id, scope}` with `scope` equal to `private` or `table`.
It acknowledges dispatch, not that the target read the message. The recipient
receives a `ROOM_POKE` WebSocket event with:

- `id`, `room_id`, and `match_id`;
- server-derived `sender_id` and `sender_player_id`;
- `recipient_id` and `recipient_player_id`, both null for table messages;
- `scope`, `text`, and `expires_at` in Unix milliseconds.

The request schema rejects spoofed sender fields. Events are delivered using the
existing `send_to_room_user` or `broadcast` methods. There is no public log entry
for a private poke, and no message text is added to game snapshots.

`RoomConnection` forwards live events to the shared room hook. `readPoke` checks
room, audience, message length, and expiry before placing an event in the bounded
popup list. `RoomGameControl` displays only events for its current match.

The client sends pokes once and does not automatically retry a failed request.
These are ephemeral social messages, not reliable game actions. There is no
offline inbox, message history, read receipt, or replay on reconnect. Room phrases
and cooldown state live in memory and clear when the backend restarts, consistent
with the deferred persistence work in [TODO.md](../TODO.md).

## Verification

Validated on September 11, 2026: 263 backend tests and 32 client tests passed,
along with TypeScript checking and the web export. Two backend dependency
deprecation warnings remain.

Backend tests in `tests/test_room_pokes.py` cover private routing across players,
tabs and rooms, broadcasts, spectators, no gameplay mutation, cooldown, offline
targets, stale matches, phrase ownership/capacity, authentication, spoofing, and
the 25-character limit. Client tests in `client/tests/pokes.test.mjs` cover audience
filtering, expiry, deduplication, bounded messages, Unicode limits, and reconnect
event handling.

Run the backend suite from the repository root and client checks from `client/`:

```sh
python -m pytest -q
```

```sh
node --experimental-strip-types --test tests/*.test.mjs
npm run typecheck
npm run build:web
```

An isolated four-player Chrome test at a 320-pixel viewport verified creating a
custom phrase, limiting input to 25 characters, private delivery only to Player 2,
broadcast delivery to all four players, visible bright-to-dim animation, automatic
disappearance, reduced-motion behavior, and unchanged game revision. Screenshots
were inspected. Native-device behavior has not been manually checked.

To try it manually, create a four-player manual game, save a phrase in the room,
tap Player 2 from Player 1's table and send it. Confirm that only Player 2 sees
the private popup. Then tap the card area and send a table message: all players
should see it fade away while play remains available.
