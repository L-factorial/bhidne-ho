# Standalone Marriage GameEngine API

The supplied Marriage V1 contract is implemented through increments 1-9. It supports
a complete **Dublee-route round**, normal qualification through sequences/Tunnelas,
and entitled Maal visibility. Configurable final-round scoring is now implemented;
see [scoring rules and API](marriage-scoring.md). Normal final-hand completion and
wildcards remain outside this contract. Points are not monetary transactions.

`MarriageGameEngine` is the single application entry point. Callers use immutable
values such as `Meld`, `DrawSource`, and `MarriageRules`, but never need to manipulate
piles or call rule modules directly. The [implementation plan](marriage-engine-plan.md)
records the supplied rules and proposed house-rule decisions.

The [Marriage platform adapter](marriage-adapter.md) now translates versioned commands
and events and plugs into the shared reliable-command runtime. It remains outside
this standalone package; lobby/UI integration is separate.

## Quick start

```python
from random import Random
from marriage import DrawSource, MarriageGameEngine

game = MarriageGameEngine(("p1", "p2", "p3", "p4"), rng=Random(42))
game.start_game()                         # Shuffle and deal 21 cards each.
assert game.get_public_view().stock_count == 75
game.draw_card("p1", DrawSource.STOCK)     # Take one card; now 22 owned cards.
view = game.get_player_view("p1")
game.discard_card("p1", view.actions.discardable_card_ids[0])
assert game.get_public_view().current_player_id == "p2"
assert game.read_last_card() is not None
```

Run a complete deterministic round with `python -m examples.marriage_round`.
The [example](../examples/marriage_round.py) uses only public methods to choose cards,
show seven Dublees, and finish with an eighth pair. Its choices and turn limit are
example behavior, not engine rules. It never injects hands or modifies private state.

## Construction and lifecycle

```text
MarriageGameEngine(player_ids, *, rules=None, rng=None, first_player_id=None)
```

- `player_ids`: two through five unique nonblank engine-local strings. Caller order
  defines the fixed turn and dealing order. IDs are not platform accounts.
- `rules`: optional immutable `MarriageRules`; deck variations are not supported.
- `rng`: optional `random.Random`. Its state is copied without advancing the caller's
  generator. Later caller RNG use cannot change the engine. Omission creates an
  engine-owned random stream.
- `first_player_id`: an existing seat, defaulting to the first supplied ID. This
  changes the first turn, not dealing order.

One engine instance owns one round. The caller serializes access; the engine does
not supply thread safety, retries, join/leave, resets, matches, timers, or networking.

```text
WAITING --start_game--> IN_PROGRESS / MUST_DRAW
MUST_DRAW --draw_card--> MUST_DISCARD
MUST_DISCARD --show_initial_melds or show_dublees--> MUST_DISCARD
MUST_DISCARD --discard_card--> next seat / MUST_DRAW
MUST_DISCARD --finish--> FINISHED
```

Only startup is a controller action; other mutations require the current player.
Finished rounds reject every mutation while read methods remain available.

## Mutation methods

Every accepted mutation returns immutable `ActionResult(revision, events)`.
Revisions advance once per accepted call; its events share that revision. Raw
results are trusted domain information, **not broadcast payloads**.

| Method | Preconditions and effect |
| --- | --- |
| `start_game() -> ActionResult` | WAITING only. Shuffle once, deal 21 cards per seat, set the first turn. Repeated startup is rejected. |
| `draw_card(player_id, source: DrawSource) -> ActionResult` | Current player in MUST_DRAW. Take the top stock/permitted discard card, refilling stock if needed; enter MUST_DISCARD. Use enum values, not transport strings. |
| `discard_card(player_id, card_id: str) -> ActionResult` | Current player in MUST_DISCARD. Throw an owned, uncommitted physical card; advance exactly one seat with wraparound. |
| `show_initial_melds(player_id, melds: Sequence[Meld]) -> ActionResult` | Current unqualified player in MUST_DISCARD. Validate exactly three disjoint pure sequences and/or Tunnelas, commit their IDs, enter the normal route, and atomically grant Maal access. Leave an uncommitted card to discard. |
| `show_dublees(player_id, pairs: Sequence[Meld]) -> ActionResult` | Current unqualified player in MUST_DISCARD. Validate exactly seven disjoint natural pairs, commit fourteen IDs, enter the Dublee route, and atomically grant Maal access. Does not finish the round. |
| `finish(player_id) -> ActionResult` | Current player in MUST_DISCARD. Require seven committed Dublees and a separate eighth pair. Record the deterministic winning pair and exactly one winner. Normal-route finishing raises `UnsupportedRuleError`. |

