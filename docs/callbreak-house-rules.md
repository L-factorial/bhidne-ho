# Call Break house rules and pre-match agreement

Status: standalone policy, review/redeal commands and optional settings-agreement coordinator are implemented. See the [implementation guide](callbreak.md). The implementation adopts the previously proposed default of a whole-deal restart before bidding; restarting only a trick is not supported. Platform lobby/browser controls remain future work.

## Defaults and exact eligibility

Keep the immutable domain policy in `callbreak/house_rules.py`, separate from trick legality in `callbreak/rules.py`. It imports card types and standard-library types only.

| Setting | Proposed default | Allowed choices |
| --- | --- | --- |
| Weak-hand restart | Enabled | Enabled / disabled |
| Weak-hand threshold | Jack | Jack / Queen |
| No-spade restart | Enabled | Enabled / disabled |
| Combination | Either enabled condition qualifies | Fixed OR behavior initially |
| Activation | Eligible player claims voluntarily | No automatic forced restart |
| Restart scope | Whole deal, before bidding | Fixed for this version |
| Who can propose settings | Any seated participant, including admin | Any participant / admin only |
| Agreement | Every seated participant accepts the exact settings revision | Required before starting |

“No card greater than Jack” means every card has rank <= J: Q, K, or A prevents this weak-hand claim. With Queen selected, every card must be <= Q: K or A prevents it. Rank comparison ignores suit. A low spade does not prevent a weak-hand claim, but any spade prevents a no-spade claim. A player with an ace and no spades can still qualify through the independent no-spade rule.

Suggested domain type:

```python
@dataclass(frozen=True)
class RedealPolicy:
    weak_hand_enabled: bool = True
    weak_hand_threshold: Rank = Rank.JACK
    no_spades_enabled: bool = True
```

Validate thresholds and actual boolean types at configuration construction. An eligibility function `redeal_reasons(hand, policy)` returns zero or more typed reasons, `WEAK_HAND` and `NO_SPADES`. Evaluate the original, fully dealt hand before cards are played. Never evaluate a shrinking hand late in a deal, when almost anyone could become eligible. The engine computes eligibility; it does not trust a player's declaration.

## Pre-match editing and agreement

The optional `callbreak/setup.py` MatchSetup coordinator owns the local player roster, admin, candidate GameConfig including RedealPolicy, settings revision, and participant acceptances. The future platform lobby maps users to these local players, authenticates actors, and serializes coordinator updates.

1. A participant proposes a valid settings change. Apply it atomically against the expected setup revision. Unseated spectators cannot edit.
2. The lobby publishes the complete resulting settings and increments their revision. Every settings change clears earlier acceptances. Roster or editing-permission changes also clear them.
3. Every participant explicitly accepts that exact revision; accepting an earlier revision does not count.
4. The existing authorized match-start action checks all current participants have accepted and freezes the roster and settings in one atomic operation. There is no admin bypass of agreement.
5. Create the standalone engine with the agreed immutable GameConfig. The core need not know who the admin is or how the group reached agreement.

Any-participant editing means anyone seated can propose a change; one person cannot silently impose a new rule on everyone. Admin-only editing can itself be proposed as a setup policy and must be visible in the final accepted configuration. Settings are public; authentication credentials are not part of setup messages.

Once started, reject settings changes. A rematch can use a fresh proposal based on the previous settings. Do not change eligibility after players have seen the cards.

## Proposed whole-deal restart lifecycle

The implementation inserts a HAND_REVIEW phase after every distribution whenever either restart rule is enabled:

```text
StartDeal(deck)
    → HAND_REVIEW
        → each player: AcceptHand or ClaimRedeal
        → all accept: BIDDING
        → valid claim: AWAITING_REDEAL
            → controller: Redeal(deck)
            → HAND_REVIEW for fresh hands
```

When both options are disabled, proceed directly from distribution to BIDDING as in the base design.

