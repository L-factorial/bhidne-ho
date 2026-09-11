# Call Break test console

This is a disposable, in-memory test host, separate from the Echo room runtime
and using the shared Call Break adapter. Three-second automation belongs exclusively
to `app/test_games/service.py`; the standalone core has no timers or bots.

## Try it

1. Start `uvicorn app.main:app --reload --workers 1` and open `/` in four or five
   tabs. Use a different guest/account in each. A duplicated tab may share a
   session: sign out of that tab and continue as a new guest when necessary.
2. Create or join one room in every tab. In the Call Break panel choose four or
   five players, then select **Create Call Break game**.
3. The creator takes player 1. In the other tabs select **Join game**. Seats are
   assigned to distinct identities in join-game order; the last required entrant
   fills the table. The game creator then presses Start game; the first dealer is random. Room entry alone does not reserve a game seat.
4. The randomly selected dealer uses **Shuffle deck**, then the next player cuts or
   skips. The dealer selects **Distribute cards**. Review/accept hands, bid in
   order, and click an enabled card to play it.
5. Leave any action unanswered for three seconds to exercise the automatic
   fallback. The countdown and recent activity identify automatic actions.

Your private hand appears after distribution and stays readable even when it
isn't your turn; legal clickable cards have a green border. The public trick
table has a slot for every player and shows each card as it is played. The last
completed trick remains visible, including all four/five cards and its winner,
while the next trick proceeds. Spectators see those public cards but no hands.

After all seats fill, additional users are spectators. They see public play,
scores and activity, never hands. Multiple tabs of one account remain one player.
Rejoining a room restores the existing seat and latest private snapshot. Leaving
or closing a tab does not remove a started game's seat: server automation keeps
the test running. Waiting games reserve entered seats until restart; they do not
create fake players to fill missing seats. A completed game can be replaced by
creating a new game with a fresh match ID in the same room.

## Automatic policy

| Phase | Fallback after three seconds |
| --- | --- |
| Dealer shuffle | Request shuffle; host supplies a SystemRandom deck |
| Cut | Skip cut |
| Distribution | Dealer starts distribution |
| Hand review | Accept every pending player's hand |
| Bidding | Count aces and J-or-higher spades, clamp to 1–maximum bid |
| Play | Choose the lowest-ranked legal non-spade if possible, otherwise a low legal spade |

Hand review has one shared three-second window; another player's acceptance
does not restart your window. Every ordinary accepted action opens a new window
for the next actor. Invalid/stale actions do not reset it. The loop checks the
deadline roughly every 100ms, so fallback occurs just after the deadline when
the event loop is available. Automatic choices go through the same adapter dispatch and engine
validation as manual choices. It accepts weak hands rather than repeatedly
requesting redeals; a human may still claim an eligible redeal during review.

The next deal is prepared automatically, retaining the core's dealer rotation.
All five deals run, after which automation stops and the final scoreboard remains.
Server shutdown cancels automation tasks. Accounts, rooms and games disappear
on restart; no production persistence, reconnect grace or strategic bot is implied.

## Distribution and private information

`StartDistribution` is a dealer-only core command after cut/skip. For this test
flow, it assigns the prepared deck in one atomic transition and emits ordered
per-card pairs: private `CardDealt` and public `CardDistributed`. There is no
animation delay or acknowledgment required between cards. Five players leave
two cards unused; four players receive all 52. Snapshots display the resulting
hand once distribution completes. A future paced-distribution controller can
introduce separate card steps without placing timing policy inside the core.

The adapter translates outcomes to versioned `GAME_EVENT` messages over existing
room WebSockets. Only the test-specific `AutoAction` uses `TEST_GAME_EVENT`.
Private outcomes use `send_to_room_user`, never cross-room send_to_user.
`TEST_GAME_STATE` is individually projected for each connected user. Only a
seated viewer receives their own `GameQuery.get_player_view`; spectators get
public state. The Event inspector consequently contains your private cards, but
never another player's private hand. Public activity logs exclude private events.

## Test-only HTTP interface

All endpoints require a bearer token and a current WebSocket membership in the
specified room. Unknown actor/recipient fields are rejected. The host derives
the player ID from its authenticated-user roster.

| Endpoint | Request |
| --- | --- |
| `GET /test-games/{room_id}` | Latest authorized state, or `status: empty` |
| `POST /test-games/{room_id}` | `{player_count: 4}` or `{player_count: 5}` |
| `POST /test-games/{room_id}/join` | `{match_id}` |
| `POST /test-games/{room_id}/action` | `{match_id, expected_revision, command, payload}` |

Actions use the adapter's validated command names and payload schemas. The host
wraps each test HTTP action in a full PlayerCommand, generating a command ID and
filling deal/attempt context after match/revision checks. Manual and automatic
choices both call dispatch_player; controller steps call dispatch_control.
The test HTTP input and TEST_GAME_STATE snapshots remain test-specific. Each game serializes manual commands and timeouts under one
lock. Revision and match-ID checking prevent stale moves and cross-rematch
actions; there is no production command-ID acknowledgment/deduplication protocol.
Responses containing state use `Cache-Control: no-store`.

The browser polls once per second as a recovery path and receives immediate
WebSocket snapshots. A countdown is only a display of the server deadline; the
browser does not choose cards for anyone. Chat and PING continue through the
existing Echo runtime independently.

### Play mode at start

The creator can choose Player play or Autoplay when starting a full table.
`POST /test-games/{room_id}/start` accepts `play_mode: "manual" | "auto"` alongside
`match_id`. Omission keeps the existing autoplay behavior for older clients.
Manual mode has no background automatic player actions or turn deadlines: players
shuffle, cut/skip, deal, accept hands, confirm bids, and select legal cards themselves.
Controller transitions (shuffle completion, scoring, and preparation of the next deal)
still run on the server. Snapshots expose `play_mode`; `remaining_ms` and
`timeout_seconds` are null in manual mode. The mode is fixed for the match.
