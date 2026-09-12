# Standalone Marriage engine implementation plan

Status: Increments 1-9 are implemented for the supplied V1 contract: complete
Dublee-route rounds, normal qualification, Maal entitlement, safe queries/events,
and a verified standalone wheel example. See the [implemented API guide](marriage.md).
Normal final-hand completion, scoring, adapters, platform commands, and UI remain
outside this contract. This plan translates the supplied 32-section
proposal into incremental, testable work. It does not claim to define universal
Nepali Marriage rules; the supplied rules form the product contract.

## 1. Scope and dependency boundary

Build one deterministic Python Marriage round for 2–5 fixed players, with four
as the example/default table size. Deal 21 cards per player from three standard
52-card packs and three printed Man cards: 159 physical cards.

V1 owns card identity, dealing, turns, stock/discard movement, pure melds,
qualification to see Maal, one round-level Tiplu, committed melds, recycling,
eight-Dublee completion, safe queries, and domain events. Normal qualification
is supported, but normal-hand completion is explicitly unsupported until its
full rules are specified. Thus V1 is a playable Dublee-route engine foundation,
not a complete implementation of every Marriage winning route.

Dependency direction:

```text
future platform adapter -> marriage -> card_utils -> Python standard library
```

`marriage` must not import `app`, Call Break, FastAPI, Pydantic, asyncio, sockets,
authentication, storage, Redis, UI code, or platform command envelopes. Player IDs
are engine-local strings, not accounts or room members. No room chat, presence,
deadlines, bots, reconnect handling, command receipts, or money settlement.

Typed domain actions are allowed inside the engine; they are not a multiplayer
wire protocol. Later adapters translate platform requests to these operations
and translate safe domain results back to platform messages.

## 2. Rules to freeze before implementation

The requirements below distinguish the supplied specification from proposed
resolutions of ambiguities. Proposed defaults are not yet confirmed house rules.
Keep them in named, immutable policies rather than distributed conditionals.

| Topic | V1 decision | Basis |
| --- | --- | --- |
| Deck | Exactly three packs plus three Man cards; reject other deck sizes in V1 | Supplied specification |
| Seats | 2–5 unique, nonempty IDs; caller order defines turn order | Count specified; ordering proposed |
| First player | Configurable seat, default first supplied ID; deterministic, not randomly chosen | Proposed default |
| Deal | One card per seat in order, repeated 21 times; empty initial discard pile | Round-robin proposed; counts/discard specified |
| Stack convention | Both stock and discard use the last element as the top | Discard convention supplied; stock convention proposed |
| Declaration window | Current player only, after drawing, before discarding | Supplied action-order examples |
| Qualification | Exactly three disjoint pure sequences and/or Tunnelas, or exactly seven disjoint Dublees | Supplied specification |
| Routes | Unqualified -> normal OR Dublee; no route switching or repeated qualification | Proposed default |
| Pure sequence | Length >=3, one suit, distinct consecutive face ranks, no substitution | Supplied specification |
| Ace in sequences | Ace low only: A-2-3 valid; Q-K-A and K-A-2 invalid | Proposed default; isolate in `AceSequencePolicy` |
| Maal neighbors | Cyclic A,2,...,Q,K: below A is K, above K is A | Proposed default; separate from sequence policy |
| Natural Maal faces | A standard Maal face can still be used at its natural rank in a pure sequence/pair/triple; never substitutes in V1 | Proposed default |
| Man in melds | Never a pure sequence or Tunnela; also not a Dublee in V1 | First two specified; Dublee exclusion proposed |
| Tiplu | First standard card scanning stock from its top; remove only that physical card | Supplied specification with skipped-Man handling clarified below |
| Dublee discard pickup | Default prohibited, except an immediately winning eighth pair; two separate policy booleans | Supplied specification |
| Finish | Explicit `finish`, not automatic on draw; current player in MUST_DISCARD | Proposed resolution of optional automatic-finish wording |
| Already-held eighth pair | May finish immediately after declaring seven pairs if a separate eighth pair already exists | Proposed default; no artificial additional-turn requirement |
| Remainder on Dublee win | Seven committed pairs + eighth pair suffice; other owned cards need no final meld or discard | Proposed interpretation of supplied winning condition |
| No recyclable stock | Reject the attempted operation atomically; do not invent a winner or silently take the top discard | Proposed default |

