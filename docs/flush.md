# Standalone Flush engine

`FlushGameEngine` owns a manually played table with a roster locked for each round. It follows
Marriage's class-based API: immutable state held privately by the instance,
atomic replacement after validation, revisioned events, and safe query methods.
It imports only `flush`, `card_utils`, and the Python standard library.

## Example

```python
from random import Random
from flush import FlushGameEngine, FlushRulesConfig, Bet

engine = FlushGameEngine(
    ['alice', 'bob'],
    initial_chips={'alice': 1000, 'bob': 1000},
    rules=FlushRulesConfig(boot_amount=5, initial_blind_bet=10),
    rng=Random(7),  # deterministic fixture; omit for an independently seeded round
)
engine.start_game()
engine.deal_cards(engine.get_state().current_player_id)
engine.skip_cut(engine.get_state().current_player_id)
engine.apply_action('bob', Bet(10))
assert engine.get_state().current_player_id == 'alice'
public = engine.get_public_view().to_dict()
private = engine.get_player_view('alice').to_dict()  # still blind: cards == []
```

The dealer defaults to the first seat. Betting and three-pass dealing begin at
the next seat clockwise. Optional `dealer_id` must identify a seated player.
The engine clones the supplied RNG state and copies input rosters/balances.
Callers cannot change a round by mutating those inputs afterward.

## Rules, fixed for the round

Create a frozen `FlushRulesConfig` before constructing the engine. There is no
rule-changing action. A future host owns the editable waiting-room settings,
creator permission, rules revision, and atomic save/start lock. These are now
implemented outside the engine; see [adapter and room controls](flush-adapter.md).

| Field | Default / meaning |
| --- | --- |
| `boot_amount` | Required nonnegative integer; zero disables boot |
| `initial_blind_bet` | Positive integer, default 1, independent of boot |
| `minimum_bet_rounds_before_side_show` | 3 personal accepted bets (blind or seen); boot excluded |
| `blind_to_seen_bet_multiplier` | 2 |
| `minimum_blind_rounds_before_show` | 3 personal accepted bets (blind or seen); boot excluded |
| `maximum_active_players_for_blind_show` | 2, inclusive maximum |
| `allow_blind_show` / `allow_seen_show` | Both true |
| `allow_side_show` | False; opt in before start for private comparisons |
| `show_only_when_two_players_remain` | True; false is explicitly unsupported |
| `minimum_players` / `maximum_players` | 2 / 5; configurable up to a 17-seat deck limit |
| `sequence_ace_policy` | `AKQ_FIRST_A23_SECOND` |
| `tie_policy` | `REQUESTER_LOSES` |
| `show_cost_multiplier` | 1 × requester's required bet; zero permits free show |

Ace ordering, tie settlement, and show cost are explicit initial house-policy
choices, not claims of universal Flush rules. Alternative Ace policies are
`A23_FIRST` and `A23_LOWEST`. `TiePolicy.SPLIT` divides the pot equally, assigning
any odd chip clockwise after the dealer among tied winners. Suits never break ties.

Exact integer amounts are required; bools, fractional amounts, and negative
balances are rejected. Every player must afford boot before startup can succeed.
Boot is collected automatically once, not as the first BET, and counts toward
neither betting counter. No player move is automated.

## API

| Method | Behavior |
| --- | --- |
| `start_game()` | Lock the round and wait for the dealer |
| `deal_cards(player_id)` | Dealer shuffles and passes to the next seat for cutting |
| `cut_deck(player_id, position)` / `skip_cut(player_id)` | Next seat cuts or skips, then cards are dealt and boot collected |
| `bet(player_id, amount)` | Debit at least the current minimum, update blind/seen minimums, and advance one active seat |
| `see_cards(player_id)` | Current blind player qualifies after personal blind threshold; retain turn |
| `fold(player_id)` | Mark folded, skip future turns; settle immediately if one remains |
| `request_side_show(player_id)` | Pay one seen bet and request the previous active seen player |
| `accept_side_show(player_id)` / `decline_side_show(player_id)` | Only the requested target responds; play resumes after requester |
| `can_side_show(player_id)` | Side-show eligibility |
| `show(player_id)` | Validate final-two eligibility and affordability, debit show cost, compare, settle |
| `apply_action(player_id, action)` | Dispatch typed `Bet`, `SeeCards`, `Fold`, or `Show` to the same methods |
| `get_state()` | Immutable trusted authoritative state, including every hand and stock |
| `get_public_view()` | Safe public snapshot, no private cards during play |
| `get_player_view(player_id)` | Public snapshot plus only this seat's previously seen cards and available actions |
| `get_allowed_actions(player_id)` | Available kinds, required bet, show cost, seeing/show eligibility |
| `can_see_cards(player_id)` / `can_show(player_id)` | `Eligibility(allowed, reason, code)` using the same checks as actions |
| `get_visible_events(player_id=None, after=0)` | Safe events after an exclusive sequence cursor; None means spectator |

All mutations return `ActionResult(revision, events)`. A rejection raises a
`FlushError` subclass with a stable `code`, and changes nothing: state, chips,
turn, history, revision, and RNG remain unchanged. Invalid construction raises
`ValueError`; unsupported rules raise `UnsupportedRuleError`. Audit failures
raise `InvariantError` and prevent a candidate state from being committed.

