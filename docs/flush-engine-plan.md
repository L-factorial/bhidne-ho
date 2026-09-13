# Standalone Flush engine implementation plan

Status: Standalone Marriage-style engine implemented. See [Flush API](flush.md)
for the supported behavior, tests, defaults, and remaining integration work.
The original plan below records the design rationale. Provisional defaults were
resolved as minimum stakes with raises, AKQ highest/A23 second, requester loses equal-hand shows,
and show cost equal to one required bet. Ace order, ties, and show cost are
configurable. Room settings/editor/locking and adapters are now implemented; see
[Flush integration](flush-adapter.md).

## Scope and repository fit

Build one manually played Flush round with a fixed seated roster. The engine owns
cards, turns, blind/seen eligibility, integer chips, contributions, hand comparison,
and terminal settlement. No autoplay, timers, bots, networking, sessions, rooms,
databases, cash transfers, or UI belong in this increment.

Dependency direction:

```text
future app/adapters/flush -> flush -> card_utils -> Python standard library
```

Reuse `card_utils.Card`, `Rank`, `Suit`, `standard_52`, `shuffle`, and `deal`.
One standard pack needs no new physical-card or Deck abstraction: each canonical
card such as `AS` occurs exactly once. Index zero remains the top of the deck.
Do not reuse Marriage's multi-pack cards or either game's specialized player state.

Follow Marriage's transactional facade: frozen dataclasses, tuple collections,
engine-local string player IDs, stable domain errors, immutable action results,
revisioned events, and separate trusted/public/player views. Call Break's pure
transitions establish the same rejection and conservation expectations.

`app/games/base.py.GameEngine` uses platform Pydantic command/event models and
user IDs. The standalone engine must not import or implement that transport-facing
protocol directly. A subsequent adapter translates the platform abstraction into
Flush actions, as the existing game adapters do. No shared framework extraction.

## Rules contract and decisions to resolve

Use Python snake_case names in `FlushRulesConfig`, mapping the supplied camelCase
concepts one-to-one. Freeze configuration when constructing the round. Reject
unknown or unsupported policies instead of silently ignoring them.

| Setting | V1 contract / proposed default |
| --- | --- |
| `boot_amount` | Proposed nonnegative integer: positive collects compulsory boot from every seat; zero disables entry contribution. Host must choose explicitly |
| `minimum_bet_rounds_before_side_show` | 3, counting this player's successful bets (blind or seen); boot excluded |
| `blind_to_seen_bet_multiplier` | 2; configurable positive integer |
| `minimum_blind_rounds_before_show` | Proposed 3; independent of side-show threshold |
| `maximum_active_players_for_blind_show` | Inclusive maximum, proposed 2; never relaxes the final-two restriction |
| `allow_blind_show` | Proposed true |
| `allow_seen_show` | Proposed true |
| `show_only_when_two_players_remain` | Confirmed true; locked capability, not an editable switch in V1 |
| `minimum_players` / `maximum_players` | Proposed 2 / 5; engine hard ceiling 17 for a 52-card pack |
| `initial_blind_bet` | Positive integer, explicitly configured independently of boot |
| `sequence_ace_policy` | Pending: AKQ highest/A23 second, A23 highest, or A23 lowest |
| `tie_policy` | Pending: requester loses or split pot |
| `bet_policy` | Any whole-chip amount at least the current minimum, up to available chips |
| `show_cost_multiplier` | Proposed 1 × requester's required bet; zero may support free-show variant |

Validate exact integer types (booleans are not amounts), positive stakes, nonnegative
thresholds, coherent player limits, supported enums, and chip balances before use.
Reject NaN, infinity, fractional amounts, negative balances, and unknown IDs.

Additional proposed decisions:

- `SEE_CARDS` is current-player-only, does not advance the turn, and is rejected
  when already seen. No existing Flush convention overrides the supplied example.
- Caller supplies each seat's initial chips and a dealer ID; default dealer is
  the first roster seat. First betting player is the next seat after the dealer,
  matching Call Break's circular betting convention. Deal three passes beginning
  at that seat. Random dealer selection belongs to a future host.
- When boot is enabled, all seats must afford it or startup rejects atomically.
  Startup collects boot automatically, without consuming a turn or incrementing
  either bet counter. With zero boot, startup collects nothing; circular betting
  still begins at the configured positive initial blind stake.
- V1 has no all-in, side pots, credit, top-ups, or automatic folds. An unaffordable
  bet/show rejects and the player may fold. A zero-chip active seat still receives
  its turn so the engine cannot stall by skipping it without settlement.