The eight-pair remainder rule is significant: after drawing, a player owns 22
cards; 16 form the eight pairs and six remain. Confirm this interpretation before
calling V1 compatible with a particular table's house rules. A third physical
copy of a face is a singleton, not another pair after its other two copies have
been committed.

For the exceptional winning-discard rule, a successful pickup is followed by
`finish`. In the restrictive default profile, mark `must_finish` so the player
cannot take a winning discard and then discard something else. If unrestricted
Dublee discard pickup is enabled, normal discard-or-finish choice remains.

Expose supported policy values only. Do not publish switches for arbitrary
wildcards, joker Tiplu, deck counts, or normal finishing rules that do not work.
Defer scoring, dirty sequences, alter cards, Marriage combinations, and wildcard
use to a separately specified rules increment.

## 3. Card model and reuse of existing utilities

Reuse `card_utils.Suit` and `card_utils.Rank`, but introduce
`marriage.PhysicalCard`. Existing `card_utils.Card` identifies a face, not a
physical copy, so it cannot identify all three identical cards in a Tunnela.
Do not change its equality or break Call Break's 52-card assumptions.

`PhysicalCard` is frozen and contains `card_id`, `card_type`, optional `rank`,
optional `suit`, and optional `deck_index`. Use deterministic IDs such as
`D0:7H`, `D1:7H`, `D2:7H`, and `MAN:0` through `MAN:2`. Standard cards require a
valid face and pack index 0–2; Man cards have no rank/suit. Constructors and deck
audit reject inconsistent IDs, faces, or copy metadata.

Use `(suit, rank)` as `CardIdentity` for natural-face comparison. Equality of
faces never proves distinct physical ownership. Man identity is a separate case,
not `(None, None)` treated as a valid natural pair.

Existing `Rank.ACE` is 14. Do not redefine the shared enum to ACE=1. A Marriage
rank-policy utility maps Ace to low-sequence position and separately maps Maal
neighbors. This avoids changing Call Break ranking.

The generic `card_utils.shuffle` can shuffle physical-card sequences. Its other
pile operations use index zero as the top; do not blindly combine them with
Marriage's last-element convention. Implement explicit Marriage draw/deal
helpers and test the exact stock orientation and dealt order.

## 4. State, ownership, and atomic transitions

Use frozen dataclasses, tuples, and frozensets for published state. The engine
facade holds the current immutable state and atomically replaces it after an
accepted action. Callers cannot mutate a hand or pile through a returned object.
There is no mutable public `engine.state` reference.

Core values:

- `MarriageRules`: frozen named ruleset/version and supported policies.
- `PlayerState`: player ID, full owned hand, qualification route, immutable shown
  melds, `committed_card_ids`, `has_seen_maal`, and finish status.
- `Meld`: meld kind and tuple of physical card IDs, resolved through the engine's
  canonical deck rather than caller-supplied rank/suit descriptions.
- `MarriageGameState`: rules, players, stock, discard, current seat, turn phase,
  optional Tiplu, optional forced-finish flag, status, winner, revision, history.
- `ActionResult`: resulting revision and immutable events from the accepted action.

Shown cards **remain in the owning hand**. Melds and committed IDs are references,
not second storage locations. Committed cards cannot be discarded, reused by
another declaration, or counted toward the eighth pair. Normal declarations
must leave an uncommitted card available to discard; reject a declaration that
would commit the entire hand while normal finishing remains unsupported.

Derive `initial_melds_shown` and `dublee_mode` from qualification route when
possible; if retained as compatibility properties, expose read-only properties
rather than multiple independently mutable flags.

For each action:

1. Validate status, actor, turn phase, route, ownership, and input structure.
2. Stage the new state and any randomness on private working values.
3. Validate resulting invariants and construct immutable events.
4. Commit state, RNG state, event history, and revision together.

