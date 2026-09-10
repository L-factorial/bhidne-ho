# Call Break adapter contract

Status: all eight player commands and all 24 outbound event variants are implemented
in [`adapter.py`](../app/adapters/callbreak/adapter.py), with strict schemas in
[`contracts.py`](../app/adapters/callbreak/contracts.py). The test-console host uses
this adapter for manual and automatic play, authenticates roster membership, and
routes its messages within the room. Production persistence and retry handling
remain separate work. Chat/PING still run Echo.

## Ownership

```text
Browser request (adapter-owned uppercase command name)
  → authenticate user and resolve room/match/player [test host implemented]
  → parse_player_command(raw_request)              [implemented]
  → validate match/revision/actor and map command   [implemented]
  → standalone engine typed command
  → domain state + outcomes
  → adapter creates OutboundEvent + RoutedEvent    [implemented]
  → platform broadcasts/unicasts within room       [test host implemented]
```

The adapter owns the client-facing message vocabulary, payloads and routing
instructions. It does not own game rules. Core commands such as `PlaceBid` and
core outcomes remain independent Python types. Core `TurnChanged`, for example,
can produce both a public adapter `TURN_CHANGED` and a private `BID_REQUESTED`.
These are separate notifications, not extra moves applied to the engine.

The existing core's audience metadata remains intact; translation must preserve
its private/public boundaries. No adapter types are imported by `callbreak`.

## Client command envelope

```json
{
  "type": "GAME_COMMAND",
  "protocol_version": 1,
  "match_id": "match-abc",
  "command_id": "move-123",
  "expected_revision": 27,
  "deal_number": 1,
  "attempt": 1,
  "command": "PLAY_CARD",
  "payload": {"card": "QH"}
}
```

`match_id` identifies a match instance; rematches get another ID. `command_id`
will support retry deduplication. Revision and deal-attempt checks prevent stale
actions after a move or redeal. The dispatcher checks match ID, revision and deal attempt against current state.
`command_id` is carried by the request but is not yet deduplicated.

No `player_id`, `user_id`, `room_id`, deck contents or recipient fields are
accepted as identity/routing instructions. The platform supplies the trusted
actor and room. Unknown fields are rejected, including inside command payloads.
Parse the original raw request before the existing generic platform model can
ignore extra fields. Numeric fields reject strings, floats and booleans. Card
IDs are canonical (`QH`, `10S`, `AC`), not lowercase or numeric face ranks.

## Player → system commands

All go privately to the system. Only validated outcomes are published.

| Wire command | Payload | Required actor | Core mapping/status |
| --- | --- | --- | --- |
| SHUFFLE_DECK | `{}` | Dealer | Implemented `ShuffleDeck()` |
| CUT_DECK | `position` | Player after dealer | Implemented `CutDeck(position)` |
| SKIP_CUT | `{}` | Player after dealer | Implemented `SkipCut()` |
| START_DISTRIBUTION | `{}` | Dealer | Implemented `StartDistribution()` |
| ACCEPT_HAND | `{}` | Reviewing player | Implemented `AcceptHand()` |
| CLAIM_REDEAL | `{}` | Eligible reviewing player | Implemented `ClaimRedeal()` |
| PLACE_BID | `amount` | Current bidder | Implemented `PlaceBid(amount)` |
| PLAY_CARD | `card` | Current player | Implemented `PlayCard(Card.parse(card))` |

Cut position is 1–51; use SKIP_CUT for no cut. The operation rotates the deck,
moving its top `position` cards underneath the remaining cards. Bid schema
accepts 1–13; the engine enforces the selected game's maximum (10 or 13).
Player identifiers in outgoing schemas allow 1–5; the host must also
check membership in the actual four- or five-player roster.

`dispatch_player(state, request, match_id=..., player_id=...)` returns an
`AdapterResult(state, messages)` on success or the engine's `PlayRejection` on
rejection. Invalid schemas raise Pydantic `ValidationError`. The host commits the
returned state, then delivers messages using the trusted roster. Calls for one
match must be serialized by the host. Rejections do not advance state.

`dispatch_control(state, PrepareDeal() | CompleteShuffle(deck), match_id=...)`
is the trusted controller entry point. The host supplies shuffle randomness.
The old `dispatch_preparation` entry point remains limited to shuffle/cut/skip
for compatibility; use `dispatch_player` for full gameplay.

## System → all players: broadcasts

| Event | Payload fields |
| --- | --- |
| DEALER_ASSIGNED | `dealer_id` |
| DECK_SHUFFLED | `dealer_id` |
| CUT_COMPLETED | `cutter_id`, `skipped`, `position` (null if skipped) |
| DISTRIBUTION_STARTED | `dealer_id`, `first_recipient_id`, `cards_per_player` |
| CARD_DISTRIBUTED | `player_id`, `hand_count`, `distribution_index` |
| DISTRIBUTION_COMPLETED | `hand_counts`, `undealt_count` |
| HAND_ACCEPTED | `player_id` |
| REDEAL_REQUESTED | `player_id` |
| BIDDING_STARTED | `first_bidder_id`, `bidding_order` |
| BID_PLACED | `player_id`, `amount` |
| BIDDING_COMPLETED | `bids` |
| PLAY_STARTED | `leader_id`, `trick_number` |
| CARD_PLAYED | `player_id`, `card`, `trick_number` |
| TRICK_COMPLETED | `trick_number`, `winner_id`, `plays`, `tricks_won` |
| DEAL_COMPLETED | `bids`, `tricks_won`, `scores`, `totals` |
| MATCH_COMPLETED | `totals`, `winner_ids` |
| TURN_CHANGED | `phase`, `player_id` (null if no single actor) |

