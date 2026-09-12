# Marriage scoring rules and API

Scoring is independent of room membership, networking, money, and UI. The engine
uses the immutable policy selected before the round and values final holdings only
after a legal finish. Existing Dublee completion triggers this calculation.
Normal-hand completion still needs its separate gameplay implementation.

## Presets and custom options

These are explicit **Bhidne Ho house policies**, not a claim that every Nepali table
uses the same rules. Published rules differ: [Pagat](https://www.pagat.com/rummy/marriage.html)
describes duplicate bonuses, marriage groups replacing their constituent values,
pairwise Maal settlement, and additional payments to the winner. Its deal-time
Tunnela declaration is different from our current shown-meld system. We therefore
name our Tunnela policy explicitly instead of calling it that traditional rule.

| Option | House bonus (default) | Simple points |
| --- | --- | --- |
| Tiplu, totals for 1 / 2 / 3 | 3 / 8 / 15 | 3 / 6 / 9 |
| Jhiplu, totals for 1 / 2 / 3 | 2 / 5 / 10 | 2 / 4 / 6 |
| Poplu, totals for 1 / 2 / 3 | 2 / 5 / 10 | 2 / 4 / 6 |
| Man, totals for 1 / 2 / 3 | 2 / 5 / 10 | 2 / 4 / 6 |
| Marriage, totals for 1 / 2 / 3 | 10 / 25 / 50 | 0 / 0 / 0 (no bonus) |
| Extra Tunnela points | 5 per shown Tunnela | Off |
| Maal eligibility | Must have seen Maal | Must have seen Maal |
| Loser payment, seen / unseen Maal | 3 / 10 | 3 / 10 |
| Extra per loser for Dublee winner | 5 | 0 |

Every numeric setting accepts integers 0..1000. Copy tables contain exactly three
totals; they are not per-card multipliers. Triple Tiplu/triple marriage entries are
reserved for the table format: the current engine removes one physical Tiplu as the
indicator, so only two Tiplu copies can be held. Presets come from the server;
clients never supply point results. Custom fields override defaults. Unknown fields,
booleans as numbers, strings as numbers, and invalid ranges are rejected.

Tunnela scope can be `off`, `shown` (engine-accepted Tunnela declarations) or `hand`
(every natural three-copy face in final holdings). The bonus is additive to Maal
points, including on Maal Tunnelas. Man cannot form a Tunnela. Maal eligibility can
be restricted to players who saw Maal or include everyone; it gates **all** item
points, including Man and Tunnela bonuses, but never the winner payment.

Only exact Tiplu/Jhiplu/Poplu faces score, using the engine's cyclic neighbors.
Other suits of the Tiplu rank have no points. All retained cards count, including
committed melds and unused Dublee cards. Discards, stock and indicator do not.
The calculator tries all disjoint marriage-group counts and selects the greatest
total. A card counted in a marriage is excluded from individual Maal counting.
Ties prefer fewer marriage groups. Tunnela bonuses are independently additive.

## Settlement and breakdown

For N players, let each player's item total be S and the sum of all item totals be T.
Maal exchange is `N * S - T`. Each loser additionally pays the selected seen/unseen
rate, plus the Dublee bonus if the winner finished by Dublee. The winner receives
the sum of these payments. Final net is Maal exchange plus winner payment.
Positive means won; negative means paid. Net points sum to zero. Finishing the
round does not guarantee a positive net score.

For example, with three players holding Maal totals 10, 2 and 0, Maal nets are
18, -6 and -12. If the first player wins with Dublee, the second has seen Maal and
the third has not, house winner payments are +23, -8 and -15. Final nets are
**+41, -14 and -27**.

No calculation is exposed before completion, including after a manual End game.
Finished projections reveal category counts and values for explanation, not the
players' complete hands, physical IDs or hidden pile contents. Final results are
deterministic on reconnect and read-only queries do not change revision or RNG.

## Standalone API

```python
from marriage import MarriageGameEngine, MarriageRules, ScoringRules

rules = ScoringRules(seen_payment=5, unseen_payment=15, man=(1, 3, 6))
engine = MarriageGameEngine(("a", "b"), rules=MarriageRules(scoring=rules))
engine.start_game()
# Execute ordinary draw/show/discard/finish methods.
result = engine.get_scores()  # None until a legal finish; then immutable RoundScore
```

`RoundScore` contains `winner`, `rules`, `total_maal`, and `players`. Each
`PlayerScore` contains `player_id`, `has_seen_maal`, `eligible`, `items` (label,
count, points), `maal_points`, `maal_net`, `winner_payment`, and `net_points`.
Public/player views include `scoring_rules` and the same final `scores`.
The adapter exposes `GET_SCORES {}` through its common command catalog and existing
`QUERY_RESULT` event. No scoring command can modify a live round's policy.

## UI and verification

The creator opens Rules before start, selects a preset or edits values, and taps
Save scoring rules. Other seats see read-only values. Unchosen settings use House
bonus. Unsaved edits are marked and are not used to start. Points opens a scrollable
overlay with a close button and displays the final formula and all player rows.

Python tests cover custom rules, duplicate/marriage overlap, Maal eligibility,
Tunnela modes, Ace neighbors, zero-sum accounting for 2-5 players, adapter final
queries, and HTTP ownership/start locks. Browser tests cover pre-game save and
cross-client visibility, plus Points pending/final states and mobile display.