Shuffle and deal are one atomic `start_game()` operation. There is no separate
shuffle/cut/deal method that can reorder an active round. A player-controlled
preparation phase would require another lifecycle contract.

No repeated qualification or route switching is allowed. Shown cards remain in the
hand and are referenced by committed IDs, not moved to another ownership pile. They
cannot be discarded, reused by a declaration, or counted toward the eighth pair.

## Validation and capability methods

These methods never change state, events, permissions, revision, or randomness.
Validation resolves IDs through the canonical deck and checks physical ownership.
Client-provided face descriptions are not accepted as proof.

| Method | Return and meaning |
| --- | --- |
| `validate_meld(player_id, meld: Meld) -> Meld` | Return the immutable meld if naturally valid and owned/uncommitted; otherwise raise `InvalidMeldError`. |
| `validate_initial_melds(player_id, melds) -> tuple[Meld, ...]` | Preview the three-meld normal declaration, including disjointness and room to discard. |
| `validate_dublees(player_id, pairs) -> tuple[Meld, ...]` | Preview exactly seven valid, disjoint natural pairs. |
| `has_eighth_dublee(player_id) -> bool` | A Dublee-qualified seat has a pair among uncommitted cards. Does not imply it is their turn or that they have drawn. |
| `can_finish_normal_hand(player_id) -> Capability` | Returns `supported=False` and a reason. Inspect `.supported` and `.reason`; this is an unsupported capability, not a normal-hand winning verdict. |
| `can_see_maal(player_id) -> bool` | Qualification-based entitlement without revealing Maal. |
| `get_allowed_actions(player_id) -> AllowedActions` | Legal moves, declaration submission windows, draw sources, discardable IDs, and blocking reasons. |

Previews do not check turn/phase, reserve cards, or create Tiplu. They do not guarantee
a later submission succeeds: mutating `show_*` methods revalidate the current state.

Construct declarations with IDs from the player's hand:

```python
from marriage import Meld, MeldType

sequence = Meld(MeldType.PURE_SEQUENCE, ("D0:AC", "D0:2C", "D1:3C"))
tunnela = Meld(MeldType.TUNNELA, ("D0:7H", "D1:7H", "D2:7H"))
dublee = Meld(MeldType.DUBLEE, ("D0:9S", "D2:9S"))
# game.validate_meld(player_id, sequence)  # Requires actual ownership.
# game.show_initial_melds(player_id, (sequence, tunnela, another_meld))
# game.show_dublees(player_id, seven_pairs)
```

`AllowedActions` fields:

- `kinds`: `DRAW`, `DISCARD`, `SHOW_INITIAL_MELDS`, `SHOW_DUBLEES`, and/or `FINISH`.
  Show kinds are submission windows, not a claim that a valid partition exists.
- `drawable_sources`: permitted nonempty/refillable `DrawSource` values.
- `discardable_card_ids`: only this seat's owned, uncommitted IDs when discarding is
  legal; empty for another seat's turn.
- `blocked_sources`: immutable source/reason records during the draw phase.
- `reason`: overall block or forced-finish explanation when applicable.
- `normal_finish_unavailable_reason`: explicit unsupported-route notice.

A restricted winning discard exposes only `FINISH`. Finished rounds expose no
mutation kinds. Unknown IDs raise `InvalidActionError` rather than giving a spectator view.

## Read methods and privacy

