# Normal-hand completion

This increment extends the original Marriage V1 contract with the following house
rules. The existing natural qualification, Ace-low-or-high convention, Dublee route, and
configurable scoring policies remain in force.

## Winning rules

- Qualify by showing exactly three disjoint natural sequences/Tunnelas. Those
  physical cards and groups stay fixed. Wildcards cannot replace cards in the
  initial qualification, and qualification routes cannot be switched.
- After drawing on your turn, a normal win uses 21 of the 22 owned cards in valid
  groups, including the three shown groups. Exactly one uncommitted card is the
  final discard. There are no loose cards, pairs, or reused physical copies.
- Final sequences contain 3-13 consecutive slots of one suit. Ace is low or high:
  A-2-3 and Q-K-A are legal; K-A-2 is not. Longer sequences are supported.
- Final sets contain 3 or 4 cards of one rank in distinct suits. Three natural
  physical copies of the same face form a Tunnela instead. Repeating a suit does
  not make a set.
- After qualification, Man, every card matching Tiplu's rank in any suit, and
  the same-suit Jhiplu/Poplu are wildcards. Standard wildcard cards may also form
  natural melds at their printed faces. Each wildcard substitutes one missing
  slot. All-wild groups are permitted. Maal neighbors retain the existing cyclic
  convention, independent of sequence boundaries.

The engine searches the uncommitted cards for an exact partition. It chooses a
deterministic witness in canonical card-ID order, including a deterministic final
discard. This is a legal-hand search, not a strategy or scoring optimizer. The
player reviews that discard and can cancel before submitting.

## API and atomic finish

`get_allowed_actions(player_id)` advertises `FINISH` only after drawing on the
current player's turn when a winning partition exists. Its private `normal_finish`
contains `melds` and `discard_card_id`. Other players and spectators receive no
preview. `can_finish_normal_hand` returns `Capability(supported=True, reason=...,
can_finish=...)`; the verdict concerns the hand, while allowed actions enforce
the turn and lifecycle.

`FINISH` still accepts an empty payload for existing clients. It also accepts
`{melds, discard_card_id}` for a selected normal partition or `{winning_pair}` for
a selected eighth Dublee. The server revalidates ownership, distinct physical
cards, locked declarations, group legality, route and turn before publishing the
selected option. Invalid selections never fall back silently to another option.
The command revalidates the current server-owned cards. It atomically removes the final discard from the winner's hand, adds it to
the discard pile, records the normal witness, and finishes the round. There is one
revision containing `CARD_DISCARDED` then `PLAYER_FINISHED`, without a next-turn
event. The normal winner owns 21 cards; Dublee winners retain their existing 22.
Rejected commands leave state, history, scores, and RNG unchanged. Runtime receipt
retries return the original result without discarding or scoring again.

Final public snapshots expose `normal_finish`; `PLAYER_FINISHED` exposes its meld
types, card groups, and final discard ID. Opponents' remaining hands and the hidden
indicator are not published. Final score items include `card_ids` for their scoring
evidence; these selected scoring cards become public only after the round ends.
Unscored hidden cards remain private. Reconnecting viewers recover the same final witness.

Final points use the existing scoring policies and actual final holdings, excluding
the final discard. Normal wins receive no Dublee bonus. The existing `shown`
Tunnela-bonus scope continues to count the initial qualification melds; `hand`
scope counts natural Tunnelas in the final holdings. A partition does not change
the natural face or point value of a wildcard.

## Interface and verification

After Maal unlocks, Your Cards replaces arrangement tabs and the planning tool
with a Marriage eligibility bulb. It checks again when the hand changes, stays
disabled for hidden hands or illegal turns, and glows when a win can be submitted.
Its inline preview offers Previous/Next and swipe through up to 24 normal winning
partitions (or available eighth pairs), showing the winning cards and final discard
or remaining cards. Back preserves selection; Show Marriage submits the selected
option. Rejection keeps the preview open. Accepted wins use the existing public
victory popup for every viewer, including spectators and reconnecting players.

Tests cover natural/wildcard groups, long sequences, Ace boundaries, 2-5 players,
qualification restrictions, card reuse, invalid finishes, rollback, conservation,
scoring, private/public projections, later discard pickups, HTTP receipt retries,
and mobile/desktop review and rejection flows.

```text
python -m pytest tests/marriage tests/test_marriage_adapter.py tests/test_marriage_room.py -q
node client/tests/browser/marriage-normal-finish.cjs
```

The browser test uses engine-generated fixtures and requires the exported web app
on `TEST_WEB_URL` (default localhost:8083), Python in `.venv` (or `TEST_PYTHON`), and
Playwright/Chrome (`PLAYWRIGHT_MODULE` if installed outside the client).

After the round, a central **Game result** button reopens the result sheet. The
points summary comes first, followed by each player’s arithmetic and scoring-card
evidence, then the winning declaration and final discard. Tunnela evidence may
overlap Maal evidence because its bonus is additive; Marriage combinations and
individual Maal allocations remain disjoint.