A rejected action changes **nothing**: no removed card, Tiplu, committed meld,
permission flag, turn, revision, event sequence, or RNG advancement. This is
especially important when qualification validates but Tiplu cannot be selected.

Accept `random.Random(seed)` for deterministic use. Clone its initial state into
engine-owned randomness so later caller RNG use cannot alter the game. Capture
and restore RNG state around staged operations. Never use global random state,
UUIDs, wall-clock time, process-specific hash ordering, or unordered set iteration
to choose cards. Same initial config/RNG state + same actions produces the same
state and ordered events within the supported runtime/rules version. Cross-version
serialized replay is not promised in V1.

## 5. State machine and public API

```text
WAITING --start_game--> IN_PROGRESS / MUST_DRAW
MUST_DRAW --draw stock or permitted discard--> MUST_DISCARD
MUST_DISCARD --show initial melds or seven Dublees--> MUST_DISCARD
MUST_DISCARD --discard uncommitted card--> next seat / MUST_DRAW
MUST_DISCARD --validated finish--> FINISHED
```

Only startup is a controller action without a current player. All other mutations
require the current engine-local player. No player joins or leaves this standalone
round after creation; future waiting-room seat changes belong outside the engine.

| Method | Contract |
| --- | --- |
| `MarriageGameEngine(player_ids, *, rules, rng, first_player_id=None)` | Validate/freeze seats and policies; initialize WAITING state |
| `start_game()` | Create canonical deck, shuffle, deal, publish first turn; reject a second start |
| `draw_card(player_id, source)` | Current player in MUST_DRAW; draw exactly one card; recycle if needed |
| `discard_card(player_id, card_id)` | MUST_DISCARD; owned/uncommitted card only; advance exactly one seat |
| `show_initial_melds(player_id, melds)` | Exactly three valid disjoint qualifying melds; atomic Tiplu creation and permission grant |
| `show_dublees(player_id, pairs)` | Exactly seven natural disjoint pairs; commit route, create/reuse Tiplu, grant permission |
| `has_eighth_dublee(player_id)` | Pure query over uncommitted owned cards; seven committed pairs are excluded |
| `can_finish_normal_hand(player_id)` | Explicit unsupported-capability result in V1, never a fabricated valid/invalid verdict |
| `finish(player_id)` | Validate supported route; record eighth pair and terminal winner; no automatic discard |
| `get_allowed_actions(player_id)` | Legal action kinds, drawable sources, discardable IDs, and reason normal finish is unavailable |
| `get_state()` | Trusted immutable full diagnostic state, not a public-player response |
| `get_public_view()` / `get_player_view(player_id)` | Safe immutable projections, with Maal visibility enforced |

`select_tiplu`, `ensure_tiplu_exists`, and `recycle_discard_pile` are internal
transition helpers, not independently callable public mutations that bypass the
turn machine. Queries have no side effects and consume no randomness.

`get_allowed_actions` must agree with command validation. For parameterized meld
declarations, distinguish an available submission window from a guarantee that
arbitrary meld IDs will validate. Do not enumerate every possible meld partition
just to build a query response. A blocked stock draw should expose its reason;
other genuinely legal actions remain available.

Use domain exceptions with stable codes, e.g. `InvalidTurnError`,
`InvalidActionError`, `InvalidMeldError`, `NoDrawableCardError`,
`TipluUnavailableError`, and `UnsupportedRuleError`. Internal conservation failures
are invariant errors, not ordinary player rejections. No HTTP codes in the core.

## 6. Tiplu, permissions, and stock recycling

The first successful qualification creates **one** round-level indicator. Later
qualifications reuse it. Setting `has_seen_maal` never copies Tiplu into a player's
ownership. Selection does not advance the turn or require an extra player action.

Scan stock from the top for the first standard card and remove only that card.
Skipped Man cards stay drawable in their existing relative order; they are not
discarded, lost, or silently burned. If no standard card exists, attempt permitted
recycling before failing. Existing Man cards retain relative order above the
recycled block. Specify and test this ordering, rather than repeatedly drawing and
re-inserting a Man forever.