| Method | Return and visibility |
| --- | --- |
| `get_public_view() -> PublicGameView` | Seats, hand counts, shown melds, qualification/finish flags, turn, phase, stock count, top discard, winner, status, revision. No hidden hands, stock order, Tiplu, or raw history. |
| `get_player_view(player_id) -> PlayerView` | Fields `public`, `player_id`, `hand`, `actions`, `maal`. Adds only this seat's hand and entitled Maal. |
| `read_last_card() -> PhysicalCard \| None` | Current visible discard top, not the latest stock draw. None when the pile is empty. |
| `get_maal(player_id) -> MaalView \| None` | Entitled Tiplu/Jhiplu/Poplu natural faces; None for an unqualified seat. |
| `get_public_events(after_sequence=0) -> tuple[VisibleEvent, ...]` | Spectator-safe events strictly newer than the cursor. Stock draws and Tiplu identities are redacted. |
| `get_player_events(player_id, after_sequence=0) -> tuple[VisibleEvent, ...]` | Also reveals this seat's own stock draws and Tiplu if currently entitled. Opponents' hidden stock draws stay redacted. |
| `get_state() -> MarriageGameState` | Trusted diagnostics only: every hand, pile order, indicator, winning pair, revision, raw history. Never send this to players. |

`MaalView` contains `tiplu`, `jhiplu`, and `poplu` as immutable `CardIdentity` values.
Reading Maal does not change the turn or emit repeated events. Unknown seats are rejected.

Event projection is allowlisted. Shown melds, discarded cards, discard pickups, and
winning pairs are public. Tiplu is visible only to qualified seats, including a later
qualifier reading older events. Cursors must be nonnegative integers; beyond the end
returns an empty tuple. Hidden fields are redacted rather than dropping events.

Snapshots, cards, views, actions, events, and nested collections returned by the engine
are immutable. Older snapshots remain unchanged. Private `_state` and helper modules
are not restoration or mutation APIs.

## Implemented V1 rules

These named defaults follow the supplied contract and proposed resolutions in the
plan; they are not claims about every table's Marriage rules.

| Area | Implemented rule |
| --- | --- |
| Deck | Three standard packs plus three Man cards: 159 distinct physical cards. |
| Deal | 21 round-robin passes in configured order. Empty initial discard; last pile element is the top. |
| Remaining stock | 117 / 96 / 75 / 54 for 2 / 3 / 4 / 5 players. |
| Identity | `D0:7H`, `D1:7H`, `D2:7H` differ physically but share a face. `MAN:0..2` have no rank/suit. |
| Sequence | At least three consecutive distinct natural ranks in one suit, any submitted order. Ace low: A-2-3 valid; Q-K-A and K-A-2 invalid. |
| Tunnela / Dublee | Exactly three / two distinct physical copies of one standard face. |
| Man / natural Maal | Man never substitutes. Standard Maal cards can form natural melds at their printed face; no wildcard or point calculation. |
| Tiplu | One standard card removed from stock at first qualification. Scan from top, skipping Man without removing/reordering them. Later qualifiers reuse it. |
| Maal neighbors | Cyclic: below Ace is King, above King is Ace. Separate from sequence ordering; shared `Rank.ACE` remains 14. |
| Qualification | Exactly three sequences/Tunnelas OR seven Dublees; mutually exclusive routes. |
| Winning pair | Separate from all fourteen committed cards. A third copy of a committed face is only a singleton. Witness chosen by canonical ID order. |
| Finish | Explicit after drawing. Already-held eighth pair may finish immediately after qualification. Preserve 22 owned cards: sixteen paired cards plus six leftovers. |

`MarriageRules` supports `ace_sequence=LOW_ONLY`, `maal_neighbors=CYCLIC`, and:

| `dublee_player_can_draw_discard` | `dublee_player_can_take_winning_discard` | Qualified Dublee pickup |
| --- | --- | --- |
| False | False | Prohibited. |
| False | True (default) | Picked card must complete an uncommitted eighth pair; finish next. |
| True | Either | Any visible discard; ordinary discard-or-finish choice remains. |

The exception does not permit pickup just because an unrelated eighth pair was
already held. Normal and unqualified players may draw a visible discard.

## Recycling and invariants

An empty-stock draw preserves the visible top discard, shuffles only older discards,
and draws one card in the same transaction. Tiplu is never recycled. Tiplu selection
can also refill an empty/all-Man stock; existing Man cards remain above the refill
block in their original order. Only the selected standard card is removed.

