# Marriage commands, events, and platform adapter

The Marriage V1 protocol lives in `app/adapters/marriage/contracts.py`. Its
`COMMAND_SPECS` and `EVENT_SPECS` registries are the authoritative catalog of
payloads, engine methods, actor requirements, mutation status, and audience.
The [standalone engine API](marriage.md) continues to own every game rule.

`MarriageAdapter` validates and translates commands; `MarriageCommandTarget`
maps authenticated users to fixed engine seats and plugs into the existing
`CommandRuntime`. This reuses Call Break's shared locking, revision checks,
receipts, deduplication, rollback, and ordered room delivery. No engine import
depends on this adapter, Pydantic, HTTP, or the platform.

## Registering a room game

The trusted room/game-creation host calls this after determining a roster. It
must authorize membership and ownership before constructing the mapping.

```python
from random import Random
from app.adapters.marriage import MarriageAdapter, register_marriage
from app.runtime.game_registry import GameRegistry
from marriage import MarriageGameEngine

registry = GameRegistry()  # In the application, use its existing shared registry.
adapter = MarriageAdapter(
    MarriageGameEngine(("p1", "p2"), rng=Random(42)),
    match_id="unique-marriage-round-id",
    owner_player_id="p1",
)
target = register_marriage(
    registry, "room-id", adapter=adapter,
    seat_by_user={"authenticated-user-A": "p1", "authenticated-user-B": "p2"},
)
```

The helper binds the room's command session to the adapter's match ID. The roster
must map every seat exactly once. One adapter belongs to one registration; create
a fresh adapter and unique match ID for a new round. Set `target.active=False`
when the host ends/removes the game. Finished engine rounds still support reads;
normal engine mutations reject after finishing.

Registered rooms use the existing shared endpoints:

- `GET /games/{room_id}`: authenticated seated player's detached snapshot.
- `POST /games/{room_id}/action`: reliable action envelope below.

Transport room-membership checks remain in the shared route. Targets reject
spectators; a trusted host can use `adapter.snapshot()` for a public spectator
view and `adapter.snapshot(player_id)` for a seat-filtered view.

The playable lobby uses the existing `/test-games/{room_id}` host, alongside
Call Break. Create with `game_type: "marriage"` and `player_count: 2..5`, then use
its join, leave, start, action, and end endpoints. `HostedMarriageTarget` wraps
the adapter with room snapshots and the same reliable command runtime. Start
deals immediately; subsequent moves use the command catalog below. Private
hands, Maal, and query results are projected separately for each authenticated
user; spectators receive only the public view. The generic registration hook
above is an alternative integration, not a second registration for these games.
See [Marriage UI and room integration](marriage-ui.md) for controls and testing.
Room snapshots also retain a bounded `marriage.moves` list of the adapter's
existing public draw/discard events for synchronized card animation. This adds
no engine command or event type and never projects private stock cards.

## Envelopes and identity

Shared HTTP action example:

```json
{
  "match_id": "unique-marriage-round-id",
  "command_id": "draw-001",
  "expected_revision": 1,
  "command": "DRAW_CARD",
  "payload": {"source": "stock"}
}
```

`command_id` is required for reliable actions; the shared route restricts it to
letters, digits, underscores, and hyphens. A direct `PlayerCommand` also supports
`type="GAME_COMMAND"` and `protocol_version=1`; omit those two fields when using
the shared HTTP envelope. The version must be the integer 1. Unknown envelope or
payload fields, booleans used as revisions, and noncanonical card IDs are rejected.

Never supply `user_id`, `player_id`, `room_id`, or recipients as command identity.
The target resolves the actor from the authenticated user and fixed roster. Only
the mapped owner can issue `START_GAME`; current-turn checks stay in the engine.
The adapter revalidates command objects at dispatch, including mutated payloads.

All commands, including queries, require the current expected revision. Queries
do not increment it or consume randomness. Receipt replay with the same command
ID and exact request does not reapply or redeliver; a reused ID with different
request content is rejected by the shared runtime.

## Command catalog

`{}` means an empty payload; extra keys are forbidden.

| Command | Payload | Engine method / behavior |
| --- | --- | --- |
| `START_GAME` | `{}` | Owner only; `start_game()` atomically shuffles/deals. |
| `DRAW_CARD` | `{"source":"stock"}` or `{"source":"discard"}` | `draw_card(actor, source)` |
| `DISCARD_CARD` | `{"card_id":"D0:7H"}` | `discard_card(actor, card_id)` |
| `SHOW_INITIAL_MELDS` | `{"melds":[meld, meld, meld]}` | `show_initial_melds(actor, melds)` |
| `SHOW_DUBLEES` | `{"pairs":[seven meld objects]}` | `show_dublees(actor, pairs)` |
| `FINISH` | `{}` | `finish(actor)`; supported Dublee route only. |
| `VALIDATE_MELD` | `{"meld":meld}` | Pure `validate_meld(actor, meld)` preview. |
| `VALIDATE_INITIAL_MELDS` | Three `melds` | Pure full declaration preview. |
| `VALIDATE_DUBLEES` | Seven `pairs` | Pure full declaration preview. |
| `GET_STATE` | `{}` | **`get_player_view(actor)`**, never trusted `get_state()`. |
| `GET_ALLOWED_ACTIONS` | `{}` | `get_allowed_actions(actor)` |
| `GET_MAAL` | `{}` | Entitled Maal or null. |
| `CAN_SEE_MAAL` | `{}` | Entitlement boolean. |
| `READ_LAST_CARD` | `{}` | Visible top discard or null. |
| `HAS_EIGHTH_DUBLEE` | `{}` | Uncommitted eighth-pair boolean. |
| `CAN_FINISH_NORMAL_HAND` | `{}` | Capability `{supported:false, reason:...}`. |
| `GET_EVENTS` | `{"after_sequence":0}`; default 0 | This actor's safe engine-event history. |

