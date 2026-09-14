# Chat access and rule approval

Room chat uses the existing bounded, in-memory history and authenticated profile
names. The notification strip appears in the room and live game view; selecting
it expands a docked chat panel with an explicit Close button. The collapsed dock
is a compact bottom bar on mobile and a bottom-right panel on wide screens; it
remains at the screen edge while the room scrolls. Notification, unread and
draft state survive moving between those views. The server checks access for
both reading and sending, independently of which screen is open.

| Viewer state | Chat |
| --- | --- |
| Seated before start, including a locked roster | Enabled |
| Seated during active Flush or Marriage | Disabled |
| Seated during an active Call Break deal | Disabled |
| Call Break deal complete, before next deal starts | Enabled |
| Finished/ended game or Flush between hands | Enabled |
| Observer or queued room member, including while watching | Enabled |

Call Break's between-deal chat exception is separate from match participation:
it does not release seats or permit active-match room departure. Existing private
pokes and whole-table pokes remain separate from room chat.

## Rule proposals

The existing settings routes validate creator edits, then propose changes instead
of immediately replacing rules when other players are seated. Snapshots expose
`rule_proposal`, including previous/proposed values, status, eligible voters,
accepted votes and the viewer's `can_vote` capability. Everyone in the room receives
updated game snapshots and can open the review strip; only seated voters see
Accept/Reject controls. The review shows the specific changed values.

The creator's submission counts as their acceptance. Every other currently seated
player must accept before the validated settings become active. A single rejection
resolves the proposal as rejected and leaves the old rules unchanged. A creator
alone can apply settings immediately; players joining later see those settings.
A roster change cancels a pending proposal, requiring the creator to propose again
for the new roster. This prevents votes from silently transferring to a new seat
owner. Disconnect and navigation do not change the roster or votes.

`POST /test-games/{room_id}/rule-vote` accepts `match_id`, `proposal_id` and a strict
boolean `accept`. Match/offer identity, room membership and voter eligibility are
rechecked under the existing match lock. Repeated identical votes are safe;
resolved or obsolete proposals cannot change settings. Only one proposal can be
pending. Lock/start reject pending proposals, and the client disables those actions.
Rejection or cancellation allows starting with the unchanged rules.

Events are `RULE_CHANGE_PROPOSED`, `RULE_CHANGE_ACCEPTED`, `RULE_CHANGE_REJECTED`
and `RULE_CHANGE_CANCELLED`, delivered through the existing `TABLE_EVENT` channel.
Snapshots remain authoritative, including for observers joining after the event.
Settings retain their existing pre-game edit window; this does not permit changing
rules in the middle of a match. Flush increments its saved rules revision only
when a proposal is accepted, preserving stale-rule start validation.

## Flush rule details

- **Initial blind bet** is configurable; the seen minimum uses its configured
  multiplier.
- **Side-show** can be enabled/disabled. The threshold counts each player's own
  completed bets, including blind and seen bets, excluding boot. It is not a
  table-wide round counter.
- **Raise limit:** there is no fixed maximum raise rule. A legal bet must meet the
  current minimum and cannot exceed that player's remaining chips. The UI offers
  minimum and double-minimum actions. No new cap is introduced here.
- **Boot:** every player pays the configured boot once per hand; zero disables it.
  The chosen policy remains everyone-pays. No rotating single payer is introduced.

## Validation

`tests/test_rule_proposals.py` covers all three games, player-only votes, unanimous
acceptance, rejection, retries, stale IDs, roster cancellation, pending lock/start,
active-player chat restrictions, observer/waiter access, and an actually played
Call Break deal followed by chat closure at next-deal start.
`client/tests/browser/chat-rules.cjs` checks notification strips, overlays,
private player access restrictions and rule review/accept/reject in real desktop
and narrow browser sessions against the backend.

Verification: 663 backend tests and 43 frontend unit tests pass; TypeScript checks
pass. The real-browser chat/rules test passes for all three games. Existing browser
rule-editor fixtures have been updated to the proposal wording.