If no standard card is available, the entire declaration fails: no commitments,
entitlement, events, revision, or RNG advancement remain. Empty stock with fewer
than two discards blocks stock drawing; another permitted source remains usable.
No stalemate winner is invented. Such exhausted pile shapes are defensive boundaries,
not naturally reachable with the conserved deck and fixed full hands.

The engine stages each action, audits the candidate, then replaces state and RNG.
Rejections change nothing. No global random stream, time, UUID, or unordered iteration
determines cards. Same initial configuration/RNG and actions produce identical state
and events on the supported Python runtime. Durable/cross-runtime replay is not promised.

`validate_card_conservation(state)` audits:

```text
all player hands + stock + discard + optional Tiplu = exactly the canonical 159 cards
```

Shown melds/events are references, not ownership. `validate_game_state()` also checks
seat/phase bounds, 21/22-card counts, qualified meld semantics, commitment ownership,
Maal permissions, indicator stability, revision/event order, and terminal winner/pair
consistency. WAITING is separate because its deck has not been allocated.

## Events and errors

| Action | Ordered domain events |
| --- | --- |
| Start | `GAME_STARTED`, `TURN_CHANGED` |
| Draw | Optional `DISCARD_PILE_RECYCLED`, then `CARD_DRAWN` |
| Discard | `CARD_DISCARDED`, `TURN_CHANGED` |
| First qualification | Optional recycle, then `MELDS_SHOWN` or `SEVEN_DUBLEES_SHOWN`, `TIPLU_REVEALED`, `PLAYER_SAW_MAAL` |
| Later qualification | `MELDS_SHOWN` or `SEVEN_DUBLEES_SHOWN`, `PLAYER_SAW_MAAL` |
| Finish | `PLAYER_FINISHED` |

Each event has `sequence` and `revision`. `TIPLU_REVEALED` records indicator creation,
not permission to broadcast its card. Use safe event methods for external consumers.

| Exception / stable `.code` | Meaning |
| --- | --- |
| `InvalidActionError` / `INVALID_ACTION` | Unknown seat, wrong phase/status, repeated start/qualification, bad source, unowned/committed discard. |
| `InvalidTurnError` / `INVALID_TURN` | Wrong seat attempted a current-player mutation. |
| `InvalidMeldError` / `INVALID_MELD` | Invalid natural meld, ownership, overlap, or declaration count. |
| `NoDrawableCardError` / `NO_DRAWABLE_CARD` | Requested pile cannot provide a card. |
| `TipluUnavailableError` / `TIPLU_UNAVAILABLE` | No eligible indicator; declaration rolls back. |
| `UnsupportedRuleError` / `UNSUPPORTED_RULE` | Normal-route finish is outside the rule contract. |
| `CardConservationError` / `CARD_CONSERVATION` | Internal invariant failure, not an ordinary player rejection. |

Value constructors reject malformed IDs, enums, seats, or unsupported configuration
with `ValueError` or `TypeError`. Exceptions have no HTTP/transport semantics.

## Tests, packaging, and deferred work

Dependency direction: `marriage -> card_utils -> Python standard library`. No platform,
Call Break, FastAPI, Pydantic, networking, persistence, or UI imports are needed. The
repository distribution still declares platform dependencies; this is not a separately
published engine distribution.

```text
python -m pytest tests/marriage -q
python -m pytest -q
python -m examples.marriage_round
python -m pip wheel . --no-deps --wheel-dir dist
python -I -S scripts/verify_marriage_wheel.py dist/bhidne_ho-0.1.0-py3-none-any.whl
```

The verifier plays the complete example with Marriage/card utilities loaded from the
wheel, site packages disabled, and no repository imports. Tests cover 2-5 seats,
seeded turns/refills, invalid actions and rollback, natural meld boundaries,
qualification, Maal privacy, winning-discard policies, terminal rejection, immutability,
and repeated complete public-API rounds.

Remaining work requires separate contracts: normal final-hand partitions, wildcards,
monetary settlement, matches, alternate gameplay rules, and stalemate resolution.
Final-round Maal scoring is available through `get_scores()`; see [scoring](marriage-scoring.md).
The platform adapter supplies wire commands and shared runtime serialization;
[lobby/UI integration](marriage-ui.md) now provides a playable first version.
Persistence remains separate. Integrations call this API rather than duplicate
Marriage rules.