A meld object is:

```json
{"meld_type":"tunnela","card_ids":["D0:7H","D1:7H","D2:7H"]}
```

Allowed types are `pure_sequence`, `tunnela`, and `dublee`. IDs must be distinct
canonical physical cards. Payload validation checks structure and bounds; the
engine checks ownership, rank/suit rules, declaration counts/types, commitment,
turn/phase, and Maal entitlement. No client command independently shuffles an
active round, assigns Tiplu, changes routes, or declares an arbitrary winner.

## Event catalog and audience

Every outbound message contains `type="GAME_EVENT"`, `protocol_version=1`,
`game_type="marriage"`, `match_id`, `revision`, `index`, `event`, and `payload`.
`index` is zero-based within the returned batch. Domain events additionally retain
the engine's global `sequence` inside `payload.event`; use that for `GET_EVENTS`.

| Event | Audience | Payload |
| --- | --- | --- |
| `GAME_STARTED` | Broadcast | `{event: VisibleEvent}` with seats and cards per player. |
| `TURN_CHANGED` | Broadcast | Safe event with current seat and phase. |
| `DISCARD_PILE_RECYCLED` | Broadcast | Safe event with recycled count, no order/cards. |
| `CARD_DRAWN` | Broadcast | Safe event with actor/source; stock `card=null`, visible discard pickups retain the card. |
| `CARD_DISCARDED` | Broadcast | Safe event with actor and public discarded card. |
| `MELDS_SHOWN` | Broadcast | Safe event with actor, route, meld types, public card groups. |
| `SEVEN_DUBLEES_SHOWN` | Broadcast | Same shape for Dublee qualification. |
| `TIPLU_REVEALED` | Broadcast | Creation notification with **`card=null`**. |
| `PLAYER_SAW_MAAL` | Broadcast | Permission notification for the qualifying actor; no Maal faces. |
| `PLAYER_FINISHED` | Broadcast | Winner and public winning pair. |
| `PLAYER_STATE` | Unicast | `{player_id, view: PlayerView}` for that exact seat. |
| `QUERY_RESULT` | Unicast | `{player_id, command_id, command, result}` for the requester. |

Accepted mutations emit public domain events in engine order, followed by one
`PLAYER_STATE` per seat in roster order. These private updates carry current hands,
action options, and entitled Maal. Thus a stock draw is public as an occurrence
but its identity is delivered only in the drawing player's state. All recipients
also receive updated public hand counts/turn information in their own views.

Queries emit only the correlated `QUERY_RESULT`; their result schemas match the
documented engine API. Validation failures produce a rejection, not a successful
query result. `GET_EVENTS` returns safe `VisibleEvent` records, not raw internal
history or prior adapter `PLAYER_STATE` messages.

`RoutedEvent.recipient_player_id` is a **server-only routing instruction**. Serialize
only `.message`. The host maps seats to authenticated users and uses the shared
runtime's room-scoped unicast. Schemas reject broadcasting private events, mismatched
recipients, hidden stock/Tiplu cards in public events, and extra payload fields.

## Adapter and target API

| API | Contract |
| --- | --- |
| `MarriageAdapter(engine, *, match_id, owner_player_id)` | Takes an independent copy of the configured engine and owns it exclusively. |
| `dispatch_player(request, *, player_id)` | Trusted local actor; returns `AdapterResult` or `CommandRejected`. Caller must serialize direct use. |
| `snapshot(player_id=None)` | Detached JSON-compatible player view, or public view if None. |
| `revision`, `seat_ids` | Current revision and immutable configured seat order. |
| `checkpoint()` / `restore(checkpoint)` | Trusted transaction hooks only; not client restoration APIs. |
| `MarriageCommandTarget(adapter, *, seat_by_user)` | Implements the shared `CommandTarget` protocol. |
| `register_marriage(registry, room_id, *, adapter, seat_by_user)` | Registers a room with the existing registry/runtime and aligns match IDs. |

Mutation dispatch runs on an isolated candidate engine. All public/private messages
and schemas are validated before the candidate replaces the committed engine. A
projection failure preserves cards, history, revision, and RNG. Shared runtime
checkpoints additionally roll back failures before receipt commit/delivery. Delivery
failure after commit follows the existing receipt/retry behavior; it never causes
the game move to run twice.

Standalone dispatch returns `CommandRejected` with match, command ID, current
revision, code, and safe detail. The target maps it to `GameCommandRejected`; the
existing reliable HTTP response returns a refreshed private snapshot and rejected
`action_ack`. Shared acknowledgments currently contain status/revision/detail, not
the adapter's domain rejection code. Infrastructure invariant failures propagate
for rollback instead of masquerading as normal game rejections.

The legacy broadcast-only `handle_command` route is explicitly rejected with
`RELIABLE_COMMAND_REQUIRED`; it cannot safely carry private Marriage hands.

## Verification

```text
python -m pytest tests/test_marriage_adapter.py tests/marriage -q
python -m pytest -q
```

Tests cover strict contracts, roster/owner authorization, stale/mismatched requests,
payload tampering, private hand/Maal delivery, safe history queries, normal and Dublee
declarations, full adapter-driven completion, failed projection rollback, shared
runtime receipt replay, and rollback before delivery. Engine independence tests
continue to forbid platform imports from `marriage` and `card_utils`.