- Show cost, if adopted, is debited once as part of the same terminal transaction.
  It is a contribution, not a qualifying blind betting turn.
- `turn_bet_count` counts accepted BET actions, including blind and seen bets.
  `blind_bet_count` increments only for accepted BET while BLIND.
- Fold wins reveal no hands, even the winner's. A legitimate SHOW reveals only
  the two compared hands. Folded/out hands and undealt cards remain hidden forever.
- For equal ranks, never use suit or arbitrary roster order as an undocumented
  tie breaker. If split is selected, return multiple winners and explicit payouts;
  allocate any odd chip clockwise after the dealer among tied winners.

### Confirmed show restriction and blind eligibility

SHOW always requires exactly two ACTIVE players, for blind and seen requesters.
Three or more active players cannot show. With one active player the round has
already ended by folding, so there is no SHOW action. Reject a false
`show_only_when_two_players_remain` configuration with UnsupportedRuleError and
present the requirement as read-only in the future rules panel.

Blind show adds all of these requirements; none overrides the final-two rule:

```text
is_current_player and player.status == ACTIVE
and active_player_count == 2
and rules.allow_blind_show
and player.blind_bet_count >= rules.minimum_blind_rounds_before_show
and active_player_count <= rules.maximum_active_players_for_blind_show
```

Here x means the requester's own accepted blind bets for final-two blind show. It does not mean global table rotations or other players' bets.
Use the label “At most N active players” for the inclusive maximum. If the UI
instead uses “Fewer than N players”, convert it to a maximum of N - 1: fewer than
3 means at most 2. Do not use these labels interchangeably.

Under the final-two restriction, an inclusive maximum >= 2 permits two-player
show; a maximum < 2 would make blind show impossible. Reject that combination
when blind show is enabled. A maximum above 2 does not enable larger-table shows;
explain this dependency in the rules UI instead of implying otherwise.

### Pre-game configuration and locking

The future room integration must support this lifecycle without putting room or
permission logic into the standalone engine:

1. During WAITING, the creator edits the room's Flush rules. Every seated player
   can inspect the latest saved values before starting. Unsaved form edits have
   no effect on the server's configuration.
2. The server validates the complete ruleset, including dependent settings, and
   saves it atomically with a rules revision. Reject unknown settings and stale
   edits. A failed edit preserves the previous valid configuration.
3. Start includes the match ID and the rules revision the creator reviewed.
   Under the same room lock used for settings changes, verify creator ownership,
   a full roster, revision, and chip affordability. Construct the engine with a
   frozen copy of those saved rules, and collect boot/deal atomically.
4. After successful start, reject every settings change on the server, including
   requests from the creator. Disabled UI inputs alone are insufficient. Failed
   startup leaves the lobby editable and does not charge boot or deal cards.
5. Public/player snapshots expose the effective rules, ruleset version, and locked
   status. Reconnection restores these exact values. The rules panel stays
   available for review during and after the round.
6. Settings can change for the next game only. A new waiting game may copy the
   previous rules as an editable draft, never mutate the finished/active engine.

The engine itself has no configuration mutator. Frozen dataclasses and immutable
nested values ensure callers cannot change rules through constructor inputs or
returned state. Adapter/room work follows the engine release; this section fixes
its contract now, without adding HTTP, authentication, or UI dependencies.

Rule-lock integration tests must cover noncreator edits, stale rules revisions,
concurrent save/start, invalid settings, failed start without debit, post-start
edits, reconnect, and starting a new game with a distinct rules snapshot.

### Betting extension boundary

`BET(amount)` accepts a whole-chip amount at least the actor's current minimum,
up to their available chips. New rooms start at blind 1 / seen 2. Blind bets set
the seen minimum to amount × configured multiplier. Seen bets set the seen minimum
to that exact amount and blind minimum to ceil(amount / multiplier). Both minimums
are published, so an odd seen bet stays exact until the next blind bet updates it.
Boot is collected once and does not change the betting minimums.

## State, actions, and atomicity

Proposed immutable domain types:

- `FlushRulesConfig`, `FlushConfig`: rules, ordered seats, initial chips, dealer.
- `PlayerState`: ID, three-card tuple, ACTIVE/FOLDED/OUT status, BLIND/SEEN
  visibility, chips, total contribution, blind-bet and total-bet counters.
- `FlushGameState`: config, players, undealt stock, phase, current seat, blind
  stake, historical pot, revision, event history, and optional settlement.
- `RoundSettlement`: termination reason, ordered winners, payouts, compared hands
  when appropriate, and evaluated winning result for SHOW. For a fold win,
  winning hand is absent; the engine need not evaluate or reveal it.
