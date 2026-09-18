# Room ledger and external settlement

Completed games publish one immutable, zero-sum signed result for every player. The result is keyed by
`room_id`, `table_id`, and `game_id`. Positive values are winnings and negative values are losses. The
room and table totals are projections of those immutable entries; confirming an external payment never
changes game history.

Table settlement freezes every currently unsettled completed game at that table. Game settlement freezes
only the selected game. Stable player-ID ordering turns the frozen signed balances into deterministic
payer-to-payee transfers. A game can belong to only one settlement batch, preventing game and table
settlement from covering the same result twice.

Transfers use `OPEN -> MARKED_PAID -> RESOLVED`. Only the payer may mark a transfer paid and only the
payee may confirm receipt. Every command carries an idempotency key. Settlement batches and actions are
append-only audit records; game results remain visible after settlement.

Marriage uses the engine's final `net_points`. A Flush round uses its chip changes and receives a stable
derived game ID because several rounds may use one table match. Call Break uses the locked placement bets
when final placements are unique. Its existing rules require player agreement for tied placements, so a
tied Call Break match is intentionally not posted until a tie policy is defined.