Player-indexed collections are explicit rows, not arrays with implicit IDs:
`bids` contains `{player_id, amount}`, `tricks_won` contains
`{player_id, tricks_won}`, and scores/totals contain `{player_id, score_tenths}`.
`plays` contains `{player_id, card}`; `hand_counts` contains `{player_id, hand_count}`.
The engine/mapper checks counts, ordering, totals and winners against actual
state. Contract validation is not a replacement for game validation.

CARD_DISTRIBUTED deliberately rejects a `card` field. REDEAL_REQUESTED rejects
private `reasons`. Deck order, hidden hands and unused card identities never
appear in these broadcast schemas.

## System → one player: unicasts

| Event | Recipient | Payload fields |
| --- | --- | --- |
| SHUFFLE_REQUESTED | Dealer | `dealer_id` |
| CUT_REQUESTED | Player after dealer | `player_id`, `deck_size` |
| DISTRIBUTION_REQUESTED | Dealer | `dealer_id` |
| CARD_DEALT | Card owner | `player_id`, `card`, `hand_count`, `distribution_index` |
| HAND_REVIEW_REQUESTED | Each player separately | `player_id`, `can_claim_redeal`, `reasons` |
| REDEAL_ELIGIBLE | Successful claimant | `player_id`, `reasons` |
| BID_REQUESTED | Current bidder | `player_id`, `minimum`, `maximum` |

Reasons are `WEAK_HAND` and/or `NO_SPADES`. Review eligibility is private. Public
TURN_CHANGED keeps everyone informed while the targeted request prompts the
actor. Simultaneous hand review uses player_id=null on the turn notification.

## Outbound envelope and routing

Every event contains `type=GAME_EVENT`, `protocol_version=1`, `match_id`,
`deal_number`, `attempt`, `revision`, `index`, `event` and `payload`.

```python
from app.adapters.callbreak import OutboundEvent, RoutedEvent

message = OutboundEvent(
    match_id="match-abc", deal_number=1, attempt=1, revision=8, index=0,
    event="CARD_DEALT",
    payload={"player_id": 2, "card": "QH", "hand_count": 1, "distribution_index": 1},
)
delivery = RoutedEvent(message=message, recipient_player_id=2)
wire_json = delivery.message.model_dump_json()
```

RoutedEvent is server-side metadata; serialize its `message` only. The event
catalog mandates broadcast or unicast. Broadcasts require recipient=None;
unicasts require a recipient matching the payload's player/dealer. Attempting
to broadcast CARD_DEALT or send player 2's card to player 3 rejects validation.
The host maps that local ID through the trusted match roster and delivers within
the room. The adapter itself performs no network I/O.

Output `index` is zero-based within one accepted transition's adapter event
batch; `revision` increases once per accepted state transition. These indexes
belong to adapter output, not necessarily the core event indexes: one domain
outcome may produce multiple wire notifications. A CARD_DEALT and its public
CARD_DISTRIBUTED share a revision, with distinct indexes. Distribution index is
one-based across assigned cards and resets with each attempt. Private messages
mean individual clients will not see every batch index.

CARD_DISTRIBUTED means card assignment succeeded, not that a network delivery
was acknowledged. Network receipt acknowledgments and retries are separate.

## Controller actions and non-event responses

`ControllerAction` defines internal PREPARE_DEAL, COMPLETE_SHUFFLE and
ADVANCE_DISTRIBUTION triggers. They are not parseable PlayerCommands. The trusted
host prepares shuffled decks. PREPARE_DEAL and COMPLETE_SHUFFLE are implemented;
ADVANCE_DISTRIBUTION is reserved and unsupported. Distribution currently assigns
all cards atomically and emits ordered private-card/public-receipt pairs.

`CommandRejected` is a private response to the requesting connection, containing
the command ID, current revision, code and safe detail. It is not a successful
game event, does not consume an event index, and does not change state. Malformed
requests whose IDs cannot be trusted can use the transport's existing parsing
error path; never echo whole malformed requests or credentials.

Implemented `GameQuery` is the read API. Authenticated query/snapshot wire requests,
pre-match seating/settings messages, transport acknowledgments and their response
schemas will be separate increments. Snapshot requests never advance state.

## Current flow and remaining plan

1. Host prepares each deal; adapter broadcasts dealer assignment and privately prompts shuffle.
2. Dealer requests shuffle; host supplies a shuffled deck; adapter prompts the cutter.
3. Cutter cuts or skips; adapter prompts the dealer to distribute.
4. Distribution emits each private CARD_DEALT followed by public CARD_DISTRIBUTED.
5. Private hand-review prompts allow accept/redeal. Bidding starts after all accept,
   or directly after distribution when review rules are disabled.
6. Bids broadcast in seat order, ending at the dealer; BID_REQUESTED targets each bidder.
7. Plays broadcast, followed by trick results, deal scores and final match results.
   The test host prepares the next deal and owns all timers and fallback choices.

Next: define production snapshot/reconnect handling, command acknowledgment and
idempotent retries, then durable match storage and production room-runtime integration.
The test HTTP wrapper currently generates command IDs and fills deal/attempt context
under its match lock after checking the client's match/revision. It returns HTTP
errors for rejections; a production transport should use the defined private
CommandRejected envelope. Do not treat current command IDs as retry guarantees.