- Typed `Bet(amount)`, `SeeCards`, `Fold`, `Show` actions and a closed action union.
  `apply_action` routes to small methods; it is not a second implementation.
- `ActionResult`: committed revision plus ordered immutable domain events.

`OUT` can remain a reserved state for later match-level elimination; startup makes
all supplied seats ACTIVE, and V1 never silently changes an insufficient stack to
OUT. Turn/eligibility helpers skip both FOLDED and OUT states.

```text
WAITING --start_game--> PLAYING
PLAYING --SEE_CARDS--> PLAYING, same player
PLAYING --BET--> PLAYING, next active player
PLAYING --FOLD--> next active player or FINISHED
PLAYING --SHOW--> FINISHED
```

Validate, stage a candidate, audit it, and commit state/revision/events/RNG together.
Each accepted action increments revision once. Rejections preserve chips, cards,
turn, stake, counters, history, event sequence, and RNG state. Terminal state has
no current player and rejects every mutation, including another start.

Clone injected `random.Random` state into engine-owned randomness, as Marriage
does. Equal configuration, initial RNG state, and actions produce equal states
and events within the supported runtime. No clocks, UUIDs, global random state,
or unordered-set choices in the core. Production seeding belongs outside replay
fixtures; deterministic tests are not a promise of cryptographic fairness.

## Public API and visibility

```python
FlushGameEngine(player_ids, *, initial_chips, rules, rng=None, dealer_id=None)
engine.start_game()
engine.apply_action(player_id, action)
engine.bet(player_id, amount)
engine.see_cards(player_id)
engine.fold(player_id)
engine.show(player_id)
engine.get_allowed_actions(player_id)
engine.get_public_view()
engine.get_player_view(player_id)
engine.get_state()  # trusted server diagnostics only
```

`evaluate_see_eligibility` and `evaluate_show_eligibility` return a typed allowed
flag and stable rejection reason. Queries and mutation handlers use the same
helpers so offered actions cannot contradict domain validation. Available actions
include required bet/show cost and affordability without inspecting hidden ranks.

Public/player views must be explicit allowlists, never raw-state serialization
followed by field removal. Include only safe primitives, enums, and immutable
nested records; use canonical card strings when serializing authorized cards.
Serialization must run on a safe view, never the authoritative state.

| Consumer | During play | After SHOW | After fold win |
| --- | --- | --- | --- |
| Public/spectator | No cards | Exactly the two shown hands | No cards |
| Blind player's view | No own or opponent cards | Public shown hands only | No newly revealed cards |
| Seen player's view | Own three cards only | Own cards plus public shown hands | Own previously seen cards only |

Blind views and allowed-action responses must not leak hand strength, evaluator
results, card-derived suggestions, stock ordering, or raw history. SEE_CARDS events
publish the visibility change publicly; identities appear only in the entitled
player projection. Unknown event types fail closed until a safe projection exists.

An engine-local player-view query is not authentication: a future adapter must
map the authenticated user to its fixed seat, ignoring client-supplied viewer IDs.
The core can reject unknown IDs and project a seat safely, but cannot establish
which remote person is asking for that seat. Document this boundary explicitly.

## Hand evaluator

Stateless `FlushHandEvaluator` evaluates exactly three distinct standard Cards.
Return a comparable `FlushHandResult` with category and explicit tie-break tuple:

| Category, strongest first | Tie-break values |
| --- | --- |
| Trail / Trio | Triplet rank |
| Pure sequence | Sequence strength from configured Ace policy |
| Sequence | Same sequence policy |
| Color / Flush | Ranks descending |
| Pair | Pair rank, then kicker |
| High card | Ranks descending |

Card input order and suit labels do not resolve equal values. Reject K-A-2 and
other wraparound/nonconsecutive sequences. Evaluate A-K-Q and A-2-3 through one
policy shared by pure and ordinary sequences. Keep winner/tie settlement out of
the evaluator; equality is a valid comparison result.

## Accounting and invariants

Use integer in-game chip units only. No payment gateway or wallet abstraction.
Retain `pot == sum(total_contribution)` as historical round accounting, including
boot and show cost. Before settlement the pot is held; after settlement it is
credited once and the held balance is zero. Derive held pot from settlement status
rather than clearing contributions or counting the historical pot twice.

```text
Before settlement: sum(player.chips) + pot == sum(initial_chips)
After settlement:  sum(player.chips) == sum(initial_chips)
                   sum(payouts) == pot == sum(contributions)
```

Audit canonical card conservation: all hands plus stock equal the exact standard
52-card multiset. Folded hands remain in ownership storage; view/event references
are not extra card locations. Every started seat retains three cards.