When stock is empty, preserve `discard[-1]`, shuffle only the older discards into
stock, and leave the visible top discard in place. If Tiplu selection has an
all-Man stock, the same refill helper may recycle older discards to find a standard
card. The indicator is a separate ownership location and can never be recycled.

If discard has zero or one card, there is nothing to recycle. If all available
cards are Man cards, ordinary stock draws are still valid but Tiplu selection is
not. Reject a failed qualification transaction without committing its melds or
any speculative refill. Do not automatically end a round on exhaustion in V1.
This may leave a rules-blocked game with no legal move; expose that condition and
document that an agreed stalemate rule is future work, not a fabricated win.

Derived Tiplu/Jhiplu/Poplu functions return natural face identities, with boundary
logic in one policy module. These helpers do not assign points or enable wildcards.
Player-facing queries reveal these identities only after that player qualifies.

## 7. Completion and conservation

Dublee finishing requires seven already committed, valid pairs plus two distinct
uncommitted cards with the same standard face. Select a deterministic witness pair
by canonical card-ID ordering if several exist. Record that pair in the terminal
result, preserve all owned cards, set exactly one winner, and prohibit every
subsequent mutating command. No money or score calculation occurs.

Implement normal-finish capability explicitly as unsupported. `finish` on the
normal route raises `UnsupportedRuleError`; `get_allowed_actions` never advertises
normal finishing as legal. Keep future normal-completion scenarios in a documented
backlog or explicitly skipped tests with reasons, not misleading passing stubs.

Audit the exact canonical physical-card multiset, not just a total length:

```text
all player hands + stock + discard + optional Tiplu = original 159-card deck
```

Also verify canonical face/copy metadata, committed IDs are owned and disjoint
between melds, turn bounds, valid route/permission combinations, a stable indicator,
and exactly one winner only in FINISHED state. Shown meld references and event
payload references are not additional ownership locations.

After startup, each inactive player owns 21 cards; the current player owns 21 in
MUST_DRAW or 22 in MUST_DISCARD. Showing melds does not change these counts. An
eight-Dublee finish from MUST_DISCARD preserves the winner's 22-card ownership.
Before startup the canonical deck has not been allocated, so validate WAITING
configuration separately rather than pretending the conservation equation applies.

Run audits after every accepted transaction in V1 and throughout tests. With only
159 cards, correctness is more valuable than prematurely optimizing this check.

## 8. Events and safe read models

Introduce events and safe queries early, not only after all mutations are written.
Each accepted command increments a revision once; every emitted event receives a
strictly increasing sequence number. No timestamps for ordering. Event payloads
must be deeply immutable: a frozen dataclass containing a mutable dict is not enough.

| Transition | Ordered domain events |
| --- | --- |
| Start | `GAME_STARTED`, `TURN_CHANGED` |
| Draw from stock after refill | `DISCARD_PILE_RECYCLED`, `CARD_DRAWN` |
| Normal draw | `CARD_DRAWN` |
| Discard | `CARD_DISCARDED`, `TURN_CHANGED` |
| First qualification | optional `DISCARD_PILE_RECYCLED`, `MELDS_SHOWN` or `SEVEN_DUBLEES_SHOWN`, `TIPLU_REVEALED`, `PLAYER_SAW_MAAL` |
| Later qualification | `MELDS_SHOWN` or `SEVEN_DUBLEES_SHOWN`, `PLAYER_SAW_MAAL` |
| Finish | `PLAYER_FINISHED` |

These are domain records, not broadcast instructions. Internal history may contain
stock draws and Tiplu identity and is trusted/private. Never expose it wholesale
through a public/player view. `TIPLU_REVEALED` means the round indicator was created;
it does not authorize revealing it to all players.

