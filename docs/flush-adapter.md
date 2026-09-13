# Flush adapter and room rules

Flush now uses the shared room host, reliable command runtime, and client room UI.
Create a Flush game for 2–10 players, review/edit rules at the waiting table, and
start once every seat is full. The initial room preset gives each player 1,000
in-game chips, a boot of 5, and a blind stake of 1. These are round-local test
chips, not a persisted wallet. All supported engine rules are shown in the editor;
SHOW's final-two requirement is read-only.

## Commands and adapter ownership

`app/adapters/flush/` provides `FlushAdapter`, `PlayerCommand`, the command/event
catalog, `FlushCommandTarget`, and `register_flush` for a trusted prepared host.
The adapter copies and exclusively owns its engine. Requests require match ID,
command ID, expected revision, command, and validated payload. Player identity
comes from the authenticated user-to-seat roster, never payload fields.

| Command | Payload | Engine API |
| --- | --- | --- |
| START_GAME | `{}` | `start_game()`; owner only, room startup uses this internally |
| BET | `{amount: positive integer}` | `bet(seat, amount)` |
| SEE_CARDS | `{}` | `see_cards(seat)` |
| FOLD | `{}` | `fold(seat)` |
| REQUEST_SIDE_SHOW | `{}` | `request_side_show(seat)`; target selected by engine |
| ACCEPT_SIDE_SHOW / DECLINE_SIDE_SHOW | `{}` | Target-only response |
| CAN_SIDE_SHOW | `{}` | Side-show eligibility query |
| SHOW | `{}` | `show(seat)` |
| GET_STATE | `{}` | `get_player_view(seat)`; never trusted raw state |
| GET_ALLOWED_ACTIONS | `{}` | `get_allowed_actions(seat)` |
| CAN_SEE_CARDS / CAN_SHOW | `{}` | Corresponding eligibility query |
| GET_EVENTS | `{after_sequence?: nonnegative integer}` | `get_visible_events(seat, after=...)` |

Mutations run on a staged engine copy. The adapter validates and serializes all
outbound events before installing that copy, allowing the reliable runtime to
checkpoint/restore the engine and per-user query result transactionally.

Domain events use `GAME_EVENT`, protocol version 1, `game_type: "flush"`, match ID,
revision, and batch index. They broadcast only the engine's safe event projection.
Each mutation also unicasts PLAYER_STATE to every seated user. QUERY_RESULT is
unicast to its requester and does not increment the game revision. Strict schemas
reject extra fields, mismatched private recipients, and nonterminal card reveals.

`GET_STATE` and snapshots serialize the safe typed domain view. Own visible cards
are canonical strings; terminal shown cards in public settlement use shared Card
objects serialized as `{suit, rank}`. The safe ROUND_FINISHED event uses the
engine's canonical string-card pairs. Neither form exposes folded hands or stock.
Blind player state contains no card identities; seeing changes only that player's
private state. Fold wins publish no cards.

## HTTP room lifecycle

Existing `/test-games/{room_id}` routes support Flush. All calls require a bearer
token and current room membership. Seated users can mutate their own game;
spectators can read public snapshots only. Leaving a started game's seat is
prohibited; reconnect restores the same seat, turn, rules, and authorized cards.

| Route | Body |
| --- | --- |
| POST /test-games/{room_id} | `{game_type: "flush", player_count: 2..5}` |
| POST /test-games/{room_id}/join | `{match_id}` |
| POST /test-games/{room_id}/flush-settings | `{match_id, rules_revision, rules, starting_chips}` |
| POST /test-games/{room_id}/start | `{match_id, rules_revision}`; optional manual play mode |
| POST /test-games/{room_id}/action | Reliable command envelope above |
| GET /test-games/{room_id} | Authorized snapshot |
| POST /test-games/{room_id}/end | `{match_id}`; creator only |

Settings require the complete rules dictionary, with no extra fields, and a
starting-chip amount from 0 to 1,000,000. Domain validation checks settings and
dependent fields; room seat count must fit configured player limits and starting
chips must cover boot. Ace/tie enum values use their documented string forms.

The creator alone can save settings during WAITING. Saved settings increment
`rules_revision`, starting at zero. Edits and startup share the game lock. A stale
save or start rejects with 409, so a concurrent edit cannot silently change the
rules a creator starts with. Startup requires the reviewed revision, constructs a
frozen engine rules snapshot, and charges boot/deals only after successful validation.
A failed start installs no engine or partial debit. After start, both the server
and UI reject rule edits. Everyone can continue reviewing the locked settings.
A new game has a fresh match ID and its own editable default rules.

Snapshots expose `flush_settings: {rules, rules_revision, starting_chips, locked}`
and, after startup, `flush: {public, private}`. Spectators receive `private: null`.
Common `game` metadata supplies revision, current player, and terminal winners for
shared client synchronization. `query_result` is stored per requester. Existing
receipts prevent duplicate BET debits; stale actions refresh the caller without
executing on a later turn. Cross-game commands are revalidated by the active adapter.