Audit nonnegative chips/contributions, monotone counters, blind count <= total
bet count, exactly one actionable active seat while playing, at least two active
seats while playing, consistent terminal reason/winners, and no unsettled terminal
pot. Unknown/malformed actions and wrong-turn requests do not alter state.

## Files and implementation increments

```text
flush/
  __init__.py
  enums.py, rules.py, models.py, actions.py, errors.py
  betting.py, turns.py, evaluator.py, settlement.py
  events.py, queries.py, visibility.py, invariants.py, engine.py
tests/flush/
  test_foundation.py, test_start.py, test_turns.py, test_betting.py
  test_visibility.py, test_show.py, test_evaluator.py, test_settlement.py
  test_invariants.py, test_determinism.py, test_independence.py
docs/flush.md
examples/flush_round.py
```

Add `flush*` to setuptools discovery in `pyproject.toml`. No planned changes to
Call Break or Marriage gameplay, shared card types, runtime, HTTP routes, or UI.

| Increment | Work | Acceptance gate |
| --- | --- | --- |
| 1 | Freeze rule decisions; foundation, actions, errors, exports, packaging | Strict rules/seats/chips validation; immutable types; import independence |
| 2 | Transactional startup, boot, dealer ordering, view/event skeleton, audits | Three unique cards per seat; blind views hide cards; exact boot accounting; seeded reproducibility; rejected startup unchanged |
| 3 | Betting, seeing, folding, eligibility, turn helpers | Seeing is immediate; personal bet counts below the configured minimum reject side-show; multiplier tests; explicit fold; skips folded seats; no hidden-card leak |
| 4 | Independent evaluator | Every category/tie breaker; all Ace policies; permutation invariance; equal hands; malformed input |
| 5 | Show and both terminal paths with settlement | Exactly-two eligibility; blind thresholds/flags; cost/affordability; correct payouts/ties; fold-win privacy; terminal rejection |
| 6 | Contract hardening and standalone release | Adversarial state/action matrix; deterministic simulations; full regression suite; example and wheel/import verification |

Introduce privacy and invariants during startup, not as a final patch after
betting/show. Each increment includes its tests and API documentation. Engine-only
work requires no browser tests. Adapter and multiplayer UI integration form a
separate plan after this core contract is stable.

## Test and release gates

- Default seats 2–5 plus configured limits and the 17-seat deck capacity boundary.
- All actions in WAITING/PLAYING/FINISHED, wrong/unknown/folded actor, wrong amount,
  repeated seeing, insufficient boot/bet/show chips, and all rule-toggle boundaries.
- Seeing retains turn; boot, show, folds, failed bets, and seen bets never increment
  blind eligibility. Test nondefault multiplier/thresholds, including zero threshold.
- Two-person show with all blind/seen combinations; three-plus show rejected;
  last-player win settles immediately without comparing or revealing cards.
- Compare all 22,100 three-card combinations using category counts and comparison
  properties; targeted tests independently assert category order and kickers.
- Serialize every public/player/event projection across visibility and terminal
  states; check exact permitted cards and absence of stock, ranks, and private
  evaluator metadata. Test immutable snapshots and invalid-event fail-closed paths.
- Audit after every accepted action and assert full state/RNG equality after every
  rejection. Seeded legal/illegal interleavings must conserve cards and chips.
- Static import boundary and `python -I -S` standalone scenario; build/install a
  wheel outside the repo to verify package inclusion, not just local imports.
- Run `python -m pytest tests/flush -q`, then the existing full backend suite.
  Record created/modified files, final defaults, tests, and remaining unsupported
  variants in `docs/flush.md` when implementation is complete.

## Explicitly deferred

All-in/side pots; additional side-show variants;
show involving more than two active players; multi-round bankroll management;
late joins/rebuys; persistence/replay across versions; transport adapters, command
receipts, user-seat authorization, room lifecycle, and UI. No autoplay is planned.

The user-confirmed previous-active-seen side-show flow is implemented as a
subsequent increment. See [Flush API](flush.md#private-side-show) for its exact
fee, decline, tie, turn, and privacy semantics.

Seeing your own cards is available on your turn immediately, without prior bets. The configurable personal bet minimum applies only to requesting side-show.

Betting minimums: new rooms start with blind 1 and seen 2 (default multiplier 2). A blind bet sets the seen minimum to amount × multiplier. A seen bet sets the seen minimum to that exact amount and the blind minimum to ceil(amount / multiplier). Bets below the current minimum or above available chips reject atomically. Boot and final-show fees do not raise the stake.