Public views expose seats, hand counts, shown melds, top discard, stock count,
qualification flags, phase, turn, and winner. Player views add only that player's
hand, discardable IDs, available action kinds, and Tiplu/derived identities when
authorized. Opponents' hidden hands, stock order, RNG state, and unqualified Maal
must be absent. Public draw events omit stock card identity; authorized player
projections may include their own draw. Shown meld card IDs and discarded cards
are intentionally public. Keep visibility projection in the domain query layer
so the future adapter cannot accidentally broadcast raw state by default.

History is immutable action-result history, not a durable event-sourcing or
serialized replay implementation. Recovery codecs, trusted checkpoint restoration,
and platform retry/deduplication remain later work.

## 9. Proposed package and test layout

```text
marriage/
  __init__.py       # deliberate public API
  cards.py          # PhysicalCard, CardIdentity, CardType
  enums.py          # status, turn phase, source, meld kind, route
  models.py         # immutable state, melds, finish result
  rules.py          # frozen ruleset and discard-source policy
  rank_policy.py    # sequence Ace convention and Maal neighbors
  deck.py           # 159-card construction, deal and pile helpers
  melds.py          # pure sequence/Tunnela/Dublee validation
  maal.py           # staged indicator selection, derived identities
  completion.py     # eighth-pair witness and explicit normal-finish gap
  invariants.py     # exact ownership/phase/route audit
  events.py         # immutable typed domain events
  errors.py         # domain errors and stable codes
  queries.py        # trusted/public/player views and allowed actions
  engine.py         # transactional facade and orchestration
tests/marriage/
  test_cards.py, test_deck.py, test_start.py, test_turns.py
  test_melds.py, test_qualification.py, test_maal.py
  test_recycling.py, test_completion.py, test_invariants.py
  test_events.py, test_views.py, test_determinism.py, test_independence.py
docs/marriage-engine-plan.md
docs/marriage.md     # actual implemented API; create during implementation
```

Reuse only genuinely compatible `card_utils` functions. Do not extract a generic
all-games framework. `engine.py` orchestrates helpers instead of containing every
meld, rank, view, and recycling rule. The facade can later delegate to a reducer
without changing its public method signatures; a second API is not necessary now.

Add `marriage*` to setuptools package discovery during increment 1. Existing
project metadata installs platform dependencies, so distinguish Python import
independence from a separate distribution. Verify the built wheel's Marriage and
card utility modules import and run outside the repository with no platform
packages installed; a dedicated engine-only distribution is a separate packaging
decision. Do not claim a clean `import marriage` alone proves installed packaging.

## 10. Implementation increments and acceptance gates

Safety primitives move earlier than the supplied ordering. Maal and declaration
commitment must land together so no intermediate release can mark a player as
having seen Maal while no indicator exists.

| Increment | Proposed files/classes | Acceptance gate |
| --- | --- | --- |
| 1 — Domain foundation | cards, enums, models, rules, rank policy, errors, deck, package exports/discovery | 159 unique IDs; three of every standard face; three Man cards; immutable values; valid rules/seats; package import boundary |
| 2 — Deterministic startup | engine facade, dealing helpers, initial invariants, events, trusted/public/player query skeleton | 21 cards each for 2/3/4/5 players; stock 117/96/75/54; empty discard; first turn; deterministic deck/order; no mutation through snapshots |
| 3 — Draw/discard and recycling | transactional execution, pile helpers, source policies, allowed actions | Correct 21/22 counts and turn progression; invalid moves unchanged; recycle preserves visible discard; exhaustion safe; rejected actions preserve RNG |
| 4 — Natural meld validation | melds, rank policy tests | Sequence length/order/Ace boundaries; exact physical Tunnelas and Dublees; reject Man, repeated IDs, mismatched faces, cross-meld overlap |
| 5 — Tiplu primitives | maal, derived identities, staged helper tests | One standard indicator; skipped Man conservation; all-Man/refill/exhaustion cases; exact neighboring ranks; no public mutator bypass |
| 6 — Qualification and Maal visibility | declaration orchestration, routes, commitments, safe views/events | Exactly three initial melds or seven pairs; atomic qualification/Tiplu grant; no route switching; no committed discard; later player gets same indicator; private visibility enforced |
| 7 — Dublee completion | completion, terminal transitions, winning-discard restriction | Seven pairs alone cannot win; eighth pair cannot reuse committed IDs; winning-discard policy combinations; explicit finish; preserved remainder; all later mutations rejected; normal finish explicitly unsupported |
| 8 — Contract hardening | complete queries/events, adversarial and seeded action tests | All errors atomic; privacy matrix; stable event ordering; repeated queries pure; all supported actions audited; nonwinning exhausted states explicit |
| 9 — Standalone release checkpoint | API guide, example runner, packaging checks, targeted cleanup | Engine runs without platform; complete deterministic Dublee-route scenario; wheel includes modules; all Marriage and existing regression tests pass |