## Client and verification

`FlushTable.tsx` offers pre-game rules, explicit save/reload, read-only rule review,
manual Bet/See/Fold/Show controls, local hide/show of seen cards, and final payouts.
Unsaved edits block startup. A newer saved revision preserves conflicting drafts
and requires reloading; successful saves reconcile the draft with saved values.
The shared RoomGameControl provides invitations, membership, lifecycle, retries,
and end-game controls. Flush is now selectable for creation in the room UI.

```sh
python -m pytest tests/test_flush_adapter.py tests/test_flush_room.py -q
python -m pytest -q
cd client
npm run typecheck
node --experimental-strip-types --test tests/*.test.mjs
npm run build:web
PLAYWRIGHT_MODULE=/path/to/playwright node tests/browser/flush.cjs
```

The browser regression requires the backend at localhost:8000, Expo web at
localhost:8081, and Chrome. It exercises independent mobile/desktop sessions,
saved rule review, server locking, blind betting, seeing privacy, reconnect,
and terminal show. There is no autoplay, persistence, all-in/side pots,
or real-money accounting in this integration.

## Ellipse table and side-show UI

The Flush screen follows Marriage's header/overlay/hand-dock arrangement. Bet and
Rules open dismissible overlays. Players sit around a responsive ellipse, with
closed/open eye icons for blind/seen, a completed-bet counter, and faded crossed
icons after folding. The ellipse fits above the hand dock on narrow screens.

The center pot animates new BET, terminal-show fee, and side-show contributions as
coin amounts moving from the acting seat to the center. Displayed pot adds each
amount when its flight finishes; authoritative state remains independent. Event
sequence cursors prevent duplicate animation on retries/polls and skip old history
on reload. Reduced-motion users receive direct pot updates. The Bet grid lists
player status, boot, each betting turn (including side-show requests), show fee,
and total contribution.

Seen hands appear in a three-card arc with individually flipped cards. Side-show
is an optional rule, disabled by default. An accepted request gives only the two
participants an opponent-card arc in their own hand area. After the third flip,
the loser sees “You lost” and the winner “You stay”. Continue dismisses the result;
the acknowledgement is stored per tab/match/seat without storing any card faces.
Reload can restore an unacknowledged private comparison but never old coin flights.

`flush.public.pending_side_show` identifies a response in progress.
`flush.private.side_show` contains only that authenticated participant's latest
opponent cards and outcome. `flush.bets` contains safe public contribution events.
The runtime applies the same receipts/revision checks to side-show requests and
responses, preventing duplicate fees or repeated eliminations.

Run `node tests/browser/flush-side-show.cjs` with the same server and Playwright
setup for a real three-session test of the ellipse, coin flights, grid, per-card
flips, target response, private outcomes, and reconnect without replay.

Betting minimums: new rooms start with blind 1 and seen 2 (default multiplier 2). A blind bet sets the seen minimum to amount × multiplier. A seen bet sets the seen minimum to that exact amount and the blind minimum to ceil(amount / multiplier). Bets below the current minimum or above available chips reject atomically. Boot and final-show fees do not raise the stake.

Manual preparation: START_GAME locks the round and enters awaiting_deal with the dealer
as current player. DEAL_CARDS shuffles the hidden deck and enters awaiting_cut for the
next seated player. CUT_DECK(position: 1–51) rotates the deck, or SKIP_CUT leaves its order
unchanged; either choice deals the cards, collects boot once, and starts betting.
Before then, no cards are dealt and no chips are debited. Commands use the same reliable
revision/receipt handling as bets, and reconnects preserve the pending preparation step.
The table shows a pulsing current-player name to everyone and a personal Your turn prompt,
with steady text for reduced-motion preferences.

Flush tables continue across rounds under the same match ID. Seating reopens at each
round end. Players may leave and newcomers may join up to ten occupied seats. The creator
must press Lock table again with at least two seated players before any deal command is
available. The previous winner deals if still seated; otherwise the creator deals.
If the creator leaves, the next seated player becomes creator. Explicit Leave room also
leaves the table between rounds; reconnects alone do not remove seats.

Stable participant IDs retain departed players' net results and balances. Returning players
recover their balance; newcomers receive the configured starting chips. The Bet grid includes
all participants, one signed column per completed round, and running totals. Roster changes
and locking are serialized. Hosted START_NEXT_ROUND commands are rejected: relocking is a
creator-only room operation. Rules remain locked for the table's lifetime.

Final Show is a two-step response: SHOW charges the requester once, publishes only their
hand via SHOW_REQUESTED, and transfers the turn to the other final player. That player
may FOLD (requester wins; responder cards stay private) or REVEAL_CARDS (both hands become
public and the engine compares them using the configured tie policy). No additional fee
is charged for revealing. Other actions and roster changes remain blocked while waiting.
The pending response and revealed requester hand survive reconnects.