- `AcceptHand` is available to each seated player once per attempt, in any order. It waives that player's restart right for that attempt. Their acceptance cannot be withdrawn. No bid or card play is accepted during review.
- `ClaimRedeal` is accepted only in HAND_REVIEW, before that actor accepts. The actor must satisfy at least one enabled condition. Invalid claims preserve the entire state.
- One valid claim is sufficient because the group already agreed to this right; no second vote is required.
- A successful claim closes the attempt and enters AWAITING_REDEAL. Further claims or acceptances from that attempt reject. The next submitted deck comes only from the trusted controller.
- `Redeal(deck)` validates a complete fresh 52-card permutation, reclaims all old hands and undealt cards, redistributes, and clears review acceptances. It is separate from StartDeal so it cannot increment the deal number or rotate the dealer accidentally.
- The deal number, dealer, opening bidder, previous deal scores, and five-deal match limit remain unchanged. Increment a `deal_attempt` counter. The abandoned attempt has no tricks or scoring result.
- Clear all prior-attempt suit deductions. Each player receives only their new hand; the old hand disappears from their current view.
- No restart after bidding starts or during tricks under this proposal. A same-trick restart would require separate semantics for exposed cards, ownership restoration, leadership, and scoring; these are outside the implemented full-deal policy.

The original proposed default has no arbitrary retry cap: an eligible player retains the agreed right on every fresh attempt. Do not silently remove it after a number of retries. A future cap needs an explicit group-approved exhaustion policy. Engine processing is one command at a time, never an internal reshuffle-until-good loop. Scheduling, disconnects, waiting, and match cancellation remain host concerns.

## State, outputs, and privacy

Extend the standalone state with deal attempt, review acceptances, and the frozen policy. Current player is None during HAND_REVIEW and AWAITING_REDEAL; multiple players may review, so expose allowed actions per viewer rather than inventing a single current player.

Add `AcceptHand` and `ClaimRedeal` player commands and trusted `Redeal(deck)` control command. Revision advances once per accepted command, including reviews and claims. Platform commands include match, deal, attempt, and expected revision so a delayed acceptance or play cannot apply to replacement cards. A stale review can be retried after fetching the latest snapshot; prior command IDs must still deduplicate.

Public outputs: `HandAccepted(player)`, `RedealRequested(player, deal, attempt)`, and `HandsRedealt(deal, new_attempt, counts)`. The actual reason stays in the claimant's private result by default; no other hand or undealt card is exposed. A public claim necessarily reveals that at least one agreed eligibility condition holds. Eligibility and available review actions are otherwise private fields in that player's view.

On the final acceptance, emit HandAccepted followed by TurnChanged for the first bidder. On claim, emit RedealRequested and no active-player event. On replacement distribution, emit HandsRedealt and one private HandDealt output per player. Review status is in snapshots; bidding starts only after the new attempt's acceptances.

Authoritative replay retains each supplied deck, attempt boundary, and accepted review/claim command. Abandoned attempts are trusted audit records, separate from completed scored deals. They do not contribute to card conservation for the active attempt or cumulative scores. Public logs never include abandoned full hands.

## Verification additions

- J threshold: a maximum J qualifies, Q/K/A each disqualify; Q threshold: Q qualifies, K/A disqualify.
- No-spade condition: zero spades qualifies, one spade disqualifies regardless of rank.
- Conditions work independently and with OR semantics; disabled conditions cannot justify a claim.
- Editing and roster changes invalidate old acceptances; start cannot race with an edit or bypass a missing acceptance.
- Ineligible, duplicate, waived, stale-attempt, post-bid, and out-of-phase claims reject without mutation.
- A valid claim preserves scores, deal number, dealer and opening bidder; replacement resets all hands, deductions and acceptance state.
- Multiple claims are serialized; only the first accepted claim closes the attempt.
- Four- and five-player replacements conserve all 52 cards including the undealt pile.
- Private eligibility, full hands and audit decks do not appear in public outputs.
- Replay remains deterministic across abandoned attempts. Existing base command totals (285 / 280 revisions) apply only with the review extension disabled; with it enabled, count every accepted review, claim and replacement command.

Python domain modules are implemented. Platform lobby controls and browser UI are not implemented.
