# Configurable Call Break match rules

The creator opens **Rules** on a waiting Call Break table. All seated players
must accept the proposal before it takes effect. Rules freeze when the match
starts and are carried into the next match's waiting settings.

All new switches default to **off**, preserving existing table behavior.

| Switch | Four-player suggested value | Five-player suggested value |
| --- | --- | --- |
| Instant high-bid victory | Exact bid 8 | Exact bid 6 |
| Perfect bid every round | Bid 1, take exactly 1 | Bid 1, take exactly 1 |
| Custom Bonus conversion | 10 Bonus per point | 8 Bonus per point |
| High-score payment multiplier | Score at least 20, multiplier 2 | Score at least 15, multiplier 2 |
| Low-score payment multiplier | Score below 0, multiplier 2 | Score below 0, multiplier 2 |

Each enabled rule exposes its editable values. The perfect-bid target defaults
to one but can also be edited. Disabling custom Bonus conversion retains the
existing ten-Bonus-per-point scoring; it does not remove overtrick credit.

## Match outcomes and payments

- Instant victory requires the **exact configured bid**. The engine ends the
  entire match as soon as that player wins the target trick. The unfinished
  deal remains available for audit and display; it is not scored as a completed
  normal deal. A missed target scores minus the bid and the match continues.
  Opponents split the sum of all losing-placement payments equally. That sum
  must divide by player count minus one.
- Perfect-bid qualification requires the target bid and exactly that many tricks
  in **every one of the five deals**. Qualifiers occupy the top places together
  and split the remaining placement payments equally. For two qualifiers in a
  four-player match, remaining players pay the third- and fourth-place amounts.
  Remaining players rank by their accumulated score, including Bonus. Tied
  opponents split the payments of their tied places equally. Proposal validation
  requires integer amounts for every possible winner split and tied-place split.
- High-score and low-score multipliers apply only to normal score-based wins.
  The winner threshold is inclusive; the opponent threshold is strict. Converted
  Bonus counts toward both. Multipliers stack independently for each opponent:
  2 times 2 means that opponent pays four times their placement amount.
- Existing normal-score tie behavior remains: ambiguous tied placements do not
  automatically produce a ledger projection. The new perfect-bid joint-win rule
  has its own explicit settlement policy above.

## Implementation and compatibility

`callbreak.match_rules.MatchRules` owns validation and frozen game configuration.
`callbreak.settlement.settlement_amounts` supplies the same zero-sum calculation
to the local host and durable settlement worker. No database migration is needed.

Scoring remains integer arithmetic: successful bid times `score_scale`, plus
one unit per Bonus; unsuccessful bid times negative `score_scale`. Scores
accumulate without per-round rounding. The historical `score_tenths` names remain
on the wire for compatibility, but consumers must divide by the accompanying
`score_scale` (10 when absent). Updated clients display exact fractions for custom
divisors and show accumulated Bonus / ओटी separately.

Old checkpoints and replays without `match_rules` retain their old behavior.
New checkpoints and replays preserve the complete selected rules. Install the
updated backend on all game servers and update clients before enabling custom
rules; older executables cannot interpret the new configuration. No rollout or
native build is part of this change.

Validation includes legal-play instant wins and missed bids for both capacities,
five-round custom-scoring replay, joint winners, tied opponents, boundary scores,
stacked multipliers, invalid settings, unanimous approval, old checkpoint loading,
and PostgreSQL/WASM early-win recovery with idempotent ledger settlement.
