# Call Break adapter contract — increment 1

Status: payload schemas, command/event catalogs, strict request parsing and
outbound audience validation are implemented in
[`app/adapters/callbreak/contracts.py`](../app/adapters/callbreak/contracts.py).
Preparation dispatch and dealer/shuffle/cut phases are now implemented; see
[the preparation guide](callbreak-preparation.md). Roster lookup, network delivery
and production incremental distribution are not yet implemented. A separate
[test-console host](test-callbreak-console.md) now handles full gameplay, private delivery
and automatic actions using test-only HTTP/WebSocket messages. Chat/PING still run Echo.

## Ownership

```text
Browser request (adapter-owned uppercase command name)
  → authenticate user and resolve room/match/player [future platform integration]
  → parse_player_command(raw_request)              [implemented]
  → validate match/revision/actor and map command   [future adapter dispatch]
  → standalone engine typed command
  → domain state + outcomes
  → adapter creates OutboundEvent + RoutedEvent    [schemas implemented]
  → platform broadcasts/unicasts within room       [future delivery]
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
actions after a move or redeal. These checks require match state and are future
dispatch work; this increment validates their shape only.

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
| START_DISTRIBUTION | `{}` | Dealer | Core StartDistribution; dispatched by test host, not preparation-only adapter |
| ACCEPT_HAND | `{}` | Reviewing player | Existing `AcceptHand()` |
| CLAIM_REDEAL | `{}` | Eligible reviewing player | Existing `ClaimRedeal()` |
| PLACE_BID | `amount` | Current bidder | Existing `PlaceBid(amount)` |
| PLAY_CARD | `card` | Current player | Existing `PlayCard(Card.parse(card))` |

Cut position is 1–51; use SKIP_CUT for no cut. The operation rotates the deck,
moving its top `position` cards underneath the remaining cards. Bid schema
accepts 1–13; the engine enforces the selected game's maximum (10 or 13).
Player identifiers in outgoing schemas allow 1–5; the future mapper must also
check membership in the actual four- or five-player roster.

Merely parsing a pending command does not make it executable. Future dispatch
must reject unsupported commands explicitly until their phases are implemented;
it must not silently map START_DISTRIBUTION to the existing whole-deck StartDeal.

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
The future dispatcher must map that local ID through the trusted match roster
and deliver within the room, not across all rooms belonging to the user.

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
host prepares shuffled decks and advances distribution. Exact typed controller
inputs and engine mappings will be defined with those implementation increments.

`CommandRejected` is a private response to the requesting connection, containing
the command ID, current revision, code and safe detail. It is not a successful
game event, does not consume an event index, and does not change state. Malformed
requests whose IDs cannot be trusted can use the transport's existing parsing
error path; never echo whole malformed requests or credentials.

Existing `GameQuery` is the read API. Authenticated query/snapshot wire requests,
pre-match seating/settings messages, transport acknowledgments and their response
schemas will be separate increments. Snapshot requests never advance state.

## Next increments

1. Dealer/shuffle/cut phases and their domain/controller commands are implemented.
2. Implement one-card distribution and its private/public outcomes.
3. Implement adapter dispatch and outcome mapping with explicit unsupported-command errors.
4. Add authenticated roster lookup, stale-command checks, deduplication and room-scoped private delivery.

The preparation adapter activates only the first increment through explicit calls. Existing core
whole-hand events remain unchanged until incremental distribution replaces them.
Tests cover all eight command variants, all 24 event variants, malformed/spoofed
input, private recipient matching, and rejection of private fields in broadcasts.