For every increment: list intended files/classes first, implement that bounded
slice, add meaningful tests, run/fix them, update the implementation guide, and
summarize its actual supported behavior. Do not claim a later increment complete
because its interfaces exist. No adapter or UI implementation is part of these gates.

## 11. Verification strategy

Use pytest with deterministic seeds and immutable fixtures. Build fixtures through
validated test-only state builders/internal constructors; do not add production
APIs for arbitrary hand/stock mutation to make tests convenient.

- Exact deck audit: duplicate physical ID, missing ID, counterfeit face for an ID,
  Tiplu copied into another pile, and double-counted committed cards all fail.
- All player counts: deal sizes and remaining stock, first/last seat rollover,
  invalid player IDs, duplicate seats, invalid repeated startup.
- State-machine matrix: every action in WAITING, MUST_DRAW, MUST_DISCARD, FINISHED,
  wrong seat, wrong source, unknown card, committed card, and duplicate declaration.
- Declaration boundaries: exactly three versus two/four initial melds, seven versus
  six/eight pairs, long pure sequences, overlapping IDs, natural face versus copy.
- Rank policy: A-2-3, Q-K-A, K-A-2, unsorted sequences, gaps, duplicate ranks, and
  Tiplu A/2/K neighbor cases. Keep the two Ace policies independently tested.
- Tiplu/recycle: first/later qualifiers, multiple top Man cards, empty stock,
  all-Man stock, no eligible indicator anywhere, zero/one/many discards, preserved
  visible discard, existing indicator excluded forever, and rollback after failure.
- Completion: preexisting/new eighth pair, only a singleton third copy, multiple
  witness pairs, winning versus nonwinning discard, both policy switches, route
  exclusivity, leftover-card accounting, explicit unsupported normal finish.
- Visibility: two players with different Maal permissions, spectators/public view,
  hidden stock draws, events that must omit private payloads, immutable nested views.
- Determinism: identical seed/config/actions -> identical states/events; a rejected
  random-consuming transaction does not change the next valid action's result.
- Seeded simulations: hundreds of legal draw/discard/recycle actions for each seat
  count, audit after every step, plus deliberately invalid interleavings. A finite
  simulation limit is a test guard, not an invented engine timeout or draw result.
- Independence: static forbidden-import check plus a subprocess scenario with only
  the standalone packages available; no server, credentials, UI, or network needed.

At each relevant gate run `python -m pytest tests/marriage -q`; run the full existing
backend regression suite before the release checkpoint. Engine-only changes do
not require browser testing. Documentation must identify unimplemented normal
completion and proposed rule choices clearly enough that future adapter authors
cannot mistake them for a complete Marriage ruleset.

## 12. Deferred work

Normal final-hand partitions and wildcard semantics need a separate rule contract
before implementation. Scoring/Maal points, settlements, multiple rounds/matches,
stalemate resolution, durable replay, and alternate house-rule profiles also remain
separate increments. Platform integration later owns user-to-seat mapping, command
envelopes, concurrency/locking, delivery, retries, participation registration, room
lifecycle, and UI. It must not move Marriage rules out of this standalone package.

## Subsequent scoring increment

The original V1 scoring deferral is superseded by the implemented, explicitly
configurable house policies in [Marriage scoring](marriage-scoring.md). This
extension provides final-round point accounting, not money movement or normal-hand
completion. Adapter and UI integration are documented in their respective guides.