Only the current ACTIVE seat may act, including SEE_CARDS. Seen players pay
`current_blind_bet * blind_to_seen_bet_multiplier`; blind players pay the blind
stake. Bets may meet or exceed the current minimum. `turn_bet_count` counts all successful BET actions;
`blind_bet_count` counts only those made while blind. Other players' actions,
boot, seeing, folding, show costs, and rejected actions do not increment it.
Insufficient-chip bets or shows reject; folding remains possible. No automatic
folds, all-in states, side pots, or credit are implied.

SHOW always requires exactly two active players. Blind show additionally checks
the configured permission, personal threshold, and inclusive active-player maximum.
Increasing the maximum never enables shows with three or more players. A single
remaining player wins immediately by folds without comparing cards.

## Evaluation and accounting

`FlushHandEvaluator.evaluate(cards)` accepts exactly three distinct standard Cards
and returns comparable `FlushHandResult(rank, tiebreak)`. `compare(left, right)`
returns -1, 0, or 1. Compare results generated with the same Ace policy.

Ranking: Trail > Pure sequence > Sequence > Color > Pair > High card. Pair rank
precedes kicker; color/high-card ties compare descending ranks. A-K-Q and A-2-3
use the configured sequence policy for both sequence categories. K-A-2 is not a
sequence. The evaluator is stateless and knows nothing about players or betting.

`pot` is the historical total of contributions, including boot and any show cost.
At settlement it is credited exactly once and `held_pot` becomes zero. Contributions
remain available for inspection. `RoundSettlement` holds reason, winner IDs,
payouts, and SHOW's compared hands/winning evaluated result. Fold wins have no
winning evaluated hand or revealed cards. Multiple winners are possible under SPLIT.

Before settlement, `sum(chips) + pot == sum(initial_chips)`. After settlement,
`sum(chips) == sum(initial_chips)` and `sum(payouts) == pot == sum(contributions)`.
Audits also enforce each player's individual balance and exact conservation of
all 52 canonical cards across hands and stock. Folded players retain their cards
in trusted state, but cannot act again. Finished games reject every mutation.

## Privacy and adapter boundary

Never send `get_state()` or its serialization to clients. Use public/player view
`to_dict()` methods, which return detached JSON-compatible values. Card identifiers
are canonical strings (`AS`, `10H`) only in authorized card fields.

Blind player views reveal no own cards. Seen player views reveal only that seat's
cards. Public events never include cards for dealing, betting, or SEE_CARDS;
after seeing, refresh the authorized player view. Legitimate SHOW reveals exactly
the two compared hands in the terminal public result/event. Fold wins reveal
nothing new, including when the winner is blind. Folded hands and stock never
become public. Previously seen own cards remain visible to their owner after folding.
Safe event projection rejects unknown event kinds until explicitly supported.

A player ID passed into a domain query is not authentication. The future adapter
must map authenticated users to their own seats and ignore caller-supplied viewer
IDs. The engine is synchronous and single-threaded; the host must serialize calls,
check expected revisions, deduplicate command IDs, manage rules/lifecycle, and
route events. Events describe accepted changes; they are not mutation commands.

## Verification and limitations

```sh
python -m pytest tests/flush -q
python -m pytest -q
python -m examples.flush_round
python -m pip wheel . --no-deps --wheel-dir /tmp/bhidne-flush-wheel
python -I -S scripts/verify_flush_wheel.py /tmp/bhidne-flush-wheel/bhidne_ho-0.1.0-py3-none-any.whl
```

Tests cover personal thresholds, amount validation, turn order, configurable shows,
ties, accounting, privacy, immutable inputs/views, rollback, seeded rounds, every
three-card combination's category, and standalone import independence. No browser
checks are needed for this domain-only increment.

Adapter, waiting-room rules editor/lock, and basic manual UI are documented in
[Flush integration](flush-adapter.md). Not implemented:
general multiplayer showdown, all-in/side pots, multi-round
bankrolls, persistent replay, or real-money settlement. Randomness is reproducible
within the supported runtime; cryptographic fairness and cross-version replay are
separate contracts. No Call Break or Marriage gameplay changes are required.

## Private side-show

When enabled, a current seen player with at least three active players may request
comparison with the previous active seen player in circular order (skip folded,
out, and blind seats). The request charges one normal seen bet and increments
only the total betting counter. It is not an additional charge on acceptance.
The target becomes the sole actionable seat and can accept or decline. All other
mutations wait; there is no timeout or automatic response.

Decline reveals no cards, retains the contributed bet, and resumes at the next
active seat after the requester. Acceptance compares the two hands, with requester
losing equal ranks regardless of the terminal split-pot setting. The loser folds,
the winner remains active, and the round continues without pot settlement.
Side-show is unavailable with two active players; use terminal SHOW instead.

The public pending request contains only requester, target, and revision. Public
events announce request/decline/resolution and the folded seat, never either hand.
The immutable trusted `side_shows` history contains both compared hands; only the
two participants' player views receive the latest private opponent-card result.
Other players and spectators cannot see it. The UI's individual flips and result
dismissal are presentation only; they never delay or authorize an engine action.

Seeing your own cards is available on your turn immediately, without prior bets. The configurable personal bet minimum applies only to requesting side-show.

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
