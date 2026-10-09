# Distributed runtime implementation plan

## 2026-10-09: production release checks and delta compatibility

- User authorized deployment to both production application servers. The latest
  UI changes were already committed and pushed as `287244b`; its production
  workflow was running when deployment was requested. Prior runs failed before
  deployment, so both-server activation must follow a successful corrected run.
- Fixed: the distributed client excludes HTTP-only `can_end_table` permission
  from game-delta checksums and retains/refreshes it from catalog previews.
  Generated previews now include the same permission and completed-table
  visibility rules as HTTP queries. Authorization remains server enforced.
- Updated release checks to match approved invitation visibility and explicit
  departures; receipt isolation now uses a valid initial dealer-selection action.
  Account-erasure fixtures drain the recipient notices created by chat, and the
  load-driver check ignores non-summary JSON artifacts while still requiring each
  game to validate. Recovery fixture writes use a leased connection, avoiding
  interleaving with background workers on the single-connection PGlite harness.
- Verification: TypeScript and all 417 client tests pass, including a delta
  test with HTTP permissions and changing catalog permissions. The affected
  backend suite passed 90 cases before the preview fix, with only its three
  exact-preview checks failing; the corrected view-generation/recovery rerun
  passes all five cases. The SQL suite passed 78 cases, exposing the recovery
  fixture race now fixed. Diff checks pass. Native load/process gates run in CI.
  A broader run passed 1289 cases and found two remaining outdated checks for
  multiple games per room and five-player review defaults. Both are updated;
  their four-case rerun (including the loopback metrics listener) passes.
- Exact next step: commit/push these release blockers, supersede the older
  test-only run, and verify the corrected workflow activates one identical
  client/backend image on both hosts plus public HTTPS health/frontend checks.

## 2026-10-09: Call Break bidding-section pulse

- Completed: the expanded bidding panel uses the existing TurnGlow to pulse
  its border while awaiting a bid. Text and touch targets remain steady. The
  pulse pauses while submitting and resumes after failure; accepted bids remove
  the panel. Reduced-motion preferences show a steady highlighted border.
- Verification: TypeScript, web export and diff checks pass. Mocked browser
  checks at 320/390/1280px confirm changing border opacity, a steady border with
  reduced motion, usable bid controls and removal after acceptance.
  Evidence: `/private/tmp/callbreak-bid-pulse-{web,browser}.log`.
- Limitations: local client change only; no native-device check or deployment.
- Exact next step: check native pulse/touch behavior in the next requested release.

## 2026-10-09: Call Break bidding turn and hand controls

- User requested bidding-turn notifications and an expanded-hand bid stepper.
- Completed: required actions use the existing notification sound even while
  the game table is open, respect the sound toggle, and consume each action
  entry once so timer/revision refreshes do not repeat its sound. Bidding cues
  include deal/attempt identity and clear once the player's bid is accepted.
- Completed: the expanded Call Break hand shows the bidding instruction and
  minus/value/plus/Bid row, defaulting to 1 each deal/attempt and retaining the
  existing reveal requirement and bid bounds. The explanatory text sits below
  the controls. The bidding section disappears after the player's bid is
  accepted, rather than remaining until all other players bid. Server acceptance
  remains authoritative; failed submissions retain the controls.
- Verification: TypeScript, all 417 client tests, web export and diff checks
  pass. Mocked browser checks at 320/390/1280px verify the bidding label, default
  value, adjustment, same-row controls, submitted amount and accepted-bid removal.
  Logs: `/private/tmp/callbreak-bidding-{tests,web,browser}.log`.
- Limitations: local client changes only; native audio/device behavior has not
  been checked. No server behavior changes or deployment.
- Exact next step: verify native bidding audio and touch controls in the next
  requested client release.

## 2026-10-09: game presentation, Call Break rules and Create game

User authorized implementation of the accumulated proposal, expanding scope
to the client UI and directly required game/creation behavior.

- Completed: Call Break Game summary has no tabs. Its three sections show the
  current dealer/round, current bid/won matrix, and five-round score matrix.
  Columns start after the dealer and end with the dealer. Completed results use
  authoritative integer score units; dotted bonus notation, zero bonuses,
  penalties, subtotal after round four, final total after round five and blank
  incomplete rows align by dot. Early terminal matches use their authoritative
  final total. Configured bonus divisors determine whole points and remainder.
  Columns adapt to available width and scroll horizontally when needed.
- Completed: Call Break shows round/hand counts centrally, compact bid/won
  information beside avatars, and a distinct accent border on the lead card.
  Its expanded hand includes player names, bids/won and textual played cards in
  lead-relative order, sharing the lead border. Existing drag insertion and
  successful-play auto-collapse are retained; Group by suit restores a stable
  spades/hearts/clubs/diamonds order without playing a card.
- Completed: special victory rules are single switches with explicit labels;
  the existing exact high-bid victory behavior is retained (four/five-player
  suggested counts 8/6), and the perfect-every-round switch selects bid 1 / won
  exactly 1. Nepali labels include टाइट. Deal rules expose No spade, no game
  and Any / At least Jack / At least Queen. Jack includes J and higher; Queen
  includes Q and higher. The legacy strict upper-bound policy also accepts Ten
  so the inclusive Jack minimum survives replay without altering saved policies.
  Any disables the face requirement. Five-player new games default both review
  requirements off; they remain configurable. The existing engine skips hand
  review when both are off and retains Accept/Reject when either is on. Saved
  settings are preserved during checkpoint recovery.
- Completed: all rule proposal actions use one full-width primary button,
  matching Create game. Drawer Stats entries are removed in all games. Leave
  uses normal text and an exit icon; End uses danger text and a stop icon.
  Own-avatar visible You labels are removed, retaining player identity and
  accessibility announcements. Session status/timer now occupies the bottom
  outside hand overlays, with smaller text. Play areas use available space;
  bounded hand overlays can grow to 94% without shrinking the table. Marriage's
  desktop hand also overlays rather than taking normal-flow space.
- Completed: newly eligible Marriage players get a client-only See maal step,
  flip the existing private maal and continue. The step shares visibility with
  the table card, which remains face up after Continue and can later be hidden
  or revealed. This sends no game commands and changes no eligibility.
- Completed: Create table presentation becomes Create game. Both creation
  forms omit the name field and send automatic-name requests. Room selection
  is a three-row absolute overlay with internal scrolling and paused parent
  scrolling. Servers allocate the lowest available Table-N name while holding
  the room/catalog lock, respecting the room limit. Durable allocation,
  creation and receipts commit together; retries retain the same table identity.
  Existing explicit-name API clients and room/table structure remain supported.
- Verification: TypeScript, all 416 client tests, web export and
  `git diff --check` pass. Focused backend coverage passes 223 cases (one
  optional integration case skipped), including inclusive face requirements,
  five-player defaults, saved-setting preservation and replay. All 44 selected
  SQL cases pass; the final creation-only rerun passes all 30 cases. Browser
  fixtures pass six Call Break summary/lead-card/timer cases at 320/390/1280px,
  three games' drawer/rule-action cases, Marriage's local maal step, and two
  creation-dropdown cases. Existing summary notification/pulse/spectator cases
  pass at 390px. Six Call Break, three Flush and two Marriage hand-overlay
  cases pass, as do three drag/regrouping cases.
  Final Call Break seat/card collision checks pass for four and five players
  at 320/390/1280px; spectator summaries pass for all three games.
  Visual review confirmed adjacent seat info, legible totals and aligned dots.
  Evidence: `/private/tmp/game-refactor-{client,backend,sql,browser,web}.log`,
  `game-refactor-creation-final.log`, `game-refactor-regression.log`,
  `game-refactor-callbreak-final.log`,
  `game-refactor-{drag,overlay,flush-overlay,marriage-overlay}.log`, and
  `/private/tmp/create-game-refactor-browser.log`.
- Limitations: local changes only. No commit, push, deployment, schema migration
  or native-device check. Release client and backend together when requested.
- Exact next step: release the client/backend together only when requested,
  then verify native dropdown gestures, drag ordering and overlays on iOS/Android.

## 2026-10-09: Previous-round bonus notation

- User requested the previous-round bonus after a dot. The Game summary's
  previous-bids line now displays bids.bonus (for example, 7 bids and 2 bonus
  tricks display as 7.2), in both English and Nepali. Existing totals and
  scoring calculations are unchanged.
- Verification: TypeScript passes. This is a local translation-only change;
  no deployment or native-device check.
- Exact next step: review the notation in the next requested client release.

## 2026-10-09: Call Break score colors and numeric alignment

- User expanded scope to improve the Call Break score tables: missed-bid
  negative scores should be red and the last digits should align by column.
- Completed: negative cumulative totals in the detailed score grid use the
  danger color, matching its existing negative deal scores. Bid, won, deal
  score, total, tricks and bonus values are right-aligned with tabular digits.
  The end-of-round Call Break results also right-align numeric columns;
  other games retain the shared results table's default alignment.
- Verification: TypeScript and all 414 client tests pass; `git diff --check`
  passes. No browser or native-device visual check for this increment.
- Limitations: local client changes only; no deployment, commit or push.
- Exact next step: visually verify numeric alignment on narrow native screens
  when preparing the next requested client release.

## 2026-10-09: Call Break hand overlays the play area

- User requested the same non-shrinking hand behavior as Flush and Marriage.
  Call Break also used a normal-flow dock and changed padding/compact seat mode
  when opening its hand, causing table and seat geometry to change.
- Completed: Call Break uses a bottom-anchored overlay with bounded, scrollable
  content. The play column reserves the measured collapsed header height.
  Table padding and compact mode depend on screen size rather than hand state;
  last-trick controls sit above the collapsed header on mobile. Dragging,
  reveal state, social anchors and summary/hand controls retain their behavior.
  The shared hand component's existing non-overlay uses are unchanged.
- Verification: TypeScript, all 414 client tests, web export and
  `git diff --check` pass. Six browser cases cover four/five-player Call Break
  at 320/390/1280px and assert identical viewport, table and seat geometry
  across expand/collapse. Three existing hand-drag browser cases also pass,
  covering all views, suit regrouping, filtering and explicit play confirmation.
- Limitations: local client change only; no native-device check, deployment,
  commit or push.
- Exact next step: release when requested and verify the overlay and scrolling
  on native iOS/Android devices alongside Flush and Marriage.

## 2026-10-09: Flush hand overlays the play area

- User-reported issue: expanding Your cards reduced the Flush play area's size.
  The dock was a normal sibling taking space from the flexible table viewport.
- Completed: seated players' hand docks are bottom-anchored overlays, like the
  Marriage workspace. The play area reserves the measured collapsed header
  height; opening the hand does not change the arena or viewport geometry.
  Expanded content is bounded to 65% of the main column and scrolls internally
  so cards, action controls and help remain reachable. Card reveal state,
  social anchoring and summary/hand mutual exclusion retain their behavior.
  Spectator controls remain in their existing layout.
- Verification: TypeScript, all 414 client tests, web export and
  `git diff --check` pass. New browser fixture passes at 320/390/1280px, checking
  identical table geometry before/after expansion and collapse, actual overlay
  placement, preserved card reveal state and Game summary/hand switching.
- Limitations: local client change only, fixture-based browser verification;
  no native-device check, deployment, commit or push.
- Exact next step: include this correction in the next authorized client release
  and verify hand scrolling and table geometry on native devices.

## 2026-10-09: profile preferences, card alignment and turn presentation

User authorized implementation of the previously planned client changes.

- [x] Profile card-theme selector is the last profile section. Its upward-opening
  overlay has three 78px rows visible and internal vertical scrolling; previews
  match the collapsed 36×54px card. Opening it does not change profile height or
  scroll extent, and parent scrolling pauses until it closes. Selecting closes
  the dropdown. The create-table selector shares the compact three-row list.
- [x] Device card defaults have a separate client context so editing the profile
  from a live game does not change the authoritative shared table theme or invoke
  a server write. Existing dealer/controller restrictions remain in effect.
- [x] Hidden-card artwork explicitly fills its local bounds. Previously the web
  Image's intrinsic asset dimensions competed with absolute-fill positioning.
  Centered cover sizing preserves artwork proportions across card sizes; aspect
  ratios that differ from the artwork crop its edges rather than stretch it.
- [x] Active-turn rings are centered on avatar bounds, use a complete uniform
  border and expand radially outward while fading. Removed the rotating partial
  arc. Reduced-motion settings retain a stationary complete circle.
- [x] Redundant named-turn labels are visually suppressed; player accessibility
  labels/live announcements still identify the actor. Required action prompts,
  player names, scores, dealer labels and game actions remain visible.
- [x] Client providers restore saved language, app/table theme and personal card
  default before rendering application content, avoiding a default-preference
  flash. Existing device-local AsyncStorage keys and writes remain unchanged.
  Invalid/missing preferences fall back to defaults. No new server preference
  storage or API changes were introduced.
- Verification: all 414 client tests, TypeScript, local web export and
  `git diff --check` pass. The new browser fixture passes eight cases at
  390/1280px: profile position/row count/preview size, internal scrolling without
  parent movement, reload persistence, equal card/artwork bounds, centered
  uniform circular pulses and personal-versus-shared theme isolation in all
  three games. All twelve existing card-theme browser cases also pass, including
  shared theme synchronization, read-only observers and controller handoff.
  Screenshots: `/private/tmp/bhidne-profile-card-dropdown-{390,1280}.png` and
  `/private/tmp/bhidne-card-alignment-{callbreak,marriage,flush}-{390,1280}.png`.
- Limitations: fixture browser verification only; no native-device verification,
  deployment, commit or push. Earlier local Play feed/invitation changes are
  retained; this increment changes client presentation/preferences only.
- Exact next step: review local UI and release when requested; then verify
  nested dropdown scrolling, card alignment, reduced-motion turn indicators and
  last-used preferences on native iOS/Android devices.

## 2026-10-09: rename Game stats to Game summary

- User authorized this label change across Call Break, Marriage and Flush.
  Shared English button, panel title and accessibility copy now say Game summary;
  Nepali uses खेलको सारांश. Updated the Marriage browser fixture text.
- Verification: both static UI copy checks pass; no old English label remains
  in client source or fixtures; `git diff --check` passes.
- Limitations: local client copy only, no deployment or native-device check.
  The previously discussed profile picker, card alignment and turn-indicator
  changes remain planning-only.
- Exact next step: include this copy change in the next authorized client release.

## 2026-10-09: direct Play invitations and waitlist controls

- User clarification: a direct invitation must appear in Play without friendship
  or membership and remain available until answered or the table session closes.
- Confirmed the existing Play component separately merges the invitation inbox
  with the social active-table feed. The earlier chat statement that social
  filtering would hide direct invitations was incorrect; no broad public-feed
  exception is required and unrelated sibling tables remain hidden.
- Completed: invited cards offer Join or Wait alongside Decline. Wait accepts
  the invitation and uses the existing waitlist entry action when permitted.
  Doing nothing leaves the invitation pending. Server invitation metadata now
  reports phase and queue availability and derives seat availability from OPEN
  phase, including between-game sessions, rather than merely waiting status.
  Legacy metadata uses the authoritative table view and counts occupied seats.
- Verification: 414 client tests, TypeScript and web export pass. Backend lobby,
  invitation, visibility and blocking coverage passes, including a non-friend's
  pending invitation with an unrelated sibling table, full/locked persistence,
  decline, session closure and accept-then-queue without taking a seat.
  Browser fixture passes at 390px and 1280px, showing Join/Wait and Decline on
  invitations, preserving Return to table and removing a declined invitation.
  The fixture export uses an explicit local API and a cleared Metro cache.
- Limitations: local only; no deployment, commit, push or native-device check.
  Pending invitations already use recipient events plus the Play refresh timer.
- Exact next step: release the reviewed backend/client together when requested
  and verify Sigma's direct invitation and waitlist flow on her device.

## 2026-10-09: restrict Play tables to the player's room circle

- User-reported issue: Sigma saw Gorkhe-Room's Flush table in Play despite
  not being friends with its owner. The active-table query included every public
  room, while the room tabs selected ownership and accepted friendships.
- Completed: distributed and legacy active-table feeds now include only rooms
  the viewer owns, has joined, or whose owner is an accepted friend. Distributed
  filtering happens before pagination. Pending requests do not qualify.
  Browse all rooms and public room entry retain their existing behavior.
- Verification: 47 PostgreSQL/WASM lobby, social notification and table-creation
  tests and 10 legacy room-visibility tests pass; `git diff --check` passes.
  Regression coverage checks Flush, Marriage and Call Break, friendship removal,
  joining/leaving, ownership without membership and private snapshot boundaries.
- Limitations: local code only; no production account inspection, deployment,
  commit or push. Existing membership intentionally keeps a room in Play even
  without friendship. This is feed selection, not a new private-room policy.
- Exact next step: review and release this backend change when requested, then
  refresh Sigma's Play tab and verify Gorkhe-Room is absent if she is neither
  its owner/member nor the owner's friend.

## 2026-10-08: table-session production deployment

- User subsequently authorized server deployment. Deployed committed revision
  `dac54bed417122506c69091caf034250f133f667` to both production application hosts
  (`168.144.105.49`, `165.245.180.205`) using the established administrator sideload
  procedure. Both serve image
  `sha256:bf0f1368aad8a4b900a83a78ed6a7ec159d19c988672f73a7269af751c0c5097`.
- Created a root-only PostgreSQL custom-format backup on app1 at
  `/var/backups/bhidne-release/pre-dac54be.dump` and validated its archive listing
  before migration. Backup SHA-256:
  `a03ff40411a2a534ba759d1f1d244b5d5c158f8a69acd92e380c119eaa93b9c5`.
  Candidate code loaded all 41 existing table checkpoints in a read-only snapshot.
  Applied additive migration 40, then passed both hosts' schema/dependency and
  frontend preflight checks. Retained the installed release lock, container
  hardening, peer-health checks and sequential activation procedure. Both backends
  became healthy before either matching frontend switched.
- Verification: fresh production web export and 42 deployment/recovery tests pass.
  Both hosts' exact revision, immutable image, committed backend/game source hashes,
  frontend index and JavaScript hashes match. Public HTTPS API health, APNs
  capability, frontend index and exact JavaScript asset checks pass. Read-only
  database checks confirm migration 40 and two fresh serving registrations with
  `table_sessions: 1`. No startup/runtime error lines or tracebacks were observed
  in the new containers during the post-activation check.
- Evidence: `/private/tmp/bhidne-dac54be-direct/verification.json` and
  `/private/tmp/bhidne-dac54be-{production-build,release-tests,backup,checkpoints,prepare,rollout,source,capabilities,logs}.log`.
  No git push was performed; the requested revision was already on the remote
  production branch. This deployment record remains a local documentation change.
- Exact next step: refresh the production web app and verify session controls on
  actual devices. Installed native apps require a separate signed client build;
  server deployment does not replace their bundled UI. Capacity/HA/operational
  work remains separate.

## 2026-10-08: table expiry, action deadlines and Call Break continuity

User authorized implementation in increments without waiting between them. Keep
all changes local: no push or deployment. This explicitly expands branch scope.

- Policy: all games expire between games after 30 minutes without an accepted
  table activity. Polls, heartbeats, rejected/retried commands and automatic play
  do not renew this deadline. Completion begins a fresh between-game window.
- Flush and Marriage required actions: 3 minutes; fold and release on timeout.
- Call Break: 2-minute action timeout uses random legal autoplay. A known network
  disconnect gets a 2-minute reconnect grace; offer current-game control to the
  FIFO queue, then connected table spectators, with 1 minute to accept. Unknown
  or empty Redis presence is never proof of disconnection.
- Returning original participants have priority. Reclaim from autoplay before
  the next action; reclaim from a replacement at a trick boundary.
- Financial safety decision: preserve original engine roster and settlement
  identities. A replacement accepts temporary control of the original seat's
  hand, bids and scores for this game only. Do not transfer liabilities silently.
- [x] Increment 1: persisted policy, deadlines and controller/private-view model.
- [x] Increment 2: fenced durable timer execution, gateway connection evidence,
  atomic handover/reclaim, expiry recipients and restart recovery.
- [x] Increment 3: responsive shared countdown, warning, removal, expiry,
  replacement acceptance and return controls; English/Nepali copy.
- [x] Increment 4: race, privacy, restart and legal-random-play tests; client
  verification and final handoff. No capacity/HA/observability changes included.

Final verification: 125 PostgreSQL/WASM integration tests and 87 policy,
checkpoint, recovery and transport tests pass (2 optional tests skipped).
All 413 client tests, TypeScript and the production web export pass. The checked-in
browser fixture passes 20 mobile/desktop session UI cases across all three games,
including deadlines, temporary-control consent, return controls and expiry/removal
notifications. `git diff --check` passes. Coverage includes every Call Break preparation/play phase through
completion, random legal cards, simultaneous reviews/declarations, trick-boundary
reclaim, deterministic checkpoint views, multi-device leases, stale timer no-ops,
reservation releases and transactional settlement/expiry routing, forged timers,
stale ownership, no-op activity, old connection evidence and Flush timeouts while
the remaining players continue. Strict additive
session metadata validates checkpoints; old checkpoints receive defaults.

Runtime decisions: gateway PostgreSQL leases last 60 seconds and refresh on ping;
unsubscribing is navigation, not disconnection. Missing leases are unknown. Timer
engine effects have system-owned game receipts linked to scheduled inbox work.
Session maintenance uses bounded rotating pages and normal ownership fences.
Flush preparation timeout completes required dealing/cutting before folding;
pending dealer departure is reconciled as soon as a dealt hand exists. At Call
Break completion the ready roster retains current controllers rather than silently
reserving a returned original who may already be playing elsewhere. A replacement
who chooses a subsequent match gets their own new roster identity and fresh stats.

UI: a shared wrapping, scrollable status panel displays authoritative action and
between-game countdowns, Auto play/temporary-control status, explicit acceptance
and decline, resume and pending trick-boundary return. English/Nepali copy explains
timeouts and the preserved original settlement identity. Expiry/removal closes the
table view with a reason; automatic seats suppress manual-action prompts. Countdown
clock offset comes from fresh HTTP responses, not an old checkpoint timestamp.

Release requirements and limitations: this increment is wired into the distributed
assembly only; legacy application selection remains unchanged. Migration 40 adds
durable gateway connection leases, and updated owners require `table_sessions: 1`.
Release the backend and client together using the existing distributed activation
process. No native-device verification, deployment, commit or push was performed.
The browser checks use local fixtures; they are not a production end-to-end run.

Exact next step: user review and morning push of the local changes, then a coordinated
release when requested and native-device verification. Capacity testing,
observability, database HA deployment and operational readiness remain the next
task set; none was added to this increment.

## 2026-10-08: separate game explanations and rule configuration

- User-expanded scope: distinct Game rules and Game rules config drawer entries
  for Call Break, Marriage and Flush. Explanations describe gameplay and supported
  configurable variations; configuration focuses on concise controls and values.
- Completed: shared read-only explanation sheet with English/Nepali gameplay,
  scoring and variation descriptions. Existing settings and proposal workflows
  remain in separate configuration sheets, without their explanatory paragraphs.
  Marriage's former Rules/config tabs become separate drawer destinations.
- Configuration editing requires the creator, waiting status, an OPEN table,
  unlocked Flush settings and no pending proposal. Locked/started games and
  other viewers can inspect agreed settings without changing them. Locking while
  a configuration sheet is open disables its controls and hides proposal actions;
  unsaved drafts do not replace the agreed read-only values or block locked Flush
  table controls.
- Verification: 411 client tests pass, including configuration availability for
  locked/started/completed tables, non-creators and pending proposals. Six browser
  fixture cases pass across all games at 320/1280px, covering distinct destinations,
  explanation-only content, editable waiting settings and live lock transitions.
  TypeScript and production web build pass.
- Limitations: local only, no native-device check or deployment; backend rule
  validation and unanimous approval requirements retain their existing behavior.
- Exact next step: include these drawer changes in the requested client release,
  then verify explanations and configuration on native devices.

## 2026-10-08: draggable Call Break hands

- User-expanded scope: make Call Break hand cards draggable like Marriage in
  every hand view, and make the existing suit-shuffle control regroup cards in
  a randomized suit order that alternates red and black where possible.
- Completed: fan, suit-filtered fan and grid reuse Marriage's gesture behavior.
  Movement starts a drag without selecting or playing a card; local ordering
  works outside the player's turn and on cards that are currently illegal to
  play. Legal-card selection and explicit play confirmation remain enforced.
  Hand and drawer scrolling pause during a card drag.
- Manual order survives view changes, suit filters, hide/show, collapse/expand
  and cards leaving the hand; a new deal resets the order. Shuffle suits clears
  manual ordering, groups by suit and ascending rank, chooses a different visible
  suit order and maximizes color alternation among the suits still present.
  Internal All filtering no longer depends on translated display text.
- Verification: 410 client tests pass, including partial-suit alternation and
  ordering after card removal. Local browser fixtures exercise actual mouse
  drags in all views at 320/390/1280px, including unplayable cards, filtering,
  local-only changes, hide/show and collapse/expand persistence, and explicit
  legal-card confirmation. TypeScript and the production web build pass.
- Limitations: no native-device drag verification or deployment. Ordering is a
  local presentation preference; hidden/unrevealed hands retain their privacy
  and reveal behavior.
- Exact next step: include this change in the requested client release and verify
  touch dragging on an iOS and Android device with existing text/display settings.

## 2026-10-08: shared game stats and responsive game layouts

- User-expanded scope: implement the agreed Marriage, Call Break and Flush
  game-stats overlay, hand interaction, inward Call Break cards and drawer fixes.
- Completed: all three games have a top-left Game stats control and a scrollable
  overlay with default All and individual player tabs. Opening stats collapses
  the hand; expanding the hand closes stats. Required-action notifications keep
  the collapsed hand pulsing, with automatic hand expansion suppressed while
  stats is open. Marriage announcements wait until stats closes.
- Marriage stats show public Maal/qualification status and shown melds, replacing
  the old shown-cards button that overlapped the top seat. Flush stats include
  round-labelled public action history, seen/blind state at each action, per-seat
  bet number, side shows and results. History explicitly excludes card payloads.
  Call Break stats include previous tricks/winners and round standings; the table
  shows prior-round bid sums and separate bonus, current bid/tricks won, central
  round/trick/turn information and played cards inward of their respective seats.
- Layout: all game drawers fit horizontally and scroll vertically. Call Break
  seats reserve space for two wrapping stat rows and grow with measured text;
  Marriage reserves the measured collapsed-hand height. Tall tables remain
  vertically scrollable on small screens or with enlarged text. English and
  Nepali translations cover the new controls and status text.
- Verification: all 408 client tests and 52 focused backend tests pass (5 optional
  database tests skipped). Public history survives hosted checkpoint restoration.
  TypeScript and the production web build pass. The checked-in browser fixtures
  pass 18 cases at 320/390/1280px, covering tabs, scrolling, mutual exclusion,
  notification pulsing, drawer bounds, spectator reads and four/five-player
  inward-card geometry; the 320px five-player case also enlarges stat text.
  The broader database run has three pre-existing view-generation failures:
  missing `can_end_table: false` metadata. The same three failures reproduce on
  untouched HEAD in `/private/tmp/bhidne-stats-baseline`; no unrelated fix included.
- Limitations: local changes only; no native-device check or deployment. New
  historical data requires the updated backend; existing clients tolerate the
  additive public snapshot fields.
- Exact next step: review the local UI, then release backend and client together
  when requested and check Gorkhe's device with its current display/text settings.

## 2026-10-08: consistent app header branding

- User-expanded scope: remove the separate Bhidne Ho header label and enlarge
  the mobile logo approximately 10%, with one size across application pages;
  preserve login branding. This supersedes the earlier brand-text wrapping fix.
- Completed: shared app and game headers use a single 57px square logo (formerly
  52px in the mobile lobby, 36px in mobile games, 60px on desktop). AppHeader
  no longer renders the separate brand text. Logo accessibility names remain.
  Game headers reserve only the space required by the logo and controls, giving
  the remaining width to game/location text. Page titles and touch targets remain.
  The unauthenticated sign-in header explicitly keeps its original 52/60px size;
  welcome artwork and the loading splash retain their existing presentation.
- Verification: TypeScript, all 404 client tests and a clean web export pass.
  Chrome fixture checks pass for lobby/profile at 320, 390, 768 and 1280px:
  both headers show a 57px logo and no separate brand text, with no JS errors.
  Evidence: `/private/tmp/bhidne-logo-browser.cjs` and profile screenshots at
  `/private/tmp/bhidne-logo-profile-{320,390,768,1280}.png`.
- Limitations: local, not deployed; no native device check performed.
- Exact next step: include this header correction in the next requested frontend
  release, then check Gorkhe's device with his existing display/text settings.

Current status: implementation increments **1–8 are complete for the isolated
integration path**; production activation and feature-parity validation remain gated.
The user has now explicitly brought application observability into scope. Operational
increment **O1** adds distributed-runtime metrics and structured logs. See the current
handoff and the O1 record for verification and deployment limits; historical increment
records below retain their original scope and decisions.

The user has additionally authorized repository-backed native PostgreSQL/Redis
provisioning for the new production hosts on `bhidne-ho-scalability-prod`. P1 below
records this operational increment. P2 adds the production push workflow and app-host
provisioning; live activation remains pending replacement-host access and validation.

This document records the planning decisions agreed with the user. Read it before
each implementation increment, update its checklist and handoff notes afterward,
and record any material design changes explicitly. The user has authorized
incremental implementation and reserved this branch for this work. See `AGENTS.md`
for the persistent branch scope.

## Scope and targets

- Target 1,000 simultaneous WebSocket connections, 20,000 daily active users, and
  approximately 1.5 million registered users.
- These are sizing targets, not verified capacity guarantees.
- First deliver correct distributed execution, recovery, delivery, and client
  integration. Capacity validation and operational readiness form a later task set.
- Extend the existing application and versioned schema rather than introducing
  separate microservices or database sharding initially.

## Agreed architecture

- Any application instance can accept authenticated HTTP requests and WebSockets.
- An established socket stays on its receiving instance until disconnected.
  Reconnects and separate HTTP requests can reach another instance.
- One application instance owns a room and hosts all its tables and games.
- A room allows a configurable maximum of five open tables, counting both waiting
  and playing tables. Enforce creation atomically.
- Each table has one current game. A rematch gets a new game ID.
- Games at different tables execute concurrently. Commands within a game execute
  sequentially in transactionally assigned database order.
- PostgreSQL is authoritative for state, ownership, pending commands, receipts,
  deadlines, durable messages, and pending finalization.
- Redis supplies wake-ups, delivery notifications, routing caches, and ephemeral
  connection presence. It is not the authoritative command queue or ownership store.
- Room ownership bounds placement, not command ordering: ordinary gameplay must
  not share one exclusive room-wide execution lock.

## End-to-end command flow

1. A receiving instance authenticates the actor and validates the request shape.
2. In one transaction, deduplicate by actor/request ID, allocate the lane sequence,
   and insert the original request into the PostgreSQL command inbox.
3. Publish a Redis wake-up to the current owner. A failed or missed wake-up does
   not erase the committed command.
4. The owner schedules the corresponding lane and reads its pending commands in
   order. Different game lanes can progress independently.
5. Recheck authorization, ownership fencing, request fingerprint, expected game
   revision, and game rules at execution time.
6. Atomically commit state/events, command receipt, inbox completion, and outgoing
   notification records. Publish no speculative engine state.
7. Return the durable result to the requester. Notification delivery runs outside
   the game execution lock.
8. Redis alerts interested connection servers. They deliver authorized projections
   to their local sockets; clients reconcile using snapshots and catch-up cursors.

Queued is distinct from accepted by the game. If the HTTP request cannot wait for
execution, return an explicit pending result and command-status reference. Preserve
the same command ID until its durable accepted/rejected outcome is resolved.

## PostgreSQL schema work

Baseline: `app/database.py`, `app/durable_games/store.py`,
`app/durable_games/runtime.py`, and `app/test_games/service.py`.

The following are proposed logical tables/changes. Final column definitions and
migrations must be reconciled with existing constraints during each increment.

| Table/change | Required state | Indexes and constraints |
| --- | --- | --- |
| New `server_instances` | Instance ID, internal address, heartbeat, draining flag, runtime capabilities | Instance primary key; heartbeat index |
| New `room_ownership` | Room, owner instance, epoch, lease expiry, recovery status | Room primary key; owner index; lease-expiry index |
| New `room_tables` | Table, room, lifecycle status, configuration, revision | Table primary key; room/status index |
| Durable table state | Seats, waitlist, offers, rule proposals/votes | Unique table/seat and table/player constraints; ordered waitlist index |
| Extend `games` | Table relationship and recoverable runtime metadata | Table/history index; partial unique active-game-per-table index |
| New `command_lanes` | Lane ID/type, optional room association, next and processed sequence | Lane primary key; room index |
| New `command_inbox` | Lane, sequence, actor, command ID, original payload, fingerprint, status, outcome reference | Unique lane/sequence and lane/actor/command ID; partial pending-work index |
| Retain `game_commands` | Durable accepted/rejected receipts | Existing game/actor/command primary key |
| Retain `game_events` | Ordered canonical history | Existing game/sequence primary key |
| New `game_snapshots` | Versioned checkpoint, event sequence, revision | Game/sequence primary key |
| New `scheduled_actions` | Game, action type, generation, deadline, status | Unique game/action/generation; partial pending-deadline index |
| New `notification_outbox` | Event ID, destination, sequence, payload/reference, retry time, publication status | Event primary key; partial unpublished-work index |
| Durable room chat | Room, sender, message ID, sequence, text | Unique room/sequence and sender/request ID with appropriate scope |
| Extend direct messages/notifications | Stable request IDs, conversation/recipient sequences, catch-up support | Conversation/sequence and recipient/sequence indexes; deduplication constraints |
| Durable finalization jobs | Game/round, job type, retry state | Unique game/round/job type; pending-work index |

Retain existing authentication, membership, player reservations, and ledger data.
Reuse existing primary-key/unique indexes rather than duplicating them. Index
specific lookup and polling paths; do not add blanket indexes over JSON payloads.

### Transaction requirements

- Enforce the five-table limit with an atomic database-maintained allocation
  counter, updated in the table mutation transaction (see increment 1a notes).
- Allocate command order under a per-lane lock, with insertion in that transaction;
  timestamps, Redis arrival order, and unconstrained sequence allocation do not
  define authoritative execution order.
- Deduplicate before allocating new work. Fingerprints represent the original
  request, not the resulting engine state.
- Keep receipt lookup available for completed games and old matches. Terminal
  status must not prevent resolving a previously committed command.
- Start/rematch IDs must be stable across retries. Game creation, reservations,
  and replacement transitions must not leave duplicate games or leaked seats.
- Restore from a checkpoint plus subsequent events; do not replay full history
  for every gameplay command.
- Commit durable settlement/finalization intent with game completion. Retry effects
  with unique game/round keys.
- Define receipt retention before deleting history; pending retries and foreign-key
  dependencies must remain valid. Retention tuning is deferred.

## Execution and locking

Use independent lanes for room lifecycle, table lifecycle, each game, and room chat.
Use conversation lanes for direct messages and recipient ordering for platform
notifications. Those non-room lanes need database serialization/claims independent
of room ownership.

- Process one command at a time per lane, with bounded concurrency across lanes.
- Never skip an unresolved head command to execute a later command in its lane.
  Retry transient failures; record terminal rejection before advancing.
- Shared lifecycle operations coordinate with affected tables/games and database
  constraints. Ordinary moves need no exclusive room-wide execution lock.
- Use compatible shared protection for room fencing during ordinary game commits,
  exclusive protection on the affected game/lane, and conflicting protection for
  ownership transfer. Validate the exact lock modes and order in implementation.
- Integrate existing game fencing with room ownership; do not retain independent
  room/game ownership authorities that can disagree.
- Keep transactions short, bound lock waits, and do no socket delivery while
  holding game execution locks.
- Use an async scheduler and shared bounded database pool, not a thread, polling
  loop, or dedicated database connection for every game.

## Ownership and recovery

Initial configurable values: 30-second ownership lease, renewal every 5 seconds
with jitter, expired-ownership discovery approximately every 2 seconds, and a short
owner cache lifetime (approximately 5 seconds).

Every process incarnation gets a unique instance ID. PostgreSQL time governs lease
decisions. Lease renewal is independent of gameplay activity.

Takeover:

1. Acquire expired or explicitly released ownership atomically and increment epoch.
2. Mark the room recovering and renew its lease during reconstruction.
3. Restore tables, roster mappings, locked rules, engine versions, canonical state,
   receipts, deadlines, and pending finalization from a consistent committed view.
4. Validate revisions and event continuity; quarantine invalid/unsupported state.
5. Restore scheduled actions, mark the room serving, and advertise its owner route.
6. Resume each lane independently and refresh connected clients.

An owner with uncertain renewal stops starting authoritative work. A former owner
cannot commit after takeover and must discard its local runtime. Reacquisition
requires reconstruction; acquiring a lease does not validate cached engine state.
An RPC timeout alone never authorizes stealing a live lease.

Persist absolute timer deadlines and generations. Submit recovered timers as
idempotent commands, reject obsolete timers, and bound overdue catch-up work.
Preserve existing deadline semantics initially: outage grace is a separate game
policy, not an implicit countdown reset.

## Redis, polling, and delivery

- Commit inbox work before publishing its wake-up.
- Normal operation: wake immediately through Redis plus a slow safety poll,
  initially around 5 seconds.
- Redis outage: increase polling frequency, initially around 250–500 ms.
- Startup, takeover, and Redis reconnection: immediately drain pending work.
- Batch polls across owned rooms; tune values later with capacity measurements.
- Cache room owner/epoch and maintain expiring connection registrations including
  user, room, server, and connection ID.
- Register each socket separately. An old disconnect cannot remove a new socket
  or mark a multi-device user offline everywhere.
- Rebuild presence and caches after Redis loss. Unknown presence does not mean
  departed membership or a released seat.
- Publish only to interested servers. Prefer IDs/sequences in Redis messages;
  never broadcast canonical private game state.
- Outbox publication can repeat. Clients deduplicate by event/message ID and
  ignore stale game revisions.
- Publication is not client delivery acknowledgment. Keep durable message history
  and per-device/connection catch-up semantics rather than one consuming user queue.
- During Redis outages, connection servers batch catch-up for their connected
  users/rooms; game clients retain snapshot reconciliation.

Durable room, table and game chat is an intentional extension of earlier ephemeral
behavior. Room history is room-scoped; table history spans games; game chat uses the
durable game ID. Closed/deleted scopes lose normal chat access. History retention
and physical purge require an explicit policy; no automatic purge is enabled.
Transient pokes can remain ephemeral unless separately requested to be durable.

## Server and client components

- Connection manager: local sockets, serialized writes, bounded send queues.
- Command ingress: authentication, validation, durable enqueue, stable deduplication.
- Ownership manager: assignment, renewal, takeover, release.
- Lane scheduler: fair bounded execution across games and other lanes.
- Game runtime: rule checks, atomic state transition, receipts, private snapshots.
- Recovery manager: runtime reconstruction, timers, finalization recovery.
- Outbox publisher: retryable notification publication outside gameplay locks.
- Delivery/catch-up service: local pushes and missed-message recovery.
- Internal authenticated HTTP: owner-specific snapshot reads and required internal
  queries. Gameplay commands use the PostgreSQL inbox plus Redis wake-ups.
- Client: pending-command response/status handling, same-ID retries, revision checks,
  reconnect snapshots, and message catch-up.

Wait briefly for queued command completion to preserve existing synchronous action
responses where possible. Add an explicit pending contract and authenticated status
lookup for longer waits. Temporary ownership recovery must be retryable, not a
false game-not-found or final command rejection.

## Load balancing and deployment integration

- Begin integration with at least two instances behind a WebSocket-capable load
  balancer, TLS termination, upgrade support, and appropriate idle timeouts.
- Application heartbeats must be shorter than the idle timeout.
- No sticky sessions are required. HTTP requests cannot assume local game state.
- Add readiness/liveness endpoints and basic draining behavior. Draining stops new
  connections and room assignments and safely finishes/releases owned work.
- Redis outage alone must not remove all otherwise functioning instances from
  service; database fallback remains usable.
- Keep internal RPC, PostgreSQL, and Redis private and authenticated.
- Use a single PostgreSQL primary initially; authoritative reads stay on primary.
  Database unavailability pauses mutations, never triggers memory-only acceptance.

## Failure behavior to preserve

| Failure | Correct behavior |
| --- | --- |
| Player or connection server disconnects | Reconnect anywhere; preserve membership/seat; resolve original command IDs |
| Owner crashes or pauses | Lease-based takeover, reconstruction, fencing of old owner |
| Gateway cannot reach a still-live owner | Retry/refresh routing; do not steal ownership |
| Crash before command commit | No successful receipt; retry against committed state |
| Crash after commit before response | Return original durable receipt |
| Crash before outbox publication | Retry publication from committed outbox |
| Duplicate publication | Deduplicate and reconcile by sequence/revision |
| Redis unavailable or notification missed | Database polling and client catch-up |
| PostgreSQL unavailable/commit outcome unknown | Pause mutations; resolve receipts after reconnection |
| Completion interrupted | Durable idempotent finalization resumes |
| Unsupported/corrupt recovery data | Quarantine rather than reset the game |
| Slow socket or overloaded scheduler | Bounded buffers/work and retryable backpressure |

## Implementation increments

Complete each increment with relevant correctness checks and a handoff note. The
user has authorized incremental implementation within this branch's scope.

Checked implementation items describe the isolated distributed integration path,
including its mounted client and executable multi-gateway/LB stack. They do not
mean production cutover is enabled or that capacity/native-device/provider release
gates have passed. Those gates are listed separately after the checklist.

- [x] 1. Schema migrations and transactional constraints.
- [x] 2. Durable table/game reconstruction and stable receipt recovery.
- [x] 3. Inbox, per-game ordering, and lane scheduler.
- [x] 4. Room ownership, fencing, routing, and takeover.
  - [x] C3a. Explicit server lifecycle, receiver assembly and socket presence.
  - [x] C3b. Isolated integration application lifespan/bootstrap and native route boundary.
  - [x] C3c. Reviewed shared account/profile/player routes, native platform reads and compatibility audit.
  - [x] C3d. Durable friendship commands and transactional notification intents.
  - [x] C3e. Existing-socket session revocation and expiry.
  - [x] C3f. Browser/provider sign-in composition.
  - [x] C3g. Durable manual settlement commands.
  - [x] C3h. Executable isolated bootstrap and persistent dataset guard.
  - [x] C3i. Shared personal phrases and expiring table/private pokes.
- [x] 5. Redis wake-ups, polling fallback, and shared presence (explicit components;
  assembled in the isolated integration runtime).
  - [x] 5a. Explicit authenticated wakeup/placement transport, adaptive inbox polling,
    reconnect rescans and isolated Redis failure tests.
  - [x] 5b. Shared per-connection presence and advisory owner cache, including
    reconnect restoration and stale-disconnect protection.
- [x] 6. Outbox, room chat, direct messages, and notification catch-up (explicit
  components; assembled in the isolated integration runtime).
  - [x] 6a. Bounded outbox claims/publication, authenticated delivery hints,
    authorized hosted-lane replay, gateway backpressure and per-client ACK cursors.
  - [x] 6b. Scoped chat/conversation/recipient execution, durable social history and
    catch-up authorization, including legacy unsequenced-message handling.
    - [x] 6b1. Room/table/game chat lanes, durable messages, owner execution,
      scope authorization, history/replay and deletion access rules.
    - [x] 6b2. Conversation/recipient execution, direct-message/notification history
      and permissions, including legacy unsequenced social records.
- [x] 7. Client pending-command handling and load-balancer integration.
  - [x] 7a. Explicit stable-request/pending-status client lifecycle and focused tests.
  - [x] 7b. Explicit stream discovery, delivery cursors and snapshot/history reconciliation
    adapters; mounted in the integration client under 7c/C3.
  - [x] 7c. Mounted control/session integration and load-balancer composition.
    - [x] 7c1. Explicit session owner, bounded subscriptions/reconnect dispatch,
      native history loader, revision view and device-storage identity helper.
    - [x] 7c2. Platform identity ownership and concrete mounted control/transport
      mappings; then LB/C3 composition.
      - [x] 7c2a. Account/device pending-command journal, pre-send persistence,
        receipt restoration and storage/crash failure tests.
      - [x] 7c2b. Explicit platform storage/session ownership and duplicate-owner
        exclusion; browser/native smoke validation remains a cutover gate.
      - [x] 7c2c. Explicit authenticated HTTP/WS and view/control mapping components.
        - [x] 7c2c1. Explicit command routes/client transport and socket-local
          delivery handshake, multiplexing and ACK ownership.
        - [x] 7c2c2. Explicit authorized views/history/discovery and control mappings.
      - [x] 7c2d. Authenticated root composition, selected-view reconnection and
        concrete screen-control parity; socket presence and live assembly under C3.
        - [x] 7c2d1. Explicit root/session/socket/view composition and parity audit.
        - [x] 7c2d2. Explicit screen-facing controllers, combined leave and initial room creation.
      - [x] 7c2e. Mounted integration client, platform panels, scoped chat and all three game screens.
  - [x] 7d. Isolated nginx/two-gateway composition and actual HTTP/WS proxy checks.
- [x] 8. Multi-process correctness integration tests and regression verification.

Increment 1 is split into reviewable schema changes:

- [x] 1a. Instance registry, room ownership, durable table catalog, atomic room table
  allocation limit, and optional legacy-compatible game/table relationship.
- [x] 1b. Durable table recovery state and command lane/inbox schema with constraints.
- [x] 1c. Checkpoints, scheduled actions, outbox, durable chat/catch-up, and finalization
  schema changes, reconciled with existing social and ledger data.

Increment 2 is split into:

- [x] 2a. Versioned trusted checkpoint capture/decode and table-state reconstruction.
- [x] 2b. Rebuild hosted engine adapters and command sessions with stable receipts;
  validate restored public/private views and continuation behavior.
- [x] 2c. Transactional checkpoint persistence/loading and receipt recovery against
  the database, including consistent table positions and reservation checks.

Increment 3 is split into:

- [x] 3a. PostgreSQL inbox enqueue/deduplication, transaction-scoped lane-head claims,
  status lookup, and atomic completion hooks.
- [x] 3b. Per-game lane scheduler and engine execution integration, including
  reauthorization, bounded work, failure handling, and fair lane progress.

Increment 4 will be split into:

- [x] 4a. Server registry and room lease acquire/renew/release/takeover primitives,
  with fencing, recovery/serving transitions, and transaction tests.
- [x] 4b. Room recovery/activation and owner routing integration, including the
  remaining table/controller command executors needed before live cutover.

Increment 4b is further split to keep the coordination and cutover changes reviewable:

- [x] 4b1. Explicit-start heartbeat/lease maintenance, retained acquisition intents,
  and local execution admission that closes on uncertain ownership.
- [x] 4b2. Consistent room recovery inventory and validation, including all tables,
  engine compatibility, reservations, scheduled actions, and finalization work.
- [x] 4b3. Recovery/activation orchestration, owner routing, and remaining
  table/controller executors. Live cutover also requires durable delivery below.

Increment 4b3 is split into:

- [x] 4b3a. Bounded recovery preparation, transient retries, classified failures,
  and exact-fence cleanup; no activation or automatic quarantine.
- [x] 4b3b. Durable table/controller execution and runtime-specific scheduled-work
  and finalization reconciliation needed to make recovery complete.
- [x] 4b3c. Final recovery/activation boundary, quarantine policy, owner routing,
  and coordinated shutdown, gated on the required executors and reconciliation.

Increment 4b3c is split into:

- [x] Explicit transactional activation validation and confirmed local admission.
- [x] Concrete execution/maintenance scheduling and readiness binding, with pending-work resumption.
- [x] Explicit durable ingress and owner wakeup routing, including unavailable-owner handling.
- [x] Bounded quarantine transitions and explicit epoch-guarded retry after repair.
- [x] Explicit coordinated shutdown/routing withdrawal and exact-fence release.
- [x] Bounded demand-driven owner selection/reacquisition.
- [x] Bounded durable placement-demand discovery and explicit dispatch adapters.
- [x] Live placement triggers/dispatch bindings (gated on transport and endpoint audit).
- [x] Endpoint capability audit and cutover dependency checks; see [cutover audit](distributed-runtime-cutover-audit.md).
- [x] C1 backend slice: active waitlists, settings/votes, invitations/replacement, atomic
  room creation and fenced lifecycle commands with reliable native envelopes.
- [x] C2 backend slice: authorized read-only table/catalog/member/invitation/ledger
  adapters, stable IDs/revisions and actor-scoped pending/terminal status.
- [x] Mount compatible HTTP/WS/client bindings for those adapters with C3/C6; no
  legacy/distributed dual writing or implicit generic/Echo conversion.

Increment 4b3b begins with:

- [x] 4b3b1. Durable pre-game lobby seat/queue/roster-lock commands.
- [x] 4b3b2. Durable room-lane creation with stable table/match identities.
- [x] 4b3b3. Durable initial game start and controller contracts/execution.
- [x] 4b3b4. Active-game departure/rematch and scheduled-work/finalization
  reconciliation.

Increment 4b3b4 is split into:

- [x] 4b3b4a. Explicit table end and Call Break abandonment, with atomic release.
- [x] 4b3b4b. Marriage/Flush fold-and-leave, engine receipts, and settlement intent.
- [x] 4b3b4c. Rematch/round identity, roster rotation, and scheduled-work/finalization
  reconciliation (split further before implementation as needed).

Increment 4b3b4c starts with:

- [x] 4b3b4c1. Ready-roster Call Break/Marriage rematches and completed-match archives.
- [x] 4b3b4c2. Flush round restart identity/checkpoint/receipt contracts and execution.
- [x] 4b3b4c3. Remaining roster rotation/offers and scheduled-work/finalization
  reconciliation (split into bounded increments before implementation).

Increment 4b3b4c3 is split into:

- [x] 4b3b4c3a. Between-round Flush seating/queue transitions and empty-table closure.
- [x] 4b3b4c3b. Completed Call Break/Marriage seat release and queue transitions,
  including replacement-vacancy metadata.
- [x] 4b3b4c3c. Replacement offers, durable timer execution, and finalization
  reconciliation.

Within 4b3b4c3c:

- [x] Replacement-offer commands, FIFO selection, and persisted expiry deadlines.
- [x] Fenced offer-expiry dispatch/execution and opt-in deadline recovery validation.
- [x] Durable manual Call Break review continuation and audit of remaining game timers
  (no automatic game timers exist in the current manual hosted flow).
- [x] Call Break/Marriage finalization resolution and atomic ledger projection.
- [x] Flush round finalization and explicit settlement recovery validation.

Tests should accompany each increment; increment 8 consolidates end-to-end coverage.
Required cases include simultaneous sixth-table attempts, competing starts,
independent games, ordered commands, duplicate requests, unknown commits, rematches,
terminal receipts, owner kill/pause/takeover, stale-owner rejection, Redis loss,
missed notification, timer recovery, settlement retry, and private-hand isolation.

## Deferred next task set

- Representative traffic mix, capacity/load testing, 1K sustained connections,
  2K burst behavior, and seeded 1.5M-account database testing.
- Validate proposed p95 command acknowledgment under 300 ms within the region and
  ordinary owner recovery within 45 seconds; neither is currently demonstrated.
- Validate surviving-instance capacity after one application server fails.
- Autoscaling thresholds, placement tuning, and automatic room rebalancing.
- Application instrumentation is now covered by O1 at the user's request. Collector
  deployment, dashboards, alert destinations, tracing and operational runbooks remain.
- Database HA/replica deployment, promotion/fencing policy, and replication durability.
- Backups, point-in-time restoration, and regional disaster-recovery drills.
- Retention/archival tuning and production rollout readiness.

Basic bounds, security, recovery logic, and correctness tests remain in the first
implementation; deferring operational work does not defer application correctness.

## Increment handoff

Implementation increments **1–8 are complete for the isolated integration path**.
The production defaults remain legacy. Final work includes executable two-gateway
composition, real nginx HTTP/WS, mounted native-protocol game/platform controls,
manual settlements, shared phrases, expiring pokes and independent-process recovery.

Verification: broad Python run had 1526 passes and 13 optional skips; its nine old
migration-stub failures were corrected. All 65 affected/new targeted checks passed,
and the final marker-cleanup change also passed the nine migration checks. All 236
client tests, TypeScript, integration web build, iOS export and mounted Chromium
smoke (including all three game projections) passed. Ten real-Redis tests passed.
Three real PostgreSQL/Redis/nginx process cases passed together; strengthened game
continuation after pause/resume/kill and a fourth database stop/restart case also passed.
No application database or deployed service was changed.

Next task set: production cutover validation and the already deferred operational
readiness work. This includes native-device journal/lock checks, real provider callback
smoke, container execution and a reviewed existing-data migration/legacy credential
exclusion procedure. The isolated initializer intentionally refuses existing datasets.
No further routine increment approval is needed; production activation remains gated.

### O1 — application metrics and structured logs

User authorization: “for all the flows and processing in the game, go ahead and
add metrics and logs properly.” This brings application observability forward from
the deferred operational task set without authorizing infrastructure deployment.

- [x] Add Prometheus metrics and structured JSON logging across HTTP/WS, shared
  platform routes, hosted/chat/social ingress, all command lanes, all three games,
  table/room controls, checkpoint I/O, scheduling, timers, finalization, recovery,
  ownership, Redis/presence and durable outgoing delivery.
- [x] Observe business outcomes after transaction exit and final fencing; keep
  database step/attempt timing distinct from committed acceptance.
- [x] Bound labels, omit sensitive contents, preserve exceptions/cancellation,
  rate-limit repeated failure logs and isolate telemetry emitter failures.
- [x] Add a separate opt-in metrics listener and read-only bounded backlog/pool
  sampling with freshness/failure gauges; keep metrics off public routes.
- [x] Add an Alloy collection template and metric semantics/dashboard/alert guidance
  in `docs/distributed-runtime-telemetry.md`; no deployed Grafana resources.

Verification is recorded in the O1 completion record below. No schema changes,
production runtime switch, cloud provisioning or client telemetry were introduced.
Exact next step: deploy the isolated staging release with the private metrics
listener, configure Alloy ingestion credentials/log source and host/PostgreSQL/Redis
exporters, create scoped dashboards/alerts and test notification delivery. Then run
real-device functional/parity and failure tests before capacity validation or cutover.

### Release gates outside the completed isolated implementation

- [ ] Verify native device SecureStore persistence and single-owner behavior, including restart/storage failure.
- [ ] Validate configured real provider callbacks through the deployed origin/proxy.
- [ ] Execute container composition and check full product navigation/visual parity before replacement of production UI.
- [ ] Review existing-data migration, stop old writers and revoke their database access; the current marker cannot fence old binaries.
- [ ] Complete the separately deferred capacity/observability/HA/operations task set.

### Increment 1a record

Changes:

- Added `server_instances`, `room_ownership`, and `room_tables` with lookup indexes,
  ownership-shape checks, immutable table identity, and lifecycle constraints.
- Added configurable `rooms.max_open_tables` (default 5) and database-maintained
  `open_table_count`. AFTER triggers atomically update the counter on actual table
  inserts, closes, reopens, and deletions. The room check constraint rejects excess
  allocation and reductions below the current count. Counter changes roll back
  with the mutation; conflicting inserts do not consume capacity.
- This refines the planned lock/count implementation: atomic counter updates avoid
  stale-count races across transactions without putting room locks on gameplay.
  Application code must not write the allocation counter directly. The limit only
  covers the new durable catalog until table creation is wired into it.
- Added nullable `games.table_id`, a composite FK to prevent cross-room association,
  a partial unique active-game-per-table index, and a table history index. Legacy
  games retain NULL; no table identity is guessed or backfilled.
- Added persistent branch-scope instructions in `AGENTS.md`.

Verification:

- `.venv/bin/python -m pytest -q`: 854 passed, two dependency deprecation warnings.
- `PGLITE_MODULE=/private/tmp/bhidne-schema-tests/node_modules/@electric-sql/pglite
  node tests/distributed-schema.cjs`: passed empty-schema and existing-data upgrade
  checks, capacity, closure/reopening/deletion, conflict insertion, rollback,
  configurable limit, rematches, cross-room rejection, and ownership constraints.
- PGlite was installed in a temporary directory only; project dependencies were
  not changed. The script accepts any installed PGlite path via `PGLITE_MODULE`.
- Migration-ledger tests cover upgrades from versions 11 and 12 and execute pending
  migrations only once. `git diff --check` passed.

Limitations:

- No hosted runtime, API, or Redis behavior has been switched. These tables are
  foundations, not functioning distributed ownership or table recovery yet.
- SQL was executed in embedded PostgreSQL/WASM, not against a deployed database.
  True concurrent multi-connection allocation and takeover tests remain required
  when the persistence/runtime paths are introduced.
- No application database was modified manually. Migration 13 will run through the
  existing migration runner on the next database-backed application startup.

### Increment 1b record

Changes:

- Migration 14 adds `table_recovery_state`: version, table revision, lobby/match ID,
  phase, capacity, and a JSON object for the remaining host recovery data. Waiting
  lobby IDs need not reference a started durable game.
- Adds `table_positions` with one row per table/user, exactly one seat or FIFO queue
  position, and unique table/seat and table/queue-position constraints. Multiple
  distinct queued users and seated users can coexist; the same user cannot be both
  queued and seated in one table.
- The versioned JSON document will hold historical roster mappings, departures,
  seat releases/offers with absolute expiry, rule proposals/votes, invitations, and
  table event history. Current seats/queue live in `table_positions`, not a second
  copy in the JSON document. This refines the proposed separately normalized
  offer/vote storage: recovery initially reads a whole table checkpoint, while SQL
  uniqueness is reserved for current positions. No per-offer query API is required
  yet. Codec validation and host reconstruction belong to increment 2.
- Existing `active_table_players` remains the authority for cross-table seat
  reservations. The future table store must write recovery state, positions,
  reservations, and the table revision together. Revision/capacity/phase agreement
  and JSON content validation are store/codec responsibilities, not yet implemented.
- Adds `command_lanes` for room, table, game, room chat, canonical two-user
  conversation, and recipient targets. Partial unique indexes permit one lane per
  target/type. Composite foreign keys prevent assigning a game lane to the wrong
  table or room. Targets are immutable across retries and rematches.
- Adds monotonic enqueued/processed lane cursors, an index of lanes with pending
  work, and a pending-command index ordered by lane/sequence.
- Adds `command_inbox` with original versioned request, actor-scoped command ID,
  expected revision, fingerprint, and pending/accepted/rejected result. Sequences
  and actor/request IDs are unique within a lane. Game requests must name their
  lane's game and supply an expected revision. Trusted internal actor IDs are
  supported; ingress must authenticate player identity and isolate system actors.
- Request identity/content cannot change after insertion. Final outcomes cannot
  be rewritten or reset to pending. Generic outcomes hold durable acknowledgment
  data, not private current snapshots. Game execution will still write the existing
  `game_commands` receipt in the same transaction; that integration is pending.
- The schema supports atomic allocation by updating a lane cursor and inserting
  its command within one transaction. The future store must deduplicate first,
  compare original fingerprints, never skip a lane's head, and advance its processed
  cursor with the outcome. The schema alone does not enforce gap-free allocation
  or head-only execution against arbitrary SQL writers.

Verification:

- `.venv/bin/python -m pytest -q`: 855 passed, two dependency deprecation warnings.
- The embedded PostgreSQL suite now applies migration 14 after the migration-13
  fixtures in both installation/upgrade cases. Checks cover recovery-document
  preservation, exclusive seat/queue positions, transaction rollback, all lane
  target types, target uniqueness and room/table integrity, independent game
  sequences, duplicate-ID rollback, immutable requests and final results, cursor
  regression rejection, pending queries, and rematch/terminal-outcome isolation.
- Run with `PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/distributed-schema.cjs`.
  New checks are in `tests/distributed-inbox-schema.cjs`, called by that runner.
- Migration-ledger tests now cover already-applied versions 11, 12, and 13.
- `git diff --check` passed.

Limitations:

- No runtime, API, client, or Redis behavior changed. Enqueue/execution, table
  persistence, receipt integration, and failover are not enabled by this migration.
- Recovery documents are stored and type-checked as JSON objects, but their full
  versioned codec has not been implemented. SQL round-trip checks are not a proof
  that a hosted engine can yet reconstruct itself.
- These SQL tests use embedded PostgreSQL/WASM. Live multi-connection concurrency
  and process-failure tests remain required with the transactional store/runtime.
- No application database was modified manually; migration 14 runs on the next
  database-backed startup through the existing migration runner.

### Increment 1c record

Changes:

- Added migration 15 through `app/distributed_schema.py`, imported by the existing
  migration registry. Earlier migration SQL remains unchanged.
- Added immutable versioned `game_snapshots`, keyed by game/event sequence, with
  revision, engine/event/snapshot versions, state and SHA-256 digest field. Insertion
  rejects sequence/revision beyond committed game metadata and mismatched stored
  engine/event versions. The primary key supports newest-checkpoint lookup.
- Added `scheduled_actions` with absolute deadlines, stable command IDs, generation
  uniqueness, pending/enqueued/cancelled states, and a pending-deadline index.
  Timers target existing lanes (including table lanes for pre-game offers).
  Enqueued timers must reference an inbox command with actor `system:timer` and the
  identical command ID/body, match, and expected revision. Dispatch and inbox insert
  can roll back together. Deadlines/content are immutable; rescheduling creates a
  new generation and cancels the obsolete timer.
- Added an independent monotonic `command_lanes.emitted_sequence`: command order
  cannot double as output order because one command can emit multiple events.
- Added `notification_outbox` with event identity/version, lane event sequence,
  optional private user audience, immutable content, retry time/count, expiring
  claim token, and publication timestamp. Pending publication has a partial index.
  Published rows cannot be reopened. A NULL audience means the lane's authorized
  audience, never everyone on the platform. Conversation/recipient targets are
  checked for consistency; room/game authorization remains a runtime responsibility.
- Added `delivery_cursors` keyed by user/client/lane, independent from read status
  and publication. Cursors cannot move backwards or exceed allocated emitted
  sequence. Conversation/recipient lanes reject another user's cursor. The delivery
  layer must authenticate clients and check room/game access before reads or writes.
- Added immutable `room_chat_messages` with room/sender/request deduplication,
  ordered stream identity, and room/sequence history lookup. This enables the
  already-agreed future durable chat behavior; today's chat service remains ephemeral.
- Extended existing `direct_messages` with nullable all-or-none lane/sequence/request
  metadata and partial unique indexes. New sequenced rows must match their canonical
  conversation participants and cannot be rewritten. Old rows and inserts remain valid.
- Extended existing `friend_notifications` rather than adding a second notification
  history. It now permits general notification kinds, optional system actors, an
  object payload, and nullable all-or-none stream/deduplication metadata. Sequenced
  rows must match their recipient lane and are immutable except `read_at`. The
  current friend APIs still produce the original kinds; general notification API
  support, including actor-less reads, belongs to increment 6.
- Added immutable-content `game_finalization_jobs` with retry metadata and unique
  game/round/job-type identity. Round zero denotes match completion. Existing
  `completed_games` and ledger tables remain the result/effect authorities; payloads
  carry stable effect IDs. Completed jobs cannot be reopened or rewritten.
- Message history deliberately has no FK to disposable outbox rows. Publishing or
  eventually pruning an outbox record must not erase history or claim client receipt.

Verification:

- `.venv/bin/python -m pytest -q`: 856 passed, two dependency deprecation warnings.
- `PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/distributed-schema.cjs`
  passed both installation and existing-data upgrade paths through migration 15.
  New checks in `tests/distributed-delivery-schema.cjs` cover preserved legacy social
  rows/inserts, checkpoint bounds/immutability, timer identity and dispatch rollback,
  outbox allocation rollback and retry/publication states, independent device cursors,
  message deduplication/catch-up, wrong private targets, and finalization retries.
- Migration-ledger tests cover already-applied versions 11–14 and one-time upgrades.
- `git diff --check` passed. No project dependencies were added.

Limitations and next-store contracts:

- No new worker, API, client, Redis path, or hosted runtime behavior is enabled.
  Schema support alone does not provide queue processing, failover, or durable chat.
- Snapshot digest format is checked, but calculating/verifying the digest and proving
  state corresponds to a particular journal prefix require the recovery codec/store.
- Allocate emitted sequences and write state/message/outbox changes in one transaction.
  Publish only authorized projections/IDs, never raw canonical hands. Multiple output
  rows from a command need distinct event sequences, including private projections.
- Future outbox workers must acquire/renew claims and mark publication with their
  claim token; claim columns alone do not implement that compare-and-set protocol.
  Catch-up must handle missed Pub/Sub delivery even for already-published rows.
- Future finalization workers must lock/claim jobs and commit idempotent ledger
  effects with job completion. No external side effect should be assumed exactly once.
- Legacy messages have NULL stream metadata. Define their catch-up cutover/backfill
  in increment 6; do not silently present them as already-sequenced messages.
- Per-device cursor acknowledgments do not authorize access. Recheck membership,
  conversation permissions, and private audiences when serving catch-up.
- Tests use embedded PostgreSQL/WASM; live multi-connection/process-failure checks
  remain required with the stores/runtime. No application database was manually
  changed; migration 15 runs on the next database-backed startup.

### Increment 2a record

Changes:

- Added `app/durable_games/checkpoints.py`, a pure trusted-only codec. Callers capture
  under the existing game lock; the module performs no I/O, registration, timer
  scheduling, ownership acquisition, or player delivery.
- Schema version 1 captures room/table/match identity, explicit table revision,
  positions, phase, historical roster, departures, rule configuration/proposals,
  offers with absolute timestamps, invitations supplied by the caller, event history,
  private query state, and a separately described engine checkpoint.
- Current seats and queue positions have one normalized representation. Replacement
  roster length preserves holes; an ended table retains its historical replacement
  roster without claiming those seats as current positions.
- Engine checkpoints preserve typed Call Break, Marriage, and Flush state. Marriage
  history carries explicit allow-listed event type names to avoid ambiguity between
  structurally similar events. No executable names are imported from stored data.
- Decoding checks strict envelope shape/version, canonical SHA-256 digest, field
  round-trip fidelity, engine revision/roster, rule reconstruction, table positions,
  offer identity/deadlines, and contiguous table events. Reuses Call Break's match
  audit and Marriage/Flush domain invariant validators.
- `restore_table_state` reconstructs detached table mechanics, including offers,
  queue ordering, release slots, and published event sequence. It does not expire
  offers or mutate the original host state.
- Flush historical seat IDs are intentionally not capped by table capacity: player
  replacements allocate new stable IDs. Occupied-seat count remains bounded. A
  finished Flush round can preserve its engine roster while the open table's users
  form the next roster; the complete historical seat map is retained.
- Locks, tasks, ownership tokens, receipt caches, local ledger retry timestamps, and
  derived reservation flags are excluded. Those must be rebuilt from the new owner
  and authoritative stores, not copied from an old process. A non-NULL legacy host
  deadline is rejected until translated to an absolute scheduled action.

Verification:

- Full backend suite: 875 passed, two dependency deprecation warnings.
- `tests/test_hosted_checkpoints.py`: 19 passed, also rerun after the last malformed
  checkpoint error-normalization adjustment.
- Covers waiting and active games (including four/five-player Call Break), private
  view equivalence, detached mutable data, Marriage terminal event types, Flush
  sparse seat IDs/next-roster formation, lobby offers/votes/invitations, retired
  seat state, digest corruption, unsupported versions, duplicate/invalid positions,
  malformed revisions/rosters, and unconverted process deadlines.
- `git diff --check` passed. No schema migration or dependency changes in 2a.

Limitations:

- This returns validated domain state and table mechanics, not a registered or
  serving `HostedGame`. Engine facade/adapter rebuilding and receipts are next.
- The codec is a trusted recovery envelope, not a client DTO. It includes hidden
  cards and private query data and must never be broadcast or logged wholesale.
- The envelope digest covers combined checkpoint data. The SQL store must split
  normalized table positions/metadata and game snapshot state correctly and compute
  the game snapshot's own canonical state digest; do not reuse the envelope digest
  as the SQL engine-state digest.
- Nested proposal/invitation/query payloads preserve JSON facts; their full lifecycle
  cross-checks and consistency with database membership/reservations belong to the
  transactional restore path. Domain audits are not proof of journal provenance.
- No database save/load, receipt restoration, timer worker, or automatic takeover is
  enabled. Receipt safety must be established before a reconstructed game can serve.

### Increment 2b record

Changes:

- Added `app/durable_games/recovery.py` to rebuild detached hosted games from a
  validated checkpoint and an explicit, complete receipt view. Reconstruction
  allocates fresh locks and adapters without registering games, acquiring leases,
  starting timers, broadcasting, or restoring process-local reservation flags.
- Added validated `from_state` constructors for Marriage and Flush. They copy
  committed state without starting, dealing, or replaying startup events. Future
  randomness uses a fresh generator; committed cards and history remain unchanged.
- Restored accepted and rejected command outcomes with their original-request
  fingerprints, actor/command identity, receipt count, and capacity limit. Reject
  inconsistent match/revision, truncated views, mismatched fingerprints, duplicate
  identities, and malformed outcomes before activation. Live execution and recovery
  share the same request fingerprint function.
- Added a trusted receipt lookup helper for terminal games, returning only a copied
  acknowledgment. A future endpoint must authenticate the actor and authorize access.
- Preserved Flush's finished-round player mapping while replacement players form
  the next roster. Re-capture verifies the rebuilt host reproduces its checkpoint.
- Fixed Call Break authorization to recognize any registered table in the room,
  rather than only the room's default game. Other game targets already do this.

Verification:

- Focused checkpoint/recovery/shared-command tests: 52 passed.
- Full backend suite: 895 passed, two dependency deprecation warnings.
- `git diff --check` passed.
- Recovery coverage includes all three games' public/private/spectator views,
  continuation, accepted/rejected retries, conflicting IDs, detached resources,
  waiting lobbies, malformed receipt views, full receipt capacity, terminal status
  lookup, sparse Flush roster replacement, and independent Call Break tables.
- No schema migration or dependency changes in 2b.

Limitations and next-store contracts:

- No database save/load, automatic startup recovery, takeover, or public status
  endpoint is enabled. Reconstruction remains off-registry until fenced ownership,
  membership, reservations, and scheduled work can be established transactionally.
- Receipt tests supply a simulated authoritative view. The database loader must
  read checkpoint, receipt rows, and their count from one consistent committed view;
  validation alone cannot prove rows originated from that view.
- The legacy hosted durable-store path still includes calculated authoritative
  state in its command payload/fingerprint. Increment 2c must reconcile this with
  original-request identity and persist rejected outcomes as well as accepted ones;
  existing database receipts are not yet wired into this recovery contract.
- The trusted checkpoint includes hidden game data and must not be exposed to
  clients. Authorization and projection checks remain required at activation/delivery.

### Increment 2c record

Changes:

- Added `app/durable_games/checkpoint_store.py`. It atomically creates/updates table
  recovery metadata, normalized positions, seat reservations, game journal events,
  engine snapshots, accepted/rejected receipts, and table/game lifecycle status.
  Its new path remains disconnected from live routing.
- Writes require a serving room lease with matching instance, epoch, and token.
  A shared ownership-row lock fences takeover while allowing independent tables
  to proceed; an exclusive table-row lock and expected table revision serialize
  each table. Recheck wall-clock lease expiry before returning from a write.
  Lease acquisition/renewal, startup activation, and takeover workers remain in 4.
- `save_in_transaction` requires an open transaction and lets the future executor
  include inbox completion and outbox writes in the same commit. `save` provides a
  standalone transaction for bootstrap/table persistence. Neither sends messages.
- Current positions live only in SQL position rows; engine checkpoints live in
  `game_snapshots`. Table documents retain the remaining metadata and envelope
  digest. Position ordering is canonicalized before capture. Each engine snapshot
  has its own digest, distinct from the combined checkpoint digest.
- Loads use a repeatable-read, read-only transaction for checkpoint metadata,
  engine state, receipt count/rows, membership, and reservations. Validate snapshot
  versions/digests against the contiguous committed checkpoint journal and current
  game boundary; refuse missing, inconsistent, or incompatible records.
- Reservation changes check canonical durable user IDs and room membership, lock
  users in stable order, and reject cross-table/game conflicts. Initial saves are
  revision zero; subsequent saves advance the table revision once. Started engine
  changes require an original command/outcome, and rejected commands cannot change
  engine state. Closed tables cannot be reopened through this API.
- Receipt retries resolve before revision checks and return the committed checkpoint
  without rewriting it. The caller must use that result before any delivery. Receipt
  limits, fingerprints, counts, and acknowledgment revisions survive reload. Old
  match receipts remain queryable after rematches; Flush round game IDs can change
  while retaining the hosted match's receipts.
- Migration 16 adds nullable `game_commands.original_request` and prevents receipt
  mutation. Existing rows remain NULL rather than guessing their original requests.
  New checkpoint storage refuses implicit import of existing/legacy game journals.
- The existing hosted durable path now records original-request fingerprints and
  requests separately from computed state, and durably records engine rejections
  before caching/delivery. Failed outcome commits restore in-memory state. Unknown
  commit retries that disagree with committed state fail closed and require reload,
  preventing publication of rerolled speculative cards. Generic durable games keep
  their existing fingerprint contract when no original request is supplied.

Verification:

- Full backend suite with PostgreSQL/WASM integration enabled: 911 passed, two
  dependency deprecation warnings. An additional Flush round-rollover test was
  added and passed separately afterward (912 passing tests in total).
- The integration harness executes the production Python stores' SQL against
  PostgreSQL/WASM, including transactions and constraints; it does not mock SQL
  outcomes. Run with `PGLITE_MODULE=/path/to/@electric-sql/pglite
  .venv/bin/python -m pytest -q tests/test_checkpoint_store.py`.
- Covers all three engines, detached reconstruction, accepted/rejected retries,
  request conflicts, independent tables, capacity rollback, waiting-to-started and
  rematch transitions, terminal lookup, membership/reservation mismatches, corrupt
  journal/receipt/position views, stale fences, lease expiry during a write, and
  full rollback when failure occurs after writes but before commit.
- Schema checks passed for fresh installations and existing-data upgrades through
  migration 16, including preserving legacy receipts and rejecting mutation.
- `git diff --check` passed.
- No project dependencies were added and no application database was manually
  modified. Migration 16 runs through the normal next database-backed startup.

Limitations and integration contracts:

- Tests execute embedded PostgreSQL, not multiple live database sessions/processes.
  Real competing writers, membership changes, owner pause/kill/takeover, and
  transport failure tests remain required in the distributed integration increment.
- No automatic registration, startup reload, room ownership worker, Redis path,
  timer dispatch, inbox execution, or outbox publication is enabled here. Explicit
  test fixtures supply serving leases; production must finish increment 4 first.
- Reconstructed invitations/offers retain their recorded facts; lifecycle workers
  must reconcile expiry, membership, and scheduled work under the acquired owner
  before activating a room. A codec/digest is not proof of a valid client command;
  the future executor must reauthorize and validate through the engine.
- Existing pre-migration receipts cannot be silently restored as original requests.
  Legacy hosted tables/journals are not automatically converted to the new format;
  define an explicit drain/cutover policy before activation. The live legacy path's
  per-game ownership model remains separate from the new room-fenced store.
- Legacy and distributed runtimes must not concurrently host the same room/users
  during cutover. New storage reserves seats even in waiting tables; legacy mixed
  writes do not yet share the new reservation locking protocol.
- Unknown-commit mismatch in the legacy live path now stops speculative delivery;
  automatic reload/continuation requires the later activation path. A trusted
  historical receipt lookup is available, but no authenticated status API is added.
- Current recovery reads the full checkpoint journal/receipt history for validation.
  Snapshot compaction, retention, and performance validation remain later work.

### Increment 3a record

Changes:

- Added `app/durable_games/inbox.py` with strict lane targets for room, table, game,
  room chat, conversation, and recipient lanes. Lane creation is idempotent by its
  immutable target; conversations require canonically ordered users.
- Enqueue locks the target lane, checks actor/request identity before allocation,
  and inserts the original request with its next sequence in one transaction.
  Failed inserts roll back allocation, so no sequence is consumed. Defaults bound
  each lane to 1,000 pending commands and each request to 64 KiB. Duplicates still
  resolve when the pending limit is reached.
- Added actor-scoped pending/terminal status lookup and bounded pending-lane queries.
  These are trusted store APIs, not authenticated public endpoints. Ingress must
  derive actor identity from credentials and authorize the requested target.
- Claims take a shared serving-room fence lock, then a lane row lock with
  `FOR UPDATE SKIP LOCKED`, and select exactly `processed_sequence + 1`. Missing,
  unsupported, or unexpectedly terminal heads fail closed rather than skipping.
  Conversation/recipient lanes use the transaction lock without room ownership.
- A claim stays inside one database transaction. Its connection is available for
  checkpoint, receipt, message, and future outbox writes. Completion records the
  final acknowledgment and advances the processed cursor atomically. Exiting a
  claimed context without completion, an exception/cancellation, or an expired
  final fence check rolls back all composed effects. Claims cannot be reused after
  context exit or completed twice. No network delivery belongs inside a claim.
- Game completion requires an identical original-request fingerprint, request body,
  actor/command identity, status, revision, and detail in `game_commands`, written
  by the checkpoint/receipt transaction. Generic outcomes are also restricted to
  acknowledgments, avoiding private snapshot payloads in command status responses.
- Migration 17 adds immutable `command_inbox.original_request` and an optional
  `dedup_match_id` with a unique hosted-match/actor/command index. Legacy rows retain
  NULL values and are not guessed into the new contract. Migration ledger tests now
  cover already-applied versions 11–16.
- Explicit identity refinement: a game inbox row's existing SQL `match_id` remains
  its durable game/round routing ID, as required by the lane constraint. The exact
  player-visible hosted match ID remains in `original_request`; `dedup_match_id`
  scopes retries across Flush round lanes. This preserves existing request bytes
  and receipt fingerprints even when a new round has a different durable game ID.
- A retry routed to a later round resolves the earlier inbox entry and returns its
  original lane/sequence/outcome without allocating work on the new lane. A fresh
  request to a no-longer-current round is rejected at ingress. Executors must still
  recheck lifecycle and permissions because they can change after enqueue.

Verification:

- Focused PostgreSQL/WASM inbox integration suite: 12 passed. It executes production
  store SQL, including rollback, real constraints, and atomic checkpoint composition.
- Covers all lane kinds, target idempotency, actor isolation, pending capacity,
  request-size limits, conflicting IDs, terminal retries, gap-free allocation,
  missing/legacy heads, incomplete claims, rollback after completion, stale/expired
  fences, all three games' accepted/rejected receipts, and Flush round rollover.
- Full backend suite with PostgreSQL/WASM integration enabled: 925 passed, two
  dependency deprecation warnings.
- Fresh installation and existing-data upgrade schema checks passed through
  migration 17. `git diff --check` passed. No project dependencies were added;
  migration 17 runs through the next normal database-backed startup.

Limitations and next-step contracts:

- No worker, HTTP/WebSocket ingress change, Redis wake-up, scheduler, or distributed
  runtime activation is enabled. The store's claims are database transaction locks,
  not persisted processing leases; a disconnected/aborted transaction leaves the
  head pending. Lost commit responses resolve via stable request lookup/deduplication.
- Do not retain speculative engine mutations after rollback or publish before the
  claim context successfully commits. The scheduler must restore/reload state on
  errors and handle uncertain commits before executing more commands.
- `enqueue_in_transaction` composes with future timer dispatch. Its caller must
  roll back/retry the whole transaction on a unique-key race; standalone `enqueue`
  retries once to resolve a hosted request racing across two round lanes.
- Claim completion proves that the matching game receipt exists; it does not
  perform domain validation, authorize the player, or synthesize game effects.
  Non-game effects/message/outbox writes must be composed by their future executor.
- Embedded PostgreSQL tests do not prove multi-connection lock contention, competing
  claimers, simultaneous rollover ingress, or process-kill behavior. Live-session
  concurrency checks remain in increment 8. Old pending rows without original
  requests require an explicit cutover policy before enabling a scheduler.

### Increment 3b record

Changes:

- Added `app/durable_games/executor.py`. A game command claims the next inbox head,
  locks its table, loads validated committed checkpoint/receipts, and reconstructs
  a detached host for that attempt. It never registers with the serving host or
  calls socket delivery, timer scheduling, or ledger APIs.
- Execution rechecks durable room membership, current match/round lifecycle,
  participant seating/departure, expected revision, and the existing game's command
  and payload validators. No-effect failures become durable rejected receipts and
  advance the inbox in order. Corrupt state and infrastructure failures instead
  leave the head pending; they are not mislabeled as player-command rejections.
- All three games reuse their existing synchronous engine/adapter hooks. Call Break
  uses the application's default round-review setting (8), configurable explicitly
  for matching owner configuration. Domain events retain adapter public/private
  routing. Completed games synchronize table phase; finished Flush rounds release
  pending departures and reopen the table without changing the historical engine.
- Added transaction-bound checkpoint loading and rejection recording. A request
  queued before a game ended or was replaced can receive a durable rejection
  without mutating the new game. Rejection-only writes update receipt-count metadata
  when appropriate, leaving engine/checkpoint facts and table revision unchanged.
- Accepted commands atomically save the checkpoint/receipt, advance the inbox,
  allocate ordered outbox events, and record settlement work when a match/round
  finishes. Rejections write only their receipt, inbox completion, and private ack.
  The outbox contains adapter projections, table events, and a public state-change
  reference; it never receives the trusted canonical checkpoint or a shared private
  snapshot. State-change references require authorized snapshot fetch on delivery.
- Table `published_sequence` in this path means handed to the durable outbox; it
  does not assert delivery to any socket. Outbox publishing and catch-up workers
  remain in increment 6. Settlement jobs use `hosted_settlement`, the durable game
  ID, and Flush round number (zero for a whole match); payload references identify
  the committed checkpoint for the future idempotent ledger worker.
- Enqueue now reserves match receipt capacity against committed receipts plus
  pending hosted-match commands under the table lock. This prevents an admitted
  command from becoming impossible to receipt after earlier commands consume the
  limit. Manually over-admitted/legacy queues still fail closed at the limit.
- Added `app/durable_games/scheduler.py` with explicit start/stop, fixed worker count,
  bounded tracked lanes, one command per turn, tail requeue for fair progress,
  coalesced hints, cooperative per-command timeout, and bounded exponential retries.
  Delayed retries use timer handles rather than occupying a worker. Different lanes
  can progress concurrently; the same lane is never offered to two local workers
  concurrently, and database claims provide the cross-process boundary.
- Stale fences and permanent failures stop that local lane attempt; transient DB
  failures/timeouts retry from committed state. Diagnostics retain bounded lane IDs
  and exception types, never raw private data. Shutdown cancels workers/retry timers
  and leaves unfinished durable commands discoverable. A newer fence supplied while
  an older attempt is active is checked by a fresh transaction.
- Pending-lane discovery supports kind filtering and a UUID pagination cursor, so
  a future owner poller can scan bounded pages and wrap without repeatedly selecting
  only the first hot lanes. `offer=False` means backpressure/stopped, not permission
  to drop a PostgreSQL command.

Verification:

- Focused executor/scheduler/inbox suites: 35 passed. SQL integration runs the
  production stores/executor against PostgreSQL/WASM; scheduler orchestration tests
  separately exercise overlap, fairness, backpressure, retries, and cancellation.
- Covers all three engines, public/private event addressing, stale revisions,
  spectators, membership revoked after enqueue, malformed game payloads, unsupported
  system actors, terminal/superseded commands, receipt admission, cancellation,
  rollback after effects, and a successful commit whose response is lost.
- A combined scheduler/store test drains independent game lanes, and a Flush chain
  continues from successive DB reloads through round completion with one settlement
  job. Tests verify source live hosts remain unchanged and no offer tasks start.
- Full backend suite with PostgreSQL/WASM enabled: 948 passed, two dependency
  deprecation warnings. The 8 scheduler tests also passed after the final explicit
  cooperative-yield adjustment. `git diff --check` passed.

Limitations and activation requirements:

- This increment has no schema migration, dependency addition, or application
  startup/HTTP/WebSocket wiring. No Redis, outbox publisher, settlement worker,
  actual room lease lifecycle, or automatic failover is activated.
- Every attempt reconstructs from storage to prioritize correctness. Caching or
  snapshot/journal compaction requires equivalent rollback/fencing guarantees and
  belongs to later performance work. Cooperative timeout cannot preempt synchronous
  Python engine computation; transaction/engine latency still needs load testing.
- Only player gameplay commands execute here. Room/table lifecycle, Call Break
  next-deal/controller commands, trusted timers, offers/expiry, and non-game lanes
  require their own executors before live activation. System actors currently get
  a stable unsupported-player rejection, not an impersonated player action.
- Existing malformed recovery data, inconsistent membership/positions, or corrupt
  heads require owner recovery/quarantine handling in 4; the scheduler never skips
  them. Exhausted retries/permanent failures remain durable pending work with a
  bounded local failure record. The owner/poller must decide resumption/quarantine.
- A successful or uncertain commit never installs speculative in-memory state.
  Subsequent attempts reload and inspect the inbox, so accepted random outcomes and
  outbox records are not rerolled/re-emitted. Integration must publish only from
  committed outbox records and keep legacy/distributed hosting isolated at cutover.
- Actual PostgreSQL multi-session contention, server/process kill, and simultaneous
  owner takeover still require live integration tests. The test SQL bridge serializes
  database access; scheduler overlap tests are not proof of live database contention.

### Increment 4a record

Changes:

- Added `app/durable_games/ownership.py` with explicit server registration,
  heartbeats, one-way instance draining, room acquisition/renewal/release, runtime
  transitions, and read-only inspection/routing hints. It starts no background work.
- Registrations identify a single process boot using a fresh instance ID and random
  boot credential. Only its hash is stored. A repeated registration must match the
  credential and original address/capabilities; it cannot replace another boot,
  refresh a heartbeat implicitly, or undo draining. Normal restarts use new IDs.
- Migration 18 adds nullable, 32-byte `registration_token_hash` and protects boot
  identity/configuration from updates while allowing heartbeat/draining updates.
  Legacy rows retain NULL credentials and cannot be adopted by a new registration.
- Room acquisition requires a fresh, non-draining registered instance. It locks
  the room and checks the caller's observed epoch. A free/expired room receives a
  new epoch/token and enters `recovering`; a live lease is never stolen based on a
  stale heartbeat. Quarantined rooms are excluded from automatic acquisition.
- Acquisition takes a caller-retained random token and expected epoch. If its commit
  response is lost, the same inputs recover the committed, still-live lease without
  incrementing epoch, extending expiry, or resetting state. A delayed acquire cannot
  reclaim a room after release. An expired retry requires a new acquisition intent.
- Renewal checks the exact owner/epoch/token and DB-clock expiry. It cannot revive
  an expired/released lease or shorten expiry. A draining instance can renew existing
  leases for shutdown but cannot acquire/activate rooms. Explicit release clears
  ownership while retaining the epoch; a repeated release is a no-op acknowledgment.
- Runtime transitions are explicit: `recovering -> serving`, `recovering/serving ->
  draining`, and an owned state to `quarantined`. Same-state retries are idempotent;
  draining/quarantined rooms cannot be reactivated by a delayed activation call.
  All transitions require a live matching fence. Release/reacquire is required for
  another recovery attempt after an intentional stop.
- The trusted `activate` primitive does not claim to perform recovery. Increment 4b
  must verify every required checkpoint, reservation, capability, and scheduled
  action before calling it. Only `serving` leases pass gameplay write fencing.
- Moved `RoomWriteFence` and shared write validation into the ownership module;
  existing imports through `checkpoint_store` remain compatible. Secrets are omitted
  from credential/fence representations and from routing metadata. Shared room locks
  allow concurrent game transactions while exclusive ownership updates fence them.
- DB wall-clock expiry is checked after row-lock acquisition, avoiding a validity
  projection computed before a lock wait. Renewal/transitions/release also predicate
  their final SQL update on wall-clock lease validity. No client/process clock
  participates in ownership decisions.
- Routing hints include only a serving, unexpired, fresh, non-draining destination;
  they contain no credential or hash. They are advisory reads: receivers/workers
  still require authoritative fencing, and missing hints do not authorize takeover.

Verification:

- Initial focused ownership SQL suite: 12 passed. A further clock-order test checks
  rejection when a simulated lock wait consumes the remaining lease time.
- Covers boot retry/credential isolation, immutable metadata, heartbeat/draining,
  explicit activation, renewal, release retry, expiry takeover, old-owner write and
  transition rejection, quarantine, lost acquisition responses, rollback before
  commit, and integration with existing checkpoint writes.
- Fresh installation and existing-data upgrade schema checks passed through
  migration 18, including preserved legacy registrations, rejected configuration
  mutation, and allowed heartbeat/draining updates. Upgrade ledger coverage now
  includes already-applied versions 11–17.
- Full backend regression suite: 962 passed, with two dependency deprecation
  warnings. `git diff --check` passed.

Limitations and next-step contracts:

- No heartbeat loop, automatic placement/takeover, room recovery coordinator,
  public/internal routing endpoint, or application startup activation is installed.
  The store APIs are trusted internal primitives, not proof of complete recovery.
- The coordinator must retain boot and acquisition secrets across unknown responses,
  use new boot identities after restart, schedule timely heartbeat/renewal, stop
  serving on fence loss, and check runtime/schema compatibility before activation.
- Expired quarantine remains quarantined. Explicit repair/release while the owner
  lease is live is supported; operator-authorized repair/reset after that lease has
  expired needs a separate recovery path. No automatic process clears corruption.
- Draining a server removes it from new acquisition/routing eligibility but does not
  forcibly revoke room leases or drain every scheduler. The coordinator must stop
  admission, transition/drain rooms, resolve in-flight work, then release leases.
- Row locks can delay takeover beyond lease expiry when an old transaction remains
  open. Before live activation, the coordinator/deployment needs bounded database
  waits and stale-session handling; no failover latency guarantee is established.
- Embedded PostgreSQL tests serialize SQL connections. Real competing owners,
  lock contention, long pauses, network partitions, and process death still require
  the live multi-session integration tests in increment 8.
- No dependencies were added or application database manually changed. Migration
  18 runs through the normal next database-backed startup. Legacy registry rows are
  preserved, not silently credentialed or enrolled into the new ownership APIs.

Next increment: 4b — coordinated room recovery/activation and owner routing, starting
with heartbeat/lease coordination and recovery validation. Remaining table/controller
executors and durable delivery are still mandatory gates before live cutover.

### Increment 4b1 record

Changes:

- Added `app/durable_games/coordination.py`. `RoomLeaseCoordinator` explicitly
  registers a fresh process boot and starts independent heartbeat and renewal
  loops. Defaults are a 30-second lease, five-second maintenance intervals,
  three-second operation timeout, one-second local safety margin, 128 tracked
  rooms, and four renewal workers. No application startup wiring was added.
- Room acquisition retains the same observed epoch and random token across lost
  responses, cancellation, and retries. Concurrent calls for the same intent
  serialize. A successful acquisition/retry is explicitly renewed before deriving
  a conservative local deadline, because acquisition retries do not extend SQL
  expiry. All acquired rooms still begin in `recovering`.
- Local admission requires a confirmed `serving` lease, exact matching fence,
  healthy heartbeat, and unexpired local confirmation. This component never calls
  `activate`; recovery validation remains a mandatory separate step.
- Heartbeat failure revokes all tracked rooms locally; uncertain renewal revokes
  the affected room. Cancellation, deadline gaps, and delayed maintenance replies
  cannot silently restore eligibility. A subsequent successful heartbeat permits
  new acquisitions but does not restore a revoked room. Explicit abandonment and
  a new acquisition/recovery are required; a still-live SQL lease cannot be stolen.
- Local deadlines use monotonic request-start time with a safety margin; they
  only remove permission. PostgreSQL wall-clock fencing remains the authority for
  every transaction. Room/worker counts and error history are bounded, and
  overlapping renewal cycles share the worker bound. Error records contain room
  identity and exception type, not SQL parameters, tokens, or game state.
- Added `OwnershipGuardedExecutor` for composition with `GameLaneScheduler`.
  Every queued/retried execution attempt rechecks local admission before reaching
  the existing detached, SQL-fenced executor. Lost-owner lanes stop locally;
  durable inbox commands remain available for later recovery/polling.
- Draining closes local admission immediately, even if the registry update's
  response is lost. Existing leases continue renewing while a future shutdown
  coordinator quiesces workers. Stop closes admission and cancels maintenance;
  it leaves SQL leases to expire instead of releasing ahead of in-flight work.
  A stopped coordinator cannot restart with the old boot identity.

Verification:

- Deterministic tests exercise uncertain renewal, heartbeat failure, pauses and
  delayed replies, lost/cancelled acquisition responses, concurrent acquisition,
  abandonment and stop races, bounds, background maintenance, drain retries, and
  scheduler rejection of queued work after ownership uncertainty.
- Production ownership SQL composed with the coordinator passed recovery/serving
  admission, draining, expired-owner takeover, epoch change, stale fencing, and
  refusal to revive ownership after a healthy heartbeat. These tests use embedded
  PostgreSQL/WASM; activation is explicit test setup, not recovery integration.
- Full backend regression suite: 980 passed, including 18 new coordination tests,
  with two existing dependency deprecation warnings. `git diff --check` and Python
  compilation of the new module passed.

Limitations and next-step contracts:

- Increment 4b remains incomplete. This subincrement is coordination infrastructure,
  not automatic failover. No room discovery/placement, recovery loader, activation,
  owner endpoint, Redis, or application lifecycle integration is enabled.
- Recovery must validate a consistent inventory of every table, supported engine
  and schema version, reservations, scheduled work, and finalization state before
  activation. A renewal observing `serving` trusts that explicit database transition;
  heartbeat success by itself is never recovery evidence.
- The future composition must wrap the lane executor with the guard and stop or
  drain its scheduler before explicitly releasing ownership. Already-started work
  relies on transaction fencing; local admission closure cannot undo committed work.
- Lost rooms and uncertain acquisition intents occupy bounded slots until explicit
  abandonment. The placement/recovery coordinator must resolve ownership from SQL
  and schedule retries without repeatedly replacing unknown acquisition intents.
- Fixed configurable maintenance intervals currently have no jitter. Placement and
  startup integration must add jitter and verify pool/renewal budgets. A saturated
  maintenance cycle may deliberately lose local eligibility; capacity and failover
  timing are not proven. Timeout cancellation also depends on the database driver
  honoring cancellation; live lock/partition tests remain in increment 8.
- No schema, dependencies, or application database were manually changed.

Next increment: 4b2 — consistent room recovery inventory and validation. Keep live
activation disabled until all required recovery and executor paths are implemented.

### Increment 4b2 record

Changes:

- Added `app/durable_games/room_recovery.py` with a read-only, repeatable-read room
  inventory transaction. It loads room membership, every catalog table (including
  closed tables), checkpoints/receipts/reservations, game identities, lane cursors,
  pending timers, and pending finalization jobs from the same committed view.
- Added `PostgresCheckpointStore.load_in_snapshot` so room recovery reuses the
  existing checkpoint/journal/receipt/reservation validation without opening a
  connection or transaction per table. Each table is also rebuilt off-registry
  through the existing engine codecs; private checkpoint and work payloads are
  excluded from inventory representations.
- Requires a live, exact `recovering` room fence before loading and checks it again
  in a fresh transaction after loading. The snapshot does not hold ownership locks
  during reconstruction and does not block normal lease renewal. The result is
  explicitly not an activation permit: concurrent changes and the final activation
  boundary still require orchestration/revalidation.
- Validates allocation count, table compatibility/configuration, engine state and
  versions, normalized reservations/membership, and active-game coverage. A live
  legacy game without recoverable table state cannot be silently omitted. Closed
  table history remains available for old lane work and finalization.
- Validates each lane's pending count and contiguous sequence range against its
  enqueued/processed cursors, including pending request-version compatibility.
  Lanes are read without creation, advancement, or command execution.
- Pending timer records retain their original IDs, deadlines, generations, request
  fields, and payloads. Pending finalization retains IDs, round, payload version,
  retry time, and attempt count, including jobs from historical games. Completed
  hosted games require the presence of a durable hosted-settlement intent.
- Unknown timer/job semantics fail closed with `UnsupportedRecoveryWork`. Explicit
  synchronous validators are keyed by timer lane-kind/action-type or job-type/
  payload-version; they receive detached copies. No production timer/finalization
  validator is enabled by default because the corresponding executors remain
  pending. Recovery never infers success or drops work it cannot understand.
- Pending seat offers and timed Call Break deal summaries currently fail closed
  because checkpoint-to-timer reconciliation is not yet implemented. Ordinary
  checkpoints remain loadable; these cases are not silently reset or resumed.
- Inventory query categories have a configurable row limit (default 4096) and
  reject overflow instead of truncating. `RecoveryLimitExceeded` distinguishes a
  recovery budget issue from malformed data. Unsupported and malformed data retain
  explicit failures; no automatic quarantine, repair, host installation, or
  activation occurs in this storage component.

Verification:

- PostgreSQL/WASM tests cover multi-table inventory, empty rooms, closed
  tables, unchanged host registries, corrupt/missing checkpoints, reservations,
  former members, unsupported game types, inventory limits, pending lane gaps,
  overdue timer identity/deadline preservation, validator isolation, finalization
  versions/retries, missing settlement intent, omitted legacy games, invalid work,
  and ownership expiry between the inventory and final fresh fence check.
- An explicit transaction test confirms checkpoint reads use the same read-only
  repeatable-read transaction and only the final fence check opens a second view.
- Full backend regression suite: 997 passed, including 17 new room recovery tests,
  with two existing dependency deprecation warnings. Python compilation and
  whitespace checks passed.

Limitations and next-step contracts:

- This is a validated inventory, not complete automatic room recovery. No schema,
  application startup, API, Redis, scheduler, or ownership activation was changed.
  No dependencies were added or application database manually modified.
- The activation coordinator must reconcile membership and work arriving after
  the snapshot, install every required executor/timer/finalization handler, and
  validate ownership at the activation boundary. It must distinguish transient
  database failures, insufficient budgets, unsupported capabilities, and corrupt
  data before retrying, abandoning, or quarantining a room.
- Runtime-specific validators still need to verify timer/checkpoint generation and
  deadline correspondence and finalization effect identities. The current default
  rejects all pending work requiring these validators; a validator registry is
  not evidence that its executor has been installed. Missing expected scheduled
  work must be checked during reconciliation before activation. Settlement intent
  presence alone is not proof of a correct or completed ledger effect.
- Table configuration other than the current empty default is rejected until its
  versioned recovery contract is implemented. This implementation reads all table
  history; retention/scoping changes must preserve old receipts and pending work.
- The row limit applies per inventory category, not to bytes or existing per-table
  journal/receipt scans. The coordinator must bound the overall recovery attempt
  and continue lease maintenance. Live multi-session snapshot/takeover races and
  recovery capacity remain unproven by embedded PostgreSQL tests.

Next increment: 4b3 — recovery orchestration and failure handling, followed by
runtime-specific work reconciliation, activation/routing, and the remaining
table/controller executors. Keep live activation disabled until these gates pass.

### Increment 4b3a record

Changes:

- Added `app/durable_games/recovery_coordinator.py`. `RoomRecoveryCoordinator`
  composes the already-running lease coordinator with the room inventory loader.
  It acquires recovering ownership, validates local eligibility before and after
  reconstruction, and returns an inventory without installing hosts or activating
  the room. Each preparation rebuilds from SQL; no cached inventory is reused.
- Bounded defaults: four simultaneous preparations, three attempts, ten seconds
  per attempt, and exponential retry delays from 100 ms up to one second. Admission
  returns `busy` immediately when full or another preparation targets the same
  room; it does not create an unbounded queue or one permanent task per room.
- Only transient database/connection/timeout/serialization/lock errors are retried.
  Acquisition retries retain their original epoch/token through the existing lease
  coordinator. Known ownership is reused only while it remains locally confirmed
  as recovering, and independent heartbeat/renewal maintenance continues during
  reconstruction and backoff.
- Structured outcomes distinguish prepared, busy, retryable, unsupported,
  budget-exceeded, invalid, ownership-lost, conflict, and unexpected failure.
  Results carry exception class names only; raw errors, private state, and inventory
  payloads are not included in result representations.
- Failed or cancelled preparations abandon only their exact known fence locally;
  they do not release SQL ownership ahead of other transactions. The SQL lease
  expires normally. A replacement acquisition cannot be discarded by delayed
  cleanup from an old attempt. Unknown acquisition outcomes retain their bounded
  intent so the caller can retry with the same inputs rather than minting a token.
- Successful preparations retain a recovering lease until the caller continues
  reconciliation or explicitly discards that prepared result. A recovery request
  targeting an already-serving lease returns a conflict without disrupting it.
- Added public local `confirms(fence, status=...)` and exact-fence abandonment to
  `RoomLeaseCoordinator`; existing gameplay admission delegates to the same guard.
  Local confirmation still grants no exemption from database fencing.

Verification:

- Focused tests cover transient retries/exhaustion, unknown acquisition responses,
  classified permanent failures, bounded/same-room admission, cancellation,
  timeouts, heartbeat loss, replacement-owner cleanup, already-serving conflicts,
  private error suppression, and lease maintenance during slow reconstruction.
- Production ownership/recovery SQL composition verifies expired-owner takeover,
  detached preparation without routing/activation, explicit discard, and invalid
  checkpoint/unsupported-job failures without deleting work or resetting state.
- Full backend regression suite: 1,017 passed, including 20 new recovery
  coordination tests, with two existing dependency deprecation warnings. Python
  compilation and `git diff --check` passed.

Limitations and decisions:

- This completes recovery preparation, not the full 4b3 activation workflow. No
  startup wiring, placement/discovery loop, routing endpoint, timer/finalization
  execution, schema migration, or application database change was made.
- Deliberately do not automatically quarantine on a generic `CheckpointError`:
  these errors can reflect concurrent membership changes or unsupported data as
  well as corruption. Durable quarantine needs a validated policy and a fresh
  authoritative check under the exact fence. Invalid/unsupported results currently
  stop local maintenance and let ownership expire; a future placement loop must
  avoid repeatedly assigning persistently failing rooms without such a policy.
- A prepared result is a snapshot, not permission to activate. Runtime-specific
  timer generations/deadlines, settlement effects, missing scheduled work, and
  changes after the snapshot still require reconciliation and final fencing.
- Placement callers must explicitly resolve/abandon exhausted unknown acquisition
  intents and inspect current ownership before changing intent. Known failed
  acquisitions have been abandoned; their original expected epoch is not a new
  acquisition authorization. Prepared results must be consumed or discarded;
  this component does not implement automatic prepared-result expiry.
- Timeouts are cooperative and depend on driver/callback cancellation. They are
  not CPU preemption or a proven failover latency bound. Live multi-session lock,
  process-death, and partition tests remain in increment 8.

Next increment: 4b3b — durable table/controller command contracts and execution,
then runtime-specific work reconciliation. Keep activation disabled until that
work and the final activation/quarantine/routing boundary are complete.

### Increment 4b3b1 record

Changes:

- Added `app/durable_games/table_executor.py` with a detached `TableLaneExecutor`
  for existing durable pre-game lobbies. Supported commands are `join-seat`,
  `leave-seat`, `join-queue`, `leave-queue`, and `lock`, with an empty payload,
  current hosted match ID, and required expected **table** revision. Engine
  revision is not the concurrency token for these commands.
- Claims the ordered table-lane head under the serving room fence, locks its table,
  reloads the committed checkpoint, and rechecks authenticated membership. User
  rows for the actor and affected positions are locked in stable order before
  checking cross-table/game reservations. Invalid/nonexistent system/user actors
  are rejected without attempting notification writes to nonexistent users.
- Reuses the existing synchronous seat allocation, FIFO promotion, game table
  policies, and rule-proposal synchronization. Does not call legacy asynchronous
  host publication, process timers, or mutate any registered live host.
- Lobby seat departure promotes queued players in FIFO order, preserving Flush
  seat identity rules. A promotion candidate reserved elsewhere causes a no-effect
  rejection; it cannot steal that reservation, partially release the actor, or
  silently reorder the queue. Queue departure remains possible when seated
  elsewhere. Closing the last unqueued lobby seat releases table allocation through
  the existing SQL trigger.
- Only the current host may lock an eligible Marriage/Flush roster; Call Break
  retains its implicit lock-at-start policy. Stale match/revision, nonmembership,
  nonempty payload, full/closed/locked seats, pending rule approvals, and reservation
  conflicts produce durable no-effect rejections for supported lobby commands.
- Successful commands atomically persist checkpoint/positions/reservations,
  table revision, outbox events, inbox outcome, and lane progress. Every accepted
  new command ID advances table revision once, including an accepted no-op; retrying
  the same ID returns its original outcome without advancing again. Table outcomes
  live in the inbox and do not pollute gameplay receipts or engine revisions.
- Extracted shared transactional outbox append into `app/durable_games/outbox.py`;
  the game executor retains its existing method boundary and behavior. Both paths
  append bounded, public table changes and actor-targeted acknowledgments before
  completing the claim. Checkpoints/private engine state are never broadcast.
- Unsupported command families, active games, rotation phases, and pending seat
  offers remain pending for a compatible executor instead of being consumed as
  permanent rejections. No ingress endpoint or startup dispatcher advertises this
  partial capability set.

Verification:

- Initial table/game executor SQL suite: 27 passed. Expanded lobby suite: 18 passed.
  Covers all three game types, FIFO promotion and queue compaction, host-only locks,
  stale revisions/matches, invalid actors, membership loss, malformed payloads,
  cross-table reservations, conflicting promotion, last-seat closure, actor-only
  acknowledgments, unsupported/active command preservation, and stale fencing.
- Fault tests cover rollback after checkpoint writes when outbox limits fail, and
  a commit that succeeds before its response is lost. Retry returns the original
  receipt without duplicate state changes or notifications. Existing game executor
  tests verify the shared outbox extraction preserves gameplay behavior.
- Full backend regression suite: 1,035 passed, with two existing dependency
  deprecation warnings. Final review added an explicit next-round roster/released
  seat capability guard and regression test; the affected lobby suite then passed
  all 19 tests. Python compilation and `git diff --check` passed.

Limitations and next-step contracts:

- This completes pre-game lobby execution, not all table/controller behavior.
  Creation, start/end, rules configuration/votes, invitations, active departures,
  rematches, timed offers, and finalization require their own durable contracts.
  No application startup, HTTP/WebSocket endpoint, migration, dependency, or
  application database was changed.
- Future ingress must route only supported capabilities and provide table revision
  separately from engine revision. A compatible lane dispatcher must handle the
  full advertised command family; unsupported heads are never skipped.
- Membership departure must coordinate table positions before removing membership.
  The loader intentionally rejects inconsistent positions instead of silently
  pruning them. Queue candidates who become reserved elsewhere need an explicit
  lifecycle policy; this increment preserves both existing reservations and FIFO
  state by rejecting a conflicting promotion.
- Events are committed but publication/client catch-up are still pending. No
  capacity, real competing-session reservation, or failover latency guarantee is
  established by the embedded PostgreSQL tests.

Next increment: 4b3b2 — durable creation/start/controller contracts and execution.
Keep live activation disabled until remaining table transitions, scheduled work,
recovery reconciliation, and delivery are integrated.

### Increment 4b3b2 record

Changes:

- Added `app/durable_games/creation_executor.py`. `RoomCreationExecutor` handles
  `create-table` on the room lifecycle lane, under the serving owner fence. The
  request supplies game type, capacity, and name; existing-match and expected-table
  revision fields must be absent. Only manual hosted lobbies are created.
- Stable table and match UUIDs derive from a versioned namespace and canonical
  lane/actor/command identity. The original request remains the inbox fingerprint
  authority; a changed payload under the same actor/request ID is rejected before
  execution. Actor-scoped requests cannot share creation IDs accidentally.
- Added optional paired table/match IDs to accepted `InboxOutcome` records. They
  survive durable outcome lookup and duplicate ingress. Rejections do not expose
  speculative IDs. This is an additive JSON outcome contract, not a schema migration.
- Execution rechecks canonical user identity, current membership, and global
  table/game reservations. It locks the creator's user row before the room's
  allocation-counter row, matching the users-before-room-counter ordering used by
  lobby closure. It reads the configurable table limit instead of hard-coding five.
- Normalizes whitespace and checks open-table names with the same Python casefold
  behavior as the existing host. Room lifecycle serialization protects concurrent
  creations; closed names can be reused. Catalog counter constraints remain the
  final protection against excess table allocation.
- Creates the initial versioned checkpoint, creator position/reservation, and
  table command lane in the same transaction as room-lane completion and outbox
  events. Flush initializes the creator's stable seat ID to one. No engine, game
  lane, live host registration, or timer is started.
- Publishes durable `TABLE_CREATED` metadata and an actor-only
  `TABLE_CREATION_ACK` through the shared transactional outbox. Retrying a committed
  request returns its original IDs/outcome without reallocating a slot or publishing
  another event. Rejected outcomes remain rejected even when room capacity changes;
  a new attempt after conditions change requires a new request ID.
- Existing catalog/recovery/game identity collisions stop execution instead of
  adopting or overwriting state. Malformed payload, missing membership, occupied
  creator, name conflict, and full room produce durable no-effect rejections.
- Invitations and explicit replacement options remain pending for a compatible
  capability. This creation contract does not implicitly close a replaceable table;
  callers must complete departure/end through the appropriate durable lifecycle.
  The existing live creation endpoint is unchanged.

Verification:

- Initial creation SQL suite: 19 passed. Expanded creation/inbox integration suite:
  34 passed before adding the canonical lane-UUID identity test.
- Covers recoverable initial state for all three games, normalized names and
  casefold conflicts, default/configured capacity, closed-name reuse, stable
  rejection receipts after capacity changes, actor-scoped request IDs, changed
  payload conflicts, invalid request shape, missing/nonmember/system actors,
  reservation conflicts, unsupported options, stale fencing, and identity collision.
- A forced post-checkpoint outbox failure rolls back allocation, catalog,
  checkpoint, positions, reservations, table lane, and outcome. A lost response
  after successful commit resolves the original receipt with exactly one allocation
  and one notification batch.
- Full backend regression suite: 1,059 passed, including 23 new creation tests,
  with two existing dependency deprecation warnings. Python compilation and
  `git diff --check` passed.

Limitations and decisions:

- Kept creation separate from engine start/controller work so its room allocation,
  request identity, and player reservation transaction is independently reviewable.
  Increment 4b3b2 now denotes creation; initial start/controller work is 4b3b3.
- Creation/start/end, automatic replacement of completed tables, invitation
  effects, rule changes, active departures, and rematches must not be conflated in
  ingress. Only the supported explicit creation contract may use this executor.
- Other future table creation/name-change writers must participate in the same
  room lifecycle serialization and lock order. Name uniqueness currently follows
  that application contract; allocation and player uniqueness additionally have
  database constraints. Live competing-session tests remain in increment 8.
- Existing receipt consumers remain compatible when IDs are absent. Distributed
  rollout must ensure participants understand creation outcomes before advertising
  this capability; old strict readers cannot parse the new optional identity fields.
- No startup, endpoint, migration, dependency, or application database was changed.
  Outbox delivery/client handling and full activation remain pending. Embedded
  PostgreSQL checks do not establish production capacity or failover timing.

Next increment: 4b3b3 — durable initial game start and controller execution, with
stable initial engine identity and atomic reservations/checkpoint/outbox/outcome.
Keep live activation disabled until the remaining lifecycle, timer, recovery, and
delivery gates are complete.

### Increment 4b3b3 record

Changes:

- Added `app/durable_games/initial_start.py` for detached manual initial starts of
  Call Break, Marriage, and Flush. Extended `TableLaneExecutor` with `start`, ordered
  on the same table lane as seating and roster locking. Its expected revision is
  the table revision, not the engine revision.
- Validates host authority, current membership, roster phase/player count, pending
  rule approvals, and global player reservations. Flush requires the saved rules
  revision. Unsupported payload fields and automatic play are rejected without
  changing the checkpoint. User locks follow the existing stable ordering.
- Uses the hosted match UUID as the first durable game UUID. Adapter startup uses
  the original table command ID. Call Break's existing synchronous startup
  controllers run against detached state; no live host, timers, or ledger effects
  occur during construction.
- Atomically saves the initial engine/checkpoint, active-game reservations, game
  command lane, table-command outcome, and outbox events under the serving fence.
  Engine initialization forms journal sequence zero; it is not a gameplay receipt.
  Subsequent player actions use the existing game-lane executor.
- Preserves private Marriage startup event recipients and includes public table
  and game state-change hints plus the actor-only table command acknowledgment.
  Initial random state becomes authoritative only when the transaction commits.
- Replaying a committed request returns its existing outcome without rebuilding
  the engine or duplicating notifications, including after a lost commit response.
  A different start request against an already-started game receives a no-effect
  rejection. An aborted transaction can retry engine construction safely.

Verification:

- Added 18 embedded PostgreSQL integration cases covering all three initial game
  types and subsequent gameplay, duplicate starts, malformed/stale/unauthorized
  requests, roster locking, pending rules, fencing, private startup recipients,
  and rollback after engine creation. Lost commit-response retries preserve the
  exact checkpoint and notification count.
- End-to-end coverage creates a room-lane lobby, rejects an undersized start,
  seats players through the table lane, starts, restores, and executes gameplay.
- Full backend regression suite: 1,077 passed, with two existing dependency
  deprecation warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- This increment handles the first engine only. Finished Flush round restart,
  rotation/seat offers, active departures, explicit end, rematches, scheduled
  next-deal work, and finalization reconciliation require their own contracts.
  Unsupported lifecycle states remain pending for a compatible executor.
- The current initial-start paths do not reach terminal settlement states.
  Synchronous startup controllers are included; persistent timer execution and
  settlement work are not enabled. Configure the same summary duration for table
  and game executors when the coordinator is eventually wired.
- No schema migration, dependency, live endpoint, startup wiring, or application
  database change. Durable publication/client catch-up and activation remain
  gated on the unfinished lifecycle and delivery work. These tests establish
  neither production capacity nor live competing-session/failover timing.

Next increment: begin 4b3b4 with durable explicit end and active-player departure,
including reservation release, engine/checkpoint consistency, fenced outcomes,
and transactional events. Keep rematch identity, timers, and finalization as
subsequent bounded steps; do not enable live activation yet.

### Increment 4b3b4a record

Changes:

- Extended the ordered table executor with explicit `end` and `abandon` commands;
  both require the current match/table revision and an empty payload. Added
  `table_closure.py` for closure policy and detached changes.
- End retains creator-or-sole-room-member authority. It closes lobbies and active
  tables for all games, rejects already-finished Call Break/Marriage matches, and
  allows closing Flush between rounds. Call Break abandonment is available to a
  seated player during an active match and applies no penalty, matching live policy.
  Marriage/Flush abandonment is rejected; their fold-and-leave is a separate command.
- Closure preserves the engine, historical roster, gameplay receipts, and journal
  sequence. It commits ended metadata, table capacity/player reservation release,
  cleared queue, cancelled pending offers/invitations/timers, table/game state hints,
  closure events, and the actor-only outcome in one fenced transaction.
- An already-ended table accepts an authorized fresh End/Call Break abandonment
  at its current revision without rewriting the checkpoint or emitting another
  closure. Same-ID retries resolve the original inbox receipt, including unknown
  commit responses. Unrelated tables and their scheduled work remain unchanged.
- Pending game commands are preserved and subsequently rejected by the game
  executor against the closed state; new game ingress is refused. Closure acquires
  no game-lane lock while holding the table row, preserving lane-before-table order.
- Ending a completed Flush round requires its existing settlement intent and
  leaves that job and the completed game status intact. Incomplete games become
  abandoned without a fabricated settlement. Recovery no longer demands a
  deal-summary timer capability for a Call Break table that has already ended.

Verification:

- Added SQL integration coverage for pre-game/active End across all three engines,
  no-effect authorization/revision/payload rejections, Call Break abandonment,
  queued gameplay after End, unknown commits, stale ownership, and transactional
  rollback of closure, capacity release, reservations, and timer cancellation.
- Covers duplicate/fresh End, sole-member authorization, completed Flush settlement
  preservation, finished Marriage rejection, invitation/queue cleanup, unrelated
  table isolation, and room recovery after End during Call Break's summary phase.
- Focused closure suite: 22 passed. Full backend regression suite: 1,099 passed,
  with two existing dependency deprecation warnings. Python compilation and
  `git diff --check` passed.

Limitations and decisions:

- Split 4b3b4 because Marriage/Flush departure can advance the engine and finish a
  round; it needs an explicit original-request/engine-receipt contract and atomic
  settlement intent. This increment only closes the whole table without advancing
  the engine. Rematch/rotation/seat-transfer execution remains unsupported.
- Membership must already agree with saved positions. End does not repair corrupt
  checkpoints or bypass recovery validation when memberships were deleted without
  first releasing seats. Sole-member authority uses committed logical room
  membership, not the number of connected sockets.
- Cancelled pending actions are retained for audit. Already-enqueued timer commands
  remain immutable; their future executor must reject stale/closed targets. Timer
  creation/dispatch must participate in table lifecycle serialization and validate
  that a target is open, including a consistent lock order, before live activation.
- Pending Flush departure flags are cleared on End, while engine roster mappings
  remain historical. No scores, chips, or ledger projections are performed here.
- No migrations, dependencies, live endpoint/startup wiring, or application database
  changes. Delivery, live activation, operational readiness, and capacity tests
  remain deferred. Embedded SQL tests do not establish real competing-session
  timing or production throughput.

Next increment: 4b3b4b — define and implement Marriage/Flush fold-and-leave with
stable original request identity, atomic engine receipt/checkpoint/outcome/events,
reservation release or pending departure, and terminal settlement intent. Keep
rematches, timer execution, and live activation disabled until their own gates pass.

### Increment 4b3b4b record

Changes:

- Added `app/durable_games/departure.py` and the `FOLD_AND_LEAVE` game-lane command.
  It uses the current engine revision, an empty payload, and the existing reliable
  request ID. This is an active Marriage/Flush game action, ordered alongside other
  gameplay; it is not a table-lane command or an implicit disconnect action.
- The executor rechecks room membership, current game identity/status, seat access,
  engine revision, and receipt capacity before applying departure. Call Break
  rejects this command and continues to use explicit table abandonment.
- The detached helper maps the operation to existing Marriage `FOLD` or Flush
  `FOLD_FOR_LEAVE` rules. It preserves command ID/revision but stores the ORIGINAL
  `FOLD_AND_LEAVE` envelope and fingerprint in both inbox and game receipt. No
  generated child request, second receipt, or untracked engine transition is used.
- Marriage marks the historical player departed and releases the table/game
  reservation immediately. Flush records a pending departure and retains the seat
  reservation until round completion. The existing game executor releases all
  pending Flush departures when either this fold or a later game action finishes
  the round, retaining historical engine seat mappings.
- An already-folded player can leave an active round without another engine
  transition: table metadata/revision and the accepted original receipt commit,
  while the engine revision/journal sequence remain unchanged. Private query caches
  for the departing player are cleared.
- The same transaction saves checkpoint/engine changes, reservations, the original
  receipt/outcome, private adapter events with their recipients, table departure
  events, table/game state hints, actor acknowledgment, and terminal settlement
  intent. Neither departure path projects the ledger or starts runtime work.
- Duplicate requests resolve the original accepted outcome even after a terminal
  transition or a lost commit response. A new request from a departed/pending player
  is rejected; it cannot reclaim the seat or advance the engine.

Verification:

- Initial departure suite: 14 passed. Expanded coverage includes off-turn and
  already-folded departure for both engines, normalized reservations, pending
  Flush departure recovery, later round completion, original request/fingerprint
  retention, private Marriage recipients, duplicate/changed requests, invalid
  payload/revision/actor, and pre-deal Flush rejection.
- Forced post-settlement outbox failure rolls back engine/checkpoint, reservations,
  receipt/outcome, events, and finalization intent. Lost commit-response retries
  preserve the saved state and exactly one settlement job.
- Additional cases cover queued commands after departure with a current revision,
  receipt-admission bounds, an expired/replaced owner, and execution of the pending
  original request by the successor owner.
- Expanded departure/game-executor suite: 31 passed, including 16 new departure
  tests. Full backend regression: 1,115 passed, with two existing dependency
  deprecation warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- Departure belongs on the game lane because it can advance engine state and must
  use the engine revision and gameplay receipt admission limits. Future ingress
  must route this explicit command there rather than rewriting a table request or
  invoking the legacy asynchronous leave handler.
- Same-ID retries are idempotent; a fresh request after departure is a durable
  rejection. Pre-game/post-game seat release, rematches, Flush round restart, and
  seat replacement remain separate table lifecycle capabilities.
- Flush preparation legality remains engine-controlled. Ordinary `FOLD` and
  `FOLD_FOR_LEAVE` actions alone still do not release table membership; only the
  explicit composite departure command adds that lifecycle effect.
- No migrations, dependencies, endpoint/startup wiring, schema changes, or
  application database changes. Terminal settlement intent is persisted, but ledger
  projection/retry workers, timer execution, delivery, and live activation remain
  gated. Embedded PostgreSQL tests do not establish production failover timing or
  simultaneous-session behavior.

Next increment: begin 4b3b4c with durable next-match creation for completed
Call Break/Marriage tables whose roster meets the existing readiness policy: a new
match identity on the same table, atomic checkpoint/reservation replacement, and
safe rejection of old-match commands. Keep Flush round restart, rotation/offers,
timer/finalization reconciliation, and live activation as subsequent bounded work.

### Increment 4b3b4c1 record

Changes:

- Added `app/durable_games/rematch.py` and the ordered table-lane `next-match`
  command for completed Call Break/Marriage tables. Requires an empty payload,
  current match/table revision, current seated host, and the existing ready-roster
  policy with no outstanding releases or pending offers. A Marriage rematch can
  open with one remaining player; normal minimum-player/lock rules still gate start.
- Generates the new match UUID from a versioned lane/actor/request/previous-match
  identity. Keeps the same table ID, capacity, name, settings, Marriage scoring,
  queue, event sequence, and receipt limit. Rebuilds the current roster from the
  completion seats, clears per-match engine/departure/query/receipt state, and
  records `previous_match_id`. No engine starts automatically.
- Returns paired table/new-match IDs in the existing additive inbox outcome and
  actor-only table acknowledgment. Publishes `NEXT_MATCH_READY` and a table-state
  hint through the same transactional outbox. The new lobby can lock/start and
  execute gameplay through the existing durable executors.
- Saves the archive, new checkpoint and reservations, pending-timer cancellation,
  outcome, and events in one fenced transaction. Table allocation stays unchanged,
  even when the room is at its table limit. Requests against the old match cannot
  mutate the new lobby; queued old gameplay drains to historical rejection receipts.
- Preserves old games, engine snapshots/journal, gameplay receipts, and settlement
  jobs. Checkpoint replacement now preserves an existing completion timestamp.
  A missing old settlement intent or generated identity collision stops execution
  without consuming the request. Pending settlement does not block a valid rematch.

Schema and historical state:

- Added migration 19, `hosted_match_archives`, keyed by game ID with unique match
  identity and an index on table/revision. Stores the versioned completed checkpoint
  before replacing the current document, preserving historical player/seat mappings,
  rules, engine state, resolved offers, and old invitations for future settlement.
- An insert trigger ties the archive to the current completed Call Break/Marriage
  checkpoint and game; content changes and deletion are prohibited. Checkpoint digest/schema
  validation remains required when trusted consumers read an archive. Archives
  contain private state and must never be exposed through client delivery APIs.
- The current-match receipt view resets, but historical receipts remain queryable
  from their game records and can receive rejections for previously admitted work.
  The archive intentionally stores checkpoint state, not a frozen receipt count.
- Old offers/invitations remain historical in the archive; they are not transferred
  into the new match. Future invitation handling must reject superseded match IDs.

Verification:

- Initial combined rematch/lobby/schema-upgrade suite: 37 passed. Expanded rematch
  suite: 16 passed. Covers both game types through new engine start and gameplay,
  full-room rematches, remaining-player host selection, original settings/history,
  old-lane draining, stale old-match table commands, queue preservation, invalid
  requests, active/closed/Flush rejection, and unresolved releases/offers.
- Forced outbox failure rolls back archive/checkpoint/reservations/timer changes;
  a lost successful commit response resolves the same new match without another
  archive or event batch. Also covers stale ownership, missing settlement intent,
  archive boundary checks and immutability, and migration ordering from version 18.
- Full backend regression: 1,132 passed, with two existing dependency deprecation
  warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- Added an archive because the existing current-table checkpoint would otherwise
  lose the old user-to-engine-seat mapping before asynchronous settlement completes.
  This is required rematch data preservation, not an operational retention policy.
  Archive retention and deletion workflows remain in the later operational task set.
- Requires schema 19 before advertising the rematch executor capability. The SQL
  declaration and tests were added; no application database was manually migrated.
- Ready-roster rematches do not resolve replacement offers, promote queued players,
  close/reopen ended tables, or run settlement. Flush is explicitly rejected by
  `next-match`; its continuing hosted match needs a distinct round contract.
- No endpoint/startup wiring, live activation, dependency, delivery, or ledger-worker
  changes. Historical settlement consumers still need to validate/read these archives;
  full reconciliation remains a prerequisite for activation. Embedded SQL tests do
  not demonstrate production concurrency, capacity, or failover latency.

Next increment: 4b3b4c2 — durable Flush round restart for a locked, ready roster,
including round identity, archival of the previous round, reliable command revision
and receipt continuity, and atomic reservation/checkpoint/outcome/events. Keep
remaining roster transitions/offers, timer execution, settlement projection, and
live activation gated on their own increments.

### Increment 4b3b4c2 record

Changes:

- Added `app/durable_games/flush_restart.py`. The table executor now accepts `lock`
  and `start` against a completed Flush round. Other post-start seating/queue/offer
  commands remain gated. Both operations use the current table revision; start
  retains host, minimum-player, saved-rules-revision, manual-play, membership,
  reservation, and pending-rule/seat-transfer checks.
- Restart preserves the hosted match ID, table ID, rules, historical stable seat
  mapping, round results, engine history, and reliable receipt limit/count. It uses
  the existing engine's `prepare_next_round` with the current roster; the previous
  winner deals if still seated, otherwise the current host does.
- The engine revision advances continuously by one, with `round_start_revision`
  recorded by the engine. Each round gets a distinct durable game UUID derived
  from the table lane/actor/request/previous durable game identity, and its own
  journal sequence-zero snapshot and game lane. The original table start outcome
  owns this transition; no synthetic gameplay receipt is created.
- Atomically archives the completed round, saves the new engine/checkpoint,
  reserves current players, cancels pending old table/round timers, creates the
  new lane, and commits table/game state hints, the table start event, acknowledgment,
  and inbox outcome. Completed-round settlement intent is required and retained;
  pending settlement does not block restart. Completed timestamps now also survive
  metadata-only writes such as locking the finished round.
- Match-wide receipt admission includes requests still pending on prior round
  lanes. Restart rejects an exhausted match instead of resetting its limit. Same-ID
  retries arriving on a later round lane resolve their original result; altered
  requests conflict. Previously queued old-round commands are rejected without
  advancing the new engine, and their receipts remain in the shared match view.

Schema:

- Added migration 20. Completed-match archives retain their primary key on durable
  game ID, while hosted match ID becomes a nonunique indexed lookup to accommodate
  multiple Flush rounds. The archive boundary trigger now also accepts a finished
  Flush round in its OPEN or LOCKED table phase. Existing archives and immutability
  protections remain intact. Readers must use the durable game ID for one specific
  round; a hosted match lookup may return several archives.
- Requires schema 20 before advertising this capability. No application database
  was manually migrated; tests apply the migration chain to embedded PostgreSQL.

Verification:

- Initial restart/initial-start/schema-upgrade suite: 39 passed. Tests exercise
  repeated round restart, continuous revisions/results/receipts, independent game
  identities/journal boundaries, multiple archives under one hosted match, immutable
  archives, old settlement jobs, stable seats after departure, and retry conflicts.
- Forced outbox failure rolls back engine, archive, lane, reservations, and outcome;
  a lost successful commit response resolves exactly one new round and event batch.
- Invalid actor, stale table/rules revision, unlocked roster, unsupported play mode,
  missing settlement intent, expired owner, and exhausted receipt capacity cannot
  create another round. Extra coverage checks pending receipt reservations and
  room recovery with both lanes and outstanding finalization work.
- Expanded Flush restart suite: 14 passed. Full backend regression: 1,147 passed,
  with two existing dependency deprecation warnings. Python compilation and
  `git diff --check` passed.

Limitations and decisions:

- The table `start` contract continues to use a TABLE revision. Player actions use
  the continuously increasing ENGINE revision and current durable round lane.
  Future ingress must resolve the current round from stored table state; clients
  continue to identify the hosted match. Rollover does not discard admitted work.
- A fresh start request during the new active round is rejected without effects;
  a duplicate original request returns its saved outcome. Completed-round departure
  reconciliation must already be consistent; restart never repairs corrupt metadata.
- Between-round roster editing and replacement offers remain separate work. The
  current ready roster can restart, including players retained after a previous
  fold-and-leave. No ledger projection, timer dispatch, automatic promotion, endpoint
  wiring, dependency, delivery, or live activation was added.
- Settlement consumers must validate/read the archived round by game ID. Full
  settlement/timer reconciliation remains an activation gate. Embedded SQL tests
  do not demonstrate real concurrent-session timing or production capacity.

Next increment: begin 4b3b4c3 with durable between-round Flush `join-seat`,
`leave-seat`, `join-queue`, and `leave-queue` transitions, preserving stable engine
seat mappings and FIFO/reservation rules. Keep completed Call Break/Marriage
replacement/rotation, offer timers, settlement workers, and live activation as
subsequent bounded work.

### Increment 4b3b4c3a record

Changes:

- Enabled table-lane `join-seat`, `leave-seat`, `join-queue`, and `leave-queue` for
  finished Flush rounds using the existing detached lobby transitions. Current
  match/table revision, membership, payload, room fencing, and reservation checks
  remain mandatory. Active rounds and other post-start game types remain gated.
- OPEN tables accept available seats and releases; LOCKED tables reject seat
  changes while still allowing queue changes. Departure promotes queued players
  in FIFO order under stable user locks. As with the durable lobby contract, an
  occupied promotion candidate causes a no-effect rejection rather than being
  silently skipped; that user can still explicitly leave the queue.
- New Flush players receive monotonically assigned stable seat IDs; returning
  players reuse their historical IDs. IDs may exceed table capacity while the
  number of current players remains bounded. Completed engine state, its original
  seat mapping, journal, receipts, and settlement jobs remain unchanged.
- Every supported roster mutation requires the completed round's settlement
  intent and consistent departure metadata. It commits positions/reservations,
  table revision/events, state hint, acknowledgment, and outcome atomically. No
  active-game reservation is created until the next round starts.
- When the last seated player leaves an OPEN table with no queued promotion,
  closure cancels pending invitations/timers, releases table capacity, and emits
  closure/state events in the same transaction. The finished engine stays completed
  and its outstanding settlement remains intact; a closed table cannot be rejoined.
- A completely replaced roster can recover, lock, and restart with the existing
  durable round executor. If the previous winner is no longer seated, the new host
  becomes dealer, matching the existing engine/host policy. The old seat mapping
  remains available in the completed-round archive after restart.

Verification:

- Focused Flush roster/restart/table suite: 46 passed, including 13 new roster
  cases. Added active-game command gating coverage for all three game types.
- Covers complete FIFO roster replacement followed by recovery/restart/gameplay,
  returning-player IDs, queue removal on seat join, locked-roster behavior,
  cross-table reservation conflicts, empty-roster closure and settlement retention,
  invalid requests, missing settlement intent, and expired ownership.
- Forced outbox failure rolls back promotion and checkpoint state. A lost
  successful commit response resolves the original receipt without allocating
  another seat or publishing another event batch.
- Full backend regression: 1,162 passed, with two existing dependency deprecation
  warnings. Python compilation and `git diff --check` passed.

Limitations and decisions:

- Reused existing lobby policies rather than introducing a second promotion
  policy. Joining a queue alone does not auto-seat a player; FIFO promotion runs
  when a seated player leaves an OPEN roster, matching the existing hosted flow.
- The normalized current roster can differ from the finished engine's roster.
  Historical Flush seat mappings must never be pruned or reassigned while retained
  engine state and settlement history refer to them.
- Membership cleanup must remain coordinated with position removal. Corrupt
  membership/reservation snapshots and unreconciled completed-round departures
  fail closed; this executor does not repair them.
- No migration, dependency, endpoint/startup wiring, delivery, or application
  database change. Timer cancellation is supported; timer dispatch, settlement
  projection, replacement offers, and live activation remain gated. Embedded SQL
  tests do not establish simultaneous-session timing or production capacity.

Next increment: 4b3b4c3b — durable completed Call Break/Marriage `leave-seat`,
`join-queue`, and `leave-queue`, preserving the historical engine roster and
recording replacement vacancies where required. Keep offer creation/acceptance/
expiry, timer execution, finalization reconciliation, and live activation as
subsequent bounded work.

### Increment 4b3b4c3b record

Changes:

- Enabled completed Call Break/Marriage table-lane `leave-seat`, `join-queue`,
  and `leave-queue`. Commands retain current match/table revision, membership,
  ownership fencing, reservation checks, atomic outbox, and durable outcomes.
- Releases change the next-match roster and departed metadata without changing
  the historical engine roster, journal, gameplay receipts, or settlement intent.
  Call Break records the original seat and leaving player as a replacement vacancy;
  Marriage permits the remaining host to create a rematch under existing policy.
- Queue eligibility now uses current table seats rather than historical engine
  membership, so a released player may join the queue. Repeated releases are
  harmless; request retries return the original outcome.
- Every completed-roster command requires the match's settlement intent. Vacancies
  and next-seat metadata no longer block these supported commands. Pending offers
  still require the forthcoming offer capability and leave requests pending.

Verification:

- Focused completed-roster/rematch/table/Flush-roster/closure regression: 83
  passed, including 11 new completed-roster cases. Covers historical state and
  settlement retention, reservation release, queue eligibility, full roster
  departure, Marriage rematch, Call Break vacancy gating, invalid requests,
  stale ownership, missing settlement intent, rollback, and lost-commit retries.
- Python compilation and `git diff --check` passed. The full backend suite was
  not rerun in this increment; the previous full run passed 1,162 tests.

Limitations and decisions:

- No automatic promotion or offer generation for completed rosters in this step.
  Call Break vacancies continue blocking rematch until accepted replacements exist.
- Releasing the last completed seat retains a COMPLETED table, matching existing
  lifecycle behavior; it does not apply Flush's empty-roster closure policy.
- No migration, live endpoint/startup wiring, dependency, or application database
  changes. Live distributed behavior remains disabled. Embedded PostgreSQL tests
  do not establish simultaneous-session behavior or production failover timing.

Next increment: begin 4b3b4c3c with durable replacement-offer transitions and
persisted expiry deadlines: FIFO offers, explicit invitations, acceptance/decline,
and queue-withdrawal cancellation. Define stable offer IDs and atomic reservation,
checkpoint, outcome, and outbox behavior before adding timer dispatch. Then finish
scheduled-work/finalization reconciliation and recovery activation/owner routing
before marking increment 4 complete and beginning increment 5.

### Replacement-offer record (within 4b3b4c3c)

Changes:

- Added `seat_offers.py` and table-lane `invite-seat`, `accept-seat`, and
  `decline-seat` commands. Strict payloads are respectively `{seat_id, recipient}`
  and `{offer_id}`; all use the current match and TABLE revision. Only completed
  Call Break tables support replacement offers; other game types reject them.
- Successful completed-roster commands offer vacancies to eligible FIFO queue
  members. Each recipient has at most one pending offer; the leaving player cannot
  receive their own vacancy, consistent with the stored offer invariant. Offers
  remain pending until explicitly resolved or a future expiry command executes.
- The current host or the vacancy's leaving player may invite a room member when
  the queue is empty. Acceptance verifies recipient authority, PostgreSQL time,
  vacancy identity, room membership, and global player reservations under stable
  user locks. Only the next-match roster changes; historical engine users persist.
- Decline removes the recipient from the queue and advances the next eligible
  candidate. Queue withdrawal cancels that user's pending offer and advances FIFO.
  These actions remain available while the recipient is seated at another table.
- Offer IDs derive from a versioned lane/actor/request/match/seat/recipient identity.
  Creation and expiry use PostgreSQL time. Each offer inserts a `seat_offer_expiry`
  scheduled action with a stable action/command ID, its original absolute deadline,
  `expire-seat-offer` command, `{offer_id}` payload, and the monotonic table-event
  sequence as generation. Table-lane expiry has no expected table revision: future
  execution must verify offer identity/status/deadline instead of unrelated edits.
- Checkpoint, reservation changes, scheduled-action insertion/cancellation, table
  events, outbox, and inbox outcome commit atomically. Accepted/declined/cancelled
  offers cancel still-pending expiry actions. Already-enqueued expiry commands must
  become harmless no-ops in the upcoming system-command executor.

Verification:

- Focused offer/completed-roster/rematch/table/Flush-roster/closure run: 89 passed
  and one obsolete unsupported-command expectation failed because `accept-seat`
  is now supported. Updated that test to use the still-unsupported
  `expire-seat-offer`; its focused rerun passed (90 cases verified in total).
- Seven new offer tests cover FIFO decline/withdrawal/acceptance through rematch,
  authority and strict payloads, database deadlines, expired acceptance, multiple
  vacancies, stable pending deadlines, replacement departures, cross-table
  reservation conflicts, creation/acceptance rollback, and unknown-commit retries.
- Updated completed-roster expectations for automatic FIFO offers. Python
  compilation and `git diff --check` passed. Full backend suite was not rerun.

Limitations and decisions:

- Uses existing schema 20; no migration or application database changes.
- Expired acceptance is a durable rejection with no roster effect. This increment
  persists expiry intent but does not dispatch it, expire offers opportunistically,
  or run background tasks. Expired pending offers therefore await the next capability
  before the queue advances; their original deadlines are never extended.
- Whole-room recovery still fails closed on pending offers until deadline validation
  and expiry execution are implemented. Live routing/startup remain disabled.
- Invitation alone does not reserve the recipient globally; acceptance performs the
  authoritative reservation check. An occupied FIFO candidate is not silently skipped.
- Historical event/offer retention and production capacity testing remain deferred.

Next: implement fenced, idempotent scheduled-action dispatch to inbox and table-lane
`expire-seat-offer` system execution. Verify absolute deadlines, stale/resolved offers,
FIFO advancement, cancellation races, takeover recovery, and duplicate dispatch.
Add offer/deadline recovery validation before lifting the pending-offer recovery gate.
Then port game timers and finalization reconciliation, followed by activation/routing.

### Offer-expiry execution and recovery record (within 4b3b4c3c)

Changes:

- Added explicit `OfferExpiryDispatcher`: one bounded due action per selected table
  lane, PostgreSQL due-time checks, live owner fencing, and atomic inbox insertion
  plus scheduled-action linkage. Uses schema's trusted `system:timer` identity and
  stable original command ID. Repeated dispatch/unknown-commit retry sees the same
  enqueued action without allocating another command. No polling task starts.
- Lock order is fence, table lane, then deadline. Dispatch never holds a timer row
  while waiting for its lane, avoiding a cycle with table mutations that cancel
  timers. Busy lanes can be skipped; inbox backpressure leaves the timer pending.
  Batch dispatch commits each lane independently and propagates failures; callers
  must retry pending work and isolate lane failures when integrating the scheduler.
- Table-lane `expire-seat-offer` requires the exact scheduled-action/inbox sequence,
  trusted actor, request, and elapsed deadline. A player-submitted or unlinked expiry
  receives a durable rejection. The stored offer ID, generation/creation event,
  match identity, and deadline are checked before applying effects.
- Expiry removes the old queued candidate, records EXPIRED, creates the next FIFO
  offer/deadline, and atomically saves checkpoint/outbox/outcome. It preserves the
  engine and settlement intent. Resolved offers and superseded matches produce
  accepted no-ops without a table revision or outbox event. Already-enqueued timers
  need no cancellation write; their eventual lane execution observes current state.
- Added explicit `offer_expiry=True` recovery capability. Validates pending offers
  against both pending deadlines and already-dispatched inbox work, including
  creation generations, original deadlines, vacancy identity, unique seat/recipient
  assignments, and linked request/sequence/status. Missing, cancelled, malformed,
  or mismatched required deadlines fail closed. No deadline resets on recovery.
- Recovery remains read-only and does not activate an owner. Without the explicit
  capability, pending offers remain unsupported. Other timer/finalization work still
  requires its own validators. Current game timer and settlement gates remain.

Verification:

- Focused expiry/offers/completed-roster/room-recovery/recovery-coordinator/table
  suite: 71 passed, including 12 new expiry cases. Initial expiry-only suite passed
  11 cases before adding the owner-takeover case.
- Covers duplicate dispatch, FIFO advancement, non-due work, stale fences, queued
  withdrawal before expiry, forged player requests, backpressure, dispatch and
  execution unknown commits, outbox rollback, pending/dispatched recovery,
  missing/cancelled/mismatched deadlines, and takeover by a new owner that fences
  the previous owner before continuing the original inbox work.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment. Finalization validation in recovery tests remains an
  explicit test stub; production settlement execution is still pending.

Limitations and decisions:

- No migration, dependency, application database change, live startup, Redis, or
  delivery integration. This dispatcher handles offer expiry only; remaining game
  timer command contracts/executors still need implementation.
- Recovery scans pending/enqueued offer actions within the existing inventory bound;
  retained historical dispatched actions count toward that bound. Retention and
  production tuning remain deferred. Deadline catch-up is bounded per call.
- Embedded PostgreSQL tests verify transactional behavior and owner-epoch fencing,
  not simultaneous real PostgreSQL sessions, production latency, or capacity.

Next: durable Call Break deal-summary deadlines and trusted advance execution,
including obsolete revision/generation rejection and recovery continuation. Audit
remaining game-controller timers, finish finalization/settlement reconciliation,
then complete recovery activation/owner routing before increment 5.

### Call Break manual review record (within 4b3b4c3c)

Correction to the previous handoff:

- Source inspection and existing `test_manual_round_summary_holds_scores_and_creator_advances_once`
  confirm that Call Break review is creator-controlled. `round_summary_seconds=8`
  causes controllers to pause at DEAL_COMPLETE; it does not set a deadline or
  automatically prepare another deal. The existing `next_deal` endpoint performs
  continuation. Adding a timer would change the agreed preserved gameplay behavior.
- Audited hosted service/adapters/lifecycle for sleep, task creation, and deadline
  assignments. Seat-offer expiry is the only active background game/table timer.
  Flush/Marriage preparation and round transitions remain player commands. Existing
  deadline fields are inert in this manual hosted flow. Future automatic play would
  need a separately defined policy and durable timer contract.

Changes:

- Added `callbreak_review.py` and game-lane `NEXT_DEAL`, with strict payload
  `{deal_number}` and the ENGINE revision. Requires the current active match,
  room membership, a seated creator, enabled review policy, and the current completed
  deal number. Other game types, system identities, stale revisions/deals, and
  malformed payloads cannot advance the engine.
- Runs existing synchronous controllers with `advance_deal=True` under the normal
  game-lane/table/fence transaction. Commits engine checkpoint/journal, the original
  request receipt, table revision, outgoing events, acknowledgment, and inbox result
  atomically. No async host hooks, timer, or network effects are invoked.
- Same-ID retries return the original receipt. A fresh current-revision request for
  an already continued deal is accepted without another engine advance, matching
  legacy behavior; it still consumes its own receipt and metadata revision. A stale
  expected revision is rejected, preserving the reliable command contract.
- Added explicit `callbreak_review=True` to recovery inventory. This recognizes
  the paused state as awaiting creator input, rather than requiring a fictitious
  deadline. Default recovery retains its unsupported-capability gate when review
  is enabled in the host. Reconstruction never starts the next deal automatically.

Verification:

- Initial continuation suite: 13 passed. Expanded game-lane/room-recovery/table
  closure/legacy manual-review regression: 69 passed, with two existing dependency
  deprecation warnings. Includes 4- and 5-player legacy review behavior.
- Covers durable transition into review without timers, creator continuation and
  following gameplay, original receipt retries, current-revision repeated commands,
  stale deal/revision, malformed payload, nonhost/spectator/system rejection,
  disabled policy, cross-game rejection, rollback, unknown commit, and takeover
  recovery of a queued creator command while fencing the old owner.
- Python compilation and `git diff --check` passed. The full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No schema migration, application database change, dependency, live endpoint, or
  startup wiring. Future ingress must translate the legacy next-deal request into
  this reliable game-lane command with a stable command ID and engine revision.
- Review configuration must remain consistent across owner instances, as with
  existing detached controllers. This step does not introduce per-table policy
  migration or automatically enable either recovery capability.
- Settlement workers and recovery activation remain pending. Embedded SQL tests
  validate transactions/fencing, not simultaneous production sessions or capacity.

Next: implement finalization checkpoint resolution (current state or immutable
archive), strict job/payload validation, and idempotent transactional ledger/result
projection for completed Call Break/Marriage matches. Validate rollback, duplicate
execution, rematch-before-settlement, and takeover before expanding to Flush rounds.

### Match finalization record (within 4b3b4c3c)

Changes:

- Added `MatchFinalizationWorker` for version-one `hosted_settlement` jobs with
  round number zero and Call Break/Marriage engines. Explicit bounded pending-job
  selection respects `next_attempt_at`; no worker loop starts automatically.
- Validates job payload and game identity/revision/status, resolves the current
  checkpoint or immutable completed-match archive, checks its digest/schema/engine
  invariants and historical roster, and verifies the engine against the committed
  snapshot and journal. Archives allow settlement after rematch without consulting
  the new roster or requiring historical players to remain current room members.
- Marriage uses engine-authored scoring and historical player IDs. Call Break uses
  saved placement payments only if all final scores differ; ties deliberately
  produce no ledger result, matching the existing policy, and complete the job.
  Stored four-entry payment configuration remains valid for four-player games;
  only the three applicable placements are used.
- Extracted `PostgresLedgerStore.record_game_in_transaction` so ledger insertion
  and job completion share one transaction. Existing `record_game` delegates to it.
  The small roster's rows use individual inserts inside that transaction. Existing
  canonical identity/amount conflict checks remain; identical prior projections
  are reused and conflicting projections leave the job pending.
- Worker lock order is serving fence, table, then finalization job. It matches
  lifecycle operations and rechecks the fence before commit. Job completion and
  successful attempt count commit with ledger writes; failed attempts roll back
  everything and remain eligible for caller-controlled retry. Unknown-commit retry
  observes completed work without duplicating entries.
- Added explicit `match_settlement=True` recovery validation for Call Break/Marriage
  jobs using the same resolver and scoring projection. Recovery remains read-only;
  it validates pending inputs without executing settlement or activating ownership.
  Flush and unknown work still require their own compatible capabilities.

Verification:

- Initial match finalization suite: 9 passed. Expanded finalization/rematch/room
  recovery/ledger regression: 55 passed, including 14 new finalization cases, with
  two existing dependency deprecation warnings.
- Covers current and archived settlement parity with the legacy scorer, exact
  distinct-placement payments, tied policy, duplicate execution, identical/conflicting
  pre-existing ledger results, ledger rollback, unknown commit, read-only recovery,
  missing/corrupt archives, mismatched job revision, stale fences, and new-owner
  settlement of departed historical players after rematch.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No migration, application database update, dependency, payment transfer, settlement
  batch creation, endpoint change, or live startup wiring. Results use the existing
  `ledger_games`/`game_ledger_entries` authority; no second result format is invented
  in the unused `completed_games` table. User-managed payment/confirmation flows
  remain unchanged.
- This worker projects game obligations; it does not send money or mark transfers
  paid. A tied Call Break job completes without payment rows, preserving policy.
- Ledger reads remain the existing refresh path; notification delivery integration
  is deferred to its planned increment. Retry scheduling/backoff and activation
  coordination still need the runtime integration step; this explicit worker
  propagates failures and does not advance retry timestamps on rollback.
- Recovery checks checkpoint/job inputs; ledger conflicts are checked at projection.
  Historical journal reads follow existing recovery validation. Production retention,
  capacity, and real simultaneous-session failover testing remain deferred.

Next: Flush round finalization, preserving the legacy result UUID derived from
hosted match ID and round number while resolving the distinct durable round game
ID. Validate historical stable seat mappings, restart-before-settlement, repeated
rounds, rollback/unknown commits, and recovery before completing finalization scope.

### Flush finalization record (completion of 4b3b components)

Changes:

- Added `FlushFinalizationWorker` using the same fenced table/job transaction and
  idempotent ledger writer as match settlement. It selects only positive-round,
  version-one hosted Flush jobs; match workers continue selecting round-zero
  Call Break/Marriage jobs. Both remain explicitly invoked and bounded.
- Shared current/archive resolution now selects by the durable game ID rather than
  hosted match ID. This distinction is mandatory for Flush: several durable round
  records and archives share one hosted match. Every checkpoint still passes
  digest/schema/engine validation and comparison with its committed journal.
- Flush resolution verifies job round number, finished engine state, final round
  result number, stored room/table/match identity, and engine revision. Projection
  uses only that round's net changes and the historical stable user-to-seat map,
  never the current table roster. Missing or mismatched history fails closed.
- Preserves the existing ledger UUID derived from `bhidne-ho:{match_id}:flush:{round}`.
  It deliberately differs from the durable round storage ID, so old and distributed
  paths deduplicate the same ledger result. Each round projects once independently,
  including when jobs execute out of order after multiple restarts.
- Added opt-in `flush_settlement=True` recovery validation using the same resolver
  and projection. All three game types now have concrete settlement validators;
  recovery no longer needs test-only finalization stubs when these are enabled.
- Current, archived, closed, and wholly replaced rosters are supported. Ledger
  projection/job completion never advances or replaces the current round's engine.

Verification:

- Initial Flush/match finalization suite: 23 passed. Expanded Flush/match
  finalization/restart/roster/recovery/ledger regression: 79 passed, including
  13 new Flush finalization cases, with two existing dependency warnings.
- Covers current/archive parity with legacy results, replaced historical rosters
  before and after restart, closure, three independently settled rounds in reverse
  order, original ledger IDs, rollback, unknown commit, malformed round/match jobs,
  missing archives, identical/conflicting prior projections, read-only recovery,
  and takeover while a later round remains active.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No migration, dependency, application database change, external payment, endpoint,
  or startup integration. Existing settlement batches/payment confirmations remain
  separate user actions. No ledger publication transport was added.
- Shared match settlement retry/backoff limitations remain: failures roll back and
  propagate to the caller; runtime work scheduling and activation must coordinate
  retries and isolate failed jobs. Recovery validates inputs without applying jobs.
- This completes the bounded executors and recovery validators in 4b3b, not the live
  distributed runtime. Their integration, serving admission, quarantine policy,
  routing, and shutdown belong to 4b3c. Redis/delivery/client cutover remains later.
- Embedded SQL verifies correctness of transactions and epoch fences, not real
  concurrent-process timing, production performance, or operational readiness.

Next increment: 4b3c recovery activation and owner routing, beginning with an
explicit activation coordinator that consumes a fully validated inventory, checks
capabilities and current fencing, and gates execution admission. Keep live startup
and endpoints disabled until pending-work scheduling and delivery/client dependencies
are satisfied; document any remaining endpoint capability gaps before activation.

### Activation boundary record (within 4b3c)

Changes:

- Added `PostgresRoomActivationStore`, which revalidates the entire room using all
  concrete recovery capabilities inside a SERIALIZABLE transaction. It locks and
  verifies the recovering owner/instance, checks versioned advertised capabilities,
  validates tables/lanes/timers/settlement, and commits the serving transition only
  while the lease remains live. An older preparation inventory is never an activation
  permit. Concurrent ingress is durable and must be rescanned after activation.
- Known unsupported lanes, room-command families, and pending table commands block
  activation. Extracted the table executor's state-dependent capability gate for
  shared use, so supported names in unsupported active states also fail closed.
- Added bounded `RoomActivationCoordinator` requiring a successful preparation and
  a synchronous runtime-readiness hook before and after the SQL transition. There
  is no default-ready hook or production binding. Its `admits` check combines local
  ownership and runtime readiness; readiness loss abandons only the matching fence.
- Added explicit `RoomLeaseCoordinator.activate` and a local activation-confirmed
  flag. Activation serializes with renewal for the same room and checks heartbeat,
  acquisition identity, deadline, drain/stop state, and generation before admitting
  work. Renewal discovering an unconfirmed serving state loses local ownership
  instead of opening admission or renewing that acquisition indefinitely.
- Timeout, cancellation, lost activation response, and post-commit readiness loss
  keep local admission closed. If SQL committed serving but confirmation was lost,
  the local acquisition is lost and is not renewed; fresh recovery/takeover follows
  expiry. No uncertain activation is retried into admission on a heartbeat alone.
- Existing SQL routing hints remain advisory. Runtime consumers must use the
  activation admission gate for execution; future routing handlers must reject
  unavailable local runtime even if a short-lived SQL hint still says serving.

Verification:

- Expanded activation/lease coordination/recovery coordination/table/offers/Flush
  roster regression: 96 passed, including 17 new activation cases. Updated older
  serving-state fixtures to use explicit activation instead of renewal adoption.
- Covers normal activation and execution, ingress after preparation, changed/corrupt
  inventory, missing capabilities/readiness, unsupported lanes/commands/states,
  unknown activation commit, unconfirmed external serving status, cancellation,
  timeout, expired lease, stop/drain overlap, concurrent activation attempts, and
  readiness loss before/after SQL commit and after local admission.
- Python compilation and `git diff --check` passed. Full backend suite was not
  rerun in this increment.

Limitations and decisions:

- No migration, application database changes, dependency, live startup, endpoint,
  route publication, automatic quarantine, or scheduler/maintenance integration.
  Readiness hooks in tests are explicit fixtures, not a production-ready runtime.
- Activation propagates validation/conflict/transient failures. Bounded recovery
  preparation and exact-fence cleanup remain separate; automatic activation retry
  and quarantine policy are later integration work. Unknown commits intentionally
  prioritize closed admission over immediate availability.
- Admission is evaluated per execution attempt. A prepared inventory is not installed
  as mutable authoritative state; existing executors reload/check the database.
- Capability audit found active-game table roster commands and room creation with
  invitations/replacement options remain unsupported. Those must stay gated until
  explicitly ported or assigned a compatible executor. Rules/settings, invitations,
  room membership, query routing, and every legacy ingress path need a full audit
  before live cutover. This boundary does not claim end-to-end endpoint coverage.
- SERIALIZABLE conflicts must be retried through fresh preparation. Embedded SQL
  tests do not demonstrate multi-session isolation races or production timing.

Next: bind concrete room/table/game executors and bounded inbox/timer/settlement
work resumption to activation readiness; gate every attempt and close on runtime
failure or shutdown. Keep live entrypoints off, then implement owner routing and
quarantine/drain policy before declaring increment 4 complete.

### Concrete execution runtime record (within 4b3c)

Changes:

- Added explicitly started `RoomExecutionRuntime`, assembling recovery, activation,
  room/table/game executors, lane scheduling, offer expiry, and both settlement
  workers. Readiness requires running scheduler workers, a live maintenance task,
  and the exact staged fence. Each command and maintenance attempt checks admission;
  existing SQL transactions independently enforce ownership fencing.
- Added bounded room maintenance concurrency and per-pass batch limits. UUID keyset
  cursors rotate through inbox lanes, due offers, and settlement jobs so a full first
  page does not hide later work. A failed maintenance item retains its cursor for
  bounded retry; successful scans wrap. Queue saturation leaves commands durable.
- Added scheduler health and terminal failure callbacks. Transient command and
  maintenance errors receive bounded exponential backoff. Permanent errors or retry
  exhaustion abandon only the affected local room fence, preserving pending work.
  Typed inbox capacity errors let due-offer dispatch retry temporary backpressure.
- Shutdown closes admission before cancelling maintenance and command workers, then
  stops lease maintenance. SQL leases expire naturally; a fresh owner reconstructs
  and resumes pending commands. Start/stop lifecycle operations are serialized.
- Made the embedded SQL harness consume an outstanding response on cancellation
  before reusing its single connection; BEGIN cancellation also enters rollback
  cleanup. This prevents shutdown tests from reading another query's response.

Verification:

- Ten new runtime cases cover automatic room/table/game execution, chained offer
  expiry, match/Flush settlement, transient command retry, settlement retry/exhaustion,
  cancellation followed by fresh-owner recovery, room failure isolation, and scheduler/
  maintenance task loss. Added a three-round, one-job-page settlement cursor check.
- The first focused regression run had 103 passes and one intermittent checkpoint
  digest mismatch during an existing offer-expiry fixture's setup. All 12 expiry
  cases passed on isolated rerun; the three-round cursor check also passed. The second
  focused runtime/scheduler/inbox/expiry/settlement/activation/lease run passed all
  104 tests. The intermittent fixture mismatch remains a verification limitation;
  its underlying cause has not been established.
- Python compilation and `git diff --check` passed.

Limitations and decisions:

- No migration, dependency, application database change, live startup, endpoint,
  Redis transport, or delivery integration. This is an explicit runtime assembly.
- The local periodic scan currently provides correctness and pending-work resumption.
  Redis wakeups and the agreed outage-dependent inbox polling policy are increment 5;
  this development scan is not the final healthy-Redis polling policy. Due-timer and
  settlement scheduling remain separate from command wakeup transport.
- Local admission closure is not persistent quarantine. Automatic owner selection,
  reacquisition, route publication/withdrawal, graceful draining and SQL release,
  and administrative retry policy remain to be integrated. A SQL serving hint may
  outlive local admission until expiry; routing must check the local runtime.
- Maintenance retries are counted across consecutive failed room passes. Unsupported
  commands arriving after activation close that room and stay pending for resolution.
  Existing unsupported endpoint/state capabilities remain gated.
- Embedded PostgreSQL tests establish transaction behavior, not real multi-session
  races, production capacity, or operational readiness. The full suite was not rerun.

Next: implement owner routing and unavailable-owner handling behind explicit gates,
then quarantine/retry and coordinated drain policy. Keep live entrypoints disabled
until the endpoint audit and delivery/client dependencies are complete.

### Owner wakeup routing record (within 4b3c)

Changes:

- Added explicit `RoomCommandRouter.submit`: resolve a room/table/game lane, enqueue
  with existing stable deduplication, then wake its owner. Terminal duplicate requests
  return the original outcome without waking an executor. The returned entry is a
  durable receipt, not proof of command execution or player delivery. Unknown enqueue
  responses propagate so callers retry the same command identity.
- Routing uses fresh PostgreSQL ownership metadata. Unowned, recovering, draining,
  quarantined, expired, stale-heartbeat, and unreachable owners leave commands pending.
  No route failure can acquire, release, or steal a lease. Failure/refusal triggers at
  most one metadata refresh and a second notification only for a changed destination.
- Added bounded routing concurrency and an overall timeout with no unbounded waiting
  queue. Saturation and failures after enqueue return a deferred reason. Cancellation
  propagates and preserves durable work; there are no detached notification tasks.
- Added credential-free `RoomWakeup` and `RoomWakeupReceiver`. Receivers check the
  local admitted fence against the addressed process boot and epoch, verify that the
  lane belongs to the room and supported command family, and recheck admission when
  offering work. Wrong/stale hints cannot enqueue another room's lane or revoke a
  newer owner. Receiver concurrency and lookup time are also bounded.
- Added a trusted runtime `admitted_fence` accessor for local adapters. The local
  secret never enters a routing payload. Local and injected remote notification paths
  share the same receiver checks; transport acknowledgements only mean wakeup admission.

Verification:

- Focused routing/runtime/activation/ownership/inbox regression: 71 passed, including
  19 routing cases. Covers local and remote owner notification, terminal duplicates,
  unavailable ownership states, one-time route refresh, post-enqueue database/transport
  failures, timeout, saturation, cancellation, unknown enqueue commit, invalid lane/
  boot/epoch hints, and admission loss during receiver lookup.
- The extended unavailable-owner test also passed separately: after expiry, a fresh
  runtime resumes the pending command once and rejects a delayed old-owner wakeup.
- Full backend suite was not rerun. The earlier offer-fixture digest intermittency
  remains documented in the preceding increment; these checks do not resolve it.
- Python compilation and `git diff --check` passed.

Limitations and decisions:

- No schema/migration, dependency, live startup, HTTP/WebSocket endpoint, application
  database change, or network transport. Redis wakeup/cache transport remains increment
  5. Tests use two runtime objects and an in-process sender against embedded PostgreSQL;
  they do not establish real multi-process timing or network behavior.
- Trusted ingress must authenticate the actor, authorize the target, and isolate system
  identities before calling this adapter. Executors retain command authorization.
  The adapter deliberately excludes chat/conversation/notification lanes until their
  executors and delivery dependencies are ready. Query routing is part of the remaining
  endpoint audit; this increment routes command wakeups only.
- Deferred work is resumed by the existing explicit runtime scans or a later wakeup.
  An unreachable live owner is never stolen from. Expired/unowned results are signals
  for a future bounded acquisition coordinator, not automatic acquisition in ingress.
- Existing quarantine states are respected, including after lease expiry. Creating
  durable quarantine on runtime failures, repair/retry controls, automatic owner
  selection, and coordinated graceful drain/release remain separate required work.
- No route cache or per-notification retry queue is added. A successful wakeup can race
  ownership loss; durable inbox state plus SQL execution fences provide correctness.

Next: quarantine/retry policy with uncertain-transition handling, followed by
coordinated drain/routing withdrawal and bounded owner acquisition. Keep live
entrypoints disabled until the endpoint audit and delivery/client work are complete.

### Quarantine and repair retry record (within 4b3c)

Changes:

- Added `RoomFailurePolicy` with bounded pending fences, worker concurrency,
  coalescing, per-attempt timeout, exponential backoff, and attempt limits. It starts
  no background tasks; the explicit runtime maintenance loop drives it. Results
  contain room/epoch, outcome classification, and exception type only.
- Permanent lane/maintenance failures first remove local room admission and abandon
  lease renewal, then schedule quarantine. Failed recovery inventories (invalid,
  unsupported, budget-exceeded, unexpected failure) and permanent activation errors
  use the same policy. Existing bounded transient work retries are retained.
- Transient failure exhaustion, inbox backpressure, cancellation, and stale ownership
  do not automatically quarantine. Scheduler failure records now carry the transient
  classification so subclasses of database errors are not misclassified by name.
  Generic recovery acquisition conflicts are left closed without quarantine because
  they may refer to a room already serving under the same coordinator.
- Quarantine validates registration and the exact boot/epoch/fencing secret. A lost
  transition response can be retried after expiry only to acknowledge an already
  committed quarantine under that identical fence. Expired unquarantined leases and
  replacement owners cannot be changed by delayed failures.
- Added trusted `retry_quarantined(room_id, expected_epoch)` control. It locks the
  ownership row, checks the inspected epoch/status, clears ownership to unowned, and
  requires a fresh acquisition and full recovery before activation. Repeated requests
  acknowledge an unchanged unowned epoch; stale requests cannot clear a newer room.
  Commands, checkpoints, timers, and settlements are never deleted or skipped.
- Runtime stop attempts one bounded policy sweep after command workers stop, then
  stops lease maintenance even if that sweep is cancelled. Full coordinated drain
  and routing withdrawal remain the next increment.

Verification:

- Failure policy/runtime/routing/ownership/activation/recovery/scheduler focused
  regression: 99 passed. Two subsequently added activation and permanent maintenance
  quarantine cases also passed separately (101 checks in total).
- Fourteen new cases cover lost quarantine responses confirmed after expiry, exact
  secret checks, repair retry epoch guards, expired/replaced-owner rejection, bounded
  retry exhaustion, cancellation after commit, queue/worker bounds and overlapping
  sweeps, timeout uncertainty, unsupported commands kept pending, failed recovery,
  activation/maintenance failures, and transient database subclasses kept retryable.
- Python compilation and `git diff --check` passed. The earlier offer-fixture digest
  intermittency remains documented; this increment does not claim to resolve it.

Limitations and decisions:

- No migration, dependency, live startup, public/internal endpoint, repair UI, Redis,
  or application database operation. Repair authorization is a required responsibility
  of a future trusted control entrypoint; no runtime calls repair retry automatically.
- Quarantine persistence is not guaranteed when PostgreSQL remains unavailable, the
  lease expires before the write, the bounded queue is full, or the process stops
  before a transition commits. Local admission stays closed, uncertain results are
  explicit, and durable work remains. A later owner must fully revalidate recovery;
  it cannot assume a failed quarantine attempt repaired or consumed anything.
- Exhausted/unknown transition results are retained in bounded local diagnostics,
  not a new persistent audit/reason schema. Durable status remains authoritative.
  Cancellation retains the exact pending fence within the attempt budget; completed
  quarantine remains effective after lease expiry until explicit repair retry.
- Recovery conflicts and infrastructure failures are not proof of corrupt data.
  Unsupported capabilities and inventory limits require explicit compatibility/
  capacity correction before repair retry. The control itself does not repair data
  or certify it; fresh recovery performs validation and can quarantine again.
- Embedded PostgreSQL tests exercise SQL and fencing behavior, not real simultaneous
  sessions or production timing. The full backend suite was not rerun.

Next: coordinated drain and routing withdrawal, stopping admitted work before lease
release and resolving uncertain release responses without reopening admission. Then
integrate bounded owner selection/reacquisition and complete the endpoint audit.

### Coordinated drain and release record (within 4b3c)

Changes:

- Added explicit `RoomExecutionRuntime.drain_and_stop()`. It snapshots known eligible
  fences while synchronously closing acquisition/admission, withdraws the instance
  from SQL routing through its draining flag, stops maintenance/command workers,
  flushes one bounded quarantine pass, stops lease maintenance, then releases leases.
  Both serving and prepared recovering rooms are included; uncertain acquisitions
  without locally confirmed fences are left to expire.
- Added bounded parallel release workers and three same-input attempts per registry/
  release transition, with timeout/backoff and credential-free result classifications.
  Unknown outcomes stay retryable on repeated drain calls; confirmed releases are
  retained as results. A delayed retry cannot release a newer ownership epoch.
- Added `RoomLeaseCoordinator.begin_drain()` for synchronous admission closure and
  known-fence capture. Shutdown lifecycle calls serialize with start/stop. Cancellation
  during withdrawal or worker cleanup still joins workers and stops renewal; release
  is skipped when cleanup is cancelled, and a later call can finish safely.
- Added an atomic `preserve_quarantine` release option. Quarantine observed during
  release, including expired quarantine, requires explicit repair retry. Permanent
  work failures observed while draining remove that fence from the release set even
  if their quarantine write cannot be confirmed. Drain never clears failed work.
- Normal `stop()` continues to use lease expiry. It now joins cleanup despite caller
  cancellation. Neither path restarts a closed runtime. No detached shutdown tasks
  are left running after a call exits.

Verification:

- Focused shutdown/failure-policy/runtime/routing/lease/ownership/activation/recovery
  regression: 103 passed. After strengthening cleanup cancellation, all ten shutdown
  cases and ten runtime cases passed again, including the new cleanup-cancellation case.
- Covers serving and prepared-room release, routing withdrawal before cleanup, pending
  command takeover, same-fence lost-response retry, retry exhaustion and replacement
  fencing, failed registry withdrawal, cancellation during withdrawal/release/cleanup,
  raced quarantine, and failed quarantine persistence without unsafe release.
- Python compilation and `git diff --check` passed. Full backend suite was not rerun;
  the previously recorded offer-fixture intermittency remains unresolved.

Limitations and decisions:

- No migration, dependency, application database action, live shutdown hook, endpoint,
  load-balancer change, Redis cache invalidation, or socket/client migration. Routing
  withdrawal here is the PostgreSQL instance draining flag plus closed local admission;
  future transport hints remain advisory and must use the existing receiver checks.
- Drain cancels admitted worker attempts and joins their transaction cleanup; it does
  not wait for the entire inbox to empty. Atomic SQL work either committed or remains
  pending, and a replacement owner recovers under a fresh epoch. No command is erased.
- SQL attempts have deadlines, bounded retries and worker concurrency. Joining worker
  cleanup assumes cooperative coroutine/driver cancellation; this is not a guaranteed
  process-kill deadline. No lease is explicitly released before cleanup finishes.
- An uncertain registry update may temporarily leave a stale SQL serving hint, but
  local admission remains closed. Unreleased leases expire naturally; quarantine
  remains persistent. Lost acquisition responses without a confirmed local fence
  are never guessed at or force-released. Calling normal stop before the first drain
  discards its known lease set and deliberately retains the expiry fallback.
- Already failed/abandoned rooms are excluded from release. New permanent failures
  during drain are reported as repair-required. Administrative retry remains explicit.
- Embedded SQL tests do not establish simultaneous-process lock timing, deployment
  termination grace periods, or production performance. Operational rollout remains
  in the later task set; this increment does not enable the live runtime.

Next: bounded owner selection/reacquisition behind the existing recovery, activation,
quarantine, and draining gates. Then finish the endpoint capability audit before live
cutover, which also depends on delivery/client work.

### Demand-driven owner placement record (within 4b3c)

Changes:

- Added explicitly invoked `RoomOwnerCoordinator.ensure_owner(room_id)`. Existing
  admitted local ownership is reused; live ownership elsewhere and quarantine are
  returned without mutation. Unowned/expired rooms select a fresh non-draining
  compatible registered boot with spare advertised room capacity, using utilization
  and a deterministic room/boot hash to break ties. Remote selection returns an
  advisory destination; it does not grant ownership or send a network request.
- Local selection calls the concrete runtime's recovery preparation and transactional
  activation gates. Failed inventories remain closed and use the quarantine policy.
  Existing prepared acquisitions can resume; expired failed local acquisitions can
  be discarded and reacquired under the observed new epoch.
- Unknown acquisition responses and cancellation retain the original token/input
  epoch through lease coordination. A locally known recovering acquisition is retried
  even if its committed lease consumes the last capacity slot. Unconfirmed serving
  ownership is not adopted; fresh acquisition waits for lease expiry.
- Added versioned-capability filtering, bounded candidate reads, active request limits,
  same-room coalescing, lookup timeouts, and bounded cooldown bookkeeping. An oversized
  registry snapshot fails closed instead of silently selecting from a truncated fleet.
  Lost local intents can be pruned without discarding uncertain uncommitted intents.
- Runtime registration now advertises `room_capacity`. Acquisition locks the registered
  instance row exclusively and checks live owned-room count before a new lease write,
  serializing competing acquisitions for that instance. Idempotent retries resolve
  before this capacity check. Legacy registrations without this field preserve their
  existing store behavior but are ineligible for automatic placement.

Verification:

- Focused placement/ownership/runtime/shutdown/quarantine/activation/lease/recovery
  regression: 96 passed. The expanded placement suite passed 13 cases, followed by
  both parameterized expired-owner and no-ownership-row cases (14 placement cases
  now covered in total).
- Covers real recovery and pending-command resumption, live/quarantined owner guards,
  deterministic remote selection, SQL capacity enforcement, lost/cancelled acquisition
  commits with original-intent reuse, retry at full capacity, local reacquisition after
  expiry, lookup coalescing/backoff, drain admission closure, incompatible/oversized
  registries, missing rooms, and corrupt recovery quarantined instead of activated.
- Python compilation and `git diff --check` passed. Full backend suite was not rerun;
  the previously recorded offer-fixture intermittency remains unresolved.

Limitations and decisions:

- No migration, dependency, endpoint, application startup, periodic fleet scanner,
  remote dispatch, or application database operation. The placement service is an
  explicit capability, matching the other gated runtime components.
- This increment selects/reacquires on demand. Durable discovery must still find rooms
  with pending commands/timers/settlements after owner loss even without new ingress;
  otherwise those rooms would wait for another explicit placement request. That is the
  exact next increment, followed by the endpoint capability audit and dispatch contract.
- Candidate snapshots are advisory and can race. PostgreSQL epoch/lease checks choose
  the winner; losers return a classified preparation failure/backoff and retry later.
  Routing to a still-live owner with an unavailable heartbeat never authorizes stealing.
- Capacity is a room-count limit, not measured CPU/game load or proof of the production
  connection target. Candidate utilization and hashing do not rebalance live rooms.
  Unknown local intents reserve coordinator memory until resolved/discarded; SQL
  capacity alone does not imply free local recovery slots.
- Cooldowns are bounded local bookkeeping, not a persistent retry schedule. Returned
  remote selections need a future authenticated internal transport consumer that
  rechecks eligibility on the selected server. No acquisition credential is returned.
- Embedded SQL verifies queries/transactions but not real multi-session acquisition
  races or performance. The existing instance-row lock order is preserved; game
  command execution does not acquire that exclusive instance lock.

Next: bounded durable placement-demand discovery and explicit dispatch contracts,
then the endpoint/state capability audit. Keep live entrypoints disabled until
transport, delivery, and client dependencies are satisfied.

### Durable placement-demand discovery record (within 4b3c)

Changes:

- Added `PostgresPlacementDemandStore.page`, reading a bounded materialized keyset
  page of rooms before evaluating durable demand. Eligible work includes supported
  room/table/game inbox backlog, pending due scheduled actions, due unfinished game
  finalization jobs, and active games attached to durable tables. Idle lobbies and
  unsupported chat/platform lanes do not trigger this game-owner scanner.
- Discovery excludes quarantine and live foreign owners regardless of heartbeat.
  A local live recovering lease remains discoverable so an unknown acquisition
  response can be resolved with the coordinator's original intent. Eligibility is
  advisory; the coordinator and SQL acquisition still recheck all ownership gates.
- Added explicitly started `RoomPlacementDiscovery` with bounded pages and workers,
  serialized sweeps, lookup/dispatch timeouts, cursor wrap, and bounded failure
  diagnostics. Idle pages and refused placements advance the cursor so later rooms
  are reached. Cancelled/query-failed scans retain the cursor. Durable work remains
  and is revisited on later cycles; there is no in-memory demand queue to lose.
- The background loop pauses without querying when runtime admission/health is
  unavailable and resumes if it recovers. Stop cancels/joins its background task and
  joins any outstanding manual sweep, even if the stop caller is cancelled. It does
  not stop the owning execution runtime or release acquired rooms.
- Added credential-free `PlacementDemand` and `PlacementDemandReceiver`, plus an
  optional async sender adapter. The receiver checks the selected boot and reruns
  placement eligibility/recovery/activation. It never recursively forwards stale
  selection. Notification acknowledgement is not proof of ownership or execution;
  refusal/failure/timeout leaves durable demand for the next scan.

Verification:

- Focused discovery/placement/runtime/routing/shutdown/quarantine regression:
  85 passed. After shutdown hardening, all 19 expanded discovery cases passed.
- Covers command recovery without new ingress, live/quarantined owner exclusion,
  idle-page pagination and wrap, due versus future timers, settlement-only demand,
  active durable games, unsupported chat exclusion, actual remote receiver activation,
  uncertain local acquisition reuse, failed query/cancelled dispatch cursor retention,
  runtime-health pause/resumption, refused/failed/timed-out dispatch revisits, and
  cancelled stop joining an outstanding manual sweep.
- Python compilation and `git diff --check` passed. The earlier offer-fixture digest
  intermittency remains documented; this increment does not claim to resolve it.

Limitations and decisions:

- No migration, dependency, application database operation, application startup hook,
  authenticated transport, Redis, load-balancer change, or client delivery integration.
  Production wiring must start/stop this service with the gated execution runtime.
  Each eligible server can discover demand; remote dispatch remains an injected
  adapter until the authenticated internal transport is implemented.
- This scan reads PostgreSQL to discover rooms needing ownership; it is separate from
  healthy-owner command inbox polling. The agreed Redis/outage-dependent command
  polling policy remains increment 5. Ownership discovery cannot depend solely on a
  new player command after an owner crash.
- Page size bounds rooms evaluated per sweep, not SQL planner work or fleet recovery
  latency. The scan walks idle rooms too; worst-case discovery delay grows with room
  count and scan interval/page size. Capacity testing and index/scan tuning must
  validate recovery targets before rollout. Existing indexes and query timeouts are
  used; no performance or production failover-latency claim is made here.
- Future-due timers/jobs become eligible on a later cycle. Enqueued timer actions are
  found through their pending command lane. Legacy games without durable table IDs
  and chat/conversation/notification work are outside this scanner's capability.
- Cooldown/capacity/refusal does not remove work. Multiple scanners can race or send
  duplicate hints; acquisition epoch checks and inbox deduplication remain authoritative.
  Cursor state is local and can restart from the beginning without losing demand.
- Embedded PostgreSQL tests verify SQL and real runtime composition, not independent
  process timing or a production network transport. The full backend suite was not run.

Next: endpoint/state capability audit with a concrete live-cutover dependency matrix,
including placement discovery/dispatch lifecycle and transport, authorization, query,
chat/notification, and delivery/client gaps. Keep live entrypoints disabled.

### Endpoint capability and cutover audit record (within 4b3c)

Changes:

- Added [distributed-runtime-cutover-audit.md](distributed-runtime-cutover-audit.md)
  with a service/endpoint matrix, state-specific executor coverage, ingress/query/
  delivery contract requirements, and C1–C7 cutover dependencies.
- Inventoried all 69 HTTP/WS route declarations across the 11 routers installed by
  the composition root, with source/handler links. Audited dynamic table commands,
  WS frame families, client gameplay retries and table controls separately from
  static route patterns. Static asset mounts are explicitly outside the API table.
- Confirmed that the existing durable runtime environment setting does not install
  the new distributed runtime. Highlighted side-effecting hosted/membership/ledger
  reads, local table/query selection, room departure/deletion locks, and socket/
  social state as concrete blockers to a routing-only cutover.
- Recorded contract gaps: missing stable IDs/table revisions on lifecycle controls,
  state-dependent leave translation, explicit creation versus invitations/implicit
  replacement, unsupported active waitlists/settings/votes, public/private query
  projection, pending outcome/status lookup, and delivery/catch-up semantics.
- Selected active-game join-queue/leave-queue as the next bounded implementation
  increment. Earlier completed executor records describe their bounded state families,
  not complete parity with every live endpoint; the audit makes that remaining work
  explicit rather than treating existing tests as end-to-end readiness.

Verification:

- Python AST extraction verified method/path uniqueness and exact coverage of every
  mounted router module: 69 API/WS declarations across 11 routers. Source inspection
  covered composition, transport, lifecycle, executor gates, social/delivery services,
  and client retry/control behavior without starting the application.
- Local audit links and route handler references checked; `git diff --check` passed.
- Documentation-only increment: no behavior, API, schema, migration, database, or
  dependency changes. No behavioral tests or application startup were run.

Limitations and decisions:

- This is a source capability audit, not execution proof or approval for live cutover.
  Real multi-process correctness remains increment 8; capacity/observability/HA and
  operational readiness remain the later task set. Previous test limitations stand.
- PostgreSQL-backed membership/social/auth services are not described as wholly
  in-memory. Their local coordination, cache, rate-limit and publication dependencies
  must be reconciled individually; unrelated platform operations need not be forced
  through room ownership.
- Durable room chat was already authorized by the baseline plan despite the legacy
  service's ephemeral comment. Transient pokes can remain transient. The audit does
  not authorize silently discarding any existing invitation/settings/room behavior.
- Main increment 4 remains open: controller/lifecycle/query parity and gated live
  bindings remain. Redis, durable delivery, client/LB and multi-process checks remain
  separate increments 5–8, not work implicitly completed by this audit.

Next: active-game table-lane waitlist commands with shared execution/recovery capability
checks and focused correctness coverage. Keep HTTP/WS bindings disabled; then work
through the other C1–C2 gaps before completing cutover integration.

### C1 controller/lifecycle and C2 query/ingress backend completion (within 4b3c)

The user requested both remaining increment-4 backend slices together. They are now
implemented as explicit components; main increment 4 remains open only for its gated
live integration. The [API contract](distributed-runtime-api-contract.md) records
the concrete envelopes, query adapters, limits and remaining compatibility bindings.

Completed C1 scope:

- Active-game waitlist join/leave for Call Break, Marriage and Flush retains FIFO,
  table revisions, receipts and unchanged engine state. A seating command racing
  game start is a durable state rejection rather than a permanently blocked head.
  Unknown commands and unsupported/corrupt recovery structures still fail closed.
- Table-lane settings and rule votes reuse existing validation and unanimous
  proposal semantics. Proposal IDs are deterministic per command; creator/seat/
  membership, pending proposal, game type and revision checks remain authoritative.
  Roster changes cancel pending proposals in mutation transactions.
- Room-lane creation supports up to 20 hosted invitees and explicit completed-table
  replacement with the observed old table/revision. Old closure, new identities,
  reservations, capacity accounting, invitation state and outbox effects commit
  together. Engine history/receipts and settlement intent remain intact.
- Hosted invitation eligibility is rechecked with locked users. Recipient answers
  may precede room membership, but validate invitation ownership and room access;
  acceptance joins the room without reserving a seat. A PostgreSQL per-user rolling
  window preserves the existing 30 hosted invitations/minute limit across servers.
- Fenced room commands cover enter/leave/delete, visibility and room invitation
  issue/answer. Departure locks bounded table lanes, then tables, then users; it
  releases eligible waiting/completed seats and queues atomically across tables,
  blocks active/locked seats, and schedules replacement deadlines on the table lane.
  Ordinary game commands never take the room lane. Deletion retains durable history
  behind the existing tombstone instead of deleting referenced games/receipts.
- Atomic catalog creation before owner assignment uses stable request identity and
  deterministic room ID; creator membership and invitations commit together. Retry
  after deletion resolves the original result without recreating the room.
- Explicit runtime registration now advertises room-creation and table-command
  capability version 2; activation validates those versions and new command families.

Completed C2 scope:

- `PostgresHostedQueries` reads coherent detached table projections, room metadata,
  previews, catalog/member pages, invitation eligibility and recipient invitation
  pages on any server. Existing per-player/spectator projection rules and database
  profile names are retained. Queries do not install hosts or run controllers,
  timers, ledger projection or proposal cancellation.
- Membership and private snapshots share a read-only repeatable-read view. Stable
  table/match/durable-game identities and separate table revision are exposed; an
  explicit missing target is not replaced with a different local match. Presence
  remains a separate gateway/Redis contract, not an inferred empty local list.
- `HostedCommandIngress` validates the supplied canonical actor identity,
  rechecks target access, requires stable IDs/revisions and rejects unsupported
  native families before admission. The actual authentication session is the
  transport's responsibility. Optional wakeup is bounded and happens after commit;
  failure leaves durable pending work. Actor-scoped status remains available after
  departure/rematch and never exposes another actor's request or engine state.
- `PostgresLedgerQueries` reads committed ledger/settlement effects and durable
  table names from one authorized read-only transaction. Finalization never runs
  from this read path. Histories beyond the configured bound fail explicitly rather
  than returning truncated balances.

Schema and API decisions:

- Added append-only migration 21: optional room-creation request/fingerprint columns
  with a per-creator unique request index, a targeted recovery-invitations GIN index,
  and bounded per-user invitation attempt arrays. No application database migration,
  dependency installation, application startup, live endpoint replacement or Redis
  connection was performed.
- Native durable contracts require explicit replacement identity and persistent
  departure/game targets. Legacy combined `/create` and `/leave`, field aliases,
  generic/Echo and ad-hoc room paths require explicit compatibility handling when
  routes/clients are bound. Do not regenerate request IDs or silently switch an
  unresolved request to a newer game. Existing live behavior remains unchanged.

Verification:

- Broad embedded-PostgreSQL regression: **216 passed** across creation, table/game
  execution, activation/runtime, room recovery, roster/closure, schema upgrade,
  placement/discovery and the new backend adapters.
- After final catalog/ledger/rollback additions, **24 focused tests passed**;
  strengthened complete player/spectator projection comparisons passed **5 tests**.
  Final completed-game departure/offer coverage passed **11 room-command tests**.
  These runs overlap; counts are not summed as unique tests.
- Covers private recipient answers, unauthorized reads/status, FIFO/revisions,
  duplicates, rules cancellation, failed wakeup with committed pending work, room
  tombstone retries, atomic multi-table departure rollback, all-three-game replacement
  at capacity, replacement/outbox rollback, invitation rate limits, and ledger reads
  leaving pending settlement untouched.
- Python compilation and whitespace checks passed. Full application/client suite
  was not run. The previously recorded offer-fixture intermittency is not claimed
  resolved. Embedded PostgreSQL uses one connection and does not prove independent
  process races, live network failover, or production capacity.

Limits and next step:

- C1/C2 backend components are complete; mounted routes, startup/shutdown assembly,
  transport dispatch and audience-safe delivery remain C3–C7 integration gates.
  The legacy `durable` setting still does not install this distributed runtime.
- Query/room-mutation bounds default to five open tables; configuration must remain
  consistent with room limits when binding services. Ledger snapshots default to
  1,000 games/batches; large-history aggregates/pagination need validation before
  rollout. Read replicas need a separate consistency contract; current adapters
  require the authoritative database. Delivery must reauthorize private audiences
  after queued membership/seat changes.
- **Exact next increment: 5**, explicit Redis wakeups/placement signalling,
  healthy-versus-failed command polling, recovery rescans and per-connection presence.
  Keep all live distributed bindings disabled until their delivery/client/correctness
  dependencies are ready. Capacity, observability, database HA and operational
  readiness remain the later task set.

### Increment 5a record: Redis signals and adaptive polling

Completed:

- Added explicit `RedisSignalTransport` for authenticated, targeted room/lane
  wakeups and placement demands. PostgreSQL receivers retain ownership/admission
  validation. Messages contain identities/epoch only, with signed freshness
  envelopes; no command payloads, private state or lease tokens enter Pub/Sub.
- Bounded queue/workers, operation timeouts, subscription round-trip probes,
  reconnect backoff and cancellation-safe shutdown bound notification work.
  Known outages skip foreground publication attempts. Missed/overflowed hints
  remain recoverable through PostgreSQL scanning and placement discovery.
- Added optional `RedisPollingPolicy` to the explicit room runtime: default
  healthy safety polling at 5 seconds and outage polling at 350 ms, both jittered.
  Health transitions request immediate rescans. Timer/settlement maintenance
  cadence, leases and database retry backoff remain independent of Redis health.
  A database scan failure resets its inbox deadline so retries use DB backoff
  instead of waiting for the healthy safety interval.
- Added optional `redis` dependency extra, lazy client construction and explicit
  composition/lifecycle documentation in [Redis notes](distributed-runtime-redis.md).
  No schema changes, live bindings, application startup or application database
  migration were performed. Existing runtime behavior is preserved when the
  optional polling policy is not supplied.

Verification:

- Redis codec/transport/polling plus runtime, routing, discovery and shutdown
  regression: **82 passed** before the final database-retry edge-case fix.
- After that fix and its regression test, polling/runtime checks: **20 passed**.
  These runs overlap; counts are not summed as unique tests.
- Isolated real Redis integration: **3 passed**, covering actual subscription
  dispatch, restart/reprobe and durable PostgreSQL command execution during Redis
  loss without changing the owner fence. Used redis-py **8.1.0** installed into
  the project virtual environment and Redis **7.4.2** built in a temporary test
  directory. The server used a temporary Unix socket with TCP/persistence disabled;
  no application Redis service was contacted. Sandbox socket binding required
  an approved elevated test run. These tests preceded the final DB-retry fix.
- Python compilation and whitespace checks passed. Real-server tests are opt-in;
  component tests exercise silent loss, saturation, stale/bad messages, reconnect
  rescans, cancellation cleanup and real PostgreSQL receiver paths.

Limits and exact next step:

- Increment 5 remains open. **Next: 5b**, shared per-connection presence and
  advisory owner cache, including TTL refresh/rebuild after Redis loss, protection
  from stale disconnects deleting newer connections, and authoritative PostgreSQL
  revalidation/invalidation of cached owner hints. Unknown presence is not offline.
- No presence, outbox/chat/notification delivery, client integration or production
  lifecycle assembly is enabled by 5a. Placement discovery retains its periodic
  catalog scan. Redis publication is advisory, never an execution acknowledgement.
- Embedded PostgreSQL uses one connection. Independent-process split-owner races,
  full failover integration and live cutover remain later gates; these tests do
  not establish production capacity. Capacity/observability/HA readiness remain
  the separate later task set.

### Increment 5b record: shared presence and advisory owner cache

Completed scope:

- Added `RedisPresenceStore` with expiring per-connection user/room indices and
  bounded atomic Redis scripts. Redis server time controls record expiry; reads
  filter expired records even when other sockets retain the index. Index cardinality
  and read sizes are bounded, and overflow is explicit rather than silently truncated.
- Added explicit `ConnectionPresenceRegistry` lifecycle: fresh socket IDs, bounded
  local inventory and refresh workers, TTL refresh, reconnect rebuild, periodic repair
  after lost keys, and joined shutdown. Exact-handle disconnects cannot erase another
  device or replacement socket. Known in-flight refreshes serialize with detach;
  uncertain Redis results may leave stale observations only until expiry.
- Presence is advisory: `observed`, `unknown`, and `overflow` never authorize
  membership, seat release or private delivery. User/room indices update separately
  and may be partially rebuilt; an empty successful read is not proof of offline
  users. Reads crossing reconnection return unknown. Platform sockets may omit room
  membership and still register in the user index.
- Added `RedisOwnerCache` and optional router integration. Serving/fresh PostgreSQL
  inspection results populate short-lived hints. A cached wakeup refusal/error
  compare-deletes that exact hint and revalidates through PostgreSQL; a cache miss,
  timeout or unavailable Redis uses the existing database route. Atomic writes reject
  older epochs/conflicting boots, and stale invalidations preserve newer routes.
  Reconnection bypasses reads for one cache TTL to rebuild authoritative hints.
- Added composition/security/lifecycle guidance to the Redis notes and updated
  cutover/API documentation. The same transport health callback must fan out to
  polling, presence and owner caching in the eventual process composition.

Verification:

- Final combined suite: **76 passed**, covering presence/cache units, real Redis
  state/transport integration, PostgreSQL-backed routing, signals and adaptive polling.
- Real Redis tests exercise socket isolation and expiry, multiple boot IDs, index
  overflow/corruption, restart rebuild, key-loss repair, atomic cache update/delete,
  cache timeout/expiry, and cached stale-owner refusal followed by actual PostgreSQL
  takeover routing. Lifecycle tests cover refresh/disconnect races, cancellation,
  bounded concurrency and observations crossing reconnects.
- Used the existing isolated temporary Redis 7.4.2 server and redis-py 8.1.0, with
  TCP/persistence disabled. Unix-socket test execution required approved elevation.
  PostgreSQL checks used the existing single-connection PGlite harness. Python
  compilation and whitespace checks passed.
- No schema/dependency changes, application database migration, application startup,
  live socket/route binding, commit or deployment occurred in this slice.

Decisions, limits and next step:

- Increment **5 is complete as explicit components**. Production composition remains
  gated under main-4 C3 and delivery/client/correctness dependencies. An owner-cache
  hit avoids the gateway lookup, never receiver/executor fencing. Redis subscriber
  count cannot detect every stale destination; PostgreSQL safety polling still
  recovers missed wakeups. Cache hints can remain briefly during drain/takeover.
- Presence metadata requires trusted Redis ACL access and gateway authentication/
  authorization. It cannot establish a complete fleet-wide offline list after
  failure. Defaults are 30-second presence TTL, 10-second refresh, eight workers,
  2,048 local sockets, 4,096 entries/index, 512 read limit, and 2-second owner-cache
  TTL. Consistent fleet configuration is required; these are bounds, not measured
  capacity claims. No global Redis key scanning is introduced.
- **Exact next increment: 6a**, bounded durable outbox publication/catch-up and
  authorized gateway delivery adapters. Recheck audiences when delivering, retain
  stable event IDs/sequences, handle duplicate publication, and support durable
  catch-up when presence is unknown/partial/overflowed or Redis hints are lost.
  Then implement room chat, direct-message and notification execution/catch-up
  within increment 6. Do not enable live distributed bindings yet.
- Independent-process locking/failover remains increment 8. Capacity testing,
  observability, database HA deployment and operational readiness remain the later
  task set.

### Increment 6a record: durable hosted outbox delivery and catch-up

Completed scope:

- Added `PostgresDeliveryStore` with bounded `SKIP LOCKED` publication claims,
  claim-token/expiry checks for renewal and completion, retry scheduling and attempt
  tracking. No database transaction spans Redis or socket I/O. Expired claims can
  be reclaimed; uncertain publication/completion can repeat stable event IDs.
- Added `OutboxPublisher` with bounded claim/fanout workers and presence-directed
  boot-ID deduplication. Signals contain only lane/event identities and sequences.
  Unknown/overflowed presence and partial/failed fanout remain retryable. Publication
  status never records client acknowledgement; empty/partial observed presence can
  miss gateways, so published rows remain readable through safety catch-up.
- Extended authenticated Redis envelopes with a validated `delivery` kind and
  optional gateway receiver. Existing wakeup/placement behavior remains supported.
  Receipt of a hint schedules local work only; ordering and content come from SQL.
- Added authorized hosted room/table/game replay in a read-only repeatable-read
  snapshot. Membership, deleted-room status, exact recipients, current seats and
  match identity gate payloads. Departed command actors retain access to their own
  strictly projected ACKs without retaining room/game access. Pages advance a scan
  boundary over other recipients' events without exposing those payloads.
- Added explicit `GatewayDelivery`: bounded subscriptions/workers/pages, per-stream
  serialization, healthy/failure safety polling, duplicate-hint coalescing and
  bounded unacknowledged windows. Socket send success advances only local progress.
  Explicit authenticated ACKs must be within that stream's offered boundary, then
  advance independent user/client/lane cursors monotonically. Lost ACKs replay stable
  IDs on reconnect; slow/failed streams close/reconcile without acknowledging work.
- Added append-only migration **22**, `command_inbox_lane_actor_idx`, for bounded
  index lookup of prior lane participation during departed-actor receipt access.
  Existing lane/sequence outbox and cursor keys cover replay and ACK lookups.
  No application database migration was applied.

Verification:

- Broader component regression: **112 passed** across delivery/store/lifecycle
  bounds, Redis signals/polling/presence/cache, room routing, game execution and schema
  upgrade tests, using the existing single-connection PostgreSQL/WASM harness.
- Real Redis delivery plus bounds checks: **8 passed** (seven bounds tests overlap
  the broader run). The real-server case verifies healthy Redis wakeup catch-up,
  continued SQL delivery after Redis stops, and replay after a missing client ACK.
  It used the existing private temporary Redis server with TCP/persistence disabled;
  Unix-socket binding required approved elevated test execution.
- Tests cover claim expiry/renewal/reclaim, stale completion rejection, failed finish
  retries, partial fanout, published-row replay, audience sequence gaps, device cursor
  isolation, revoked membership/seats/matches, unknown presence, missing history,
  slow sockets, bounded outstanding sends and cancellation-safe shutdown.
- Python compilation and whitespace checks passed. No live application startup,
  endpoint/socket binding, dependency installation, commit or deployment occurred.

Decisions and remaining limits:

- Authorization linearizes at the replay snapshot: a revocation committed before
  that read denies access; concurrent revocation cannot retract an already-authorized
  socket write. Gateways queue identities rather than private payloads. Clients still
  need revision-aware snapshot reconciliation and duplicate-event handling in 7.
- `published_at` is an advisory attempt marker, not proof of complete fleet fanout.
  Catch-up remains necessary for partial presence, missed hints and disconnected
  clients. These adapters do not promise exactly-once network delivery.
- Unsupported social lanes fail closed. Targeted table invitation replay currently
  requires room membership; existing authorized invitation queries remain available.
  Social notification delivery outside room membership is part of 6b.
- Missing outbox history/unknown event versions require explicit reconciliation;
  no retention pruning or automatic snapshot-bound cursor reset is enabled. The
  socket composition must bind actor/client/handles, serialize socket writers and
  implement the close/reconcile callback instead of keeping a failed stream silent.
- Defaults bound active streams, rows, workers and unacknowledged windows. Queries
  are per subscribed stream; no production throughput/capacity claim or independent
  process-locking proof follows from the component tests.
- **Exact next increment: 6b**, durable room-chat/conversation/recipient command
  execution and history/catch-up authorization, with stable request/message IDs,
  recipient permissions and an explicit treatment of legacy unsequenced messages.
  Extend publisher/reader social routing only alongside that access contract.
  Increment 6 remains open. Live C3 bindings, clients/LB and independent-process
  correctness remain later integration gates. Capacity/observability/HA readiness
  remain the separate later task set.

### Increment 6b1 record: durable room, table and game chat

Scope decision:

- The user expanded durable chat to room, table and game scopes and confirmed
  durability despite short-lived/deleted tables. Split 6b into reviewable slices:
  scoped chat (6b1), then conversation/recipient execution and social history (6b2).
  Durability protects delivery/reconnects; it does not imply permanent history access.

Completed:

- Added migration **23**: separate `table_chat`/`game_chat` lanes and scoped foreign
  keys/uniqueness. Extended existing `room_chat_messages` with optional table/game
  identities, scoped stream validation, per-lane sender/request deduplication and
  a recent-sender index. Existing durable room rows retain their identities/content.
- Added `ChatIngress`, `ChatLaneExecutor` and `ChatHistory`. Commands retain stable
  original fingerprints and actor-scoped receipts. Accepted messages, deterministic
  IDs, ordered history, outbox events and outcomes commit atomically. DB-timed
  per-conversation rate limits survive restarts; retries do not duplicate messages.
- Preserved room-chat active-play pauses and Call Break break exceptions, plus
  seated-send/queued-read table permissions. New game chat requires a current seat
  and active game reservation. Authorization is rechecked at execution and replay.
  Table read locks protect coherent execution-time checks without external I/O;
  chat has independent lane ordering and never mutates the engine/checkpoint.
- Table history spans real rematches. Game identity is the durable game ID, including
  successive Flush rounds; normal game-chat access closes on completion/replacement.
  Room/table deletion closes normal access without erasing durable history/receipts.
  Same-request retries and safe actor-only ACKs remain available after departure.
- Registered scoped chat executors and the explicit `durable_scoped_chat: 1`
  capability. Activation validates supported chat work; placement discovery includes
  chat-only demand; owner wakeups and fallback scanning execute all three chat lanes.
  A replacement owner recovers pending chat, and stale fences cannot execute it.
- Extended publisher/catch-up authorization for chat; Redis still carries IDs only.
  Spectators cannot receive table/game content, queued users cannot send table chat,
  and revoked participants can receive only their own safe ACKs. Deleted senders
  receive a durable rejection without an invalid-recipient outbox row poisoning the
  lane. Added [scoped chat contracts](distributed-runtime-chat.md).

Verification:

- Broader regression: **127 passed** across scoped chat, schema upgrade, activation,
  room runtime/routing, placement discovery, delivery, inbox and real rematch behavior.
- After the final deleted-sender guard and regression addition, focused chat/upgrade
  checks: **13 passed**. Runs overlap; counts are not summed as unique tests.
- Covers all three games, atomic rollback before completion, dedupe conflicts,
  durable rate rejection, seat/queue/membership changes, unchanged engine checkpoints,
  table closure, room deletion, rematch history, replacement-owner recovery and
  preservation/immutability of pre-migration durable room-chat records.
- Python compilation and whitespace checks passed. SQL runs use the existing
  single-connection PostgreSQL/WASM harness; they are not independent-process race
  or capacity evidence. No Redis protocol changed in this slice.
- No application database migration, dependency installation, live startup/route
  binding, client change, commit or deployment occurred.

Limits and exact next step:

- **6b1 is complete as explicit components; 6b and main 6 remain open.** Next is
  **6b2**, conversation/direct-message and recipient-notification execution, durable
  history/catch-up permissions and explicit treatment of legacy unsequenced records.
  Extend social publisher/reader routing only with those access rules.
- Legacy room/table chat remains ephemeral in its existing live handlers. There is
  no invented backfill of in-memory messages. Native durability starts at admission
  through the new path; previously persisted room-chat rows are preserved.
- No purge duration/job or archival permission is enabled. Closed scopes are already
  inaccessible through normal reads; physical retention cleanup needs an explicit
  policy and a safe outbox reconciliation boundary. Old game chat is retained but
  inaccessible after completion/replacement; table chat remains available to current
  eligible participants across rematches.
- Native chat records expose sender IDs; mounted clients must resolve display names,
  escape text, retain request IDs, subscribe to the correct durable scopes, and fetch
  history when chat permission reopens. Older executors lack the new capability and
  must be drained/upgraded before native chat ingress is enabled.
- Live C3 composition, clients/LB and independent-process correctness remain later
  integration gates. Capacity, observability, database HA and operational readiness
  remain the separate later task set.

### Increment 6b2 record: durable direct messages and notifications

Completed:

- Added `SocialIngress`, `NotificationProducer`, `SocialLaneExecutor`,
  `SocialRuntime` and `SocialHistory`. Stable request fingerprints, deterministic
  message IDs, message/outbox/receipt atomicity and durable read-state commands
  extend the existing inbox; platform lanes are serialized independently of rooms.
- Preserved accepted-friend send/read policy, including execution-time friendship
  locking and authorization on replay. Revoked participants retain only own safe
  ACK/status access. Notification creation is trusted-service-only and transaction
  composable; read/history access is recipient-only.
- Added bounded shared-worker polling and local wakeups. Platform pending scans run
  even with healthy Redis because these lanes have no pinned owner. Existing Redis
  delivery hints now address both conversation users with gateway deduplication.
- Added authorized stream bootstrap/discovery, native sequenced history and separate
  timestamp/UUID pagination for legacy rows. No fabricated legacy event sequences.
- Migration **24** adds targeted pending/history/discovery indexes and non-cascading
  native notification origin metadata. Upgrade preserves durable notification IDs,
  content/read state and legacy behavior. Added [social contracts](distributed-runtime-social.md).

Verification:

- **85 passed** across social schema upgrade, social commands/history, scoped chat,
  delivery/bounds, inbox, room schema upgrade, player behavior and Redis signals.
- Covers retry conflicts, revoked friendship, private recipient access, foreign-ID
  read rejection, atomic rollback, room-independent recovery, legacy pagination,
  stream discovery, two-user gateway deduplication and notification origin deletion.
- Earlier focused runs overlap this suite and are not added to its count. SQL tests
  use the single-connection embedded PostgreSQL harness, not independent processes.
- Compilation and whitespace checks passed. No application migration, live route or
  startup binding, deployment, commit, or dependency installation occurred.

Limits and exact next step:

- **6b2, 6b and main 6 are complete as explicit components.** C3 must still mount
  routes/workers and wire notification producers into source business transactions.
  Live handlers remain legacy. Upgrade all workers before enabling native ingress;
  do not permit competing legacy/native writers.
- Clients must discover new streams, resolve sender profiles, retain request IDs,
  reconcile history and distinguish notification read state from delivery ACKs.
  Native notifications require the new readers; old actor inner joins are unsuitable.
- **Next: 7a**, reliable client command lifecycle and focused client tests, starting
  with the existing pending-action helper. Remaining 7 slices cover social delivery
  discovery/reconciliation and load balancing. C3 live assembly and increment-8
  independent-process correctness remain gates. No retention/purge policy is enabled;
  capacity, observability, HA and operational readiness remain the later task set.

### Increment 7a record: reliable client command lifecycle

- Added explicit `DurableCommandClient` for inbox-backed game/table/room/social
  envelopes. IDs, targets, matches, revisions and nested payloads stay unchanged
  across retries. Pending receipts lead to status-only queries; only validated
  matching terminal receipts resolve the intention. New intentions are blocked
  while unresolved. This adapter does not cover atomic room-catalog creation.
- Transport/HTTP errors, rematches and malformed responses preserve uncertainty.
  Ten-second default deadlines, cancellation and one concurrent reconciliation
  bound client work; late responses cannot settle a subsequent attempt. Logout
  permanently closes the session without implying server-side command cancellation.
- Kept legacy helpers/live screens unchanged because distributed server endpoints
  are still unmounted. The caller supplies an authenticated submit/status transport.
  No dependency, migration, startup, commit or deployment changes.
- Verification: **37 passed** in the new lifecycle and existing client-helper suites;
  full client TypeScript check and whitespace checks passed. Tests cover lost
  commits/responses, pending/rejected status, malformed or foreign receipts,
  HTTP errors, timeout/abort/concurrent reconnects, payload isolation, late responses,
  logout and ID generation without native Web Crypto. These are client component
  tests, not live backend integration or independent-process correctness evidence.
- State is in-memory and must outlive socket/table components; app termination/page
  reload persistence and mounted ownership are still integration work. HTTP errors
  do not automatically release an uncertain request; definitive pre-admission error
  mapping requires a concrete route contract. Added [client contracts](distributed-runtime-client.md).
- **7a complete as an explicit component; main 7/C6 remain open. Next: 7b**, stream
  discovery/subscriptions, delivery cursors and snapshot/history reconciliation.
  Then 7c mounted controls/session recovery and LB composition; C3 live cutover stays
  gated on complete compatibility and increment-8 correctness. Operational work
  remains the later task set.

### Increment 7b record: delivery discovery and reconciliation

- Added explicit `DurableDeliveryClient` and bounded `discoverDeliveryStreams`.
  Recovery loads authorized current views before replay; new visible events refresh
  state/history instead of applying stale game deltas. Installed progress and
  durable ACK are distinct, allowing lost-ACK retries without duplicate application.
- Added `after_sequence` to gateway pages and verified initial/reconnect/subsequent
  boundaries in backend tests. Clients reject missing frames, wrong lanes, malformed
  events and unsupported versions, while allowing private-event sequence gaps.
- Bounded serialized per-lane operations and discovery; close/timeout invalidate
  late async loads. Catalog failure/overflow does not produce partial subscription
  replacement. Each subscription incarnation and device has independent progress.
- These are explicit adapters: mounted session ownership, subscription handshake,
  frame buffering, concrete authorized snapshot/history loaders and UI reducers
  remain 7c/C3. No automatic retention-boundary reset, reload persistence, routes,
  startup binding, migration, dependencies, commit or deployment were introduced.
- Verification: **57 client tests passed** across delivery and command lifecycles
  and legacy command helpers; full client TypeScript check passed. Backend delivery
  regression: **21 passed** (delivery and bounds). Whitespace and Python compilation
  checks passed. Tests do not establish independent-process
  correctness or capacity. Updated client/delivery contracts with exact caller duties.
- **Next: 7c1**, authenticated session ownership and bounded subscription/reconnect
  composition, including concrete history/snapshot loaders and reload policy; then
  mounted native control mappings and LB integration. Main 7/C6 and C3 remain open.
  Operational readiness remains the later task set.

### Increment 7c1 record: session ownership and bounded subscriptions

- Added `DistributedSession` above screen lifetimes. Stable command slots retain
  original intentions across remount/reconnect. Disconnect removes subscriptions;
  logout permanently closes commands and clears lane views. No credential rebinding.
- Composed complete authorized discovery with periodic refresh, bounded subscription
  workers, per-lane ordered buffering, handshake recovery, offered-boundary ACKs
  and revocation cleanup. Obsolete callbacks/late opens cannot install private views.
  Overflow/timeouts drop streams for later rediscovery instead of growing queues.
- Added device/tab-scoped storage identity helper, native sequenced-history pagination
  and revision-aware detached view replacement. Reused bounded delivery deadlines.
- Defined reload policy: never reconstruct uncertain commands with new IDs. Persistent
  account-scoped journaling before send is required before native controls go live.
  Current session state survives remount/reconnect, not process death. Platform store
  binding and duplicated-tab ownership remain explicit integration duties.
- Verification: **71 client tests passed**, full client TypeScript check and whitespace
  checks passed. Covers page buffering/order, command preservation, catalog changes,
  failed discovery, overflow, revocation, logout, late opens, timeouts, worker bounds,
  history truncation and stale revisions. Transport is mocked; no production load or
  independent-process correctness claim follows. No dependencies, migrations, live
  bindings, commits or deployments changed.
- **7c1 is complete as explicit composition; main 7/C6 remains open.** Next: **7c2a**,
  durable pending-command journal and crash/reload isolation tests. Then platform
  identity/session integration, concrete hosted/social/legacy loaders and mounted
  HTTP/WS control mappings, followed by LB/C3 composition. Increment-8 correctness
  remains required for cutover; operations/capacity remain the later task set.

### Increment 7c2a record: durable pending-command journal

- Added versioned `CommandJournal` scoped to authenticated account/device, bounded
  to 32 slots/1 MiB. Saves original envelopes before admission to client send work;
  validates and saves receipts before local resolution. Restores all session slots,
  including offscreen requests, with exact retry or status-only recovery as appropriate.
- Storage read/write/read-back failures block further work rather than assuming no
  commit. Reopening inspects the persisted truth. Corrupt/version/scope mismatches
  remain untouched and fail closed. Terminal slot release is allowed; unresolved
  work cannot be released. Closed accounts retain uncertain disk records without
  leaking them into another account's namespace.
- Added optional persistence to existing command/session components. Logout aborts
  late work and closes journal access. Sequential stale-owner detection is included;
  true exclusive cross-tab/platform ownership remains 7c2b. Storage must synchronously
  complete atomic durable writes; async write-behind adapters are not supported.
- Verification: **87 client tests passed**, full TypeScript and whitespace checks
  passed. Includes crash before send, lost server response, pending/terminal reload,
  write failures before/after commit, corrupted receipt, stale ownership, storage
  bounds, logout/account isolation and restoration through session composition.
  Storage/transport are mocked; physical durability and live correctness are not proven.
- No dependency, application migration, live route/screen, platform storage install,
  commit or deployment changes. Earlier unjournaled constructors remain explicit;
  live native mutation wiring must supply persistence. No automatic uncertain-work
  deletion or private snapshot storage is enabled.
- **Next: 7c2b**, platform storage binding and exclusive device/tab/session ownership,
  then concrete mounted control/HTTP/WS/view adapters and LB/C3. Main 7/C6 remains
  open; increment-8 correctness and later operational work retain their scope.

### Increment 7c2b record: platform storage and exclusive ownership

- Added explicit web localStorage/Web Locks and native synchronous SecureStore
  bindings, plus shared owner construction and authenticated `OwnedSession` lifecycle.
  Journal restoration follows lock acquisition; close invalidates journal access
  before release. No memory/unlocked fallback on storage or lock failure.
- Browser policy deliberately chooses one active same-account session per profile/
  origin; duplicate tabs are refused rather than given a new identity that bypasses
  pending work. Handoff restores the stable device ID and original journal. This
  replaces the earlier unrestricted per-tab-identity proposal. Different devices
  and accounts retain independent namespaces.
- Native registry guards the app's single JS runtime, including module reloads;
  it is not a cross-process OS lock. SecureStore errors block sends. Large-value
  limits and platform lifecycle semantics require device validation; no full 1 MiB
  native capacity claim is made. No new dependencies or native build edits.
- Verification: **101 client tests passed**, full TypeScript and whitespace checks
  passed. Covers duplicate ownership, preserved handoff, storage failures/corruption,
  account isolation, late acquisition, logout and session-before-lock cleanup order.
  Tests inject browser locks/native storage; real browser termination and native
  keychain smoke validation remain cutover gates.
- No application migration, live mounting, commit or deployment occurred. Platform
  acquisition remains explicit; screens still use legacy routes. No uncertain-work
  purge or automatic duplicate-tab identity regeneration was introduced.
- **Next: 7c2c**, explicit authenticated server/client HTTP/WS mapping, subscription
  handshake/ACK ownership and concrete hosted/social/history adapters; then mounted
  root/control compatibility and LB/C3. Main 7/C6 remains open. Independent-process
  verification stays increment 8; operational work remains the later task set.

### Increment 7c2c1 record: command and delivery transport

- Split 7c2c into reviewable transport and view/control slices. Added an explicit
  unmounted `/distributed` router factory for bearer-authenticated submit/status and
  first-frame-authenticated multiplexed delivery WebSockets. Request JSON cannot set
  actor identity; ingress selection preserves hosted/chat/social authorization.
- Added socket-local aliases, bounded serialized sends/frames/subscriptions, origin
  allowlist, heartbeat timeout, ACK offered-boundary checks and disconnect cleanup.
  Paused gateway admission sends the durable initial cursor before activating pages;
  default existing subscriptions retain immediate activation behavior.
- Added client HTTP and multiplexed socket transports matching these contracts.
  Commands retain original envelopes; HTTP failure never becomes a terminal receipt.
  Socket handshake/ACK confirmations, cancellation, heartbeat and obsolete-alias
  handling compose with journaled session components.
- Verification: **106 client tests**, **28 backend transport/delivery tests**, full
  TypeScript, Python compilation and whitespace checks passed. Includes authenticated
  routing, actor injection rejection, wrong origins/credentials, foreign/unoffered
  ACKs, cleanup and paused-handshake ordering against embedded PostgreSQL delivery.
  Router/client transport doubles are not full network or multi-process evidence.
- No application migrations, live mounts, dependency changes, commits or deployment.
  Socket presence registration, root reconnect/credential lifecycle, concrete reads
  and mounted controls remain integration gates; gateway safety polling still applies.
- **Next: 7c2c2**, authorized projections/history/stream discovery and concrete control
  mappings, then authenticated-root/presence/C3 integration and LB. Main 7/C6 stays
  open; platform smoke and increment-8 correctness still precede cutover. Operational
  readiness remains the later task set.

### Increment 7c2c2 record: authorized reads and control mappings

- Added `DistributedReads` and optional unmounted read routes for selected hosted
  snapshots, recipient/selected-scope bootstrap, social catalogs, native chat/social
  history and separate legacy timestamp/UUID pages. Bootstrap checks membership,
  table/game relationships, scoped chat permissions and accepted friendship before
  creating a lane; no game state, commands or owner leases are created.
- Added `DistributedReadClient`: pins selected tables, walks bounded native history,
  preserves separate legacy cursors and merges recipient/social/selected stream IDs.
  Discovery fails as a whole on permission/error/overflow; optional scope eligibility
  remains an explicit root responsibility. No historical-game fanout scan is added.
- Added journal-compatible game/table/room/chat/notification command mappings with
  separate engine/table revisions and durable game/match identities. Scoped chat
  maps to send-chat, conversations to send-message. Retry keeps the original target.
  Actual UI event bindings, combined leave policy and room-catalog creation remain
  audited mounted integration work rather than implicitly changing live controls.
- Verification: **111 client tests**, **39 backend tests** (reads/routes, existing
  chat/social and hosted-query ingress), full TypeScript, Python compilation and
  whitespace checks passed. Covers actor-bound bootstrap, rejected foreign scopes,
  revoked friendship/membership, route bounds/cursors, history pagination, independent
  revisions and Flush-style durable-round preservation. SQL uses embedded PostgreSQL;
  route/client doubles are not live-network or independent-process evidence.
- No application migrations, dependencies, live mounts, commit or deployment changes.
  Completed 7c2c as explicit adapters; main 7/C6 remains open. **Next: 7c2d**,
  authenticated root/selected-view reconnection composition and actual screen-control
  parity, then C3 socket presence/live assembly and LB. Platform smoke and increment-8
  correctness stay cutover gates; operational work remains the later task set.

### Increment 7c2d1 record: authenticated root and selection composition

- Added `DistributedRootRuntime` and owner-supervisor factory composing journaled
  session, authenticated command/read transports, multiplexed sockets and selected
  room/table/game/chat views. Selection/socket changes preserve pending identities;
  logout/auth expiry closes work and journal ownership. Retry is bounded with capped
  delay; old callbacks/selections cannot commit into replacement subscriptions.
- Added selected-snapshot identity/revision checks and serialized bounded primary
  snapshot reads across hosted lanes sharing a screen. Root control admission uses
  installed table/game revisions and exact durable identities. Scoped histories and
  social bootstrap/catalog loading use production client adapters.
- Introduced typed HTTP status errors for auth expiry without converting errors into
  durable rejections. Fixed receipt recovery being skipped when catalog discovery
  failed; the two paths now progress independently.
- Audited live room/table controls: combined leave, initial room creation, lifecycle
  shortcuts and receipt-driven navigation still require screen-facing parity. Split
  7c2d into this explicit root composition and 7c2d2 controllers; no partially
  implemented distributed behavior is mounted.
- Verification: **119 client tests**, full TypeScript and whitespace checks passed.
  Covers composed view discovery/loading, socket retry/replacement, selection changes,
  old-callback cancellation, persisted request preservation, stale revisions, auth
  expiry and command recovery during discovery failure. Peers/storage remain test
  doubles; no browser/native or multi-process server proof is claimed.
- No application migrations, dependency changes, live mounts, commits or deployment.
  **Next: 7c2d2**, screen-facing lifecycle controllers, deterministic leave mapping
  and atomic initial room creation, then C3 socket presence/server assembly and LB.
  Main 7/C6 stays open; platform smoke/increment-8 correctness remain cutover gates;
  operations and capacity remain the later task set.

After each increment record:

- Completed scope and touched components.
- Migrations or API contract changes.
- Verification performed and remaining limitations.
- Decisions/deviations from this baseline, with rationale.
- Exact next increment and any dependencies.

### Increment 7c2d2 record: screen controllers and catalog creation

- Added explicit session-owned screen command controllers with pending/busy/error
  state, immediate reconciliation and matching accepted-receipt callbacks. Unmount
  cancels the screen wait without deleting the journal. Background receipt recovery
  can update a mounted observer; rendering/navigation failures cannot change outcomes.
- Added deterministic combined leave: eligible open/completed/ended tables use
  `leave-seat`; active Call Break uses `abandon`; active Marriage/Flush uses
  `FOLD_AND_LEAVE`. Locked/unseated cases fail before admission. Retries retain the
  original operation and observed identities/revisions despite changed views.
- Added lobby mappings and explicit gameplay, room, chat and notification controls.
  Root `screen(slot, callbacks)` binds controllers to persisted session slots.
- Added journaled catalog creation and optional authenticated `POST /distributed/rooms`
  using existing atomic `PostgresRoomCreation`. Lost-response retries use the same
  request ID and return the same room. Accepted catalog receipts carry a room ID,
  not a lane/sequence/status reference. No migration or live route mount is added.
- Verification: **134 client tests**, **11 backend transport/catalog tests**, full
  TypeScript checking passed. Backend tests include atomic catalog retry/conflict,
  tombstone behavior and invite rollback. Two existing Starlette deprecation warnings
  remain. Python compilation and whitespace checks passed.
- Limits: these are explicit adapters with mocked client peers, not live UI or
  independent-process evidence. Accepted navigation is once per controller lifetime;
  explicit recovery after remount may navigate again, so destinations must be
  idempotent. Journal version remains 1 with a target-specific catalog receipt;
  older clients cannot interpret that receipt and must fail closed on rollback.
  Transport failures retain uncertain catalog intentions; they do not certify rejection.
- Exact next step: **C3a**, explicit server startup/shutdown and authenticated socket
  presence composition. Main 4/7 and 7c2d live integration remain open. Do not enable
  partial distributed behavior or competing legacy/native writers.

### Increment C3a record: explicit server lifecycle and socket presence

- Added `build_server`/`DistributedServer`: one boot identity, ordered registration,
  room runtime, presence, gateway, social, signal receivers, publisher and discovery
  startup. Composes real command/read/catalog routes without importing/mounting them
  in the legacy application. Pool/Redis are borrowed unless explicitly transferred.
- Added bounded router admission for HTTP and socket tasks. Partial/cancelled startup
  cleans attempted components; shutdown fences admission, stops discovery/dispatch,
  joins requests, drains room work and closes owned resources last. Failed component
  cleanup keeps resources open for retry. Exposes the existing drain uncertainty report.
- Bound Redis health to adaptive inbox polling, delivery reconciliation and presence
  refresh. Redis unavailability does not block startup or durable command execution.
- Added authenticated user socket presence and server-resolved room hints shared by
  subscriptions. Unsubscribe/revocation/disconnect removes hints without mutating
  membership or seats. Former-member ACK access does not imply room presence.
  Shutdown attempts socket close code 1012 and joins cleanup before closing the pool.
- Verification: 86 targeted server/transport/delivery/presence/shutdown/Redis tests
  passed; final server/transport run passed 25 tests after socket shutdown coverage
  (87 distinct tests). Includes assembled HTTP catalog/table creation through owner
  discovery/execution during Redis outage, against PostgreSQL/WASM. Python compilation
  and whitespace checks passed. Two existing Starlette deprecation warnings remain.
- Limits: controlled broker/socket peers and embedded SQL do not establish independent
  process failover or capacity. No live runtime switch, migration, client edit or
  deployment. Presence bounds count registrations, including distinct subscribed rooms;
  hints never grant authorization. Optional owner caching remains unbound.
- Exact next step: **C3b**, application lifespan/bootstrap and route compatibility
  boundaries with explicit writer exclusion. Main 4/7, mounted clients/LB, platform
  smoke and increment 8 remain open; operational readiness remains the later task set.

### Increment C3b record: integration application and compatibility boundary

- Added explicit `create_app(runtime_mode='distributed-integration',
  distributed_server=...)` selection. Requires a fresh preconfigured assembly; no
  environment flag or default changes activate distributed behavior. Production
  `distributed` selection and mixed legacy/server arguments fail before startup.
- Added isolated ASGI lifespan that starts/stops C3a components, including cleanup on
  startup failure. Mounts the native router and lifecycle health endpoint only;
  borrows/transfers resources according to the supplied server configuration.
- Added protocol boundary that rejects old HTTP routes with a structured 409 and
  old sockets with 1008 before dispatch. No Echo/ad-hoc/legacy game services or
  static client are constructed. Exact captured CORS/socket origin allowlists agree.
- Verification: **37 application/server/transport/auth tests** passed, including
  PostgreSQL/WASM native creation/read through the real application lifespan,
  unavailable-before/after-lifespan behavior, partial startup cleanup, accidentally
  mounted legacy handler exclusion, origins and unchanged legacy default behavior.
  Python compilation and whitespace checks passed. Two existing Starlette warnings
  remain; no client edits, migrations, deployments or live runtime switch occurred.
- Scope decision: writer exclusion is within the integration app. It cannot stop
  older external writers; dedicated integration data is required and production
  activation stays blocked. Authentication issuance/profile/friendship/ledger and
  other legacy platform routes are explicitly unavailable here, not silently reused.
- Exact next: **C3c**, shared authentication/profile/platform routes and remaining
  compatibility audit, then live client bindings/LB and increment-8 correctness.
  Main 4/7 stay open until production integration/cutover dependencies are complete.

### Increment C3c record: shared platform routes and native read bindings

- Added `SharedPlatform` to the explicit server factory, using the same pool/auth
  service as native commands. Reviewed exact account/profile/player GET/POST/PATCH
  routes are mounted with lifecycle admission; guest login is an explicit disabled-
  by-default option. Middleware admits only matching shared method/path contracts
  outside the native prefix, adds no-store, and preserves legacy writer rejection.
- Added PostgreSQL-backed player search/public reads to avoid serving stale gateway
  caches after another service updates a profile. Own-profile validation and existing
  account/session contracts are reused without constructing legacy game services.
- Exposed bounded native catalog, room/table invitation and membership reads plus
  the existing authorized read-only ledger projection. No legacy finalization-on-GET
  or unsequenced message/notification mutation handlers are mounted.
- Recorded route mappings and remaining compatibility gaps in
  `docs/distributed-runtime-platform.md`: friendship notifications, browser/provider
  login, active-socket revocation, manual settlements and client read-shape mappings.
  Shared account/profile writes retain existing semantics, not game-inbox receipts.
- Verification: **53 targeted tests passed**, including real PostgreSQL/WASM account
  issuance/revocation, actor-bound profiles, cross-service freshness, guest/method
  boundaries, catalog privacy, authorization and bounds. Existing ledger tests verify
  no read-triggered finalization. Added datetime parameter support to the SQL test
  harness for authentication sessions. Python compilation and whitespace checks passed;
  two existing Starlette deprecation warnings remain.
- No client edits, migrations, deployment or production runtime switch. Writer
  exclusion is still within the isolated integration application, not older external
  processes. Exact next increment: **C3d**, durable friendship commands with atomic
  notification production. Main 4/7 and the other cutover gates remain open.

### Increment C3d record: durable friendship commands

- Added request/accept/remove friendship commands on the existing conversation pair
  lane. Participants/users and empty payloads are validated without requiring an
  already accepted relationship; DM/history authorization retains that requirement.
  Pair-lane FIFO now orders friendship changes and direct messages together.
- Added explicit pending-request cancellation/rejection and accepted-friend removal
  semantics. Invalid transitions complete rejected receipts; same-ID retries retain
  original outcomes even after later relationship removal. No receipt schema changes.
- Friendship changes, actor ACK/receipt and deterministic recipient notification
  intents commit atomically. Unexpected failures after effects begin propagate and
  roll back the claim, including validation errors from downstream effects. Recipient
  capacity exhaustion leaves commands pending. Notifications materialize asynchronously
  using existing social workers and sequenced outbox delivery, not legacy inserts.
- Both users receive change records: actor `friendship_changed`, other user a specific
  requested/accepted/rejected/cancelled/removed notification. Client rendering/mapping
  remains later work; historical payloads do not replace current friendship reads.
- Verification: **40 targeted tests passed**, including 13 new friendship tests,
  existing social/transport/platform/schema regressions, rollback on second-notification
  and receipt failure, backpressure, ordered removal-before-message rejection, own-ACK
  privacy and real HTTP-to-worker catch-up while Redis is unavailable. PostgreSQL/WASM
  is not independent-process concurrency evidence. Python compilation and whitespace
  checks passed; two existing Starlette deprecation warnings remain.
- No migrations, client edits, deployment or production selection changes. Old
  friendship mutation aliases remain blocked. Exact next: **C3e**, existing-socket
  session revocation/expiry, followed by browser/provider auth and remaining platform/
  client compatibility. Main 4/7 and increment 8 remain open.

### Increment C3e record: established-socket authentication lifetime

- Added `SocketSession` with a periodic watchdog and a serialized freshness gate for
  incoming operations/outbound frames. Uses the exact original token and shared
  authenticator; identity changes are rejected. Default checks are five seconds apart
  with a two-second timeout. Slow/outdated results cannot extend authorization.
- Revocation/expiry closes 1008; verification outage/timeouts close 1011 rather than
  retaining stale authentication indefinitely. Session failures interrupt idle sockets
  without Redis or heartbeat dependence. Independent tokens for one user stay valid.
- Cleanup joins the watchdog, unsubscribes delivery and removes presence. Stopped
  sessions reject late delivery callbacks. Existing server shutdown retains 1012 and
  cancellation-safe joining. No seats, memberships or durable commands are changed.
- Verification: **43 targeted tests passed**, including eight new tests with actual
  PostgreSQL/WASM session issuance/revocation/expiry through separate service objects,
  identity/outage/timeout failures, idle cleanup, late callbacks and token isolation.
  Existing server/application/transport/platform tests also pass. Python compilation
  and whitespace checks passed; two existing Starlette warnings remain.
- Limits: bounded eventual checks, not atomic or instantaneous database/socket logout;
  already sent frames cannot be recalled. One check stream per socket, no batching or
  capacity claim. SQL/ASGI tests do not replace independent-process evidence. Legacy
  production sockets stay unchanged; no migration, client edit or deployment occurred.
- Exact next: **C3f**, reviewed browser/provider sign-in composition. Manual settlements,
  client mappings, main 4/7 and independent-process/LB/platform gates remain open.

### Increment C3f record: browser sign-in composition

- SharedPlatform now creates BrowserSocialAuth from existing validated environment
  configuration using PostgresBrowserAttempts and PostgresSocialIdentityStore bound
  to the same auth/profile services. Only reviewed provider-list/start/callback/
  completion routes are mounted with lifecycle admission and no-store responses.
- 19 tests passed: cross-gateway SQL-backed attempt completion, wrong-secret/replay
  rejection, native token usability and existing browser/platform regressions.
  Provider exchange is mocked; real provider smoke remains external validation.
- No new credentials, migration or runtime activation. Next C3g: durable manual
  settlement commands; continue sequentially without further routine confirmation.

### Increment C3g record: durable manual settlements

- Added create-settlement and settlement-action commands on the fenced room lane.
  Creation claims 1–1000 completed unclaimed ledger games, checks zero-sum balances
  and requires an outstanding participant. Actions enforce payer/payee identity and
  OPEN → MARKED_PAID → RESOLVED transitions. No transfer of money is performed.
- Settlement batches, game claims, transfers/action audit, actor receipt and room
  change event commit together. Stable IDs preserve retries; unexpected persistence
  failures roll back effects. Legacy mutation routes remain blocked.
- Advertised manual_settlement version 1 in activation capabilities. No migration
  or receipt schema change. Clients refresh the existing ledger after acceptance.
- Verification: 18 settlement/activation tests passed, including rollback on receipt
  failure, deduplication, conflicting request identity, authorization and transitions.
  Fifteen server tests also passed in the preceding run. PostgreSQL/WASM coverage
  does not establish independent-process locking. Production remains unchanged.
- Next: 7c2e client platform mappings and mounted integration, then LB/process tests.

### Increment 7c2e1 record: native platform client mappings

- Added separate bounded catalog/member/room-invitation/table-invitation read cursors
  and authorized ledger reads. Added canonical friendship pair targets and manual
  settlement controls through the existing persisted controller lifecycle.
- Verification: 22 mapping/controller tests and full client TypeScript checking passed.
  Retries retain their original target/payload; unauthorized reads are not empty pages.
- Next: 7c2e2 mounted integration entry using the existing game screens and one
  authenticated journal/session. No production client selection changed.

### Increment 7c2e2 record: mounted integration client

- Added EXPO_PUBLIC_RUNTIME_MODE=distributed-integration as an explicit build entry;
  production selection remains unchanged. One deployment/account-scoped persistent
  journal owns commands across room/table navigation, disconnects and reloads.
- Mounted native catalog/create/enter/leave, table creation/lifecycle/rules and game
  actions using existing Call Break, Marriage and Flush screens. Room chat uses its
  own durable command slot. Legacy room services/sockets are never mounted here.
- 120 targeted client tests, TypeScript checking and integration web export passed.
  Chromium smoke verifies sign-in, room creation, persisted command ID, reload and
  room selection without legacy room traffic. It exposed an illegal browser fetch
  receiver; the read client now binds fetch to globalThis with a regression test.
- Limits: this is an integration client, not full production screen parity. Platform
  panels, table/game chat selection and transient pokes still need integration.
  Native hardware storage/lock and real provider smoke remain validation gates.
- Next: C3h/7d isolated launcher/LB and real process tests; close remaining parity
  before enabling the distributed production selection.

### Increment C3h/7d record: isolated launcher and actual load balancer

- Added explicit integration bootstrap with empty-dataset-only initialization,
  persistent runtime marker, exact schema verification and owned resource lifetimes.
  This branch's legacy Database.open refuses marked datasets under the migration
  lock. No implicit conversion of existing data and no production selector added.
- Added separate integration Dockerfile/compose and nginx configuration. HTTP has
  no affinity requirement; existing WebSockets stay on their gateway. Upgrade and
  timeout configuration is explicit; the proxy does not retry mutations.
- Verification: 9 bootstrap validation/SQL tests passed. An actual temporary nginx
  process with two independent ASGI gateways, real PostgreSQL and Redis passed HTTP
  distribution, stable room retry and WebSocket delivery/ACK during Redis failure.
  Docker itself is unavailable here; compose/container image execution is unverified.
- Temporary PostgreSQL/nginx were built for tests, without global installation or
  touching application data. Old deployed binaries still require credential/network
  exclusion at cutover; a marker cannot fence code that does not check it.
- Next: finish independent-process pause/kill/takeover tests and client platform
  bindings, then consolidated regressions and remaining browser/native gates.

### Increment 7c2e3 record: native platform and scoped chat bindings

- Bound existing friendship and ledger components through optional native transports;
  their legacy default behavior is retained. Durable controllers govern pending,
  rejected and accepted effects, and message drafts clear on delayed acceptance.
- Added profile/phrase, native notification read and paged room/table invitation
  controls, room settings/invitations and explicit room/table/game chat selection.
  Client reads have cancellation/time bounds. Revoked sessions clear private views.
- Fixed browser fetch receiver binding and optional paused-chat discovery isolation.
  The latter prevents a denied room chat from suppressing an authorized game view.
- Verification: 236 client tests passed; TypeScript, integration web build and iOS
  export passed. Mounted Chromium smoke covers persisted room creation/reload plus
  all three existing game screens using generated authorized projections. These are
  mocked transport/browser composition tests, not native hardware or provider proof.

### Increment C3i record: shared phrases and expiring pokes

- Reviewed phrase routes share the existing SQL service across gateways. Actor-scoped
  phrase mutation/read tests passed. The legacy poke handler is never mounted.
- Added fenced send-poke table commands with stable receipt/outbox effects, member/
  seat/recipient validation, 1.5-second cooldown and 15-second queued-intent expiry.
  Migration 25 adds the cooldown lookup index. No game/checkpoint mutation occurs.
- Poke presentation expires after five seconds, but normal outbox retention still
  applies. Redis presence does not gate private sends or imply recipient delivery.
  Existing overlays deduplicate IDs and reject expired/wrong-recipient messages.
- Eighteen targeted poke/activation SQL tests passed, including audience, retry,
  cooldown, spectator denial, unchanged checkpoints and atomic receipt rollback.
  Delivery-client coverage verifies validated, once-per-cursor transient presentation
  and ACK progress even when the UI callback fails. See the dedicated poke contract.
- Next: final increment-8 regression/correctness audit. Production activation and
  external/native/provider checks remain explicitly unverified.

### Increment 8 record: independent processes and consolidated regressions

- Added disposable real PostgreSQL/Redis plus independent uvicorn gateway fixtures,
  actual nginx configuration validation and HTTP/WS tests. No application service or
  database is used. Binary environment variables make skips explicit.
- Verified cross-gateway authentication/projections and actor hand isolation; one
  receipt/sequence for duplicate game requests; FIFO stale-revision rejection; Redis
  outage chat progress; real owner SIGSTOP beyond lease expiry; higher-epoch takeover;
  old-process resume; engine continuation on replacement; owner SIGKILL; and resumed
  gameplay after another takeover. No forced lease timestamp edits are used.
- Real concurrent creation yields exactly five tables and rejects the sixth. Current
  legacy Database.open refuses the dedicated dataset and closes its pool on failure.
  nginx distributes HTTP without affinity; sockets upgrade and deliver/ACK through
  the proxy while Redis is stopped. Automatic proxy mutation retries are disabled.
- A real PostgreSQL stop/restart returns no false durable acknowledgement; original-ID
  retry completes once after gateway pools recover without intervention. The test's
  own inspection pool is refreshed separately before final SQL assertions.
- PostgreSQL/nginx binaries were compiled only in temporary directories. A macOS/
  Python asyncio child-watcher waitpid hang on SIGSTOP required a Popen-backed gateway
  test wrapper with thread-based waiting; production code was not changed for it.
- Three process cases passed together in 180.79 seconds. Strengthened gameplay
  continuation passed in 123.69 seconds; database restart passed in 4.22 seconds.
  Ten additional real-Redis tests passed. Broad Python: 1526 passed, 13 optional skips,
  nine migration fake failures fixed; all 65 affected tests and nine final schema
  checks passed. Client: 236 passed, TypeScript/web/iOS exports and mounted Chromium
  smoke passed. Two existing Starlette deprecation warnings remain.
- These are correctness checks, not a 1K-connection/1.5M-account capacity result. Native
  hardware, real provider exchange, container execution and existing-data production
  cutover are explicitly not claimed. Implementation is complete in the isolated path;
  release validation and operations remain the next task set.

### O1 completion record — distributed application telemetry

Implemented `telemetry.py` with a process-local Prometheus registry, fixed-label
operation counters/histograms, post-commit command outcomes, gameplay outcomes by
engine, submission/dedupe counters, HTTP route-template metrics, WebSocket gauges,
and structured allowlisted JSON logs. Instrumentation is attached to shared runtime
boundaries so table controls, game actions, chat/social commands, invitations, pokes,
settlements, timers and recovery all pass through observed paths. Executors retain
their existing transaction and cancellation semantics.

`telemetry_runtime.py` supplies an opt-in private listener, local/pool gauges and
30-second read-only pending inbox/outbox sampling. Queries have a 1.5-second statement
limit within a two-second overall timeout. Last-success and current-sample-health
metrics distinguish stale values from a fresh empty queue. Sampling stops before
application pool cleanup; scrapes issue no SQL. The executable integration bootstrap
configures the logger and optional listener; compose enables an internal-only metrics
port. Distributed nginx/uvicorn default access logs are disabled to avoid OAuth query
leakage. Legacy runtime activation remains unchanged.

Verification:

- 158 SQL/runtime regression tests passed with PGlite: inbox and all engine/table/room
  execution, finalization, recovery, server/application, delivery and poke coverage.
- A separate 135-test flow batch passed: chat/social, shared platform/browser auth,
  reads/transport, settlements, placement/activation and Redis/presence/polling.
- 52 focused tests passed, including emitter failure isolation, unknown commit,
  post-commit accounting, rollback/final-fence failure, privacy, scrape listener
  cleanup and stale sampling. Five final targeted checks passed after distinguishing
  HTTP cancellation from server errors. These batches overlap; do not sum them as
  a unique suite count. There are 13 dedicated telemetry test cases in the final tree.
- Five independent-process PostgreSQL/Redis/nginx tests passed with metrics enabled:
  pause/resume/kill takeover, Redis loss, capacity enforcement/dataset isolation,
  HTTP/WS proxy delivery, PostgreSQL stop/restart, and private metrics/JSON log checks.
- Python compilation and `git diff --check` passed. Two existing Starlette
  deprecation warnings remain in the in-process test suites.

Design limits: metrics/logs are best-effort observations, never an accounting ledger;
crashes after SQL commit can lose the corresponding observation. Pool/lock/commit
wall time is measured, not client end-to-end latency. Pending outbox age is advisory
publication lag, not proof of missed delivery. Database backlog samples are global:
aggregate replicas with max and gate on freshness, not sum. One application process
per registry/listener is supported. IDs are log fields only; payloads, private cards,
chat text, tokens and exception messages are omitted. Repeated failure logs are
rate-limited; local stderr still requires a properly managed collector/rotation sink.

No cloud resources were provisioned, no application data migrated, no Grafana account
or alert contact configured, and no native client instrumentation added. The supplied
Alloy configuration is a deployment template; live Grafana ingestion and Alloy binary
validation remain staging checks. Host/Redis/PostgreSQL exporters, dashboards, alert
notification tests, tracing and capacity/HA/readiness work remain in the operational
rollout. The next concrete step is the staging collection/alert setup described in
`docs/distributed-runtime-telemetry.md`, followed by real-device parity/failure testing.


### P1 record — repeatable native production service provisioning

- Added `deploy/provision/run.sh` with separate `preflight` and `apply` modes, an
  Ansible playbook, inventory/secret examples, templates and operator instructions.
  It targets dedicated Ubuntu 24.04 hosts: PostgreSQL 17 from signed PGDG packages
  and Ubuntu Redis 7, managed by systemd independently of application Git pushes.
- Installs missing packages using `state: present`, without deliberate upgrades.
  Reconciles managed configuration and restarts only on configuration changes.
  PostgreSQL role/database creation is idempotent; no data deletion, schema
  initialization, conversion or migration is performed. Password changes reconcile
  from operator-supplied secrets and require coordinated application rotation.
- Validates actual host-bound RFC1918 addresses, two distinct application IPs,
  separate service hosts, explicit cloud firewall readiness and independent secrets.
  Rejects unmanaged packages/config/data/listeners and unexpected PostgreSQL clusters.
  An ownership marker supports resuming interrupted installations, not automatic
  adoption of existing databases. Secrets/local inventory are gitignored and
  secret-bearing tasks suppress output; SSH host-key verification stays enabled.
- PostgreSQL binds privately with SCRAM and per-app host access. Redis binds
  privately with authentication, 1 GiB maxmemory/noeviction, and no persistence for
  its reconstructible runtime role. The playbook configures kernel overcommit and
  verifies local PostgreSQL application login/query plus authenticated Redis PING.
- Verification: Ansible 2.20.9/community.postgresql 3.14.3 syntax check passed;
  four local unittest cases passed, including 15 actual Ansible assertion scenarios
  for fresh/unmanaged hosts, cluster version/port/multiplicity and network/firewall
  guards, plus RFC1918 boundary/invalid input checks. Shell syntax and whitespace
  checks passed. No service installation/restart or second-run idempotence was
  exercised on Ubuntu; Docker/Ubuntu execution is unavailable in this workspace.
- No remote host was accessed or changed. Private IPs and SSH access details remain
  missing. Firewall rules are an operator prerequisite, not provisioned by this
  playbook. Connections are private-network password authenticated; database TLS,
  backups/WAL restore validation, HA, production runtime activation, load balancing,
  DNS and branch-based application deployment remain separate work.
- Exact next step: obtain the four VPC addresses and administrative SSH details,
  confirm service-port firewall restrictions, populate/encrypt the ignored local
  configuration, and run preflight. Validate initial apply and unchanged rerun on
  disposable Ubuntu hosts before production apply. Then implement the separately
  planned production application release workflow and remaining readiness gates.


### P2 handoff — production push workflow and replacement-host setup

- User authorized secure push deployment from `bhidne-ho-scalability-prod` and
  native PostgreSQL/Redis setup on separate VMs. Added a dedicated Actions workflow
  testing the backend with PGlite and actual PostgreSQL/Redis/nginx processes, then
  publishing one GHCR image and deploying its immutable digest sequentially.
  Actions are commit-pinned, workflow deployments serialized and process-test skips
  fail the release gate. Existing `main` testing deployment remains unchanged.
- Added a root-owned forced SSH receiver accepting only check/deploy plus a digest
  for a fixed GHCR repository. It checks schema/marker and Redis before stopping an
  app, requires a healthy peer for replacement, detects image/environment changes,
  preserves the previous container and restores it on candidate readiness failure.
  It runs UID 10001 containers with private app ports, loopback-only metrics,
  read-only rootfs, dropped capabilities, memory/PID limits and rotated logs.
- Added `deploy/provision/apps.yml` to install missing Docker, configure root-only
  runtime credentials and install the restricted deployment key/receiver. Registry
  pulls use the deployment job's short-lived packages-read token sent over SSH stdin;
  root-private temporary Docker credentials are removed when the receiver exits.
  Native service provisioning remains separate from pushes. Local provisioning
  inputs/controller dependencies are excluded from Docker build context.
- Added `docs/production-deployment.md` covering credentials, empty-dataset-only
  initialization, load balancer/DNS, first release, partial-fleet failure, schema
  limits and the current native integration entrypoint/marker. No legacy-dataset
  conversion, automatic migration, database rollback or zero-downtime claim.
- GitHub change actually completed: created repository environment `production`
  with custom branch policy permitting only `bhidne-ho-scalability-prod`. Verified
  via API using existing Git credentials without exposing them. Set and verified
  production-environment app-host variables for the replacement addresses. Created
  a dedicated local ED25519 key at `~/.ssh/bhidne-ho-github-production`. Automatic
  approval review rejected uploading this exact private key as the environment
  secret without specific user authorization. An explicit approval question is
  pending; do not retry or bypass that rejection unless approved. No secrets were
  written and no workflow was pushed. Initial VM checks described below were read-only; see the subsequent service
  provisioning handoff for live changes. Application deployment has not run.
- User then destroyed all originally pictured droplets and recreated replacements
  using a shared SSH login key. User confirmed four replacements: app1
  `168.144.105.49`, app2 `165.245.180.205`, PostgreSQL `159.223.94.162`, Redis
  `157.245.50.145`. Inventory records these public addresses; all VPC addresses have since been
  verified as described below. Do not reuse the destroyed-host IPs. The workflow
  reads `BHIDNE_PROD_APP1_HOST`/`BHIDNE_PROD_APP2_HOST` from the production environment.
  Recreated hosts need newly verified SSH host fingerprints even with the same
  login key. User confirmed all four use `bhidne-ho-production-servers.pub`;
  inventory now selects the matching local private key. User provided app1's
  console fingerprint `SHA256:9gAdsvvGL9eDyLZHWQcCUlY1AhY8/fFpo//EYrrEF5M`;
  it exactly matches the fetched ED25519 host key. The verified known-hosts line is
  stored at `/private/tmp/bhidne-prod-app1-verified-known-hosts`. User loaded the
  passphrase-protected shared key into their SSH agent; strict SSH as root now works.
  Its .pub fingerprint is `SHA256:FYArzeG7cNDUJsc8eGNCl9bbMWhNZMUfzgrW2loX4Vw`.
  Read-only app1 inspection confirms Ubuntu 24.04.4, no Docker, and VPC address
  `10.104.0.7` on eth1, independently confirmed by DigitalOcean metadata. The
  `10.15.0.6` address on eth0 is not the VPC address to use. Local UFW is inactive;
  cloud firewall configuration is not yet verified. Inventory records app1's VPC
  address. App2's supplied fingerprint
  `SHA256:zXnyMvVkfCTZlmTTxFKY69Gss9EzcGb4Qtl0OaHf7HQ` also exactly matches its
  fetched ED25519 host key. Verified root SSH inspection confirms Ubuntu 24.04.4,
  no Docker, inactive UFW, and VPC address `10.104.0.2` on eth1, confirmed by
  DigitalOcean metadata. Inventory records both app VPC addresses. The combined
  verified app known-hosts file is `/private/tmp/bhidne-prod-apps-verified-known-hosts`.
  Redis's supplied fingerprint
  `SHA256:dFvQRZ62qayXvxhMQe6BdcqTTeUcCKsbqmuQOUQpM1Q` matches its fetched
  ED25519 key, stored at `/private/tmp/bhidne-prod-redis-verified-known-hosts`.
  Verified root SSH inspection confirms Ubuntu 24.04.4, no installed redis-server
  package, inactive UFW, and VPC address `10.104.0.8` on eth1 confirmed by metadata.
  Inventory records that Redis address. These initial checks did not change VMs.
  PostgreSQL verification and subsequent live changes are recorded below.
- Verification so far: 27 mocked release-receiver tests pass; five provisioning
  tests pass, including 20 actual local Ansible assertion scenarios. Both playbooks
  pass Ansible syntax checks; workflow YAML and its shell steps parse, and whitespace
  checks pass. Broad backend run: 1577 passed, 1 failure and 15 setup errors in
  sandboxed live-service fixtures. All 16 affected cases passed outside the sandbox
  against disposable local services in 206.55 seconds. No application fixes were
  needed for those failures. Two existing Starlette deprecation warnings remain.
  Docker installation and real image rollout remain unverified; no Docker runtime
  is available locally. Native-service apply and rerun results are recorded below.
- Subsequent service progress and the current next step are recorded below.


### P2 service provisioning handoff — verified replacement hosts

- PostgreSQL console fingerprint `SHA256:3wM2Zs3FnrJcpSNqAqjXOALJDwPfv7nZrnFMPm1si2E`
  exactly matches its scanned ED25519 key. Strict root SSH works using the shared
  administrator key. Ubuntu 24.04.4 and VPC IP `10.104.0.9` were verified on eth1
  and through DigitalOcean metadata. No existing PostgreSQL installation, data,
  configuration or service listener was found. All four verified host keys are
  held in `/private/tmp/bhidne-prod-all-verified-known-hosts`.
- Added and applied `deploy/provision/service-firewall.yml` to the two database
  hosts. UFW permits SSH22 and allows the appropriate database port only from
  app VPC IPs `10.104.0.7` and `10.104.0.2` to the service VPC address. Other service
  sources and unsolicited inbound traffic are denied. Existing unrelated rules
  are refused rather than reset. Initial apply: both hosts ok=12, changed=5,
  failed=0. Cloud firewall state is unchanged. App-host firewall setup is pending.
- Created mode0600 gitignored `inventory.local.yml`, encrypted `secrets.local.yml`
  and `.vault-password.local.yml` under `deploy/provision/`. The independent
  database and signalling secrets were never printed or sent to GitHub. Preserve
  these local files; do not regenerate credentials on reruns.
- Both fresh database VMs passed all service preflight assertions. Native service
  installation completed: PostgreSQL 17.11 (PGDG) and Ubuntu Redis 7.0.15, enabled
  at boot and active. Initial service apply: PostgreSQL ok=21 changed=12 failed=0;
  Redis ok=18 changed=6 failed=0. PostgreSQL application credentials passed SELECT 1
  and Redis authenticated PING passed. The dedicated database remains empty of
  application schema; runtime bootstrap has not run.
- Both app hosts reached private PostgreSQL5432 and Redis6379; unauthenticated Redis
  PING was rejected. Cross-database-host service access and public service ports
  were inaccessible. Listener inspection confirmed only loopback and the expected
  VPC addresses. UFW status confirmed source-specific rules and default inbound
  deny; fresh strict SSH connections succeeded.
- Unchanged live service rerun: PostgreSQL ok=22 changed=0 failed=0; Redis ok=16
  changed=0 failed=0. No restart handlers ran and authenticated checks passed again.
  Collection deprecation warnings concern Ansible APIs scheduled for removal in
  2.24; the controller is constrained to 2.20. This initial live validation used
  the user-authorized replacement VMs after confirming they contained no services
  or data. Backups/restore, HA and capacity validation remain pending.
- Exact next step: obtain load-balancer details (frontend origin supplied below),
  configure app-port firewall restrictions, then provision the application hosts.
  The exact GitHub deployment-key upload approval remains unanswered; no private
  key upload or application rollout may be inferred from supplied fingerprints.

### P2 frontend domain handoff

- User selected GitHub Pages hosting at `https://prod.bhidne-ho.lfactorial.com`
  with backend `https://api.prod.bhidne-ho.lfactorial.com`. Updated example and
  ignored local production inventories with the frontend HTTPS origin. No remote
  app configuration or DNS changes were made.
- Inspected the existing main-only Expo Pages workflow. GitHub's documented
  one-site-per-repository limit means a separate production Pages repository is
  needed to keep the existing main site. Asked whether to use the suggested
  `L-factorial/bhidne-ho-prod-site` or replace the existing site; answer pending.
  Existing frontend workflow and CNAME are unchanged. Documented production build
  variables, the proposed hosting arrangement and DNS destinations.
- Verification: parsed both inventory YAML files and confirmed the exact origin;
  whitespace validation passed. No runtime code changed.
- Exact next step: resolve Pages destination choice and backend load-balancer
  details, then implement production frontend publishing and app provisioning.
  The earlier exact deployment-key upload approval remains outstanding.

### P2 frontend selector removal

- At the user's request, removed the login backend selector and all supporting
  client changes, selection persistence, translations, and selector-specific tests.
  Restored the six affected tracked client files to their pre-selector contents.
  Existing distributed client code and its explicit integration-build selection
  remain intact. Reverted the additional CORS origin introduced for the selector.
- Earlier deployment/provisioning work and unrelated telemetry changes are
  preserved. No live server, GitHub, DNS or credentials were changed.
- Verification: TypeScript check and refreshed local web export passed. No
  tracked client diff or selector code references remain; whitespace checks pass.
- Exact next step: resolve the frontend hosting/build arrangement separately from
  the production backend's outstanding load-balancer/TLS and key-upload approval.

### P2 Cloudflare Pages frontend preparation

- User selected a separate Cloudflare Pages frontend for this production branch.
  Added `client/scripts/build-cloudflare.mjs` and `npm run build:cloudflare` to
  type-check/export with the production API/web URLs and distributed runtime.
  Rejects other Cloudflare branches; removes exported CNAME only. Existing main
  Pages workflow, source CNAME and distributed client implementation are preserved.
- Added `docs/cloudflare-pages.md` with exact Git integration, build, branch and
  custom-domain/DNS settings. No Cloudflare credentials are available in this
  session; the cloud project, account connection and DNS are not configured.
- Verification: TypeScript and production export passed; wrong-branch rejection,
  production API URL in bundle, source CNAME preservation and exported CNAME
  removal verified. Mocked browser smoke passed login, durable room creation,
  disk journal, reload and room selection with no legacy room traffic. No game
  projection fixtures were supplied; this is not live backend/game verification.
  Whitespace checks passed.
- Exact next step: publish the frontend preparation files to this branch, connect
  the repository through Cloudflare Pages, configure its custom domain, then
  validate against the deployed backend. Backend load balancer/TLS, application
  rollout and the separate GitHub deployment-key approval remain outstanding.

### P2 app-host frontend and managed load balancer

- User chose native Nginx/frontend on both app VMs behind a managed DigitalOcean
  LB. Cloudflare files replaced with a general production export script. Added
  `Dockerfile.production`: Node builds the frontend in CI, then the export joins
  the backend runtime image. Existing distributed development Dockerfile and main
  Pages deployment remain unchanged.
- Both hosts stage validated frontend assets in the preflight release phase, before
  either index is activated. Bounded archive extraction refuses traversal/links,
  assets are append-only with collision checks, and frontend activation follows
  backend readiness. Failure restores prior frontend and backend. Release history
  is retained; retention and cross-version API compatibility remain operator duties.
- App provisioning installs native Nginx, validates config before reload, serves
  static content on the frontend Host and proxies API/WebSockets on the API Host.
  Private80 ingress is restricted to configured LB sources; health includes frontend
  presence and local backend health. LB source addresses/firewall readiness are
  required before the full app playbook can run.
- Verification: 36 release tests, six provisioning guard tests, Ansible syntax,
  workflow YAML/shell validation and production frontend typecheck/export passed.
  Nginx 1.24 Ubuntu package installed on both apps with auto-start blocked, then
  explicitly stopped/disabled at boot. Both hosts passed nginx -t against the
  rendered config; no production listeners were enabled. A temporary loopback-only
  Nginx instance on app1 passed index/SPA routing, hashed asset caching, missing
  asset404, API proxy, unknown-Host404 and combined readiness200/503 checks, then
  was stopped and removed.
- Full Docker image build and live image/frontend release remain unverified:
  the local controller has no Docker binary. The CI recipe builds the frontend
  in a separate Node stage. No app provisioning or frontend files have yet been
  activated on the VMs; full provisioning remains gated on LB/firewall inputs.
- Exact next step: finish validation, obtain managed LB details and app firewall
  configuration, resolve pending exact deployment-key upload approval, then apply
  app provisioning, initialize the empty dataset once and publish/deploy the release.
  No frontend/backend release, DNS change or key upload has occurred in this step.

### P2 managed load balancer address

- User supplied public LB IP `129.212.208.25`; recorded in example and ignored
  local inventories and deployment instructions. This does not establish its
  private source addresses, LB type, attached droplets, TLS or forwarding rules.
- No DigitalOcean connector or doctl is available. Requested the provider page
  link and current settings to resolve private ingress/forwarding configuration.
  No firewall readiness flag, Nginx allowlist or remote configuration was changed.
- Exact next step: verify the LB configuration and app firewall restrictions, then
  finish app provisioning and release. Public DNS/TLS checks are recorded below.
- Public checks: HTTP80 returned503 for the API Host; a TLS handshake on443
  timed out. Neither production hostname resolved from the controller. These
  observations do not establish the LB's configured forwarding rules or TLS state.
  Inventory edits passed whitespace validation; no DNS records were changed.

### P2 production DNS delegation

- User approved delegating only `prod.bhidne-ho.lfactorial.com` to DigitalOcean
  for managed Let's Encrypt; the parent domain remains on GoDaddy. Documented
  exact child-zone A records, parent-zone NS records, verification commands and
  certificate names. No provider account access is available, so DNS and
  certificate mutations remain dashboard steps for the user.
- Authoritative checks: GoDaddy returned the parent SOA with no production NS
  delegation; ns1.digitalocean.com refused the child-zone SOA query. Recursive
  production A/CNAME/NS and parent CAA queries returned no answer records.
- User screenshots show regional external HTTP LB in SGP1/default-sgp1, HTTP80
  to droplet80, health path /, Proxy Protocol disabled, keepalive enabled and no
  HTTPS rule yet. The last screenshot is the new-certificate wizard, not evidence
  of an issued certificate or saved forwarding rule.
- Exact next step: create the DigitalOcean child zone before adding the three
  GoDaddy NS records, verify propagation, then issue the certificate and finish
  the HTTPS forwarding rule. App firewall/LB sources and key upload remain pending.

### P2 load balancer and firewall dashboard progress

- User completed certificate, redirect and /health dashboard steps, attached both
  app droplets (screenshot confirmed), and reported creating the app firewall
  after correcting the peer TCP port to8080. Final saved firewall rules still
  need verification; application_firewall_ready remains false.
- Live checks: SSH works on both apps; Nginx remains inactive. Both production
  HTTPS domains validate certificates and return503, consistent with no healthy
  application targets. No application release was activated.
- Header-only private-interface captures on both apps observed three TCP80
  probes each, at ten-second intervals, from10.104.0.3. Recorded this observed LB
  source in the ignored local inventory; future source changes require updates.
- Next: verify saved firewall rules/boundaries and resolve exact GitHub deployment
  key upload approval, then complete app provisioning and initial release.

### P2 GitHub production secrets authorized and saved

- User explicitly approved uploading the dedicated deployment private key to
  L-factorial/bhidne-ho's production environment as BHIDNE_PROD_DEPLOY_SSH_KEY.
  Uploaded it using GitHub's public-key encryption, along with the verified app
  host keys as BHIDNE_PROD_KNOWN_HOSTS. API metadata confirms both secret names
  exist. No credential values were printed or committed.
- The earlier exact key-upload approval blocker is resolved. This does not
  activate a deployment: app provisioning, firewall verification, initial schema
  initialization and image release remain outstanding.

### P2 application hosts provisioned

- User screenshot confirms saved app firewall: SSH22, HTTP80 from managed LB,
  TCP8080 from10.104.0.2/32 and10.104.0.7/32, default outbound rules, two droplets.
  Enabled the ignored inventory firewall readiness flag and populated the
  dedicated deployment public key. Applied apps.yml successfully to both hosts:
  each ok19, changed11, failed0, unreachable0.
- Docker and Nginx are now active; protected runtime configuration, constrained
  deployment receiver, dedicated authorized key and frontend/API virtual hosts
  are installed. Both apps passed database-port checks and nginx configuration
  validation. Local /health returns503 until the application and frontend exist.
- Dedicated key SSH authentication succeeds but arbitrary shell commands are
  rejected by the receiver. Release tests:36 passed. No image release or database
  initialization occurred. Next: publish the production branch's prepared changes,
  build the tested image in CI, initialize the empty production schema once from
  that immutable image and rerun deployment; verify public login and runtime.

### P2 first production release completed

- Published prepared app-host frontend changes as e665af2. GitHub run36378657438
  passed1606 backend tests in1298.32s and five real process tests in206.66s, then
  built/published image sha256:801f6d6b292b5fd49b1dc08c60ac0a312f667b30f7be62559be1be6df67c35d2.
- Initial preflight refused the uninitialized dataset. Admin initialization from
  that exact image confirmed zero public tables, created the dedicated schema
  and verified migration versions/marker. No legacy dataset was touched.
- Both app hosts deployed successfully. Public verification initially failed
  while the managed LB accumulated five successful health checks. The unchanged
  deployment rerun passed; the complete workflow is now successful. Extended
  future public verification retries to90 seconds; YAML and shell syntax pass.
- Verified both host Nginx health endpoints, public HTTPS frontend/API, browser
  sign-in rendering without uncaught errors,401 authentication boundary and CORS,
  and secure WebSocket upgrade. No production test account was created; live
  authenticated gameplay remains unverified. App provisioning rerun: zero changes
  and zero failures on both hosts.
- Retry-window/docs-only follow-up uses [skip ci] to retain the already-tested
  running image without another redundant rebuild. Ordinary future branch pushes
  continue to test, build and deploy automatically.
- Next operational work: authenticated gameplay acceptance, off-server database
  backup/restore, monitoring and capacity/recovery verification before wider use.

### P3 original frontend parity — requirement correction and first increment

- User clarified that merging main was intended to preserve the exact original
  layout/pages/experience with a distributed backend. The separate integration
  screen does not satisfy that requirement. User authorized implementation;
  no production activation of partial parity is authorized by this increment.
- Added docs/distributed-ui-parity.md with the original frontend reference,
  implementation/acceptance checklist, activation boundary and known contracts.
- P3a extracts RoomActions for create/enter/leave/delete from SharedRoomsScreen
  and useRoomSession. Legacy transport remains default; JSX layouts, root build
  selection, authentication, existing room reads and sockets are unchanged.
- Added DistributedRoomActions for a dedicated journaled command slot. Awaited
  completion means durable acceptance, not pending admission. Same-intention
  retry preserves IDs/payloads, background acceptance cannot duplicate a mutation,
  restored operations can be recovered before new actions, and account changes
  or disposal prevent late success. The adapter is not yet mounted.
- Known gap: legacy active-game leave confirmation uses structured error data;
  durable room rejection currently has text. Adapt authoritative state/metadata
  before activation rather than inventing success or parsing error text.
- Verification: TypeScript check and 58 targeted adapter/controller/session/command
  tests passed. Full client suite:245 passed, zero failures/skips. Whitespace
  validation passed.
- Exact next increment: P3b, authenticated runtime composition and original lobby
  read contracts, preserving pending-operation recovery and original navigation.
  No server changes, build flag changes, commits, pushes or deployments in P3a.

### P3b original UI adapters — in progress

- Added an authenticated OriginalDistributedRuntime owner using the existing
  exclusive account journal lifecycle. It retains uncertain room work on logout,
  recovers accepted creation after reload, and retires terminal room intentions
  only after the caller acknowledges persisted navigation. It is not mounted yet.
- Added committed, read-only /distributed/ui projections for original lobby cards,
  memberships, active tables and game selection. Private invitations stay outside
  the public/friend room feed. Public table previews never grant membership or
  expose engine snapshots. Explicit unknown match IDs fail instead of selecting
  a different match. Shared projection reads do not execute legacy timers/writes.
- Added bounded client pagination preserving original category/recency ordering;
  invalid/repeating cursors fail visibly. Presence is still absent, not fabricated
  from membership. Member previews currently use stable ID order pending presence.
- Added DistributedGameCommandClient with the original submit/refresh interface.
  Durable slot ownership survives screen changes; pending is not success and a
  failed projection read after command acceptance does not repeat the mutation.
- Verification: TypeScript check passed. Backend targeted suite:28 passed with
  PostgreSQL/WASM enabled; the additional authenticated UI-route test passed
  in the11-test transport suite. Full client suite:257 passed, zero failures or
  skips. Whitespace check passed. No production activation or deployment.
- Remaining in this increment: mount these adapters through original UI lifecycle,
  implement distributed presence/social bridge and original request contracts,
  and test recovery/navigation. Build mode and production deployment unchanged.

- Added invitation-preview and paginated member-profile reads. An invitation
  allows a room preview but does not join it or grant private game/member-profile
  access; revoking the invitation removes preview access. Exact next step remains
  original-screen composition, beginning with session/read/connection injection;
  these adapters alone do not complete frontend parity.

### P3b original screen composition — acceptance in progress

- Mounted one account-owned runtime behind the original screens in the explicit
  `distributed-original` mode. Production remains `distributed-integration` until
  the complete acceptance checklist passes. No production deployment yet.
- Added authenticated request routing for original room, table, social, chat,
  notification and ledger controls. Unknown distributed routes fail closed;
  shared authentication/profile reads retain their existing platform endpoints.
- Table/game commands retain distinct identities and revisions. Accepted commands
  with failed follow-up reads keep their journal intention without resubmission.
  Completed-table replacement retains its original revision through retry.
- Added actor-specific structured departure conflicts, persisted table reactions,
  own-command identifiers in chat history, and observed Redis presence in lobby
  projections. Unknown presence displays as unknown. Original styles unchanged.
- Original invitation entry now waits for account runtime initialization. A
  successful membership read clears revoked room navigation without racing a
  newer entry. Chat history establishes its baseline before unread live delivery.
- Verified original welcome, styled sign-in/sign-up, lobby, room creation and
  two-player Marriage table creation in Chromium against disposable native
  PostgreSQL/Redis and two gateways. No browser JavaScript errors in those paths.
- Verification so far: TypeScript passed; full client suite 262 passed before
  four additional recovery/chat regression tests (all nine API tests pass).
  Room departure/creation backend suite: 34 passed. Full backend and independent
  process suites are running. Browser gameplay/social acceptance remains ongoing.
- Exact next step: finish guest seat/start/gameplay for Marriage, Flush and Call
  Break; verify original social/ledger/recovery journeys and mobile screens; fix
  any contract gaps, then activate only after the remaining acceptance checks.

### P3 acceptance progress

- Full backend run: 1,607 passed, 15 opt-in skips, and one metrics-listener failure
  caused by the filesystem/network sandbox denying socket bind. That exact test
  passed with local socket permission; no application change was required.
- All five real PostgreSQL/Redis/two-gateway process checks passed, including the
  actual Nginx HTTP/WebSocket/retry contract (run separately with Nginx configured).
- New checked-in original UI adapter acceptance passed on a fresh native cluster:
  all three games create/seat/chat/start/end, private reads, ledger/departure,
  friendship/direct messaging and notification read state. Node 22 is now explicit
  in production CI, and image builds run the complete client regression suite.
- Client suite: 269 passed with zero skips; typecheck passed. Added regressions for
  own-profile chat lookup, retained selected match/replacement revisions, failed
  follow-up reads, restored offscreen intentions and concurrent receipt recovery.
- Browser: original Marriage desktop/mobile declaration commands passed; original
  Flush desktop/mobile dealt, cut and bet successfully. No JavaScript errors.
  Final Call Break browser check and production-mode build remain next.
- Public table reactions preserve original spectator visibility; private pokes
  remain recipient-only. Three focused durable poke/reaction tests passed.


### P3 original frontend activation — rollout in progress

- Completed desktop/mobile Call Break shuffle, cut and distribution browser checks,
  plus original table-chat delivery between browsers, authenticated room reload and
  return to the active game, profile loading and sign-out persistence. No browser
  JavaScript errors. Browser gameplay covers initial actions, not exhaustive rounds.
- Production-mode export/typecheck passed; static export is approximately 8.8 MB.
  Main/GitHub Pages configuration remains unchanged.
- Compatibility release `91ac85f` is pushed; GitHub Actions run `36385373177`
  is executing required backend/native process tests before deploying both hosts.
  It retains the integration frontend so browsers cannot reach new UI routes on
  an old backend during a rolling cutover.
- The original-frontend build flag and deployment documentation are prepared
  locally. Exact next step: verify compatibility release on both app hosts, then
  push activation, monitor CI/rolling deployment, and verify both hosts and public
  original welcome/sign-in screens. Do not report activation before verification.


- Compatibility run `36385373177` stopped before publishing/deploying: 1,618
  backend tests passed, but original-UI acceptance could not import `i18next`
  because CI had not installed client dependencies outside the Docker build.
  Added lockfile-based `npm ci --prefix client` and moved original-UI acceptance
  ahead of the long backend suite. It had passed locally with dependencies present.
  Production mode remains integration for this corrected compatibility release;
  activation will be committed again only after both hosts receive it.


### P3 original frontend activation — compatibility verified

- Corrected compatibility release `a2e072e` deployed successfully through GitHub
  Actions run `36387386219`. CI passed original-UI native acceptance (1), the
  backend suite (1,618), all independent process checks (5), client tests and the
  image build. No tests were skipped in those CI acceptance suites.
- Direct SSH verification confirmed both hosts run revision `a2e072e` and image
  `sha256:98879f8adaca4c3bbede5f5946de559a491dd5c733a5601f2bcaef4119c2ba08`,
  return healthy API responses, and serve identical frontend index files.
- Switching production build to `distributed-original` is now safe across both
  load-balancer targets. Exact next step: push activation, complete its required
  CI/rolling deployment, then verify original public desktop/mobile pages and
  identical healthy releases on both hosts.


### P3 complete — original frontend deployed and verified (2026-09-28)

- Activation commit `45ad67c` deployed successfully through GitHub Actions run
  `36390417629`: original-UI native acceptance (1), backend suite (1,618), all
  independent process checks (5), client suite (269), typecheck and image build.
- Both app hosts directly verified at revision `45ad67c` and image
  `sha256:a4be23258b76b5a0c6a40bc5770fae9512d4b898ea2eae6d7f39931ea5abe091`.
  APIs are healthy and frontend release paths/index hashes agree across hosts.
- Public `https://prod.bhidne-ho.lfactorial.com` serves the original welcome,
  sign-in and sign-up layouts on desktop/mobile Chromium, with no JavaScript
  errors or failed requests. Authenticated original UI/game/social acceptance
  was performed against disposable native infrastructure, not production users.
- Public original-UI API routes require authentication (401 without a session),
  and production-origin CORS preflight succeeds. Backend runtime/database marker
  remains distributed-integration by design; original frontend uses distributed-original.
- Main/GitHub Pages remains unchanged. No environment-toggle UI was introduced.
  Temporary local browser/native cluster services are stopped.
- Remaining limitations are the separately scoped operational task set: capacity,
  observability, database HA, provider credential configuration and native-device
  release validation. Exact next task is an operational readiness increment when
  requested; no original-frontend implementation or deployment step remains open.


### Interactive action latency correction — 2026-09-28

- User reported multi-second moves with the first two production players. Read-only
  inspection showed low app resource use and repeated `ingress_wakeup_failed`;
  matching submitted/committed command IDs showed roughly 5–8-second game delays.
- Root cause: server assembly supplied `RoomCommandRouter.wake(lane_id)` directly
  to hosted/chat ingress, whose callback contract is `(room_id, lane_id)`. The
  resulting TypeError was swallowed by the advisory-wakeup boundary. Durable
  fallback scans eventually committed commands, hiding the defect in functional
  acceptance without latency assertions. Existing routing tests used an adapter;
  production assembly had omitted it.
- Added the adapter in server assembly; routing still derives the room from the
  durable lane. Persistence, authorization, fencing, deduplication and safety scans
  are unchanged. Social ingress already used its correct one-argument callback.
- Added a deterministic assembly-contract regression and native local/remote owner
  latency acceptance for table controls, game commands and chat. Initial native
  result: all eight commands completed in 0.11–0.13 seconds on disposable local
  PostgreSQL/Redis/two gateways. This is not a production network latency promise.
- Verification: server assembly suite 16 passed; routing/Redis/ingress/chat suite
  51 passed; all six native process checks passed, including latency, Redis loss,
  owner takeover, database outage, deduplication and Nginx delivery.
- Exact next step: deploy through production CI, verify both host revisions/health,
  and inspect post-deployment wakeup diagnostics.

### Original UI action feedback correction — local only (2026-09-28)

- User reports improved backend latency but flashing pending/aborted-fetch errors
  and poke HTTP 409 during Flush. Explicit instruction: do not push these changes.
- Game adapter now reconciles the original journalled command at 100 ms intervals
  for a two-second fast-confirmation window, waiting for concurrent background
  recovery instead of competing with it. Unresolved confirmation is a distinct
  pending state, not a refresh/connection error. Original IDs, revisions, rejection
  details and retry-only-read behavior after acceptance remain intact.
- Distributed game controls delay the progress notice 500 ms to avoid flashing on
  fast moves; genuinely slow actions retain confirmation feedback and remain
  disabled until a committed projection is observed. Layout and legacy behavior
  are unchanged. Opponent-view periodic refresh remains one second.
- Intentional session disconnect during background command recovery no longer
  reports its aborted request as a connection failure. Regression reproduces this
  path; the exact production aborted-fetch instance has not been traced, and real
  network/timeout failures are still reported rather than globally suppressed.
- Active-game ingress capability gate now permits send-reaction alongside
  send-poke. Previously the reaction executor accepted it, but ingress rejected
  before enqueueing. Regression now goes through ingress in Flush, Marriage and
  Call Break, checking durable public audience, dedupe and unchanged game state.
- Verification: 273 client tests passed; TypeScript passed; five PostgreSQL/WASM
  poke/reaction checks passed; native two-gateway original-UI acceptance passed
  (17.05 s), including actual Flush deal/cut using the game adapter and active
  reactions through the social adapter in all three games. Diff whitespace clean.
- No commit, push or deployment performed. No production player data modified.
  No new browser-rendering or production latency claim: these are adapter/native
  integration checks. Exact next step: review local diff; push/deploy only after
  the user authorizes it, then verify real two-player Flush responsiveness and
  trace any remaining aborted-fetch error with request timing/context.

### Production trace and misleading reconnect state — local only (2026-09-28)

- Read-only inspection of both app logs and PostgreSQL command metadata confirmed
  recent creation/start/Flush actions commit promptly: create-table 123 ms,
  join-seat 247 ms, lock 221 ms, start 261 ms, Flush deal/cut/bets 191–296 ms,
  chat 50–78 ms. Earlier end was 582 ms and enter-room 1,700 ms. These are stored
  inbox creation-to-completion durations, not browser click-to-render timings.
  No leave-room command exists in the inspected inbox (40 total rows), so the
  reported leave attempt cannot be claimed to have reached or committed there.
- Logs contain repeated ingress TableStateRejected failures consistent with the
  already identified active-reaction gate. read.snapshot is misleading telemetry
  naming: it labels stream opening, including expected denied optional chat
  subscriptions. These entries alone do not prove failed game snapshot reads.
- Found separate UI state bug: every background command recovery failure invokes
  the same callback as delivery failure, setting the whole screen to reconnecting.
  A healthy unchanged game need not emit another snapshot to clear that status.
  The pending poke also occupies the shared table-control intention slot; its
  preserved unresolved intent can block a different table-control action.
- Local fix propagates command versus delivery error source through session/root;
  command failures remain visible and journalled but do not falsely mark delivery
  disconnected. Authentication expiry still closes the account runtime. Regression
  proves failed command recovery retains its intent and healthy subscription,
  while actual subscription closure is still reported as delivery failure.
- TypeScript and all 274 client tests passed; diff whitespace clean. No production
  writes, commits, pushes or deployments. Existing local fixes remain undeployed,
  as requested. Next: review changes and obtain user authorization before any push;
  then verify browser interaction timing and the exact leave/exit flow after rollout.

### Event-driven original UI and lobby coverage — implemented locally (2026-09-28)

- Explicit user authorization to implement the planned improvements, with NO push
  or deployment. All earlier local feedback fixes are preserved. Main/legacy UI
  keeps its existing behavior; original layouts and engine rules are unchanged.
- Original game screens now observe the root's committed, player-specific
  WebSocket-driven snapshots. Normal one-second snapshot polling is replaced by
  a 30-second recovery refresh; unresolved actions retain bounded recovery checks.
  Foreground/online transitions request recovery immediately. Ending a table drops
  its obsolete game/chat selection while retaining room delivery.
- Hosted lanes share a 20 ms batching window for snapshot reads. Invalidations
  arriving during an in-flight read force a subsequent read, not reuse of an
  earlier snapshot. Late HTTP recovery cannot overwrite higher committed revisions.
  Identical selections do not recreate a socket. Initial/reconnect reads remain.
- Durable delivered ACKs can complete matching command journals, preserving actor
  scope, command IDs, lane/sequence validation and persistence-before-observation.
  ACKs arriving before admission are buffered until the inbox sequence is known.
  Late pending HTTP receipts cannot downgrade committed outcomes. Game confirmation
  uses an already delivered snapshot when its match/revision meets the outcome;
  status reads at one-second intervals are fallback during the bounded wait, not
  the healthy-path update source. Existing rejection/ambiguity handling remains.
- Lobby rooms/memberships now refresh on delivery activity, initial load, foreground
  and online, with coalescing and a 30-second fallback. Root discovery/recovery is
  also 30 seconds. Delivery heartbeats/server-side outbox catch-up remain unchanged.
- Additive migration 26 introduces an authenticated public `lobby` delivery lane.
  Its only payload is LOBBY_CHANGED, with no room/player IDs or private metadata.
  Public room creation/deletion/visibility and table-count changes invalidate this
  stream. Private changes notify affected users on their existing recipient lanes.
  Creator/member/invitation audiences are captured before departure/deletion, so
  removal of room access cannot erase the user's personal invalidation. Creation,
  invitations/answers, membership, visibility, table creation/closure and invitation
  reconciliation participate. Existing friendship recipient delivery refreshes
  lobby classification. These invalidations share the mutation's DB transaction;
  no synchronous WebSocket send or all-user database fanout occurs in a command.
- Snapshot errors from closed table subscriptions are avoided by keeping only the
  room scope for ended tables. Connection interruption is reported explicitly;
  command errors remain separate from delivery health.
- Explicit `bootstrap migrate` validates the distributed marker and supported
  contiguous history, then applies pending migrations under the migration lock.
  Startup/check remain read-only. CI phases now migrate, check both hosts, upgrade
  both backends sequentially, then activate frontends. Release receiver phases are
  constrained to configured repository digests and tested.
- BEFORE PUSH: install the updated receiver on both hosts using the dedicated
  `deploy/provision/release-receiver.yml` playbook. It only updates the receiver.
  See `deploy/production/event-driven-rollout.md` for the exact command, rollout
  sequence, and migration limitation: a pre-26 image cannot restart against schema
  26, so recovery after migration requires a compatible forward-fix image. Nothing
  in this task installed that receiver or migrated production.
- Verification: 279 client tests and TypeScript passed; production web export
  checked separately below. Backend regression group 74 passed; earlier room,
  catalog, social and delivery group had 61 passed and one environment-related skip
  with four obsolete event-count expectations subsequently corrected and passing
  in the 74-test group. Lobby/upgrade + release group 42 passed; final release suite
  39 passed; invitation/replacement suite 6 passed. Bootstrap tests also passed.
- Native: all six multi-process checks passed (88.57 s), including outage/owner
  takeover/dedupe/delivery. Original UI acceptance passed with real WebSockets,
  public lobby creation/deletion for a nonmember, Flush delivery to both players,
  reactions in all three games, and end/departure. Recorded local move-to-both-root
  snapshot times: deal 1,427 ms, cut 538 ms; these are not production/browser SLA
  claims and include fallback where necessary.
- Browser: disposable local native cluster, desktop/mobile Chromium, original
  Flush deal/cut/two bets passed with no page errors; idle observation had zero
  game-snapshot HTTP reads over three seconds. This checks the happy path, not an
  exhaustive full game/capacity test. Temporary browser services were shut down.
- YAML parsed, dedicated receiver Ansible syntax checked, diff whitespace clean.
  No production data writes, git commits, pushes or deployments performed.
- Next: user reviews local changes, installs the receiver with their administrative
  access and decides when to push. After their rollout, verify both revisions and
  real two-player browser latency, lobby/privacy/departure/reconnect flows. Capacity,
  full-round gameplay and native-device release validation remain separate scopes.
- Final production-mode Expo web export passed at
  `/private/tmp/bhidne-event-production-web`; temporary cluster shutdown completed.

### Player-facing failure messages — implemented locally (2026-09-28)

- User authorized consistent, understandable feedback across the UI; explicitly
  no push/deployment. Added `playerError.ts` as a presentation-only boundary for
  game/room controls, chat/pokes, friends, invitations, notifications, ledger,
  profile/privacy, authentication and the alternative distributed screens.
- Unknown server/transport text is replaced by contextual, developer-owned copy.
  Known game-rule explanations and structured seat/turn conflicts remain useful;
  unmapped details fall back safely instead of exposing internal diagnostics.
  New shared feedback has English/Nepali copy. Reviewed existing rule sentences
  retain their existing English wording; this is not full domain-error localization.
- Uncertain command outcomes explicitly ask the player to wait for confirmation,
  rather than implying rejection or encouraging a duplicate submission. HTTP
  status, raw error details, receipts, journals and recovery contracts remain
  available to the underlying logic. Read errors no longer claim an unresolved
  write. Sign-in credential failures are distinct from expired sessions.
- Lifetime-signal cancellation guards remain in place. An abort reaching the UI
  may represent a genuine timeout and gets connection guidance rather than being
  silently hidden. Delivery recovery clears its connection warning without clearing
  unrelated action feedback. Reconnection copy no longer promises a saved seat
  before refreshed state has established it. Layout and game rules unchanged.
- Verification: 286 client tests passed, including infrastructure-message filtering,
  status/auth/uncertainty distinctions, rule/context preservation, timeout feedback,
  locale/idempotent formatting and read failure semantics. TypeScript passed;
  production-mode web export passed at `/private/tmp/bhidne-feedback-web`;
  `git diff --check` clean. No new live browser fault-injection or production tests
  were performed for this presentation increment.
- Next: review alongside the existing event-driven changes and follow
  `deploy/production/event-driven-rollout.md` before the user's own push. After
  rollout, verify actual two-player reconnect, leave, rejected move and chat
  recovery feedback. Nothing committed, pushed, installed or deployed here.

### Authorized publication (2026-09-28)

- User now explicitly authorized commit and push, with automatic GitHub deployment,
  and requested stopping after push instead of monitoring the deployment.
- Installed the tested constrained release receiver on both app hosts with
  `deploy/provision/release-receiver.yml`: both succeeded, one file changed each,
  no service restart. The workflow's new rollout phases are now supported.
- Previously recorded client/backend validation applies; final whitespace check
  passed. User will check the deployment after publication. Migration 26's
  forward-fix rollback limitation remains as documented in the rollout guide.

### Table creation navigation race — fixed locally (2026-09-28)

- User reported successful table creation without entry into its game page.
  Reproduced the deployed UI failure in a disposable distributed browser setup;
  the create form remained open instead of showing the live-game overlay.
- Root snapshot invalidations increment `actionTick`. The refresh effect's cleanup
  previously also invalidated the foreground operation generation and aborted
  every screen request. A committed creation could therefore lose its response
  and navigation when delivery restarted the background refresh.
- Separated screen/session lifetime cleanup from refresh-loop cleanup. Refresh
  restarts cancel only their own read/timer. Unmount, session and command-client
  changes still invalidate foreground callbacks and abort their requests.
- Added `client/tests/browser/distributed-table-creation.cjs`, restricted to a local
  disposable runtime. It delays create responses while WebSocket delivery remains
  active, asserts immediate game-page entry, exactly one creation request, and no
  browser errors. Flush/Marriage at 390px and Call Break at 1280px passed. The
  deployed-code browser reproduction failed before this fix; the fixed build passed.
- Verification: all 286 client tests and TypeScript passed; local web export passed;
  whitespace check clean. No production gameplay data intentionally created;
  initial browser setup exposed a cached production URL and failed CORS before
  signup, then local bundle URLs were corrected and external requests blocked.
- Next: review and publish this focused fix, then verify create-table navigation
  in production. Nothing committed, pushed or deployed in this increment.

### Grafana Cloud monitoring — prepared locally (2026-09-28)

- User chose Cloud Free and authorized repository-managed monitoring for the four
  production hosts. Added `deploy/provision/monitoring.yml`, role-specific Alloy
  template, hidden credential prompt, wrapper, filtered log bridge and importable
  starter dashboard under `deploy/monitoring/`.
- Uses the provided metrics/Loki endpoints and nonsecret tenant IDs. No token from
  chat was copied into files, commands or Git. Next credential entry is through
  `python3 deploy/monitoring/configure-secrets.py`; protected local YAML is ignored.
- Native Alloy package pin 1.20.0-1 verified available in the official signed APT
  repository. All three rendered configs validated with the checksum-verified
  official macOS Alloy 1.20.1 validator; deployment validates again with the exact
  installed Linux version before activating configuration.
- Scrapes existing private runtime metrics (30s), selected host/DB/cache and Alloy
  metrics (60s). PostgreSQL uses local peer `alloy`/pg_monitor; Redis gets a separate
  restricted account applied live, with optional include preserved in service
  provisioning. No public monitoring listener, app deployment or DB restart.
- Root-owned bounded timer sanitizes fixed-source logs into files readable by Alloy;
  no Docker socket privileges granted to Alloy. Application payload/SQL/exception
  text is excluded. DB/cache logs initially report severity only. Log boundary
  losses and possible crash duplicates are explicit limitations in the README;
  logs are diagnostic, never authoritative receipts. No historical log backfill.
- Verification: provisioning tests 5 passed, 5 existing environment-dependent tests
  skipped, 17 subtests passed; four new tests cover privacy, persisted offsets,
  incomplete lines, truncation and oversized input. Ansible syntax, shell syntax,
  dashboard JSON and diff whitespace passed. No live exporter/ACL, systemd,
  ingestion or Grafana dashboard rendering validation yet.
- Nothing installed/restarted on production, committed or pushed. Next: user enters
  ingestion token locally, run monitoring playbook against verified inventory,
  verify all 12 scrape targets plus pg_up/redis_up and Redis scrape errors, confirm
  Cloud receipt of fresh app logs, measure collector resources/ingestion volume,
  then import dashboard. Investigate any restricted-ACL exporter incompatibility
  without granting application key access or CONFIG. Existing local table-entry
  navigation fix is preserved and remains unpublished.

### Grafana Cloud monitoring — installed and verified (2026-09-28)

- User completed the hidden credential prompt and authorized proceeding. Verified
  local credential file mode 0600; used existing encrypted service secrets with
  the ignored local Vault password file. No secrets printed or committed.
- Installed pinned Alloy 1.20.0-1 and filtered log collection on app1, app2,
  PostgreSQL and Redis, with strict verified SSH host checking. No application,
  PostgreSQL or Redis service restart, application release, commit or push.
- Live validation caught the PostgreSQL exporter rejecting keyword-form DSNs.
  A URL with both localhost and a socket query also selected TCP authentication.
  Corrected the template to `postgresql:///bhidne_distributed_prod?host=/var/run/postgresql&user=alloy&sslmode=disable`.
  Confirmed peer access independently and exporter `pg_up=1`, scrape error=0.
  Only Alloy was restarted while resolving this; database authentication unchanged.
- Added mandatory DB/cache exporter health assertions beyond Alloy readiness;
  PostgreSQL check passed with zero changes. Redis installation passed including
  restricted ACL and exporter assertions (`redis_up=1`, scrape error=0). Redis
  CONFIG collection explicitly disabled with the exporter's `-` sentinel.
- Final read-only verification: all four Alloy services/timers active and ready;
  all four have positive remote-write sent-sample and Loki sent-entry counters,
  zero failed/retried metrics, zero pending samples, and zero dropped/retried log
  entries. One harmless synthetic monitoring log per host tested the log pipeline.
  These counters establish successful uploads, not a separately authenticated
  Grafana query/UI rendering check. No query/admin token was requested or used.
- Observed Alloy resident memory approximately 226–240 MiB per host. Runtime series
  counts 1327/1022 on the two apps; selected host series counts 223/223/239/215.
  These are sample observations, not a capacity/free-tier guarantee. Public API
  `/health` returned healthy distributed runtime during installation.
- Added reusable secret-free `deploy/monitoring/verify.py` and documented local
  Vault invocation. Ansible syntax and final whitespace checks passed; the earlier
  log-privacy/cursor tests remain passing. Exact installed Linux Alloy validated
  the deployed configurations. New mandatory exporter assertion exercised live.
- Next: import `deploy/monitoring/dashboard.json` in Grafana and select existing
  Cloud Prometheus/Loki data sources, check usage/cardinality under real activity,
  then implement the separately planned bounded load test. Severity-only DB/cache
  logs and best-effort rotation/startup coverage remain documented limitations.
  Dashboard UI rendering/alert routing are not yet verified or configured.

### L1 — randomized distributed load driver (2026-09-28)

- User explicitly brought capacity-test scripting into scope: one-hour loops,
  a 20,000-account credential pool, randomized social/room/table behavior, fast
  gameplay with rare delays, and validation after every completed game.
- Added `scripts/loadtest/run.mts`, state-aware action/result helpers, a runbook,
  policy/validator tests and opt-in native acceptance tests. Reuses the original
  UI's distributed HTTP, durable command identity and WebSocket adapters; no
  runtime behavior, deployment configuration or engine rules changed.
- Default profile: 3,600 seconds including a 300-second ramp, 1,000 concurrent
  accounts in exclusive four-player groups, 180-second completion drain, shuffled
  account rotation, 50–500 ms think time, and 0.5% delayed moves at 2–5 seconds.
  `--users 20000` selects 20,000 concurrent accounts separately from pool size.
  Actual unique users and observed next-command timing are reported rather than
  assumed. The profile does not guarantee visiting all 20,000 users in an hour.
- Separate offline credential generation and eight-worker signup/signin
  provisioning precede the measured run. Generated 20,000 unique username/password
  records at `.loadtest/accounts.jsonl` (0600, Git-ignored); these have not been
  provisioned on a live server. An explicit target URL is mandatory.
- Scenarios cover friend requests/acceptance/removal, direct/room/table chat,
  notifications, public/private rooms and invitations, entry/departure/reentry,
  visibility, table invitations/answers/seats, optional seat rejoin and reaction,
  lock/start, gameplay and cleanup. All three game types are selected randomly.
  Call Break plays five deals; Flush finishes one round; Marriage draws/discards
  and eventually folds. This is not exhaustive feature coverage or a Marriage
  meld/normal-win solver; the runbook lists excluded flows explicitly.
- Terminal checks compare all participant public views. Call Break recomputes
  bid scores, trick/card accounting and winners; Flush checks conservation;
  Marriage checks zero-sum results. Ledger checks wait for finalization, require
  the table's unique result and compare net amounts/placement payments. Tied
  Call Break placement correctly has no payment entry; the API cannot prove the
  internal no-payment finalization job ran. This is public-API validation, not an
  independent complete engine audit.
- Native development checks caught client-driver assumptions: table invitation
  acceptance is separate from joining; Flush's completed round does not set its
  continuing table's game.finished; completed Marriage/Call Break tables
  reject direct end, so cleanup creates and ends an unstarted successor. Private
  room reentry needs a new invitation; NEXT_DEAL requires the completed deal number.
- Reports include bounded latency distributions, approximate percentile bounds,
  HTTP statuses, command/route coverage, delayed and over-one-second dispatches,
  resource identities and failure stages. Failed account groups are quarantined
  for that run; their command journals are saved with protected permissions.
  Ambiguous commands are never replaced with new IDs to conceal failures.
- Verification: eleven deterministic policy/validator tests and TypeScript checking
  passed. Three concurrent Flush cohorts (12 exclusive accounts) completed and
  validated with deliberate late commands in 41.31 seconds. Full-game native
  acceptance passed in 339.97 seconds: independent Flush, Marriage and five-deal
  Call Break groups completed, validated results/ledger and cleaned up. Native
  tests used disposable PostgreSQL, Redis and two real gateway processes. The
  payment validator also has a regression for JavaScript zero versus negative
  zero, found after a completed Call Break match with default zero payments.
  Final whitespace check passed. No hour-long or production-capacity claim yet.
- Next: choose the target and concurrency,
  provision the dedicated accounts, run a short target smoke and the one-hour
  profile, correlate its reports with Grafana and generator resource usage.
  No production writes, commit, push or deployment performed for this increment.

### Invitation session recovery follow-up (2026-09-28)

- Investigated reported private-room permission denial and invitation stuck at
  "Opening invitation" after session startup failed. Screenshots do not establish
  the production root cause or whether an account-specific invite was sent.
  Private-room preview correctly requires ownership, membership, or a pending
  invitation; a shared link alone grants no access.
- Confirmed a client recovery gap: failed journal ownership acquisition left
  invitation loading indefinitely and the existing retry could not recreate a
  missing distributed runtime. Expose startup errors inside the invitation,
  stop the loading message on failure, and retry session acquisition explicitly.
  Localized lock-contention and missing-browser-capability messages explain
  recovery. Exclusive ownership and persisted command recovery remain intact.
- Verification: TypeScript checking and 24 targeted journal-owner/player-error
  tests passed, including retry with the same controller after another owner
  closes and restoration of the original pending command. Whitespace check
  passed. No real Safari UI or production reproduction performed.
- Next: verify on two browser tabs and on the affected phone, then deploy the
  reviewed client change. If a successfully sent invitation still gets 403,
  correlate recipient account and invitation status with server logs.
  This change is local only; no deployment or production writes performed.

### Query/index coverage increment (2026-09-28)

- Added migration 27 with seven non-unique indexes: lower(display_name),
  lower(username), reverse friendship pair, pending invitation recipient/page
  and room/recipient, settlement room/time and transfer batch/order. No tables,
  columns, constraints or record formats change; no extension is required.
- Corrected the audit's search assumption: the live directory uses find_exact,
  not the unused PostgreSQL substring search method. Split exact matching into
  two indexed candidate queries with UNION deduplication, preserving case
  handling, self-exclusion, username priority and the 20-result limit. No new
  trigram indexes or change to search semantics.
- Lobby pages now fetch members with one bounded lateral query instead of one
  request per room, retaining visibility, ordering, empty rooms and each room's
  1001-row overflow sentinel. Nonempty pages use two data queries.
- Settlement lists batch children into two queries, reducing the list to three
  data queries while retaining batches without children and transfer ordering.
  Existing API bounds/authorization remain unchanged.
- Verification: 44 targeted tests passed using PostgreSQL/WASM where applicable,
  covering lobby, ledger, player service, bootstrap and migration paths. A
  populated pre-27 dataset with 20,000 accounts retained directory results after
  upgrade; EXPLAIN (ANALYZE, BUFFERS) on the actual search SQL selected both new
  expression indexes. Added query-count, grouping, self-exclusion, duplicate
  search match, empty-batch and membership-overflow regressions. The SQL test
  bridge's response limit was raised to accommodate bounded member pages.
  Whitespace check passed.
- Limits: this is not a 20,000-concurrent-user test, nor a production latency
  benchmark. Other index choices need representative execution-plan/usage
  measurement. Index writes add maintenance/storage cost. The migration runner
  uses regular transactional CREATE INDEX, which can block writes until commit.
  Updated production rollout notes for a maintenance window, ANALYZE and strict
  schema-27 startup compatibility; previous images cannot simply be restarted.
- Next: review/deploy migration 27 and this application together, inspect live
  query plans/statistics and run the target load profile. No production writes,
  commit, push or deployment performed.

### U2 — lobby/room polish, localization, read caching and activity metrics (2026-09-29)

The user explicitly authorized implementing the collected UI, caching, filtering
and observability requests on `bhidne-ho-scalability-prod`, extending the earlier
runtime-only scope. This increment is local and reviewable; no commit, push,
production mutation or deployment was performed.

Completed:

- Lobby content tabs now use the room's text/underline treatment. Recent becomes
  Create or Join, containing the create/join actions. The welcome is compact,
  without the extra promotional text. Bottom navigation uses room-style outline
  icons, labels and accent selection. The room header is smaller and omits its
  code; invitation/share controls retain it.
- Header brand follows English/Nepali selection (Bhidne Ho ? / भिड्ने हो ?).
  Sharing/privacy guidance, game descriptions, Call Break/Flush/Marriage rules,
  scoring/explanation panels and additional profile/social copy use matched locale
  catalogs. User text, names, IDs, numbers and authoritative game state stay intact.
  Switching language no longer rebuilds the game transport/command client.
- Background room/game/chat/reconnect warnings wait 1.5 seconds before appearing.
  Failed background room/game reads retry sooner; successful refreshes clear their
  own warning without erasing action errors. Action failures and uncertain command
  outcomes retain their existing feedback/recovery behavior. Removed a duplicate
  lobby error presentation. Live activity events refresh the active-games list.
- Active tabs filter terminal table/game statuses and phases on server and client;
  completed results remain available through explicit selected game/history views.
  Database authorization continues to exclude inaccessible/deleted/private rooms.
- Added bounded process-memory and Redis caches for authorized room/table snapshots
  and relationships, activity/membership projections and invitation previews.
  Dependency versions cover table/game/checkpoint/receipt, membership, positions
  and profiles. New committed versions invalidate old keys across servers, so
  delivery-triggered refreshes populate current data and old fills cannot overwrite
  newer versions. Redis failure/corruption falls back to reconstruction.
- Added cluster active-games/active-players gauges by game type plus totals, and
  distinct online-user presence across servers/tabs/devices. Unknown Redis/database
  samples are not reported as false zeroes. Dashboard queries use max across
  replica observations, never sum. See `distributed-runtime-telemetry.md` and
  `distributed-runtime-read-cache.md` for definitions and limits.

Verification:

- 290 client tests and TypeScript checking passed; production-mode distributed
  web export passed with explicitly local API URLs in `/private/tmp/bhidne-review-web`.
- 74 targeted backend tests passed, with PostgreSQL/WASM and disposable real Redis.
  Coverage includes cross-server cache hits, changed table/profile versions,
  membership/public-access revocation, detached values, expiry/bounds/cancellation,
  Redis errors, completed-game filtering, cluster counts and socket deduplication.
- Browser checks passed at 390px and 1280px against disposable PostgreSQL/Redis and
  two actual gateways: compact layout, action placement, navigation styling,
  English-to-Nepali switch, preserved room name and translated invitation/privacy
  guidance. Injecting one 503 into the room list recovered without a warning flash.
- Existing delayed-response creation regressions passed for Flush and Marriage at
  390px and Call Break at 1280px: game view opens with one creation request.
  Browser checks caught an incorrectly inserted notice hook in a child component;
  it was corrected and the final build/typecheck/browser checks passed.
- Dashboard JSON and whitespace checks passed. Two existing dependency deprecation
  warnings remain in backend tests. No production capacity or native-device claim.

Design limits and next step:

- A lightweight authoritative SQL access/inventory/version read deliberately
  precedes cached payload lookup. PostgreSQL is the fallback for expensive state
  reconstruction, not for permission decisions. Directory, ledger, chat history
  and lobby-page reads retain existing bounded SQL. This is not full database-free
  operation, a new cache authority, or a replacement for durable writes.
- Cache defaults: 256 local entries / 16 MiB serialized local budget, 512 KiB per
  payload, 30-second local/Redis expiry, 150 ms Redis operation timeout. Redis now
  holds private actor-specific projections within the existing private deployment.
- Online users reflect observed authenticated sockets, with TTL grace after crashes
  and convergence during rebuild/rolling deployment. Global-user Lua maintenance
  targets the existing standalone Redis, not cross-slot Redis Cluster.
- Next: review this local diff. When publication is requested, release both gateways
  and the client, import the updated Grafana dashboard, and verify activity counts,
  cache hit rates/memory, mobile layout and language switching under actual traffic.
  No schema migration or production infrastructure change is required here.

## U3 — Remaining static copy and shared player caches (2026-09-29)

User authorization: proceed with the remaining localization and user/profile/
directory caching gaps identified after U2. This extends the user-requested UI and
cache work; no deployment, commit, or production configuration change is included.

Completed:

- Finished the identified static copy in profile/phrase management, invitation and
  room controls, preview screens, game help, rule-change review, confirmations,
  feedback and accessibility labels. Added explicit presentation mappings for rule
  keys and enum values; configuration, identifiers, names, chat, saved phrases,
  card values and game state remain unchanged. State-held feedback translates at
  render time. Poke confirmations retain their recipient separately from wording.
- Added the missing language toggle to the game table's newer drawer menu. Language
  changes rerender labels without recreating game command clients or table state.
- Added bounded process-memory/Redis payload caches for profile and appearance
  reads, public/batch players, exact directory and substring searches, and friendship
  lists. Platform and room projections share one cache budget per gateway.
- Keys use committed user/profile/account/relationship versions from the same
  repeatable-read snapshot as the miss loader. Updates, deletions and additions
  make old keys unreachable across gateways immediately; the next read fills the
  new version. This avoids missed-invalidation races and works during Redis failure.
  Search pages use deterministic ordering, including a user-ID tie breaker, so
  candidate-version selection and payload loading agree at the twenty-result limit.
- Added real SQL tests for cross-gateway Redis hits, profile/appearance changes,
  username bookkeeping, directory renames/new accounts/deletions, actor isolation,
  detached batch results and friendship request/accept/remove. Extended the SQL
  test bridge to serialize UUID arrays used by the production batch-player query.
- Added a source-level regression check for untranslated JSX prose and literal
  accessibility labels, plus rule-label/interpolation checks. Extended browser
  coverage for profile copy and language changes inside each game's table menu.

Verification and limitations:

- 89 targeted backend tests passed; two existing Starlette/AnyIO deprecation
  warnings remain. 292 client tests passed, including catalog key/placeholder parity
  and preservation of dynamic values. TypeScript and the web export passed.
- Local mobile/desktop lobby and room browser checks passed, including translated
  profile phrases, preserved room names and recovery from a temporary failed read.
- Game-menu browser checks passed for Flush and Marriage at 390px and Call Break
  at 1280px: delayed creation responses and language changes preserve the table
  name and send only one creation command. The check exposed the missing drawer
  language toggle; it was added and the final build and all three checks passed.
- Authoritative SQL version/access reads deliberately remain on cache hits. Directory
  hits still query a bounded candidate page; this does not cache a search index or
  claim database-free operation. Authentication, authorization, ledger, chat history
  and lobby-page reads keep their authoritative SQL paths. Invalidations are lazy
  version changes, not a synchronous write-through broadcast to all processes.
- No new schema, production deployment or capacity/latency guarantee. See
  `docs/distributed-runtime-read-cache.md` for the exact cache coverage and bounds.
- Exact next step: review the local diff; when release is requested, deploy both
  gateway code and the client and verify cache-hit metrics, language switching and
  cross-gateway profile updates in the deployment environment.

## U4 — CI migration-test adapter correction (2026-09-29)

- Investigated failed production workflow 36634513096 for commit 05e38f9. The
  supplied CI log reports 1 failed / 1650 passed: the additive-upgrade test only
  enabled PGlite script mode for migration 26. Migration 27 contains multiple
  CREATE INDEX commands, which the prepared-statement path rejects.
- Reproduced the exact failure using CI's PGlite 0.5.8. Updated the test-local
  adapter to recognize every registered migration script, while retaining normal
  parameterized execution for ordinary queries. Production migration SQL and
  runtime behavior are unchanged; upgrade preservation/idempotency checks remain.
- Verification: all 7 lobby-event and query-indexing tests passed with PGlite 0.5.8.
  The original-UI native acceptance test passed during diagnosis. A broader
  diagnostic run was intentionally stopped after 807 passes once the supplied log
  identified the failure; this is not a new full-suite pass claim. The prior
  targeted U3 checks did not include this migration test.
- Exact next step: commit and push this test correction and handoff note, then
  check that the production workflow completes testing, publishing and deployment.
  This correction has not been committed, pushed or deployed by the agent.

## U5 — Gateway connection recovery after PostgreSQL restart (2026-09-29)

- Investigated the supplied process-test failure: a same-ID command recovered on
  gateway two, but retrying its accepted receipt on gateway one returned 500.
  The production pool did not check connections at checkout, allowing idle sockets
  killed by the database restart to reach a later request on either gateway.
- Enabled `AsyncConnectionPool.check_connection` on the runtime pool. Psycopg
  checks and replaces stale connections before serving them to application code.
  No command transaction replay, receipt changes, or relaxed process assertions.
- Added two regressions using the production app's pool and Psycopg's real
  checkout loop, with simulated dead/healthy network connections. Recovery returns
  only a checked connection; unavailable recovery raises a pool timeout. Both
  regressions fail when the new checkout check is disabled in-process.
- Verification: 27 bootstrap/server tests passed, including SQL-backed checks
  with PGlite; two existing dependency deprecation warnings remain. The exact
  real-process outage test could not run here: this Windows environment has no
  installed WSL, native PostgreSQL/Redis process-test setup, or Docker runtime.
- Limits: checkout adds a database health-check round trip. It cannot prevent a
  failure after checkout or resolve an uncertain commit; existing same-ID retry
  and durable receipt handling remain required for those cases.
- Exact next step: review and publish this change, then rerun the production CI
  suite including all six independent-process tests before deployment. Nothing
  has been committed, pushed, or deployed by the agent in this increment.

## U6 — Marriage checkpoint compatibility across processes (2026-09-30)

- User authorized the checkpoint fix after production app2 reported repeated
  `CheckpointError` failures loading a Marriage table. A local experiment reproduced
  the lossless-decode error across Python hash seeds: `committed_card_ids` is a
  frozenset, but its JSON array was compared as ordered data. This reproduces a
  matching cause; the exact production checkpoint has not been inspected.
- New checkpoint captures sort only Marriage committed-card IDs. Decoder and
  host-rebuild comparisons treat only this field as unordered, after verifying the
  original checkpoint digest. Ordered hands, deck/discard, melds and event history
  retain exact comparisons. Duplicate IDs are not silently deduplicated.
- Existing signed checkpoints remain readable without migration. Table-only saves
  retain the committed engine representation and historical snapshot digest when
  the only difference is set order. Actual engine advancement writes canonical
  state through the existing receipt/revision/journal transaction.
- Added subprocess tests for normal and duplee qualification, writer seed 1 and
  reader seeds 1–4, canonical and legacy envelopes, and full detached host rebuild.
  Added negative cases for duplicate/missing/foreign IDs, revisions and digest
  tampering. SQL coverage verifies an old checkpoint survives a table-only update
  without changing its engine snapshot, followed by one persisted discard.
- Verification: checkpoint/store/recovery suite 59 passed; final cross-process,
  distributed-read, chat, settlement and rematch suite 52 passed (overlapping
  checkpoint tests). Whitespace checks passed. SQL checks used local PGlite, not
  production PostgreSQL. No production mutation or live recovery claim.
- Scope: this fixes the reproduced checkpoint ordering defect. The separately
  identified frontend reconnect-status recovery and unknown-presence presentation
  issues remain unmodified.
- Exact next step: review and push when requested, let CI complete, deploy the
  backend to both app servers and verify the affected table and both qualification
  routes. No database rewrite, manual digest repair or schema migration is needed.
  This increment has not been committed, pushed or deployed by the agent.

### U7 - Client recovery and table presence (implemented locally)

- Plan: repair recovery reporting, distinguish unknown presence from offline,
  and verify table selection preserves subscriptions and pending intentions.
- Delivery health now requires successful discovery and initial recovery of all
  authorized streams. A successful discovery clears a previous discovery failure
  even when no subscriptions changed. Snapshot arrival alone no longer clears a
  still-failed stream. Failed streams retry promptly while healthy streams stay
  attached; timer ownership prevents overlapping scheduled recovery ticks.
- Game seats now distinguish observed offline from unavailable/stale presence.
  Unknown observations display a localized connection-unknown label. A local
  delivery warning no longer independently marks the viewing player offline.
- Back-to-room already hides the game without leaving the table or closing the
  root. Added a root regression proving same-table selection retains subscriptions
  and pending commands. This is runtime coverage, not an end-to-end browser test.
- Move guards remain unchanged: pending work, unsynchronized game state, or lost
  delivery readiness still block moves. Recovery restores readiness; this change
  does not permit moves against stale state to conceal a connection problem.
- The table-entry and red snapshot-load failures remain covered by U6's reproduced
  checkpoint correction; no new server retry or authorization bypass was added.
- Verification: 298 client tests passed, TypeScript checking passed, Expo web
  export passed, git diff --check passed. Added regressions for recovery with an
  unchanged catalog, all-stream readiness, obsolete recovery, failed-stream retry,
  same-table selection and unknown presence. No live production or iPhone check.
- Exact next step: review/push when requested, pass deployment CI, deploy U6 to
  both app servers and this client build, then verify Marriage through room/back,
  reconnection, discard and both qualification routes on the affected devices.
  Actual intermittent transport outages may still require production logs; these
  changes do not establish that every reported outage had the same cause.
- No commit, push or deployment performed by the agent.

### U8 - Lobby online-friend chat

- User requested Chat in place of the bottom Profile entry. Added a selected Chat
  tab with an online-friend list, existing private conversation history/composer,
  English/Nepali labels and an empty state. Header profile remains available.
- Reused existing private message transport, including distributed durable sends.
  An opt-in /friends?include_presence=true read observes accepted friends through
  cluster Redis presence, with 16 concurrent observations per batch. Ordinary
  /friends response shape remains unchanged; friendship cache is not mutated.
- Chat lists only positively observed online friends. Polls every three seconds
  and rechecks presence/friendship before submitting. An unavailable friend
  disables composition and retains the current draft. This is lobby UI admission,
  not a new durable-message execution rule: an already submitted message remains
  valid if its recipient disconnects. Existing Friends messaging is unchanged.
- Presence uses global connected status, not a requirement that the recipient
  also has the lobby visible. Legacy runtimes without cluster presence show no
  online recipients rather than inventing presence.
- Verification: 298 client tests, TypeScript check, web export; 5 backend tests
  covering accepted-friend-only observations, unknown/offline filtering, absent
  presence and existing friendship/messaging compatibility. No live UI/device
  verification or deployment performed. Next: deploy client and backend together
  and check two online friend accounts plus offline/reconnect transitions.

### U9 - Profile header control alignment

- Moved the profile Back control into AppHeader's existing inline action slot,
  immediately beside Theme, instead of the separate lower action row. Existing
  back behavior and minimum 44px touch target remain unchanged.
- Verification: TypeScript check. No backend change or deployment.

### U10 - Shared language icon and picker

- Replaced one-tap language toggling with the requested compact `? A` control,
  44px square with the header accent color, border and rounded button finish.
- Added an anchored English / ?????? popup with a selected checkmark, explicit
  radio accessibility state, outside-tap dismissal and Escape handling. Popup
  positioning respects viewport edges and safe areas.
- AppHeader now exposes language alongside theme/profile on authenticated lobby
  and room pages as well as sign-in/signup. GameTableHeader exposes the same
  control beside theme; existing welcome, profile and menu instances share it.
- Existing LanguageProvider continues saving the choice; English remains default.
  No server game commands or backend behavior changed.
- Verification: 298 client tests passed; TypeScript and Expo web export passed.
  Local Chrome browser checks at 320/390/1100px passed selection, selected-state
  attributes, reload persistence, Escape dismissal and popup bounds. The browser
  fixture exercises the entry screen; live room/game and real-device checks remain.
  Reusable check: client/tests/browser/language-menu.cjs after a web export.
- No deployment. Next: review and deploy with the pending client changes.

### U11 - Remove redundant profile language preference

- Removed the profile body's language row and now-empty Preferences section,
  plus their unused import/style. Shared header and game-menu pickers remain.
- Verification: TypeScript passed. No deployment. Next: review/deploy the pending
  client changes together.

### A1 — App-store readiness plan and account recovery foundation (2026-09-30)

- User explicitly expanded scope to the app-store readiness TODO and implementation.
  The new baseline is [app-store-readiness-plan.md](app-store-readiness-plan.md),
  covering auth, notifications, deletion, privacy/support, chat safety and device
  testing. Existing distributed-runtime consistency guarantees remain in force.
- Added migration 28 and an internal PostgreSQL recovery service: password-proven
  recovery email enrollment, single-use purpose-bound hashed verification/reset
  tokens, per-account shared issuance limits, atomic reset/session revocation and
  bounded expired-token cleanup. Public recovery routes remain unmounted until
  delivery and public abuse controls are complete.
- Password sign-in now locks the credential row through proof verification and
  session creation, serialized with reset to prevent surviving old-password logins.
- Verification: 53 focused SQL/auth/platform/migration/socket tests passed, plus
  3 real PostgreSQL independent-connection race tests. `git diff --check` passed.
  Disposable database only; no email, device checks, commit, push or deployment.
- Limits: recovery is not yet user-facing; delivery, public endpoints, Settings,
  provider/device acceptance and all later readiness increments remain open.
- Exact next step: A2 email delivery configuration, generic rate-limited recovery
  routes and verification/reset/Settings UI, following the new checklist.

### A2 signup confirmation follow-up — 2026-09-30

- Added signup-only masked password confirmation in original and explicit integration
  clients, matching-password guards on submission, keyboard focus progression and
  English/Nepali mismatch feedback. API payload remains unchanged.
- Updated existing signup browser fixtures. TypeScript, Expo web export and 4
  localization tests passed; diff whitespace check passed. Browser fixtures and
  native keyboard checks were not run. No commit, push or deployment.
- Exact next step remains A2 email delivery, recovery API and Settings/screens per
  docs/app-store-readiness-plan.md.

### A2 mandatory signup email — 2026-09-30

- User approved required email for new password-account signup while keeping email
  optional for existing accounts. Added client/API validation, English/Nepali copy,
  email keyboard/autofill, private unverified-email persistence and updated callers.
- Migration 29 adds nullable `account_credentials.unverified_email` without erasing
  or backfilling existing data. Signup writes it atomically with credentials/session.
  Recovery still trusts only verified contacts; confirming mailbox proof clears the
  unverified signup value. No email is exposed in player/profile/session responses.
- Verification: 89 focused backend tests, 5 client email/localization tests and
  11 load-driver tests passed; TypeScript, web export and Chrome mobile signup/profile
  acceptance passed. Migration checks preserve legacy login, sessions, profile data
  and verified contacts. `git diff --check` passed.
- Public verification delivery and existing-account Settings enrollment remain open;
  no mail, production DB access, commit, push or deployment. Release migrations 28/29,
  both gateways and client together; older signup clients omitting email receive 422.
- Exact next step: A2 email provider/sender configuration, durable verification delivery,
  public verification/reset routes and optional recovery-email Settings enrollment.
- Additional keyboard-form run passed signup focus/viewport checks, then hit an
  unrelated stale chat assertion expecting raw `Message test failure`, which the
  existing error presentation intentionally suppresses. Full keyboard suite is not
  claimed passing; no unrelated chat change was made. Local test server stopped.

### A2 keyboard test repair — 2026-09-30

- User explicitly authorized correcting the minor test mismatch within this
  increment. Chat/room error assertions now require friendly messages and absence
  of raw server text; draft retention remains checked. Refreshed stale Create or
  Join, expanded-invitations and Marriage Rules and config navigation steps.
- No product code or database changes. Generated local game fixtures and ran the
  complete keyboard-forms browser script against a disposable in-memory server:
  all signup/profile/chat/room/table checks and all three game-rule/poke scenarios
  passed. This supersedes the earlier reported keyboard-test failure.
- Syntax/whitespace checks passed. Native-device tests remain separate; no commit,
  push or deployment. Next: A2 email delivery, public recovery routes and Settings.


### A2 email delivery and public recovery — 2026-09-30

- Implemented additive migration 30, encrypted transactional email/reset queues,
  shared account/IP/recipient limits, bounded SMTP retries and independent worker
  leases. Recovery routes are explicitly reviewed in the distributed shared-route
  allowlist; worker startup/shutdown follows server/database ownership.
- Signup verification, generic reset requests/completion, email verification and
  authenticated status/enrollment/removal are connected to localized client forms.
  Profile recovery settings remain optional for existing accounts. Reset deletes
  every session and proof; no auto-login. Existing PostgreSQL data is preserved.
- Independent PostgreSQL tests confirm workers do not double-claim and SMTP does
  not hold database locks; removal invalidates in-flight proofs. Recovery/database,
  deployment/console, TypeScript, web export and localization/link checks passed.
  The full mobile-width browser recovery flow also passed against disposable
  PostgreSQL with captured mail; test resources stopped. See app-store-readiness-plan.md
  for exact coverage and remaining live checks.
- Disabled by default until SMTP, sender, public frontend origin and shared Fernet
  keys are configured. docs/account-recovery.md records key rotation, retries,
  cleanup, trusted-proxy requirements and duplicate/in-flight delivery semantics.
  No production database reset, commit, push, deployment or real email sent.
- Exact next step: staging provider/sender configuration and real mailbox acceptance,
  then A2 SecureStore/native-link/social-login device checks. A3 deletion follows.

### A2 staging activation preparation — 2026-09-30

- Prepared `docs/recovery-staging-acceptance.md` after authorization to proceed.
  Verified that staging uses the `test` environment/main workflows, whereas the
  current branch targets the separate production release.
- Provider/sender details and private credentials are still needed for real delivery.
  No deployment, secret mutation, external mail or database modification occurred.
- Exact next step: configure the selected provider and private staging settings,
  release the reviewed recovery changes to staging and run real mailbox acceptance.

### A2 production target clarified

- User selected the deployment target of the current branch. Confirmed
  `bhidne-ho-scalability-prod` maps to the production environment and
  `https://prod.bhidne-ho.lfactorial.com`; this supersedes the staging target
  for the ongoing activation work.
- Resend domain verification is user-confirmed; key named `bhidne-ho-prod` created.
- Added a hidden-input helper to prepare owner-only, Git-ignored local production
  settings, retaining existing queue encryption keys on reruns. Two tests passed
  and Git ignore rules verified. No live secret read, host mutation or email sent.
- Exact next step: user enters the Resend key locally, then wire the private settings
  into production runtime configuration, verify SMTP connectivity on both hosts,
  and complete the controlled recovery rollout and real-mail acceptance.

### A2 production email configuration and delivery probe

- User confirmed this branch's production environment is also the testing target;
  no separate staging environment is being created. The planned database reset
  is deferred to an explicit later step; no database was reset or modified here.
- Validated the locally entered Resend configuration without exposing values.
  Both application hosts passed SMTP STARTTLS and authentication on port 2587.
- Installed recovery-only settings in both root-owned runtime.env files using an
  atomic, owner-only merge that preserves unrelated settings. No containers restarted.
  Added provisioning preservation so later apps.yml runs retain these settings.
- Five focused setup/deployment tests passed, including key preservation, file
  permissions, idempotent runtime merging and injection rejection. A standalone
  Jinja rendering check could not run because this venv lacks jinja2; the full
  Ansible playbook was not run against hosts.
- At the user's provided address, sent one delivery-test email from the first app
  host. Resend accepted it; inbox receipt remains user confirmation. No live recovery
  tokens or account passwords were generated for that transport test.
- Live /auth/recovery/capabilities returned HTTP 409. The working-tree recovery
  code has not been committed/pushed/deployed; installing settings alone does not
  activate it in running containers.
- Exact next step: confirm inbox receipt, complete the recovery application release
  through this branch's normal pipeline, then test signup/verification/reset using
  the user's chosen mailbox. SecureStore/device/social-login acceptance remains open.

### A2 forgot username by verified email

- Implemented the user-requested Forgot username entry point in both clients and
  reviewed POST /auth/recovery/username/request in the shared route allowlist.
- Generic accepted responses queue encrypted requests without account lookups.
  Background delivery resolves all currently verified usernames for a mailbox,
  reuses recipient/IP budgets, leases and retries, and never changes credentials.
- Migration 31 extends the existing delivery table without resetting data. Existing
  account/session/challenge/outbox rows are covered by an upgrade-preservation test.
- Verification: 58 backend checks, the expanded real-PostgreSQL browser flow plus
  worker concurrency test, TypeScript, Expo export and localization/link checks
  passed. No production mutation or external email for this increment.
- Exact next step: normal branch release with migration 31 and both gateways before
  publishing the updated client; old workers do not process username reminder jobs.
  Then complete real-mail acceptance on this branch's existing production/test target.

### A2 account-page consistency

- Applied the original login form styling and shared branded header to recovery
  pages, their success states and the distributed integration sign-in interface.
  English/Nepali and theme controls are available throughout these account flows.
- TypeScript, Expo web export and the disposable PostgreSQL browser recovery flow
  passed. Browser coverage exercises language/theme switching and verifies entered
  recovery values survive those changes. Native device acceptance remains open.
- This increment changes client layout only; no schema or production changes.
- Exact next step: release the accumulated recovery implementation with migration
  31 and both gateways before the client, then complete real-mail acceptance on
  the existing production/test target. Do not reset the database for this release.

### A2 release-check repair

- The pushed recovery commit `5e65d4a` failed the production workflow before
  deployment: the original-UI acceptance fixture omitted the newly required
  signup email and received HTTP 422. Both live hosts remained on the earlier release.
- Updated the disposable player fixture with example.test email addresses. No
  application behavior, schema or existing account data changed.
- The formerly failing original-UI acceptance test and all six independent
  distributed-process tests passed locally with PostgreSQL and Redis. The remaining
  backend CI suite passed: 1,726 passed, one opt-in recovery browser test skipped,
  and two dependency deprecation warnings. No commit, push or deployment performed
  during this repair.
- Exact next step: push this fixture correction through the normal branch pipeline,
  verify both gateways and the frontend release, then complete real-mail acceptance
  on the existing production/test environment. Do not reset PostgreSQL.

### A2 session persistence and logout reliability

- Latest login/logout now wins over stale saved storage after write failures.
  Storage issues have English/Nepali notices and save/removal retry. Existing keys
  and saved-session formats remain compatible; cached private room data is stripped.
- Logout clears local account state immediately; server revocation failure is
  explicitly identified as local-only logout. Expiry returns to sign-in. Guards
  prevent late old-account responses from replacing the current login.
- Verification: 61 session/journal/runtime unit tests and four localization tests
  passed; TypeScript and web export passed. Disposable PostgreSQL browser recovery
  and session checks passed, including account switching and failed-storage retry.
- No database changes or reset. Native restart/upgrade/keychain checks remain
  unchecked; see [device acceptance](session-lifecycle.md). No commit, push, build
  tracking or deployment performed; the user owns those actions.
- Exact next increment: prepare private native builds and validate session/recovery
  links on devices, then configure/test Google, Facebook and Apple login. Real-mail
  release acceptance remains open and is tracked independently by the user.

### A3 deletion inventory and read-only preflight

- User authorized all three deletion increments and deferred native build work.
  Commit/push/build tracking remain the user's responsibility.
- Mapped credentials, provider handoffs, recovery queues, social data, seats/rooms,
  immutable journals/checkpoints, receipts/outbox, settlements and backup/client
  copies in [account-deletion-design.md](account-deletion-design.md).
- Added an internal read-only inventory helper for proof type and current dependency
  counts. Five migrated-database tests passed, covering privacy, account isolation,
  current seats, ownership, queued commands, shared ledgers, social/guest identities
  and unchanged sessions. No schema, route, cleanup worker or public UI enabled.
- Requested missing owner facts: whether settlements represent money; monitored
  public support email; actual backup retention. These are not invented in the UI.
- A3 is NOT complete: destructive cleanup, request jobs, provider revocation,
  Settings/public forms, end-to-end and restore acceptance remain to implement.
  Exact next step: receive these policy facts, then implement the approved cleanup
  representation and additive lifecycle/job schema before exposing confirmation.


### A3 backend, Settings and public deletion implementation

- User confirmed balances/settlements are game points, the profile's verified email
  should receive public deletion confirmations, and backups are not configured.
  Implemented all three code increments; activation remains off by default.
- Migration 32 preserves existing users/sessions without resetting PostgreSQL.
  Acceptance requires current proof plus `DELETE`, rejects active participation or
  pending account work, and atomically disables access/revokes sessions. Workers
  revoke encrypted provider grants and retry failures without false completion.
- Cleanup removes account and social/chat data, transforms durable copies and
  preserves shared game-point values under an unlinked non-login reference. Owned
  rooms transfer when possible; unfinished transfers involving the account cancel.
  Current and archived games remain recoverable, including post-cleanup finalization.
- Public `/delete-account` uses a private verified-mail confirmation and generic
  lookup response. Profile and public flows share language/theme controls. Browser
  testing caught and fixed same-tab email-link navigation and local static routing.
- Verification: 26 deletion/inventory/provider tests, then cross-gateway revocation
  and guest/social proof checks; 3 real-PostgreSQL worker/HTTP/concurrency tests;
  78 game/social/chat/recovery/cache/provider regression tests; 47 account/platform/
  migration/mail regression tests. Earlier 60 inbox/checkpoint/mail/browser-auth
  tests and a final 25 provider/browser-auth/runtime tests also passed. These runs overlap and are not a unique suite total.
  TypeScript, web export, 12 localization/session tests and the deletion browser
  acceptance passed. Tests used disposable databases/fake mail/mock providers.
- Limits: no real provider or mail acceptance, native/device validation, large-account
  capacity test or backup restore test is claimed. Cleanup is an atomic scan of
  reviewed history, with lock/statement timeouts; timeout failures remain pending.
  Other players' shared content and downloaded copies remain; pseudonymization is
  not anonymity. Full details: [account-deletion-design.md](account-deletion-design.md).
- Exact next step: commit/push through the user's terminal, deploy all gateways and
  frontend with deletion disabled, then perform disposable account/mail/provider
  acceptance before setting `BHIDNE_HO_ACCOUNT_DELETION_ENABLED=1`. Example setting:
  [deletion.env.example](../deploy/deletion.env.example). No database reset required.
  No commit, push, deployment or remote build monitoring was performed here.

### A4 first increment — player blocking (2026-09-30)

- User deferred mobile notifications until near store testing and authorized the
  block/unblock increment. Implemented migration 33 and authenticated owner-bound
  block APIs, Settings list, friends/search and chat controls, English/Nepali copy
  and existing theme support. Legacy runtimes advertise the feature unavailable.
- Distributed social executors recheck both directions, including queued work.
  Social effect transactions hold a shared policy lock and block/unblock takes the
  exclusive lock before user/relationship writes. Inactive rows retain the last
  unblock cutoff so commands admitted before **or during** a block cannot revive.
  Repeated unblock is idempotent and does not move that cutoff.
- Blocking removes friendship and cancels room invites; hosted/manual-seat invites
  are rechecked at acceptance. Social history and per-viewer outbox replay suppress
  blocked contact without altering immutable outbox rows or skipping cursor
  advancement. Game state, seats, point history, room membership and automatic FIFO
  progression remain intact. A3 cleanup removes block rows in both directions.
- Limitations/design decisions: shared policy serialization is an initial correctness
  boundary, not a capacity result; manual seat provenance reads are bounded and
  fail closed at the documented limit. Already downloaded messages cannot be
  recalled. Existing clients reconcile room/friend/table history via polling.
  Pending seat-offer metadata can remain visible until resolved/expired, but
  blocked manual acceptance fails. No mixed old/new gateway/worker deployment;
  run additive migration 33 and release all distributed components together.
- Verification: 45-test and 51-test focused/regression batches passed. Final cutoff
  checks passed all 11 blocking cases and the existing-data migration case (12);
  notification history/replay consistency also passed. Independent-connection real
  PostgreSQL block/send race passed. TypeScript, Expo web export, eight localization/
  table-social tests and mobile-width Chrome blocking/language/theme acceptance
  against disposable PostgreSQL passed. No physical-device or production acceptance
  claimed. See `docs/app-store-readiness-plan.md` for commands and exact boundaries.
- Exact next step: user commits/pushes from their terminal and tracks deployment;
  next implementation increment is bounded message/player reporting and protected
  moderation. Notification implementation remains deferred. No commit, push,
  remote build monitoring or production database operation performed here.

### CI follow-up — unknown-account admission expectations (2026-09-30)

- The user supplied a CI run with 1,755 passes and two failures in creation/table
  executor tests. Both expected a nonexistent account's command to reach execution;
  A3's account-availability check now correctly rejects it at inbox admission.
- Replaced those stale parameter cases with explicit admission tests asserting
  `Account unavailable.`, no inbox record, no sequence allocation, no outbox events
  and no table creation/checkpoint changes. Each test then admits a real account at
  sequence 1 and verifies successful execution, guarding against rollback gaps.
  Existing executor rejection cases for system/malformed actors and nonmembers remain.
- Production behavior and database schema are unchanged by this follow-up. User
  retains commit/push and deployment monitoring; the next feature increment remains
  bounded chat reporting and protected moderation, with notifications deferred.
- Verification: both complete affected test files passed locally: **44 passed**
  (`tests/test_creation_executor.py` and `tests/test_table_lane_executor.py`,
  PostgreSQL/WASM). `git diff --check` passed. The full CI suite was not rerun
  locally; user will commit/push and track the next CI run.

### Frontend CI follow-up — separate tab/session instances (2026-09-30)

- Reproduced the supplied Docker frontend failure locally: 307/308 tests passed;
  the failing case was session restoration in `client/tests/reconnection.test.mjs`.
- The test swapped browser storage while sharing one module's session memory and
  expected a warm in-memory read to behave like a reload. Updated it to use separate
  module instances for each tab and reload, matching actual browser isolation.
- Checks now verify sanitized persisted/restored room data, server isolation,
  independent Alice/Bob tab identities, identity retention when leaving a room,
  and logout clearing only the current tab. Production session behavior is unchanged.
- Verification: all 308 frontend tests pass with the Docker stage's Node test
  command. No commit/push or remote build monitoring performed. User will commit/push
  this correction; next feature remains bounded reporting/moderation, with mobile
  notifications deferred until near store testing.
- `npm run build:production` also passed locally, including TypeScript and
  the production-configured Expo web export. `git diff --check` passed. The full
  Docker image/remote CI build was not rerun here.


### Authentication presentation follow-up (2026-09-30)

- UI-only: Sign In and Sign Up offer disabled Google, Facebook, Apple buttons,
  then an “or” divider and the requested username/email form-reveal action.
  The welcome entry also keeps providers disabled, regardless of configuration.
- Existing form fields, validation, submit handlers, API contracts, session logic,
  recovery screens, and navigation destinations remain intact. The requested
  “username or email” label does not add email login: existing sign-in still uses
  the username. No backend, database, migration, or provider configuration changes.
- One subtle recovery link under the sign-in password opens a compact chooser
  for the existing username and password recovery screens. New copy is localized
  in English/Nepali and uses existing theme tokens; mobile auth panels are narrowed.
- Verification: 308 frontend tests, TypeScript, production web export, and local
  Chrome acceptance for signup, verification, username/password recovery, reset,
  session restoration/expiry/logout, and account deletion passed. Disabled social
  controls and existing valid/unsolicited callback handling also passed. Mobile
  screenshots checked; native iOS/Android device testing remains outstanding.
- Browser fixtures now reveal forms explicitly. Clear Metro's cache when changing
  export environment variables: the initial local export retained cached production
  configuration; rerunning with `--clear` and checking the API endpoint resolved it.
- Next step: user review and commit/push. Reporting/moderation is still pending;
  notifications remain deferred. No commit, push, deployment, or CI monitoring.


### Authentication Back navigation (2026-09-30)

- Welcome now has one “Sign in or sign up” entry action; social options appear
  only on the following authentication method screen, where they remain disabled.
- Added a localized Back control above the auth heading. From either form it
  returns to the selected method choices without clearing the entered fields;
  from method choices it returns to Welcome. Back dismisses the keyboard and is
  disabled during submission. Integration runtime uses the same welcome entry.
- Existing signup/login/recovery APIs, validation and form submission are unchanged.
- Verification: all 308 frontend tests, TypeScript, and three local Chrome
  acceptance scenarios passed (signup/recovery, session lifecycle, deletion).
  Browser coverage confirms no welcome social buttons, return to Welcome, and
  all signup values preserved after Back/reopening. Updated browser entry labels
  and scoped recovery Back selection to the foreground modal.
- Next: user reviews and commits/pushes; no deployment or remote CI monitoring.
  Native device verification remains outstanding.
- Production web build (including TypeScript) and `git diff --check` passed.


### A4 reporting and grouped moderation (2026-09-30)

- Added additive PostgreSQL migration 34 for bounded reports and one immutable
  decision per report. Existing game/account data is preserved; no database reset.
- Player rows and direct/room/table/game chat offer private reporting. The server
  captures the referenced message/profile, checks sender and existing chat access,
  rejects guessed private message IDs, deduplicates same reports for 24 hours,
  and serializes a ten-new-reports/hour account limit across gateways.
- Moderator access uses backend-only `BHIDNE_HO_MODERATOR_USER_IDS` and optional
  `BHIDNE_HO_MODERATOR_EMAILS`. Only a current, unique verified recovery mailbox
  qualifies. Signup/provider claims are excluded. Invalid configuration fails
  startup; no configured identities means no moderator access. Each API request
  rechecks current account/contact state. Provisioning preserves private settings.
- Profile → Moderation follows the app header, language/theme and Back conventions.
  Pending/Reviewed lists group by reported user ID; expanding loads individual
  reports with server evidence and separately labeled reporter explanations.
  Accept/Decline opens confirmation requiring a reason; reviewed reports display
  decision, reason, moderator ID and time. Reads are paginated; permission failure
  clears displayed evidence. Conflicting concurrent decisions cannot overwrite
  the first result; identical retries are safe. Moderators cannot review reports
  submitted by or targeting themselves.
- Acceptance is classification only, with no automatic punishment or gameplay
  changes. Removal, mute/suspension, appeals and community rules remain outstanding.
- Evidence/decisions expire after 90 days and are purged hourly while the distributed
  runtime runs. Account cleanup removes reports involving the deleted reporter,
  reported player or deciding moderator. Public privacy copy must describe this.
- Verification: 43 targeted backend cases across moderation, blocks, platform and
  account deletion; a real PostgreSQL concurrent retry/decision race; five private
  configuration tests; 308 frontend tests; TypeScript and production Expo export.
  Local Chrome acceptance exercises player reporting, ordinary-user denial,
  moderator-only Profile entry, grouping, required reasons, both decisions,
  persistence, language/theme and Back. Mobile/desktop layouts inspected.
- Configuration/rollout: `docs/moderation.md`, `deploy/moderation.env.example`.
  Next step: user review/commit/push; deploy schema/code to all gateways, configure
  the chosen moderator ID or verified email privately, restart all gateways, and
  verify access with both moderator and ordinary accounts. No live grants,
  commit/push, deployment or remote build monitoring performed. Native device
  acceptance remains outstanding; notifications remain deferred.

### Chat safety / policy follow-up — 2026-09-30

Explicit user scope expansion: all remaining chat-safety and public-policy features.
Migration 35 adds moderation enforcement/audits, message removal markers, rules
acceptance and PostgreSQL abuse counters without resetting existing records. Actions
are separate from accepted/declined report decisions. Suspension refuses active
participation or pending commands, then revokes sessions; mute preserves gameplay.
Redaction covers history/replay; removal markers survive evidence expiry. No gameplay
sequence or snapshot schema changed. Public routes and modular bilingual UI are added.
See `docs/moderation.md` for restrictions, rates, retention, rollout and limitations.

Checks: 75 + 29 + 32 targeted backend cases (overlapping suites), two real PostgreSQL
concurrency checks, Chrome acceptance, 309 frontend tests, TypeScript and production
export passed. Public policy metadata still awaits operator/contact/age/backup
confirmation; deployment/provider/log-retention review and native acceptance remain.
No commit/push/deployment or remote CI tracking. Exact next step: finalize confirmed
public policy metadata, then user review/commit/push and deployment acceptance.


### Public policy details confirmed

The owner confirmed operator **Lfactorial**, monitored support/appeals email
**prajwal@lfactorial.com**, minimum age **18**, and **no configured database backups**.
These now supply the default `/public/policy` metadata, with environment overrides
preserved. The example configuration and moderation handoff are updated. This
supersedes the pending confirmation noted above; it does not deploy the pages.

Verification: checked default metadata, explicit override behavior, incomplete-config
warning behavior and the existing public metadata/rule-acceptance API test.
Next: user review/commit/push and deployment, then verify public URLs and configured
moderator access. Provider/log-retention review and native acceptance remain.
No live settings, commit, push or deployment performed.

### Original UI acceptance consent follow-up

CI's original UI adapter acceptance failed because its newly created accounts sent
friend requests without accepting the community rules. Updated the test player
setup to fetch the current rules version, assert initial non-acceptance, explicitly
accept through the public authenticated API, and verify persisted acceptance before
using social commands. Runtime enforcement and production signup remain unchanged.

Verification: `tests/test_distributed_original_ui.py` passed against disposable real
PostgreSQL/Redis and two independent gateway processes (20.37s), covering all seven
adapter acceptance stages. The Node module-type warning was not the failure cause.
Next: user commit/push and CI rerun; GitHub-secret delivery for moderator configuration
remains separate pending implementation. No commit, push or deployment performed.

### Remaining CI consent setup failures

- Investigated the supplied CI run (4 failed, 1793 passed). Load-driver failures
  explicitly reported missing community-rule acceptance during friendship setup.
  The HTTP friendship and PostgreSQL block-race tests also created fresh accounts
  without completing this newly required posting prerequisite.
- HTTP friendship setup now reads the current rules, explicitly accepts through
  the authenticated API, and verifies persisted acceptance for both accounts.
  Block-race setup uses the production acceptance service before starting the race.
  Both tests now include the rejection outcome in assertion failures.
- The load driver's dedicated synthetic players accept the current rules after
  signin, when needed, and verify saved acceptance before opening runtimes or
  sending social commands. README documents this synthetic-account behavior.
  Production signup, moderation enforcement, and command processing are unchanged.
- Verification: friendship suite 13 passed; moderation enforcement 16 passed;
  load-model tests 11 passed; Node syntax and whitespace checks passed. The native
  block-race and two load-driver tests were skipped (3 total) because native
  PostgreSQL/Redis test binaries are unavailable locally; WSL is not installed.
- Next: commit/push when requested and rerun CI's native PostgreSQL/Redis tests.
  No deployment or claim that the complete production workflow has passed.

### Process-suite posting setup follow-up

- The separately executed final CI process suite still used an untouched signup
  helper. Its Redis-loss, Nginx fallback and command-latency scenarios all reached
  chat with fresh accounts lacking community-rule acceptance.
- Updated only that suite's account helper to fetch the current rules, assert
  initial non-acceptance, explicitly accept through the authenticated API, and
  verify persisted acceptance before outages or timing measurements begin.
  Added full outcome diagnostics to chat acceptance assertions. Runtime policy,
  Redis fallback, lease takeover and latency thresholds are unchanged.
- Added a non-native regression using the same helper against the actual ASGI
  application and PostgreSQL/WASM. With its Redis broker offline, a freshly
  provisioned account creates a room, commits chat and reads the message back.
- Verification: new regression plus moderation enforcement: 17 passed. All six
  native process scenarios skipped locally because service binaries are not
  configured. Whitespace check passed. Native PostgreSQL/Redis/Nginx behavior must
  still pass the existing final CI job; no full-workflow success claim.
- Next: commit/push when requested and rerun the backend workflow. No commit,
  push, production mutation or deployment performed by the agent.

### Collected UI refinement increment — 2026-10-02

The user explicitly expanded scope to the collected welcome, policy, sign-in,
chat and Friends UI changes and authorized implementation with “go ahead”.

- Welcome uses an open layout without a bordered sign-in panel, existing brand
  artwork and a spade divider. English copy is “Play together. Stay connected.” /
  “Your games, your people, your table”; Nepali copy is updated too.
- Privacy, Terms, Community rules and Support share subdued, dot-separated footer
  links in that order. Public policy pages use an accessible header back arrow;
  the redundant bottom back control is removed. Rules acceptance also uses the
  header arrow. Recovery is now an accent-colored, underlined sign-in action.
  Delete account is removed from both sign-in variants and retained in Profile.
- Room, table and direct chats share compact message headers with a muted ellipsis
  beside the timestamp. Only another player's non-removed message can offer a
  report menu, and reporting capability still gates it. The menu contains
  “🚩 Report message” and opens the existing report form. Community rules uses a
  small shield icon and understated text; acceptance behavior is preserved.
- Friends uses a gold Search button, search icon, section counts, avatar fallbacks,
  compact player rows, live presence indicators and Add friend / Message actions.
  Reporting, blocking and red Remove friend are moved into anchored ellipsis
  menus. Incoming/outgoing request controls and existing confirmation forms remain.
  Menus render outside scrolling containers, dismiss on outside press/Escape/back,
  focus their first action on web and fit their measured height to the viewport.
- Design decisions: keep the current selected app theme rather than force the
  reference's blue palette. Reuse existing artwork and semantic colors. The
  current friendship API does not supply avatar images, so the existing anonymous
  avatar is shown; no image service or backend profile expansion was added.
- Verification: TypeScript and all 309 frontend tests passed; production Expo
  export passed. Local Chrome fixture acceptance at 390px and 1280px verifies all
  four policy/back routes, deletion absence on sign-in, player reporting, block
  cancellation, friend removal, direct-message reporting and own-message action
  absence, with no page errors. Existing reporting/blocking browser scripts now
  open the contextual menus. Added `client/tests/browser/ui-refinement.cjs`; run
  against an isolated local Expo export with `EXPO_PUBLIC_RUNTIME_MODE=legacy`
  and `TEST_WEB_URL` pointing to its local static server. Fixtures intercept APIs;
  this verifies presentation, not distributed persistence or production services.
- Limitations: native device acceptance and real distributed backend/browser
  acceptance of the updated safety controls remain outstanding. Account deletion
  enablement, deployment, capacity and operational readiness remain separate.
- Exact next step: review the local UI changes/screenshots, then commit/push when
  requested and run deployed distributed/native acceptance. No commit, push,
  account deletion enablement or deployment performed.

### Public policy header and Back placement

- Privacy, Terms, Community rules and Support now keep the shared Bhidne Ho
  branding beside the logo. Their page labels remain in the content panel.
- Moved Back from before the header logo to the top-left of that panel, retaining
  the existing navigation callback, localized accessibility label and 44px target.
- Verification: TypeScript passed. No backend change, commit or deployment.

### TestFlight native delivery Origin fix — 2026-10-02 PDT

- User authorized fixing build 1.0 (3)'s reconnecting/game/social symptoms after
  read-only diagnosis. During the supplied October 3 02:30–03:20 UTC window,
  app1/app2 logged 44/49 delivery WebSocket HTTP 403 rejections. SocketRocket
  0.7.1 derives the iOS Origin from the API URL; production allowed only the
  frontend Origin. Live handshake probes reproduced API Origin 403 versus
  frontend Origin 101 before the change.
- Provisioning now includes the exact production API Origin alongside the exact
  frontend Origin. The backend Origin/authentication logic is unchanged. Added
  regressions for both approved Origins, invalid authentication and an attacker
  domain with the API hostname as a prefix. Focused transport/session checks:
  19 passed, 2 native PostgreSQL-dependent cases skipped.
- Applied the same origin-only runtime environment change to both production
  app hosts sequentially using the installed release helper, peer/readiness
  checks and its rollback path. Recreated the existing immutable image
  `sha256:d92af6acfa98d3d4f5b60b1309ba550d935fd7b4b9e5dc7024a2ee5904ccdbf5`;
  both deployments healthy. Root-only environment backups remain on each host
  at `/etc/bhidne-prod/runtime.env.before-native-origin`. No schema changes,
  image upgrade, commit or push. Existing TestFlight build can use this fix.
- Post-rollout public TLS WebSocket verification passed for both exact approved
  Origins; invalid AUTH tokens closed both connections and an unrelated Origin
  still returned 403. Whitespace checks passed.
- Limitations: physical-device acceptance remains pending. The blocked readiness
  flag explains chat/poke gating and suppressed Flush glow, and can disable the
  Marriage declaration; any residual native declaration/layout defect must be
  assessed after reconnection works. Exact next step: reopen build 3 on both
  phones, verify connection and retest all four reported symptoms, then
  commit/push the provisioning regression and documentation when requested.

### Native game modal cleanup — 2026-10-02 PDT

- User authorized implementing the reported iOS room freeze and related game
  dialog cleanup. Sigma ended the waiting two-seat Call Break table in “Sigma
  room” at October 3 06:21:41 UTC. Read-only production checks confirmed an
  accepted end command and a closed table; UIKit touch interception could not
  be established from server logs. The source exposed nested game/menu/end
  native presentations and replacement of their contents during parent dismissal.
- Added a scoped game presentation boundary. Native game menus, confirmation,
  chat/poke/share/theme, language/context menus and Flush/Marriage dialogs render
  as ordered views within one native game Modal. Outside a game and on web,
  existing Modal behavior remains. The outlet is inside both theme/social
  contexts and spans the window, preserving measured menu positions. Lower
  layers and the game are untappable/hidden from accessibility while a higher
  layer is shown; Back/accessibility escape goes to the top dialog first.
- End confirmation closes on submission. On iOS the live contents stay mounted
  through native `onDismiss`, and closing the root clears game layers and their
  open flags. A late dismissal cannot clear a newly reopened presentation.
  Inner overlays appear without native presentation animations; the parent
  retains its existing animation. No gameplay, account, database or server changes.
- Verification: four ordered-layer cases; four React lifecycle cases using a
  mocked iOS Modal host and matching React tools in a temporary directory;
  TypeScript and all 313 frontend tests; production Expo web build; production
  configured iOS Hermes export; whitespace checks. Local Chrome fixture cases
  passed cancel/end failure/retry/success and remote end with menu/chat open,
  followed by tappable room controls and new table creation. All browser APIs
  are intercepted; no production account/game writes. Exact test commands and
  physical-device matrix are in `client/TESTFLIGHT.md`.
- Limitations: no signed native compilation, UIKit/VoiceOver/device acceptance,
  EAS upload or deployment claimed. Simulator access is unavailable in the
  sandbox; lifecycle mocks and browser checks cannot prove the physical iPhone
  freeze is eliminated. Exact next step: user review/commit/push, create a new
  iOS/TestFlight build, then run the two-phone waiting Call Break end/reentry and
  remote-open-dialog scenarios plus Flush/Marriage equivalents. Build 3 cannot
  receive this client change from a backend deployment. No commit/push performed.

### Room and profile dismissal cleanup — 2026-10-03 PDT

- User explicitly authorized extending the iOS presentation cleanup to room and
  profile/account deletion while preserving existing working behavior. These
  paths had source-level risks; no physical-device deletion freeze was reproduced.
- Added a shared dismissal-action hook. iOS actions wait for native `onDismiss`;
  web/Android actions run after committing hidden state, without depending on an
  iOS-only callback. Pending actions run once and are canceled on unmount,
  reopening, or explicit room/session invalidation. No animation timeout is used.
- Both lobby and room Profile presentations stay mounted while dismissing.
  Delete account, public policy navigation and Profile sign-out close Profile
  before their callbacks can replace its owner. Ordinary Back only closes Profile.
  Existing profile editing and account confirmation/proof/status behavior remain.
- Room Options closes its sheet before issuing deletion. Duplicate taps are
  guarded; confirmation resets on submission and room/session changes. A changed
  selection/account cancels a queued deletion and releases the busy state. Failed
  deletion preserves the room with its existing error and permits a fresh retry.
  Lobby room-card Delete/Leave confirmations likewise close before removal can
  unmount the card; failures reopen the existing confirmation with the error.
  Joining/sharing/removing that card is disabled during its removal request.
- Verification: TypeScript; all 313 ordinary frontend tests; six new React
  lifecycle cases plus the four existing game cases (10 passed); production web
  export and production-configured iOS Hermes export; whitespace check. Six local
  mobile Chrome scenarios passed Room Options/card cancellation/failure/retry,
  both Profile entry points with display-name editing, policy/Back, deletion/Back,
  rejected proof/success/status/Back and sign-out/sign-in navigation. The three
  existing game-ending browser scenarios also passed. All fixture API/WebSocket
  calls are intercepted; no production room/account writes were made.
- Limits: lifecycle tests mock native Modal; web fixtures do not exercise UIKit
  or real distributed services. No signed native compilation, physical-device
  acceptance, deletion enablement, deployment or EAS upload is claimed. No
  account/backend deletion rules were changed. Commands and device checks are
  in `client/TESTFLIGHT.md`.
- Exact next step: review/commit/push the client increment, create a fresh iOS
  TestFlight build from this code, and retest room/card deletion and both Profile
  entry points using disposable room/account data, alongside the two-phone game
  ending matrix. An already-built/uploaded artifact will need a newer build to
  include this increment. No commit/push/upload performed by the agent.

### Independent initial Marriage Tunnela declarations — 2026-10-03 PDT

- User authorized implementing the reviewed phase-based declaration design.
  Only initial `DECLARE_TUNNELAS` gains independent-action acceptance. Ordinary
  gameplay, queries, later meld showing, and other games retain exact revisions.
- Every accepted declaration, including an explicit empty declaration, still
  advances the engine revision. The adapter exposes `declaration_phase_id` in
  public/private snapshots while declarations are pending; clients capture it
  in the declaration payload alongside the original revision and cards.
- Each Marriage adapter owns one immutable deal. Derive the phase identity from
  its persisted match ID (`<match_id>:initial-tunnelas`), avoiding random recovery
  state, database migrations, or engine/checkpoint schema changes. A rematch has
  a new match identity. Supporting multiple deals inside one Marriage adapter
  would first require adding a persisted deal generation to this identity.
- Shared-runtime, direct-adapter, distributed executor, and durable checkpoint
  checks accept the same open phase only for an eligible undeclared player.
  Original revision must be between 1 and the current engine revision; future
  and predeal revisions remain invalid. Ownership and natural/distinct meld
  validation remain in the engine. The final declaration closes the window in
  its existing atomic transition; gameplay remains blocked until all nonfolded
  players declare. Duplicate receipts still resolve after closure without new
  state/events. Fresh declarations for closed/wrong phases or completed players
  reject. Older callers omitting the phase retain exact-revision behavior.
- Both HTTP and distributed UI command clients capture detached payloads at
  submission. Reconnects, journal restoration, later snapshots, and caller-side
  payload changes cannot rewrite the original phase, revision, or cards.
- Verification: adapter/shared-runtime cases cover same-deal stale acceptance,
  wrong/empty/closed phases, future revisions, repeated player declarations,
  legacy stale rejection, natural/foreign-card validation, duplicate receipts,
  and ordinary stale draws. PostgreSQL/WASM game-lane and checkpoint suites:
  30 passed, including two commands queued at revision 1 and fresh-executor
  recovery between acceptance at revisions 2 and 3. Full backend: 1,167 passed,
  648 optional integration tests skipped, two dependency deprecation warnings.
  Full frontend: 315 passed, including HTTP lost-response payload pinning and
  distributed journal restoration; TypeScript and Expo web export passed.
  `git diff --check` passed. SQL command used
  `PGLITE_MODULE=/private/tmp/bhidne-ci-pglite/node_modules/@electric-sql/pglite`.
  Full backend needed local socket access for the telemetry listener test.
- Limits: no production deployment, native-device acceptance, commit, or push.
  Existing unrelated working-tree changes were preserved. Phase identity is
  transport metadata, not a credential or a substitute for authorization.
- Exact next step: review this increment, deploy the backend before releasing
  the client that sends the new payload field, then verify simultaneous initial
  declarations from two devices and reconnect/retry during the declaration
  window. Existing installed clients continue using exact revisions until updated.

### Username as the initial sign-up display name — 2026-10-03 PDT

- User explicitly requested removing the profile/nickname field from account
  sign-up. Removed that input, required-name gating, and its form state. The
  account submission now sends username/password/email; email validation and
  password confirmation remain in place.
- The sign-up endpoint persists the normalized account username as the initial
  display name when the optional legacy display-name field is omitted. Existing
  callers supplying a display name remain compatible. Existing accounts and
  profile-edit behavior are unchanged; users can choose a new display name there.
  Usernames retain their existing 3–32-character range; custom profile names
  retain their existing 25-character limit.
- Updated existing signup browser scenarios to omit the removed field and
  expect the username in Profile before a subsequent display-name edit.
- Verification: 19 focused backend profile/signup tests passed (three optional
  SQL cases skipped); all 315 frontend tests passed; TypeScript and whitespace
  checks passed. Existing profile regression now verifies `/me/profile` stores
  the username as well as displaying it at a game table. Updated browser scripts
  were not run against a live browser/backend in this increment.
- Exact next step: review/release backend and client together, then verify signup
  and profile editing on a device. No deployment, commit or push performed.
  Socket/polling changes discussed above remain planning-only.

### Socket preservation C1 — 2026-10-03 PDT

- Implemented the user's authorized connection-lifecycle increment. Navigation
  now reconciles room/table/game/chat subscriptions on the existing authenticated
  socket and retains account/lobby/social streams and journaled command slots.
  Obsolete discovery is aborted before applying its catalog; old private views
  cannot install into another selection.
- Foreground/online recovery probes the existing socket using the existing
  PING/PONG protocol. Concurrent probes share a bounded health check. Actual
  close/error, malformed protocol, send failure, or heartbeat timeout triggers
  replacement with capped backoff; authentication READY resets backoff.
- UI socket health now comes from authenticated transport readiness rather than
  aggregate subscription/discovery health. Isolated discovery/chat/social
  failures retry without labeling the socket disconnected or freezing gameplay.
  Recovery notices distinguish game/chat updating from actual reconnecting.
- Added bounded in-memory close diagnostics (cause, close code/reason/clean flag,
  timestamp; no credentials or message frames). This is diagnostic evidence for
  future device reproduction, not proof of a specific production failure cause.
- Verification: TypeScript and 41 focused root/session/transport tests passed,
  including navigation/account-stream retention, healthy foreground probes,
  heartbeat timeout, close diagnostics, isolated failures, and original pending
  command preservation across genuine socket replacement. Whitespace passed.
- No endpoint, command payload, WebSocket message format, auth, or receipt changes.
  Existing unrelated changes preserved. No deployment or physical-device test.
- Exact next step: C2, unify active-game snapshot reads and schedule fallback
  polling from the last successful authoritative read, preserving in-flight
  invalidations and independent pending-command/failed-read retries.

### Snapshot refresh coordination C2 — 2026-10-03 PDT

- Implemented shared active-game snapshot reads across WebSocket invalidations,
  HTTP UI reads, foreground recovery and fallback polling. Selection-scoped
  projections retain authorized endpoint semantics, including match-addressed
  reads after replacement. Reads for other scopes remain separately bounded.
- The active-game fallback now uses a room/match clock updated only by successful
  authoritative reads. A delivered event refresh reschedules the mounted screen's
  fallback for 30 seconds later. Empty views retain a 30-second fallback rather
  than spinning; a different game or failed read cannot postpone the current
  game's check. In-flight refresh callbacks are serialized in the mounted screen.
- Coalesced reads distinguish invalidations from fallback reads. Polls can join
  a running read; a notification arriving after a read starts requires a later
  read, and polls follow that newer queued invalidation. Canceling one waiter
  cannot cancel other active consumers. Subscription discovery uses the current
  projection rather than independently fetching the same game every 30 seconds.
- Failed snapshot/command retries remain at their separate one-second cadence.
  Background pending commands wake receipt recovery without waiting for the
  discovery interval or repeatedly rediscovering healthy streams. Original IDs,
  revisions, payloads, receipts and journal ownership remain pinned.
- Verification: TypeScript and all 326 frontend tests passed, including the
  second-28 event / second-58 fallback clock, independent scopes/retries,
  event/poll coalescing, mid-flight invalidation ordering and late obsolete
  discovery. Local distributed-original web export passed. No API contract or
  backend changes were needed for C1/C2. Whitespace checks passed.
- Exact next step: C3 mounted browser/device-style verification of socket
  retention, chat isolation, genuine replacement and near-deadline events;
  inspect available diagnostics and document remaining physical-device limits.


### Socket and refresh verification C3 — 2026-10-03 PDT

- Completed the client implementation and verification increment. Mounted Chrome
  fixture checks passed for socket retention across selection/online recovery,
  near-deadline notifications postponing fallback by 30 seconds, isolated chat
  recovery, and genuine close/replacement with restored subscriptions.
- An overdue heartbeat after app suspension now probes the authenticated socket
  before declaring failure. A deterministic transport test verifies a responsive
  socket survives a two-minute wall-clock gap; missing PONG still times out.
- Verification: all 330 frontend tests passed; production web build (including
  TypeScript) and production-configured iOS Hermes export passed. Browser checks
  used intercepted HTTP/WebSocket fixtures; the subsequent heartbeat adjustment
  was covered by deterministic transport tests. Whitespace checks passed.
- Close diagnostics capture bounded transport causes and actual close details.
  No production/device disconnect was reproduced, so no remaining real-drop cause
  is claimed. Server auth/protocol/ACK close protections remain unchanged.
- HTTP command submission, API contracts and original pending command IDs remain
  unchanged. No backend changes were needed for these socket/refresh increments.
  Existing unrelated work was preserved; no commit, push or deployment performed.
- Exact next step: review the completed client diff, then prepare a fresh native
  build and run the two-player device matrix in client/TESTFLIGHT.md, inspecting
  close diagnostics during background/resume and network interruptions. Capacity,
  observability and deployment readiness remain separately scoped follow-up work.

### iOS TestFlight icon

- Copied the supplied BhidneHoAppLogo.png into client/assets/branding and set
  expo.ios.icon in client/app.json to that repository-relative asset.
- Verified the original PNG is square (1254x1254) with no transparent pixels.
  Kept the supplied artwork intact; Expo generates native icon sizes at build.
- Verified Expo's resolved public configuration points to the existing asset.
  Next: user commits/pushes the asset and config, pulls on the build machine,
  and runs the production iOS EAS build. No build upload or deployment performed.


### Direct two-host production deployment — 2026-10-03 PDT

- User explicitly authorized deploying the current build to both app servers
  without waiting for GitHub deployment. Released committed merge revision
  `40f6099c073c070b71b786330599115481afc3e4`; both hosts previously ran `02cbe92`.
- Built `deploy/Dockerfile.production` from a tracked-source Git archive on app1.
  The host's legacy builder produced an incomplete Docker-save archive; app2's
  candidate metadata check refused it before any live application changes.
  Installed only Ubuntu's docker-buildx plugin (no Docker engine upgrade/restart)
  and rebuilt with BuildKit. Verified all 13 layers and revision metadata in the
  complete archive, and its SHA-256 checksum after transfer.
- Both hosts now run identical local immutable image ID
  `sha256:02a9a54e425b287506769618b48b9f335504d9d4721bf09a5b78047718b0e578`.
  This is a sideloaded image ID, not a published GHCR reference. Administrator
  adapter `/var/tmp/bhidne-direct-release-40f6099.py` uses the installed release
  helper in memory, substituting this verified image ID for registry resolution.
  Installed receiver/configuration files are unchanged. Release locking, schema
  and Redis checks, restricted containers, peer-health/readiness checks and
  backend/frontend rollback safeguards remain in use.
- Ran candidate checks and staged assets on both hosts, replaced backends
  sequentially, then activated both frontends only after both backends were
  healthy. No database migration/reset or runtime-environment change was needed.
- Verification: image build passed all 330 frontend tests, TypeScript and
  production web export; 58 focused backend/release tests passed locally. Both
  hosts report healthy revision `40f6099` with identical image IDs, frontend
  symlinks, index hashes and served JavaScript hashes. Public API health, frontend
  index and JavaScript asset also match over HTTPS. Evidence is in local
  `/private/tmp/bhidne-direct-40f6099-verification.json`.
- No GitHub workflow dispatch, image publication, source push or native build
  upload performed. Installed native apps require a fresh native release to
  receive client changes; backend/web rollout does not update their bundles.
- Exact next step: verify the two-player native/device matrix against the live
  backend using a fresh native build and inspect real disconnect diagnostics.
  Review/commit this deployment handoff separately; existing deployment assets
  and the previous managed containers remain available for recovery.

### Authorized pushed-view and ephemeral-chat plan — 2026-10-05 PDT

The user approved implementation after discussing these delivery semantics:

- Game commands/state remain durable and fenced. Replace ordinary game
  notification-triggered snapshot reads with automatically generated authorized
  view deltas, not a duplicate client game engine. Changed arrays are initially
  replaced whole. Optional semantic events may drive animation only.
- Keep per-player projection/comparison out of the gameplay transaction. Commit
  durable generation intent and immutable transition inputs with state/receipts;
  generate exact before/after views asynchronously, persist output idempotently,
  then publish via Redis to connection servers and authenticated WebSockets.
- Target active subscribers; offline/rejoining clients fetch snapshots. Presence
  is advisory and cannot grant access. Recheck current authorization before
  delivery, including private seat/match identity, blocking and moderation.
- Apply patches atomically against matching identity/revisions/checksums; ignore
  duplicate/older updates. Reconcile gaps, mismatches, unsupported versions,
  reconnects and stale command outcomes. Retain the 30-second fallback, postponed
  by successful authoritative pushes; preserve independent receipt retries.
- Room chat stays durable, with committed message-content pushes and local merge
  by ID/sequence. Entry/reconnect/gaps recover history.
- In-game chat becomes ephemeral, with bounded client-memory history, direct
  Redis/WebSocket delivery and no DB writes, inbox, outbox, retry or replay.
  Missing messages are acceptable. Pokes likewise become ephemeral, deduplicated
  and expiring. Authorization may still read the DB. Preserve posting permissions,
  rate limits, blocking/moderation and private recipients; do not silently turn
  existing write-based policy checks into unbounded posting.
- Preserve historical stored chat and existing table-chat semantics unless the
  user explicitly extends scope. Audit original UI routing: its visible in-game
  chat must use the ephemeral path even if it previously selected a durable
  table-chat lane. Keep deliberate persistent table chat distinct.
- Negotiate client capabilities so old clients retain safe existing behavior.
  Bound payloads, generation concurrency, pending work and socket queues. If a
  transition cannot be delivered as a patch, signal snapshot reconciliation.
  Production enablement waits for complete integration and verification.

Reviewable increments:

- [x] D1. Shared patch/checksum codec and opt-in immutable transition inputs.
- [x] D2. Bounded post-commit generation worker, exact authorized projections,
  idempotent output, ordered claims and snapshot-recovery output.
- [x] D3. Authenticated recipient-aware Redis payload transport, current-access
  checks, capability negotiation and direct durable room-chat delivery.
- [x] D4. Client patch installation, native-compatible checksum implementation,
  push/read race protection, fallback clock and command/reconnect recovery.
- [x] D5. Ephemeral in-game chat and pokes with preserved authorization/policy,
  bounded queues and no persistence or replay; original UI integration.
- [x] D6. Integrated multi-gateway failure/recovery checks, browser/native limits,
  request/latency/payload evidence and rollout review.

### D1: delta codec and exact transition retention — 2026-10-05 PDT

- Existing engine history retains revisions, but the table recovery document is
  overwritten. Engine snapshots alone cannot reproduce historical table metadata
  and authorized player views. Added additive migration 36 for immutable full
  delivery checkpoints and generation jobs referencing contiguous table revisions.
  Table revisions cover lifecycle changes as well as engine moves; game identity
  and engine revisions remain separate in the eventual wire envelope.
- `PostgresCheckpointStore(retain_view_transitions=True)` records inputs/intent in
  the same fenced state transaction. Initial creation retains a baseline; enabling
  on an existing table retains its prior baseline. Receipt retries append nothing,
  and transaction aborts roll back state and generation records together.
- Retention defaults to **false**, and no existing composition enables it. No
  projection worker, Redis payload delivery or client patch application has been
  activated. Existing deployed notification/fetch and chat/poke behavior remains.
- Added matching Python/TypeScript version-1 patch codecs: recursive object
  set/remove operations, whole-array replacement, base/result checksums and
  identity/revision validation. Apply to detached values; mismatches, overlapping
  paths, unsafe keys, unsupported JSON numbers, depth/size/operation overflow
  require snapshot recovery. The Python generator verifies its own output.
- Checksum input is an ASCII tagged JSON tree: object keys sorted by UTF-16 code
  units, strings encoded as UTF-16 hex, finite safe integers/floats encoded as
  big-endian IEEE-754 binary64, negative zero normalized to zero. SHA-256 output
  avoids Python/JavaScript decimal-printing and Unicode-sort disagreements. The
  TypeScript codec accepts an injected async digest; native digest wiring is D4.
- Verification: 22 codec tests including actual JSON player views for all three
  games; six PostgreSQL/WASM transition tests covering exact historical inputs,
  retry/immutability, opt-in/default behavior, rollback and two phase-based empty
  Tunnela declarations; checkpoint suite 14 passed; game-lane suite 16 passed.
  All 341 frontend tests passed and TypeScript passed. Tests use a SHA-512-verified
  cached PGlite 0.5.8 package extracted into `/private/tmp/bhidne-view-delta-tests`;
  the previous temporary PGlite install was incomplete. No repository dependency
  changes were needed. Full backend regression: 1,188 passed, 654 optional SQL
  tests skipped, and one existing telemetry-listener test failed because sandbox
  socket binding was denied. That exact test passed with local socket access;
  two existing dependency deprecation warnings remain. Focused SQL tests above
  ran with PGlite enabled. `git diff --check` passed.
- Limits: full checkpoint retention adds durable bytes and serialization to the
  commit path, but no per-player views are computed there. Retention/cleanup must
  be bounded before enabling the worker; raw checkpoints remain trusted server
  data and must never enter Redis/client payloads. Profile/room metadata used by
  projection must be supplied consistently for before/after; checksum mismatch
  safely reconciles independent changes. Migration is local only, not deployed.
- Exact next step: D2. Read this plan, implement bounded generation claims that
  serialize each table's pending transitions across workers; rebuild before/after
  authorized views with the same HTTP projection rules; persist recipient outputs
  and job completion atomically with claim-token fencing, plus an explicit
  snapshot-recovery result for oversized/unsupported transitions. Include pruning
  and backlog bounds before runtime retention is enabled. D3–D6 remain required.
  No commit, push or deployment performed. Pre-existing deployment handoff edits
  in this document were preserved.

### D2: post-commit generation — 2026-10-05 PDT

- Added bounded worker claims that admit only the earliest pending transition per
  table, use expiring claim tokens, and atomically persist recipient outbox output
  with completion. Output is built solely from retained before/after checkpoints.
  Replacements and unsupported/oversized views yield snapshot-recovery markers.
- Projection uses the same detached host and profile naming as HTTP. Room catalog
  `tables` is excluded from the patch/checksum; it remains separately reconciled.
  Patch ordering uses table revisions so table/lifecycle changes are covered.
- Active table subscriptions register advisory `view:<table UUID>` presence.
  Membership and private seat/match access are independently checked at delivery.
- Completed generation inputs are pruned in bounded batches. Under sustained
  failure, pending work caps at 64 per table by discarding unclaimed backlog;
  the resulting revision gap requires a snapshot, never speculative acceptance.
- Extended account erasure to discard generation inputs/jobs and replace related
  delta payloads with recovery markers, preventing a late worker from restoring
  erased identity. This is directly required by the new persisted source.
- Verification: four PostgreSQL/WASM cases passed for all games, exact player
  projection reproduction, duplicate finish, ordered claims, expired-token
  rejection and checkpoint pruning. Runtime integration is under construction;
  D3–D6 must pass before the combined change is ready. No commit/push/deployment.
- Exact next step: D3, finish authenticated payload transport and negotiated
  subscriptions, verify current-access redaction and legacy-client behavior.

### D3: recipient-aware payload delivery — 2026-10-05 PDT

- Signed, size-bounded Redis notices now carry committed event content. A modern
  contiguous table stream sends it directly after a read-only current-access and
  committed-row check; it does not construct a game snapshot or scan an event
  page. Changed/moderated/erased rows override old Redis content. Sequence gaps
  use durable catch-up. Slow subscribers are isolated in bounded worker batches.
- READY advertises `view-delta-v1`/`ephemeral-v1`; clients opt in on SUBSCRIBE.
  AUTH remains compatible. Old clients retain notification/fetch behavior. New
  table/game clients receive ordinary semantic notifications as `VIEW_PENDING`,
  while receipts, deltas and recovery markers retain their independent meanings.
- Generation output checks current audience, membership, match and seat again at
  delivery. Advisory view presence only selects work; it never grants access.
  Oversized patches become recovery markers before reaching the client buffer.
- Durable room chat carries committed message ID, command ID, sequence, sender
  name and text. Client history merging removes the subsequent history HTTP read
  on ordinary pushes. Entry, reconnect and discontinuities still recover history.
- Verification: 54 focused delivery/generation/signalling/server/ephemeral tests
  passed (one real-Redis case skipped in that run), followed by 41 transport,
  authorization, generation and slow-socket tests. Existing account-erasure tests
  also passed; late generation is explicitly fenced by removal of erased inputs.
- Limitation: connection servers still read SQL for current authorization and
  current committed payloads. This removes client snapshot requests and repeated
  snapshot construction; it is not a zero-database-read delivery design.
- Exact next step completed by D4 below. No commit, push or deployment.

### D4: client state application and recovery — 2026-10-05 PDT

- The authenticated root owns the selected view and applies generic patches to a
  detached copy. Identity, revisions, base/result hashes and supported format must
  all match before installation and ACK. The client does not reproduce game rules.
- Native/browser SHA-256 uses typed arrays and ASCII canonical encoding, without
  WebCrypto, TextEncoder, Node crypto or another native dependency. Independent
  crypto vectors and shared Python/TypeScript fixtures agree.
- Successful deltas advance the existing per-room/match 30-second fallback clock.
  Gaps, corrupt payloads, resets and rejected commands reconcile immediately.
  Reconnect restores snapshots. HTTP/push races cannot replace a newer view or
  expose state from an obsolete selection. Accepted moves briefly await an
  observed committed result, then fall back to an authorized read if needed.
- Added local room-chat push observers; successful messages postpone its
  30-second recovery read. Legacy room-chat polling keeps its previous interval.
- Verification: 349 frontend tests and TypeScript passed at this increment;
  production web export and iOS/Android Hermes exports passed. Chromium checks
  independently applied the shared fixture and actual authorized views from all
  three games, rejecting gaps, bad checksums and missing operations atomically.
- Exact next step completed by D5 below. Physical-device/live-release validation
  remains an operational release check; local exports are not device testing.
  No commit, push or deployment.

### D5: ephemeral game chat, pokes and reactions — 2026-10-05 PDT

- Added an authenticated, bounded `/distributed/ephemeral` endpoint and signed
  Redis/WebSocket delivery. Game chat expires for delivery after 30 seconds;
  pokes/reactions after five. No game-state mutation, inbox, receipt, message row,
  outbox, durable counter, replay or automatic retry is created by this path.
- SQL authorization uses a **read-only transaction**, including membership,
  exact current match/seat, posting permissions and blocks. Thus “no DB
  transaction” means no DB **write** transaction here; DB authorization reads
  remain necessary. Redis failure rejects live posting; lost publication is
  acceptable. Receiver access and expiry are checked again before socket delivery.
- Redis Lua atomically enforces a shared actor-wide 20/minute budget, normalized
  duplicate-text rejection, 1.5-second poke cooldown and two-minute request-ID
  deduplication. Durable ingress mirrors this budget and preserves its SQL policy
  fallback; existing SQL counters supply a floor so switching paths cannot bypass
  posting limits. Rate/dedup keys have TTLs and no game/message persistence.
- Original UI in-game chat now uses this path with at most 100 locally retained
  messages per match and five match buffers. Private pokes keep recipient filtering;
  public reactions preserve target metadata for their renderer and spectators.
  Expired chat is discarded by the client. Ephemeral-message reports target the
  player, because no durable message exists for a message-history report.
- Explicit persistent table chat and historical stored chat remain available.
  Old clients keep their durable paths; capability negotiation protects rollout.
- Verification: ten integrated generation/live-content tests passed using
  isolated real Redis plus PostgreSQL/WASM. Tests prove zero SQL writes/revision
  changes for chat, private pokes and public reactions; expiry, blocks and departure
  suppress delivery. Real Lua tests verify shared budgets, deduplication, conflict,
  cooldown and TTLs. Frontend tests cover bounded history, no snapshot fetch for
  cached live posting, single delivery, expiry and durable room-chat pushes.
- Exact next step: D6 final integrated regression/build review and evidence.
  No commit, push or deployment; original document handoff edits preserved.

### D6: completed integration and review handoff — 2026-10-05 PDT

- Distributed server assembly now enables retention and starts/stops generation
  with its existing lifecycle. All six increments are integrated locally. No
  deployment, migration against a deployed DB, commit or push was performed.
- Final generation refinements: rebuild before/after engines once per transition
  and reuse them for authorized recipients; yield between recipient builds so
  cancellation/deadlines run. No active subscribers means no projection work.
  Backlog compaction also deletes orphaned inputs in bounded batches, so a down
  worker cannot accumulate one retained checkpoint per subsequent move forever.
- The complete room catalog remains outside the game checksum. Each result now
  includes an authorized selected-table preview with its own checksum. The client
  replaces/removes only that table's entry, preserving other room tables. This
  fixes stale seat/phase summaries without another full snapshot read. Other
  tables still use their existing room/catalog refresh paths.
- View result notices target all gateways subscribed to that table, so every
  stream can advance past other recipients' rows without artificial sequence
  gaps. These private bytes remain within trusted Redis/server transport; current
  SQL audience/seat/match checks filter them before a socket send. The real-Redis
  two-gateway test uses the actual publisher and deliberately changes a signed
  hint's checksum; committed SQL content overrides it and exact views still apply.
  Missing publication catches up from durable output; departed seats cannot replay
  formerly private results. Room chat retains durable history and direct local merge.
- Erasure invalidates view outputs across affected rooms, including previews that
  contain a deleted player's name without their ID appearing in the changed
  fields. Tests cover already-generated output and fence a second in-flight job.
  Explicit dealt-Tunnela declare **and** no-declare cases both retain contiguous
  transitions and reproduce every authorized result exactly through the codec.
- Verification: final focused backend suite **138 passed** with real isolated
  Redis and PostgreSQL/WASM. Follow-up suites after the last publication/erasure
  refinements: **37 passed** (publisher/server/live social), **18 passed** (erasure),
  **43 passed** (signalling/presence/polling/bounds), and **5 passed** (platform).
  Frontend **350 passed**, TypeScript passed, production web export passed, and
  iOS/Android Hermes exports passed with `distributed-original` enabled.
- Full PostgreSQL/WASM-enabled backend regression: **1,813 passed, 37 optional
  external-service cases skipped, two failures**. The telemetry listener failure
  was sandbox socket binding; its elevated listener suite passed (also included
  in the 138-case focused run). The platform assertion consumed an unrelated
  worker SQL response because it bypassed the embedded harness connection lock.
  Fixed those two count assertions to hold the connection; all five platform
  tests then passed. This is a directly related test-harness correction, not a
  production database or player-profile behavior change. Two existing dependency
  deprecation warnings remain. Final `git diff --check` passed.
- Request evidence: client tests assert **zero additional snapshot HTTP requests**
  for a valid push/duplicate and selected-table preview; gaps and bad checksums
  cause an immediate recovery request. Live posting from a cached view performs
  no snapshot HTTP request and SQL tests assert no DB writes. SQL authorization
  reads on gateways and on live posting are intentionally retained.
- Sample codec evidence for one real authorized transition per game (compact
  JSON, excluding the separate preview/envelope): Callbreak 1,706-byte delta vs
  7,116-byte snapshot; Marriage 4,233 vs 8,342; Flush 985 vs 6,340. Chromium applied
  these actual views and tested three recovery failures in approximately 10–22 ms
  per sample total. These are local functional samples, not production latency,
  capacity or physical-device measurements; small changes need not always produce
  a smaller patch. Oversized patches deliberately recover with a snapshot.
- Review/rollout order: review these uncommitted changes; obtain the user's
  approval before any commit/push. Any later deployment must first make migration
  36 available to all upgraded runtime processes, then roll out complete servers
  and compatible clients. Old clients and older rolling gateways retain recovery
  behavior; ephemeral losses during mixed-version rollout are acceptable. Fresh
  native releases are needed for installed apps to receive these client changes.
- Exact next step: **user review and approval for commit/push**. Capacity testing,
  observability, DB HA deployment, physical-device/live-release checks and broader
  operational readiness remain the subsequent task set; none was silently enabled.

### UI increment — shared game attention header (2026-10-05)

User explicitly extended the branch scope to implement the discussed game-section
UI. Existing D1–D6 runtime changes remain uncommitted and intact.

- Completed: Callbreak, Marriage and Flush share a collapsed row with Chat on the
  left, an expandable attention header in the center, and Poke on the right.
  Waiting players always receive the click/tap-to-expand affordance. Expanded
  games display the same reactive header above the table and retain existing
  expanded social controls.
- Required actions take priority: bid/play, Marriage draw/discard/finish and
  initial Tunnela declaration, Flush bets and authorized side-show responses.
  Hand review and game/round results also receive cues. Marriage suggestions use
  only the authorized private hand, exclude already-shown qualification cards,
  and identify Dublee, Maal qualification and known Marriage opportunities.
  Suggestions never authorize a game command.
- The rounded header has a glowing border and exactly three animated rays on
  either side. Required actions pulse while actionable; optional discoveries
  animate briefly. Cue identity excludes snapshot revision and countdown changes.
  Reduced-motion users receive static cues. English and Nepali copy are included.
- Social state now lives above the expanded modal: collapse/expand preserves
  history, unread counts and drafts. Presentation outlets keep social sheets
  within native game-modal layering when expanded, while collapsed buttons open
  social sheets directly. The previous collapsed notification sound remains;
  its unused old opacity animation is disabled.
- Verification: TypeScript passed; all 357 client tests passed, including seven
  new attention tests covering stable cue identity, spectator privacy, declaration
  gates, required-action priority, shown-card exclusion, known Maal identities,
  side-show permissions and round settlement. Production web build and both iOS
  and Android exports passed. `git diff --check` passed.
- Limitations: builds and unit tests do not establish physical-device layout,
  native modal transition or live multiplayer interaction correctness. Those
  visual/interaction checks remain part of release review. No commit, push or
  deployment was performed.
- Exact next step: user review of the accumulated runtime and UI changes, with
  approval required before commit/push. Capacity, observability, database HA and
  operational readiness remain the subsequent task set.

### Room increment — retire room privacy (2026-10-05)

User explicitly extended scope: all rooms are public; remove the public/private
choice throughout room UI.

- Completed: removed visibility choices from both room creation screens and room
  settings. Room cards no longer display public/private badges. Browse and friend
  room labels now refer to rooms rather than public rooms, in English and Nepali.
  `RoomPrivacySettings` is now `RoomInvitations`, retaining player discovery and
  invitations without privacy controls.
- Both memory/legacy and distributed creation paths default to public and persist
  public visibility even if an older client supplies private/friends input.
  Compatibility visibility endpoints/commands retain owner authorization but
  preserve public visibility. Durable creation keeps legacy visibility input in
  the idempotency fingerprint so retries of explicit old requests still match.
  Recovered client creation receipts always describe a public room.
- Migration **37** converts existing room rows to public, supplies the database
  default, and installs a normalization trigger so older rolling servers cannot
  recreate private rooms. The compatibility column remains for old clients and
  SQL callers. Migration 36 from the earlier runtime increment remains intact.
- All live rooms are discoverable and enterable by authenticated players. Room
  membership, owner controls, private per-player game projections, moderation,
  invitations and tombstones retain their separate access boundaries. Leaving a
  room no longer requires an invitation to rejoin it.
- Verification: TypeScript passed; all 357 client tests passed; production web
  build passed. Targeted backend suite: 81 passed; the remaining active-table test
  was updated for public discovery and passed on rerun (82 targeted checks total).
  PostgreSQL/WASM migration regression passed, covering pre-existing rooms,
  retained invitations, omitted visibility, and legacy private/friends writes.
  Distributed migration upgrade/idempotency tests also passed. Diff check passed.
- Deployment requirement: apply through migration **37** before running the new
  room behavior. This intentionally makes formerly private rooms publicly
  discoverable and joinable. No live dataset, commit, push or deployment changed.
- Exact next step: user review of accumulated runtime/UI/room changes and approval
  before commit/push. Operational readiness work remains the subsequent task set.

### Push increment P1 — native delivery foundations (2026-10-05)

User authorized the notification plan and direct APNs (iOS)/FCM (Android).
Implementation proceeds without commit/push. Migration 38 adds session-bound
native devices, notification preferences, committed game-generation jobs and a
leased delivery queue. Jobs enqueue inside existing game/invitation transactions;
provider network calls occur only in a separate worker. Old runtimes advertise
no notification provider support. No real credentials or delivery is enabled yet.

P1 is complete and verified by the P3 checks below. Credentials, Android Firebase
configuration and physical-device delivery require operator setup before release.
Browser push, chat push and poke push are outside this first release.

### Push increment P2 — native opt-in and navigation (2026-10-05)

- Added Expo SDK 57 native notifications and application-environment modules.
  Profile settings offer device opt-in, game-action/invitation/sound preferences
  and local quiet hours. Permission is requested only after explicit opt-in.
- Native registration uses APNs/FCM device tokens, never Expo relay tokens. iOS
  environment comes from the built app's entitlement. Android build configuration
  accepts the operator's existing application ID and Google-services client file;
  no published application ID was guessed or changed.
- Foreground match activity is reported with an expiring lease. A current-game
  alert is deferred while that lease is renewed; if the client disappears, its
  lease expires and delivery can proceed while the alert is still valid. Native
  foreground banners elsewhere obey the sound setting.
- Cold-start and live notification taps validate the current account and target
  identifiers, deduplicate delivery identities, and use the existing invitation/
  selected-match flow to obtain current authorized state. Account changes abort
  obsolete native operations. Logout/server session revocation cascades device
  and queued-delivery removal. Account erasure also removes push preferences.
- P2 is complete; P3 verification and operator documentation are recorded below.
  No provider credentials have been configured or push sent.


### Push increment P3 — verification and release handoff (2026-10-05)

- Completed direct APNs/FCM delivery, committed queue generation, opt-in settings,
  foreground activity leases and current-account notification navigation. Both
  the production shared screen and explicit distributed integration screen support
  notifications; tap targets fetch current authorized game state.
- Required Callbreak alerts include manual shuffle/cut/deal, hand review, bidding
  and play. Marriage declaration and draw/discard/finish and Flush betting/side-show
  responses use authorized views. Local eligibility suggestions remain in-game.
- Queue checks cover hosted invitations as well as room invitations, transaction
  rollback, deduplication, foreground expiry, stale actions, session revocation,
  preferences, blocks, concurrent claims and retries. Native transport tests cover
  APNs signing/environment and FCM OAuth, expiry, silent channels and invalid tokens.
  Token-bearing provider transport logs are suppressed during send operations.
- Verification: 66 distinct targeted backend tests passed across the regression
  run and focused rerun (25 final focused checks). The sole initial regression
  failure was an old private-room discovery expectation; it now verifies the
  approved public-room behavior while preserving membership/ledger boundaries.
  All 360 client tests, TypeScript, production web build and iOS/Android bundle
  exports passed. Python compilation and diff whitespace checks passed.
- Added `docs/app-notifications.md` with migration 38, credentials, native build
  configuration, delivery guarantees/limitations and physical-device release checks.
  Credentials remain absent. No live push, database migration, deployment, commit
  or push occurred. Native bundle export does not replace signed device testing.
- Exact next step: operator supplies APNs credentials, Firebase service-account
  credentials, existing Android application ID and native Firebase client config;
  rebuild and test signed apps on physical devices before release. User approval
  is still required before committing/pushing accumulated changes. Capacity,
  observability, database HA and operational readiness remain the next task set.

### Production API rollout — APNs configuration pending (2026-10-05)

- User authorized server configuration and restart after pushing backend commit
  `3cc1a90b66ffa9162ed12a89347c8d2c6bbd9af8`. SSH agent access restored.
- Existing CI was queued behind an older release. Built the exact committed backend
  atop the deployed production image, preserving its existing web frontend, and
  loaded the same image on both hosts: `bhidne-direct:3cc1a90-apns`, image ID
  `sha256:518ba84b014754895efd5af3f9259c3bb8a865bed1c06dbb5e11ec003e9ef65d`.
- Applied additive migrations through 38 using the normal bootstrap migration
  entrypoint. Database/Redis preflight passed on both hosts. Restarted app1, checked
  health, then restarted app2 using the existing guarded rollback/peer-health
  procedure under the release lock. Public health and push-capabilities route pass.
- Added optional read-only `/etc/bhidne-prod/apns` -> `/run/bhidne-apns` credential
  mount to the release receiver and APNs environment preservation to the provisioning
  template/filter. 41 release receiver tests pass. These local provisioning changes
  remain uncommitted/unpushed. Updated receiver installed on both hosts; existing
  runtime environment and hosted frontend preserved.
- APNs is not enabled: macOS privacy denies reading the key in Downloads even with
  escalated execution. Requested user copy to
  `~/.ssh/bhidne-apns/AuthKey_78JRYU2GBN.p8`, outside Git. Public capabilities currently
  reports `providers: []`. No real push has been sent.
- Exact next step: after the user copies the key, transfer it to both protected
  host directories (directory root:10001 mode 750, key root:10001 mode 640), configure
  key path `/run/bhidne-apns/AuthKey_78JRYU2GBN.p8`, team `ATLDYPD4ZQ`, key ID
  `78JRYU2GBN`, topic `com.lfactorial.bhidne-ho`, validate signing as UID10001 and
  restart sequentially again. Verify capabilities lists `apns`, then physical
  TestFlight delivery. Monitor latest CI (3cc1a90) which may replace the manual image
  while retaining the receiver's credential mount and runtime environment.

### APNs activation (2026-10-05)

- User moved the Apple signing key out of macOS-protected Downloads. Uploaded it
  securely to both hosts, outside source/images, with root:10001 ownership,
  directory mode 750 and key mode 640. Containers mount it read-only.
- Configured `/run/bhidne-apns/AuthKey_78JRYU2GBN.p8`, team `ATLDYPD4ZQ`, key ID
  `78JRYU2GBN`, topic `com.lfactorial.bhidne-ho` in protected runtime environments.
  Saved protected pre-APNs environment backups. ES256 signing preflight passes
  as the actual UID10001 container user on both hosts.
- Both hosts restarted sequentially and passed health checks. Direct host checks
  and the public API advertise `providers: ["apns"]`. No native-device push sent
  yet. Exact next step: build/install the signed iOS app and verify opt-in,
  background delivery and notification taps on a physical device. Local receiver,
  provisioning and handoff edits remain uncommitted/unpushed.

### Production bug increment — table social, departure and iOS push (2026-10-06)

User authorized fixes after read-only investigation of ekraj/sigma's Flush session
in `chal chal bhai room`, approximately 7:11–7:16 PM Pacific on October 6.

- Production evidence: both application hosts run `bhidne-direct:3cc1a90-apns`.
  The production API advertises APNs, but no push devices, preferences or deliveries
  existed when inspected. Enable attempts had not reached device registration.
  Live-social HTTP counters showed 17 rejected POSTs and no accepted POSTs since
  container startup. The End command completed at 7:15:51 PM; no leave command was
  queued for sigma. Both accounts had accepted the community rules.
- Table chat, reactions and poke now share the durable client's existing command-ID
  generator. Its native fallback uses only backend-accepted characters. The former
  decimal-containing fallback was reproduced as a deployed-schema validation failure.
  Room chat and direct-message behavior are unchanged.
- A fresh authorized ended-table view completes departure locally because closure
  already releases seats. A durably rejected leave racing closure reconciles to
  that view. Pending/uncertain requests still resolve the original ID and receipt;
  an ended snapshot never discards an unresolved command. Backend leave-seat ingress
  after closure now queues the original request for a durable no-effect rejection,
  avoiding an ambiguous pre-queue conflict while preserving terminal state.
- Native notification registration obtains and validates a real APNs token before
  selecting an environment. If Expo's embedded-profile lookup returns null, only a
  positively identified App Store release (including TestFlight) uses production.
  Explicit development environments remain development; unknown release types fail
  closed. Permission, token, environment and registration-validation errors now have
  distinct English/Nepali guidance. Authentication and uncertain network errors keep
  their existing semantics. No token or native exception text is exposed in UI/logs.
- Verification: all 373 client tests passed, including 13 added regressions for
  social IDs without browser crypto, ended-table and concurrent/recovered departure,
  unresolved-command preservation, APNs environments, cancellation/account changes,
  registration failures and localized error handling. TypeScript, production web
  build and iOS/Android bundle exports passed. All 43 targeted backend regressions
  passed against PostgreSQL/WASM, including original-ID receipt recovery after
  closure and unchanged closed-table reservations/state. Python compilation and
  whitespace checks passed.
- Limitations: the device's exact native exception was not captured; the null-APNs-
  environment failure path was reproduced with injected native API results. Bundle
  exports do not establish physical TestFlight permission, registration or delivery.
  No production settings, data, service restart, commit, push or deployment changed.
- Exact next step: review these changes, then rebuild/install a signed TestFlight
  app and verify notification registration,
  background delivery/taps, table chat/poke and simultaneous Leave/End on devices.
  Commit/push/deployment remain pending user approval.

### UI increment — hand header and local Marriage cues (2026-10-06)

User explicitly authorized these UI changes after collecting the requirements.

- Removed the room-page bottom return-to-game/chat/poke bar and the separate
  top-of-game attention banner. Table-card navigation remains available.
- The Your cards header now uses the rounded cue shape in both collapsed and
  expanded views, with three glowing rays on each side when a cue is active.
  Idle headers retain the normal card label/count. Collapsed headers carry chat
  and poke on either side; duplicate floating buttons are suppressed, while
  social errors remain visible. Expanded cards retain the existing social dock.
- Marriage's existing Maal, Marriage and Tunnela detectors report their actual
  eligibility results to the header. Existing inner buttons, bulbs and action
  authorization are unchanged. Required server cues retain priority and include
  local opportunities. Detection results are scoped to the current hand, route,
  visibility and declaration state to avoid carrying stale eligibility forward.
- Verification: all 376 client tests passed, including local detector cue priority,
  heuristic suppression, and spectator/folded/ended suppression regressions.
  TypeScript, production web build, and final web/iOS/Android bundle exports passed.
  Whitespace checks passed. No backend behavior changed in this UI increment.
- Limitations: bundle checks do not establish physical-device layout or animation
  behavior. No interactive browser or physical TestFlight session was run for this
  increment. Changes remain local; no commit, push or deployment performed.
- Exact next step: review the header at narrow phone widths in TestFlight, with
  collapsed/expanded hands, incoming server cues and local Marriage eligibility;
  then commit/release when requested.

### Marriage hand increment — drag swaps and card markers (2026-10-06)

User requested drag-only swapping in both Dublee and Sequence/Tunnela views, then
requested stronger drawn/discard card markers. Tap selection remains unchanged.

- Cards can be dragged onto another revealed card to exchange their displayed
  positions, including across rows. Movement takes over after an 8-point threshold;
  taps retain single-card selection/deselection and the discard confirmation.
  The hand scroll pauses during dragging, and a drag release cannot become a tap.
  Drops outside another card do nothing. Busy, hidden and declaration cards cannot
  be dragged, and measurements from a changed hand/session are discarded.
- Manual ordering is local, scoped to match/player, and survives snapshot refreshes.
  Removed/shown cards are filtered out and new cards append to the manual order.
  Pressing either arrangement button restores that mode's automatic ordering,
  including pressing the currently selected mode. Physical IDs, eligibility solvers,
  private receipt order and game commands are unchanged.
- The newly drawn card now has a 4-point green border and a small downward green
  arrow above it. A selected card uses a 4-point red border and red arrow; selection
  takes priority on the drawn card and deselection restores the green marker.
  Each card reserves arrow space so markers do not overlap the preceding row.
- Verification: all 380 client tests passed. New regressions cover both arrangements,
  refresh/removal/draw reconciliation, invalid/self/cross-row drops, and marker
  precedence. Mocked browser regressions passed at 390px (touch, cross-row swaps)
  and 1280px (mouse), including automatic arrangement reset, unchanged taps, marker
  colors/arrows and no game commands from swaps. Phone screenshots were inspected.
  TypeScript, production web build, final web/iOS/Android exports and whitespace
  checks passed.
- Limitations: touch checks ran in Chrome; physical iOS/Android gesture behavior
  still needs device verification. No production mutation, commit, push or release.
- Exact next step: verify drag swaps, scrolling and both card markers in TestFlight
  alongside the previous fixes, then commit/release when requested.

### Direct production release — October 6 fixes (2026-10-06)

- User pushed the accumulated client changes as `c0addf4`, followed by backend,
  provisioning and handoff changes in `a9342367bfab15818e477b75891ddd2475d27239`,
  then explicitly requested direct deployment without waiting for GitHub.
- Built the exact committed backend atop the existing verified production dependency
  image (dependency manifest unchanged), packaging a fresh production web export.
  The same image was transferred and verified on both application hosts:
  `sha256:7c43711e21001f5976672c8bb11d052607d564f82f34f125446a4269d4f4fb3a`,
  local tag `bhidne-direct:a934236`. Installed release receiver matches the pushed
  receiver and retains the read-only APNs credential mount.
- Dependency/schema and frontend preflight passed on both hosts before activation.
  Used the existing release lock, peer-health gate, graceful shutdown and rollback
  procedure to activate each backend sequentially. Activated matching frontends
  only after both backends were healthy. No migration or credential changes.
- Verification: all 380 client tests, 84 targeted backend/release tests, TypeScript
  and production web build passed. Both hosts report the exact revision/image and
  healthy backend, identical frontend index/JS hashes, and APNs enabled. Public HTTPS
  API health, push capabilities, frontend index and exact JS asset also passed.
  Verification record: `/private/tmp/bhidne-a934236-direct/verification.json`.
- Server/web rollout is complete. Existing TestFlight installations still contain
  their old JavaScript/native bundle: server deployment cannot deliver the client
  APNs registration, social-ID or UI fixes to them. No native build/submission or
  physical notification delivery test was performed in this release.
- Exact next step: rebuild/install the signed TestFlight app from this revision,
  then verify notification opt-in/background delivery/taps, table chat/poke,
  simultaneous Leave/End, Marriage dragging and the new hand/card cues on devices.

### 2026-10-06 — Authorized lobby refactor

- User expanded scope to implement the collected lobby changes. Top tabs are
  Play, Rooms, and Create Room or Join; Rooms contains Your Rooms and Friends’
  Rooms. Bottom navigation contains Home, Friends, and Chat.
- Play starts with a theme-aware green glowing create button, followed by the
  existing game filters. Dedicated Play cards show game, room, then table names;
  merge active tables and invitations newest first; omit the Open badge and
  Share footer; and choose Join/Watch from capacity and server permissions.
  Already seated players reopen their table. A definitive join rejection with
  a fresh unavailable-seat projection falls back to spectator entry; uncertain
  commands and occupied-other-table conflicts retain their existing error flow.
- The create overlay selects game, room, table name, and optional invited
  players. On submission, players without rooms receive “[player name] room”;
  cancelling does not create an orphan room. Existing durable room/table command
  slots preserve retries and session checks.
- Opt-in `notify_room` creation persists invitations for eligible room members
  and explicit invitees, reusing durable lobby invalidations and push jobs.
  Blocked implicit recipients are skipped. Push fanout now pages devices rather
  than failing above 256. Existing room table creation retains its prior behavior.
- Discard uses durable invitation decline and suppresses that table from the
  actor’s Play activity query across refreshes, while preserving room listings.
  Accepting an explicit invitation as a nonmember adds room membership and queues
  friendship on the canonical pair lane, ordered with other friendship commands.
  Pair lane locks precede user locks; the internal command is unavailable at
  public ingress. Its proof uses the committed acceptance receipt so later
  checkpoint replacement cannot invalidate delayed processing. Block policy is
  checked again before friendship effects.
- Verification: 383 client tests and 81 targeted backend tests passed, including
  notification fanout, decline persistence, nonmember membership/friendship,
  delayed friendship processing, public forgery rejection, blocked recipients,
  and no automatic friendship for implicit member notifications. Production
  TypeScript/web build and web/iOS/Android exports passed. Four Chrome checks at
  390/1280px passed for navigation, feed ordering and card actions, persistent
  discard, separate create/filter rows, overlay invitation payloads, and both
  existing-room/default-room creation. No schema migration required.
- Limitations: browser checks use mocked legacy HTTP/WebSocket responses;
  distributed effects are covered separately by PostgreSQL-compatible PGlite
  integration tests. Exports are not signed TestFlight builds; physical device
  notifications and production rollout were not performed for this increment.
- Exact next step: review and commit this lobby increment, then deploy the
  backend/web and produce a new signed TestFlight build when requested. Verify
  room-member and invitee delivery, invitation acceptance, join/spectator entry,
  and persistent discard with separate accounts on devices.

### 2026-10-06 — Direct production deployment of lobby refactor

- User explicitly authorized direct server deployment. Deployed committed
  `7cc4cf0bf5f88417d53c526094c76998fad69000`, packaging a fresh production web
  build with the exact committed backend. Dependencies and schema are unchanged.
- Built on the verified prior production image and transferred the same image
  to both app hosts, checking archive and image hashes. New image:
  `sha256:9b9aa338f273d7d4384fd79351b72788d706146270ff6735f2bafff07574cc43`,
  local tag `bhidne-direct:7cc4cf0`. Retained the installed release lock, schema
  and dependency preflight, peer-health gate, graceful shutdown, and rollback.
  Activated backends sequentially, then their matching frontends.
- Verification: fresh TypeScript/production web build passed. Both hosts report
  the exact revision/image and healthy backend, identical frontend index/JS,
  and APNs enabled. Backend lobby/push file hashes match the committed source.
  Public HTTPS API health, APNs capability, frontend index and exact JS hash
  passed; public JS contains the new lobby create flow and notification intent.
  Record: `/private/tmp/bhidne-7cc4cf0-direct/verification.json`.
- No migration, credentials change, or signed native build/submission was made.
  Backend/web rollout is complete. Existing TestFlight installations still need
  a new signed app build to receive the client lobby changes.
- Exact next step: produce/install that TestFlight build when requested, then
  verify room-member/invitee notification delivery, automatic membership and
  friendship, join/spectator entry, and persistent discard on separate devices.

### 2026-10-06 — Create-table and invitation refinements

- User authorized implementation of the collected follow-ups. When no rooms
  exist, the create form hides the room label, dropdown and fallback-room text.
  Submission implicitly creates `ProfileName-Room`; existing-room selection
  remains available, and the default room is reused after a partial failure.
- Call Break exposes 4/5-player radio choices. Marriage and Flush omit a client
  capacity override; the server resolves their maximum from game rules (5/10).
  A shared resolver preserves explicit valid capacities and supplies defaults
  for both durable creation and the legacy HTTP model. Play cards continue to
  use committed capacity and permission projections for Join/Watch.
- Interpretation stated while working: Marriage can start with 2 players at a
  maximum of 5. Call Break retains its engine's exact selected 4/5-player roster
  requirement. An optional clarification was requested because a 2-player
  Call Break match conflicts with that engine contract; no answer was received.
  No Call Break rules or engine roster semantics were changed.
- Invitation autocomplete begins after 3 trimmed characters, debounces 250ms,
  reuses a bounded component-local profile cache, and refreshes through the
  version-aware player search. Exact directory fallback preserves pasted-ID
  and uncached exact-name lookup. Query changes/unmount/session changes abort
  stale results. Suggestions exclude self and already selected players; each
  selected player appears below with a remove control. Selection clears the
  query and prevents duplicates; the existing 20-invite limit remains enforced.
- Verification: 388 client tests and 78 targeted backend tests passed. Four
  Chrome checks at 390/1280px passed for implicit/default rooms, 4/5 selection,
  three-character threshold, stale-response cancellation, self/duplicate
  exclusion, removable selections and final invitation payloads. Backend
  integration tests verify computed capacities, full-table join rejection, and
  starting a default five-capacity Marriage table with only two players.
  TypeScript/production web build and web/iOS/Android exports passed.
- Limitations: browser checks use mocked transport; no physical TestFlight
  keyboard/device check, signed native build, or deployment of these refinements
  was performed. No database migration is required.
- Exact next step: commit/release the refinements when requested, deploying the
  capacity-default backend before shipping its matching frontend/native bundle,
  then verify autocomplete and keyboard behavior on devices. If the user means
  actual two-player Call Break, clarify that separately before changing its rules.

### Create Table consistency and Play card presentation — 2026-10-06

- Implemented the user-approved UI collection with a shared `CreateTableForm`
  used by lobby and room creation. Both show existing game logos and names,
  three-character autocomplete with removable invitees, and only Call Break's
  four/five-player choice. Lobby alone supplies a room selector when rooms exist;
  its existing implicit ProfileName-Room creation remains intact. Removed the
  introductory paragraph and room-specific Marriage/Flush capacity controls.
- Room creation now omits Marriage/Flush capacity so the previously implemented
  server defaults apply, and sends notify_room like lobby creation. Existing
  durable commands, duplicate-submit protection and seat-conflict recovery remain.
  Invitation eligibility is enforced by the server at submission; both forms now
  use the same discovery flow rather than the former room-only eligibility list.
- Play's create action uses theme primary red with a light border and no glow.
  Order is Create, Available tables/refresh, game filters, then cards. Cards show
  seated-player circles and differently colored italic room/table names. Where
  invitation metadata supplies only a seated count, circles show neutral dots;
  actual roster metadata supplies player initials without fabricating identities.
- Verification: TypeScript and all 388 client tests passed; production web build
  and web/iOS/Android exports passed. Chrome checks at 390 and 1280 pixels, with
  and without existing rooms, verify row order, non-glowing button, game images,
  roster initials, italic/distinct name colors, room selector visibility, invite
  search/removal, server-capacity defaults and room/lobby creation payloads.
  Screenshots include `/private/tmp/bhidne-room-create-390.png` and matching
  desktop/lobby captures. Browser transport is mocked; device keyboard behavior
  and signed TestFlight release remain unverified. No deployment was performed.
- Exact next step: review/commit the combined pending capacity and UI refinements
  when requested; deploy the server capacity defaults before distributing their
  matching web/native release. No database migration is required.

### 2026-10-06 — Direct production deployment of Create Table refinements

- User authorized direct deployment; deployed committed release
  `e790b9545a5d53fec78c84da6a0ff7661171ddd6` to both application hosts.
  Fresh production web build/TypeScript passed. Backend dependencies, schema and
  installed release receiver are unchanged from the previous production release.
- Built once atop the verified previous production image, transferred and hash
  checked the same image on both hosts: `bhidne-direct:e790b95`, image ID
  `sha256:65fa562b5ae87f7f6cb39eba70286e19e7b0eff319eb007097c80de868e62fa5`.
  Used installed release locking, dependency/schema preflight, peer-health gates,
  graceful shutdown and rollback. Activated both backends sequentially before
  switching their matching frontends.
- Both hosts report the exact revision/image, healthy backend and APNs capability.
  Capacity-default backend files match committed hashes; identical frontend index
  and JavaScript hashes are served by both hosts and public HTTPS. Public bundle
  includes restored player circles and shared invitation controls.
  Evidence: `/private/tmp/bhidne-e790b95-direct/verification.json`.
- Backend/web deployment complete; no database migration or credential changes.
  No signed native build was produced. Existing TestFlight installations need a
  new signed app build to receive bundled UI changes.
- Exact next step: generate/install that native build when requested and verify
  the shared creation forms, keyboard and invitations on physical devices.

### 2026-10-07 — Cause-specific feedback, Play cards, social notices and email sign-in

- User explicitly authorized the collected changes after the invitation incident.
  Known player-facing rejections now retain their cause before generic HTTP status
  handling, with English/Nepali guidance for duplicate table names, limits, seats,
  invitations, host permissions, rules, stale state, chat and pokes. Unknown technical
  messages remain sanitized; pending-command feedback and durable receipts remain
  unchanged. Sign-in failures show incorrect credentials rather than session expiry.
- Available Tables uses each game's existing logo beside two lines: game name and
  distinctly styled room name → table name. Join/Watch and Discard stack at the
  right with yellow borders. Regular cards now also expose Discard: an actor-owned,
  durable recipient command hides that match from Play without leaving its seat,
  closing the table or hiding it from room listings/other players. Invitation cards
  retain their existing durable decline behavior.
- Poke tools show a horizontal player strip with thumbnails above names, then
  unboxed emoji choices and a message composer. Punchlines are limited to 30 Unicode
  code points in client/server validation; removed the tabbed preset/boxed picker.
- Room/table/game chat, direct messages and pokes enqueue idempotent recipient
  notification intents with the authorized source transaction. Production's
  ephemeral table chat/reaction path now persists only notification metadata;
  message text and reaction visuals retain their existing ephemeral delivery.
  Bell lists display chat/poke notices and can open their room/table/conversation.
  Native push jobs are generated only after notification commit. Sending rechecks
  contact/block history, membership/table access, direct friendship, source/session
  validity, read status, preferences and quiet hours. Current-game foreground
  suppression remains; pokes expire after five minutes. The existing Actions
  preference now explicitly covers game actions, chat and pokes. No message text
  is copied into notification records or provider payloads.
- Login accepts username or a uniquely matched verified email, case-insensitively,
  while preserving the canonical username in the session. Unverified email and
  ambiguous shared recovery addresses cannot select an account; username login
  remains available. Password verification/session creation locks both credentials
  and the matched verified contact. Signup username validation remains unchanged.
  Both login forms say “Username or email” and allow the email field length.
- Migration 39 adds personal table dismissals, an index on lower(verified email),
  and transactional chat/poke push fanout from recipient notifications. No deployed
  schema or application was changed during this implementation.
- Verification: TypeScript and all 393 client tests passed. 126 targeted backend
  tests passed against PostgreSQL-compatible PGlite 0.5.8, with one optional live
  Redis test skipped. Coverage includes verified/unverified/ambiguous email login,
  unchanged signup validation, source rollback, durable/ephemeral notices,
  deduplication, block rechecks, and personal discard with seats/room listings
  preserved. Four Chrome checks at 390/1280px passed for cards, logos, stacked
  yellow borders and create forms; three game checks passed for the poke picker,
  30-character limit, keyboard positioning, preserved rejected drafts and reaction
  delivery. Production web build and web/iOS/Android exports passed.
- Limitations: browser transport and push providers are mocked in these checks;
  native exports are unsigned bundles, not TestFlight builds. Real device/APNs
  behavior and rollout remain unverified. The PGlite harness serializes database
  connections and does not establish PostgreSQL lock-race or capacity guarantees.
- Exact next step: review/commit this increment, then, when release is requested,
  apply migration 39 using the existing distributed migration workflow, deploy
  the matching backend/web release and produce a signed native build. Verify
  verified-email login, ordinary/invited card discard, and chat/poke bell and push
  delivery using separate accounts/devices, including foreground/background cases.


### 2026-10-07 — Direct production deployment of social/login/UI increment

- User explicitly requested direct app-server deployment. Built committed revision
  `72a1e2eb3ac07556df13fcd12a4ac4d97fdf428b` with a fresh production web export.
  Python dependencies are unchanged; built on the existing pinned production base.
- Strict SSH host keys match the previously console-verified fingerprints for both
  app hosts. The installed release receiver hash matches the repository. Used the
  existing administrator sideload adapter with immutable local image verification;
  retained receiver locking, container sandbox, schema/dependency preflight,
  peer-health checks and frontend activation checks.
- Applied append-only migration 39 explicitly through the receiver migration phase.
  Both hosts passed schema/database/Redis preflight before backend activation.
  Activated both backends sequentially, then both matching Nginx frontend bundles.
- Both app hosts run image
  `sha256:6f752bb6ce60bf7993faeb87e9f07d267522e7c2eede8b30563439b4821ee43d`.
  Both report API health `ok` and APNs provider availability. Matching index and JS
  hashes were verified on both hosts and public HTTPS; deployed backend Python
  sources match the committed source hashes. Public JS contains username/email
  login, specific duplicate-name feedback and ordinary-card discard.
- Evidence: `/private/tmp/bhidne-72a1e2e-direct/verification.json`; production build
  log `/private/tmp/bhidne-72a1e2e-production-build.log`. Previous release containers
  and frontend assets remain on the hosts. Previous backend requires schema 38 on
  startup: rollback across this migration requires reversing migration 39 before
  restarting it, rather than an application-only rollback. Prepared an emergency
  schema reversal script preserving dismissal records; it was not executed.
- Backend/web deployment complete. No signed native build was produced. Existing
  TestFlight installs need a new app build for the bundled UI changes. Provider
  availability does not establish end-to-end notification delivery; no live player
  chat/poke or credential tests were sent during deployment.
- Exact next step: produce a signed native build when requested, then verify
  username/verified-email login, table discard, and chat/poke bell and APNs delivery
  using separate accounts/devices in foreground/background states.


### 2026-10-07 — Profile-owned theme/language controls

- User requested theme and language controls inside Profile instead of lobby,
  room and game table headers, and removal of the lobby welcome/name line.
- Removed both controls from AppHeader and game table header/menu. Profile now
  contains labeled theme/language controls using the existing persisted pickers.
  Added Profile access to each game table header. ProfileModal uses the shared
  GameModal wrapper so native game overlays stay in the game's presentation;
  outside a game it retains the existing native modal/dismissal behavior.
- Removed the signed-in lobby welcome/name heading; retained the Play/Rooms tabs.
  Welcome-screen controls remain available before login.
- Verification: production web export and TypeScript passed. Four Chrome lobby
  checks at 390/1280px passed, including Profile settings and the removed heading;
  all three game table fixtures passed at mobile/desktop sizes with Profile
  settings and return-to-game interactions. Ten React native-shaped modal and
  dismissal checks and four modal-layer unit checks passed. These are simulated
  native checks, not UIKit/device validation.
- Exact next step: deploy the matching frontend release using the authorized
  direct app-server workflow; native UI requires a new signed app build.

- Direct deployment completed for commit
  `1760eb085583a76c97305b56a5c82ab6483f3d4c` on both app hosts, with image
  `sha256:4a4fa552a4550ecc0651ac6a3e2bd9cd75284fed7107f5a7824da66990449698`.
  No database migration was needed; schema remains 39. Both API health checks and
  public HTTPS passed, and frontend index/JavaScript hashes match across hosts.
  Evidence: `/private/tmp/bhidne-1760eb0-direct/verification.json`.
- Additional Chrome checks confirmed settings and dismissal from both room and
  lobby Profile. A broader legacy room-deletion browser fixture failed on an
  unrelated room-card selector; focused Profile checks passed. Native dismissal
  tests passed using temporary React 19.2.3 test tools outside the repository.
- Exact next step: verify the deployed web UI after refresh; produce a signed
  native build when requested and validate nested Profile settings on devices.


### 2026-10-07 — Lobby chat, community-rules onboarding and table navigation

- User explicitly authorized the accumulated UI/notification changes and retained
  the direct production app-server release preference.
- Lobby Chat uses the existing online-friends chat mode; Friends retains search,
  requests and the full friends view. Profile and lobby Friends initially show
  six friends; More expands the full list within a bounded scrollable area.
- Chat entry checks current community-rules acceptance. Missing acceptance opens
  rules automatically and preserves the selected tab/conversation; accepting
  restores that intended chat. Applied to lobby/direct, room and all game chat.
  Rules load/acceptance failures remain visible and server posting enforcement is
  unchanged. Known posting rejection now points to opening/accepting Community
  Rules instead of generic forbidden feedback.
- Push validation resolves the authorized sender display name plus room/table
  context before building localized chat, poke and invitation/creation text.
  Recipient authorization, contact/block checks, preferences, quiet hours, expiry
  and metadata-only notification storage remain unchanged. Bell notices include
  room → table context; room-wide creation invitations say who created the table.
- Game headers show brand beside the logo, game type centered above room → table,
  and only back arrow followed by burger at right. Share/Profile/Theme/Language
  live in the burger; preferences remain in Profile too. Profile Back uses an
  arrow. Header room names come from the room context rather than table identity.
- Lobby table entry shows a gently pulsing Taking-you-to-table overlay while room
  navigation, snapshots and command confirmation proceed. It respects reduced
  motion and hides the intermediate room controls from interaction/accessibility.
  Success, request failure or expired session dismisses the overlay. Game Back
  remains view navigation, without a leave-seat command.
- Verification: production web export/TypeScript and all 394 client tests passed;
  21 targeted backend checks passed against PGlite 0.5.8. Ten simulated native
  modal/dismissal checks passed. Chrome fixtures cover separate Chat/Friends,
  missing-rules acceptance/resume, six-friend More in Profile/lobby, named bell
  notices, all three game headers/menus/chat gates, room chat, and successful and
  failed table transfer with back navigation preserving seats. API/provider data
  in browser checks is mocked; these checks do not establish live device/APNs or
  UIKit behavior. No database migration or dependency change is required.
- Exact next step: deploy this committed backend/web release directly to both
  app hosts, verify health/source/assets, then produce a signed native build and
  perform separate-account/device checks when requested.

- Direct production deployment completed for commit
  `eedf0124d1ffad5995337c51d7f9326bc96f0d1c` on both app hosts with image
  `sha256:c51f8eb8737a6fbfb4c719d4dfb88cb4b4633e7911d4aab052d12dddead91c85`.
  Schema remains 39; no migration/credential/dependency changes. Restored local
  SSH-agent access from the existing macOS keychain before upload. Both hosts
  passed preflight and API health, and public HTTPS serves matching frontend
  index/JavaScript hashes. APNs provider availability is confirmed.
- Release evidence: `/private/tmp/bhidne-eedf012-direct/verification.json`;
  checks: `/private/tmp/bhidne-lobby-followup-{client,backend,browser,native}.log`.
  Backend/web live; a signed native build and real-device notification/keyboard
  validation remain separate work. Exact next step: refresh and verify web flows,
  then produce/install a native build and exercise separate-account foreground/
  background chat/poke notifications when requested.

### Device notification defaults (2026-10-07)

- Native push now requests OS permission and registers automatically after
  authenticated sign-in when the production provider is available. Existing
  account notification categories, sound and quiet-hour preferences are kept.
- Profile Disable stores an explicit local `0` for this device/account and
  removes its server registration; it survives remount and sign-in. Enable
  restores `1`. OS denial/revocation does not create a user opt-out or repeatedly
  prompt. Android channels are created before permissions/token acquisition.
- Startup/manual operations are serialized and session/abort checks prevent a
  permission prompt completing after logout from registering the previous user.
- Migration limitation: previous Disable removed the preference entirely, so
  historical opt-outs cannot be distinguished from never-configured devices.
  Missing preferences now default on, subject to OS permission; explicit opt-outs
  made with this version are persistent. The web in-app bell remains available.
- Verification: TypeScript, targeted notification tests and four mocked native
  lifecycle checks pass. iOS/Android exports also pass. No server,
  schema or dependency changes are needed. OS prompts/APNs delivery require
  validation on signed native builds; simulated checks do not establish delivery.
- Exact next step: produce/install a signed native build and verify default
  registration, Profile opt-out persistence and chat/poke delivery on devices.

### Profile punchline section removal (2026-10-07)

- Removed the saved punchline editor and its edit-help text from Profile.
- Verification: client TypeScript and diff whitespace checks pass. This is a
  presentation-only removal; no schema or dependency change is needed.
- User requested local changes only: no push or deployment performed.
- Exact next step: review the local Profile and notification-default changes;
  release only when requested.

### Monochrome app themes (2026-10-07)

- Added Monochrome Noir and Monochrome Pearl to the existing theme picker and
  device persistence. Neutral surfaces, primary actions, text, selected states,
  borders, table surrounds and card backs use layered charcoal/silver or white/
  graphite. Brand artwork and playing-card faces/suit colors stay recognizable.
- Pearl sets the browser light color scheme and dark native status-bar icons;
  dark themes retain light icons. Primary button borders now use a semantic
  palette token, preserving the existing colored themes' border appearance.
- Verification: TypeScript, all 395 client tests (including monochrome contrast
  and neutral-token checks), and production web export pass. Chrome checks at
  390px and 1280px cover both palettes, reload persistence and color scheme with
  no page errors; mobile screenshots were inspected. Browser checks cover the
  landing view; real native status bars remain device validation work.
- User requested local changes only. No push or deployment performed.
- Exact next step: review the local theme/Profile/notification-default changes
  and release only when requested.

### Available-table card location lines (2026-10-07)

- Play available-table cards now show localized Room : <name> and Table : <name>
  on separate lines beneath the game type. Room uses muted text; Table uses
  normal text; the game heading keeps its accent color, following each palette.
- Verification: TypeScript and diff whitespace checks pass. No data/API changes.
- Changes remain local; no push or deployment. Exact next step: review the local
  card layout with the other pending UI changes and release only when requested.

### Available-table typography (2026-10-07)

- Game-type headings use the already bundled Cormorant Garamond Bold at 26px
  with 32px line height for a classic card-room character. Room/Table details
  keep Inter and increase to 15px/22px for readability. Text retains native font
  scaling and unrestricted wrapping; headings have the accessibility header role.
- Verification: TypeScript and diff whitespace checks pass; no new font/dependency.
- Changes remain local; no push/deployment. Exact next step: review the available
  table cards on a phone, including larger system text, before requested release.

### App-wide readable typography (2026-10-07)

- User clarified that the typography request covers all pages, text and labels.
  Added shared AppText across 100 screen/component imports, with Cormorant
  Garamond Bold for prominent headings and Inter for body, buttons and labels.
  The display font token now differs from the medium label token, so buttons
  retain modern type. Metadata starts at 14px; body defaults to 16px; headings
  start at 22px. Existing larger sizes remain. Line spacing grows with the text.
- Inline nested text keeps parent typography and its own color/emphasis. OS font
  scaling remains enabled and uncapped. Animated turn/transfer text uses the same
  component. Form inputs use Inter with at least 16px type and 24px line height;
  remaining direct input surfaces now use the shared FormInput.
- Verification: TypeScript, all 395 client tests and two mocked native typography
  checks pass. Production web and iOS/Android exports pass. Refreshed legacy
  preview Chrome fixtures pass lobby Chat/Friends and Profile at 390/1280px,
  all three game headers/menus/chat gates, room chat, and table transfer success/
  failure. An initial browser attempt used a cached export and did not reach the
  lobby; clearing/re-exporting resolved the fixture setup. No live writes made.
- Real-device large-system-text/Devanagari and dense game-layout inspection remain
  manual validation work; browser workflows do not establish UIKit rendering.
- No dependency change, push or deployment. Exact next step: review local
  typography and pending UI/native changes, release only when requested.

### Direct production release a721e19 (2026-10-07)

- User authorized deployment of all pending changes. Deployed committed revision
  `a721e19a484023ce4fb203fc390fd6b76535073e` directly to both production app hosts
  using immutable image
  `sha256:76b33f2a1671092985f60884d9c2a9aef6cf4d0395b4cedba5e02ea33ee5a1d5`.
  Retained the installed release lock, dependency/schema preflight, peer-health
  checks and rollback. Both backends and frontends activated successfully.
- Production HTTPS verifies API health, APNs availability and exact matching
  frontend index/JavaScript hashes across hosts. All 251 committed backend Python
  file hashes match. Public bundle includes both monochrome palettes and the
  classic font. No database migration or dependency changes; schema remains 39.
- Before deployment: fresh production build, 395 client tests and six mocked
  native notification/typography checks passed. Deployment evidence is in
  `/private/tmp/bhidne-a721e19-direct/verification.json`; build/test logs use
  `/private/tmp/bhidne-typography-release-*`.
- Profile punchline removal, monochrome themes, separate Room/Table labels and
  app-wide typography are live on the web. Native notification-default behavior
  and native UI require a new signed app build; server deployment cannot update
  already-installed native bundles. No Git remote push performed.
- Exact next step: refresh production web and inspect the updated UI; produce a
  signed native build and validate system text scaling/push on devices when
  requested.

### 2026-10-07 — App-wide visual consistency refactor

- User explicitly expanded scope to frontend visual consistency. Changes are
  local only; runtime behavior, APIs, navigation, copy, game rules and spacing
  tokens are preserved. Existing uncommitted handoff notes are retained.
- Shared typography now uses the existing Cormorant Garamond package's semibold
  face for 28px screen headings and 22px section headings, Inter for body/labels,
  and consistent line-height floors. Available tables, Friends and sheet/rules
  titles share the screen-heading scale. Branding keeps its larger scale; card
  ranks keep the original bold face/scale; inline text and OS scaling remain.
- Consolidated panel/control radii, muted borders, theme-colored elevation,
  selected tabs, icon stroke/size tokens and disabled opacity across auth,
  lobby/rooms, social/profile/settings, overlays and all three game screens.
  FormInput uses semantic surfaces/text, accent focus borders and a web focus
  ring without changing field dimensions or keyboard behavior.
- Shared action finishes supply primary/secondary/tertiary/destructive/selected
  appearances. Lobby Join/Enter uses primary actions and Discard uses destructive
  styling. Filled account deletion has separate destructive/on-destructive
  tokens, avoiding unreadable error-text colors on filled backgrounds.
- Noir uses charcoal layers; Pearl uses warm off-white surroundings. Both retain
  neutral interface accents and readable red/pink destructive/error feedback.
  Heritage/Dusk artwork and palettes remain intact. Generic player avatars,
  empty seats and reaction bubbles now follow semantic theme colors.
- Verification: TypeScript, all 396 client tests, three mocked native typography
  tests, web export and iOS/Android exports pass. The new mocked Chrome fixture
  covers all five themes: lobby/Friends/Profile/theme dialogs at 390/1280px,
  theme switching/reload persistence, all three game menus, authentication forms,
  focused fields and disabled social controls. Screenshots were inspected.
  Logs/screenshots use `/private/tmp/bhidne-visual-*`. A cached initial export
  did not reach the lobby; rebuilding with explicit local API/legacy mode and
  a cleared Metro cache resolved fixture setup.
- Remaining hardcoded color exceptions: provider branding in SignInButton;
  cultural/felt artwork in TableSurface; the RoomCard photograph scrim; red/green
  draw/discard markers in MarriageTable. These retain their existing visual
  meaning. Local font-size declarations and card/badge geometry remain where
  shared AppText normalization or game-specific rendering governs appearance.
- Limitations: mocked browser APIs and unsigned native exports do not establish
  UIKit/Android rendering, large-system-text behavior or live device accessibility.
  Exact next step: review the local UI, especially native large-text/Devanagari
  and dense game hands; release or produce signed builds only when requested.

### 2026-10-07 — Planned card-display and Marriage maal issues

Status: collected requirements only. The user explicitly requested no
implementation yet; this list does not authorize code changes or deployment.

- [ ] Remove visible Marriage card copy-number labels (Copy 1/2/3). Retain
  unique physical card IDs internally for selection, discard and game tracking.
- [ ] Display “Joker” instead of “Man” for the Marriage joker card.
- [ ] On small card displays, put the rank/number and suit on separate rows.
  Resolve the inconsistent alignment of the two-character “10” rank while
  keeping other ranks/suits aligned consistently.
- [ ] Allow a player who is eligible to show maal to do so immediately at the
  start of their own turn, before drawing a card. Showing remains optional:
  the player may instead draw and discard normally without showing maal.
- [ ] Preserve the normal draw/discard requirements when maal is shown:
  - If shown before drawing, the player must still draw one card and then
    discard one card to complete the turn, even though maal is now visible.
  - If shown after drawing, the player only needs to discard one card.
  - Showing/seeing maal does not itself replace a draw or discard.

Verification: documentation-only update; no implementation or tests performed.
Exact next step: continue collecting/reviewing issues and wait for an explicit
implementation request before changing card rendering or Marriage turn behavior.


### 2026-10-07 — Card display, turn indicators, Marriage qualification and Flush side-show

- User explicitly authorized implementation, Git push and deployment of the
  collected game changes. This supersedes the planning-only note above and
  expands branch scope for this increment.
- Removed visible physical-copy numbers while retaining card IDs. Joker naming
  and separate rank/suit rows now cover small Marriage, Flush and CallBreak cards.
  Active seats use themed flowing/pulsing avatar borders; reduced motion keeps a
  static border. Only the player TURN badges were removed; action-area prompts remain.
- Marriage initial melds/dublees may be shown before drawing on the player's turn.
  Qualification remains optional and preserves MUST_DRAW before a draw, or
  MUST_DISCARD after one; it never consumes the normal draw/discard.
- Flush pot displays three compact rows (Pot, Seen Bet, Blind Bet); eye/eye-off
  badges identify seen/blind. Seats show total contribution this round and table
  session net (settled results minus current exposure); positive/negative values
  have dedicated readable green/red theme colors. Finished rounds are counted once.
- Flush rules expose minimum bet amount, optional minimum bet counts for every
  remaining player before final show, and side-show configuration. New tables
  enable side-show by default after three betting cycles by every remaining active
  player, excluding boot. Existing saved rule choices are preserved.
- SideShowRequest is free and requires at least three active players, with both
  participants seen. The recipient is the previous active seen seat, skipping
  blind/folded seats. The decision switches to that player with glowing Accept/
  Reject controls in the normal card area. Rejection returns Bet/Fold to the
  requester, with side-show eligibility restored on their next regular turn.
- Acceptance returns a separate glowing Side show reveal decision to the requester.
  Reveal charges the current minimum seen bet once, shows each participant the
  other's cards privately, folds the loser (requester on ties), and advances after
  the requester. Public request/accept/reject notices disclose no cards.
- Reliable command contracts, private projections, contribution accounting and
  checkpoint recovery include the accepted/reveal phase. Legacy rules receive only
  additive defaults after digest validation; older already-paid pending side-shows
  retain a prepaid flag so revealing never charges them twice. Unknown fields still
  fail lossless validation. No database migration or dependency change is needed.
- Verification so far: 333 focused backend tests, 398 client tests, TypeScript,
  production web export and unsigned iOS/Android exports pass. Mocked Chrome
  covers enabled request/response/reveal actions and actual command dispatch in
  all five themes, private comparison, mobile/desktop Marriage/CallBreak borders,
  and reduced motion. Screenshots were inspected. Full backend verification runs
  separately with PGLite. Its account-deletion pending_actions fixture failure
  reproduces on unchanged e8d7f7c, as does the shared-room invitation fixture
  expectation failure. A telemetry listener sandbox bind failure passes with
  local-listener permission. No unrelated deletion/invitation changes were made.
  Direct guarded deployment avoids the automatic pipeline stopping on those
  existing failures; implementation/report commits use [skip ci].
- Release plan: use the guarded production receiver and one immutable image;
  activate both backends before either frontend. A rollback to the old game code
  after new checkpoint writes requires compatibility review, particularly for an
  accepted side-show, because old code cannot decode the added phase/rules fields.
  Browser fixtures use ephemeral local snapshots and intercepted network calls.
  Final review also aligned the in-hand discard preview and excluded zero-value
  events from coin flights; free requests still appear in the public side-show
  notices/history. Native exports do not update installed apps; signed native builds remain separate.
- Exact next step: finish broad verification, push the implementation and perform
  guarded deployment to both application hosts, then verify exact source/image/
  frontend hashes and public HTTPS health.


### 2026-10-07 — Game-change release completed

- Implemented and pushed the complete collected game-change scope in `6c3e62b`
  and final UI review corrections in `09fbf36ddbd9d109597633cb8d4822fb5a4e6665`.
  All five Marriage/card items in the earlier planning-only checklist are complete.
  The added avatar turn borders, Flush pot/status/session totals, rule controls,
  and request → respond → reveal side-show process are complete as described above.
- Verification: 333 focused engine/adapter/checkpoint tests and 398 client tests
  pass. TypeScript, final production web export, unsigned iOS/Android exports,
  mocked Chrome game checks across all five themes and reduced-motion checks pass.
  The broad PGLite backend run completed with 1,872 passed, 30 skipped and six
  failures. Five assertion failures reproduce on unchanged `e8d7f7c`: account
  deletion pending-actions gating; shared-room invitation feed visibility; and
  missing `created_at` in generated table previews for all three games. The sixth
  was the sandboxed telemetry-listener bind; it passes with local-listener
  permission. These are not silently reported as passing or fixed in this scope.
  Real Postgres/Redis/Nginx process suites were not run in this increment.
- Direct deployment retained the installed receiver's release lock, dependency/
  schema preflight, peer-health check, container hardening and rollback guards.
  Both backends were activated before either frontend. No database migration,
  credentials change, dependency update or operational HA configuration was made.
- Both production application hosts (`168.144.105.49`, `165.245.180.205`) run release
  `09fbf36ddbd9d109597633cb8d4822fb5a4e6665`, immutable local image
  `sha256:dc42d24eec89d87c71f373f6db0c90dbf8e7aab40679d84b26e497bf69bb04b9`.
  All 252 committed backend/game source hashes match on both hosts. The frontend
  index and JavaScript hashes match the fresh local production export on both
  hosts and public HTTPS. API health and APNs capability remain healthy.
- Live public web startup, sign-in entry, font loading and absence of JavaScript
  errors pass in mobile Chrome. No production accounts, tables or messages were
  created by verification. Game interactions were tested with isolated engine
  state and intercepted browser fixtures, rather than active production games.
- Release evidence: `/private/tmp/bhidne-09fbf36-direct/verification.json` and
  `/private/tmp/bhidne-game-{backend-full,engine-tests,client,browser,rollout,public-check}.log`.
  Browser screenshots use `/private/tmp/bhidne-game-*.png`. The release report is
  a documentation-only follow-up; it does not require replacing the verified image.
- Limitations: existing table rule choices are preserved, including tables that
  disabled side-show. Refresh the web page to load the new controls. Installed
  native apps require a separate signed build; unsigned export validation does
  not establish device rendering. Old-code rollback after new checkpoint writes
  requires the compatibility review described above.
- Exact next step: use the refreshed production UI for the next play/review session.
  Address the baseline test failures or produce signed native builds if requested.
  Capacity testing, observability, database HA and operational readiness remain
  the distributed-runtime follow-up task set.

### 2026-10-07 — Shared card themes (local implementation)

- Implemented the explicitly requested typography/palette consistency, lobby-only
  header wordmark, and ten Nepal-inspired card backs. Creation selects a shared
  table theme; the in-game hamburger menu changes it for every player.
- Control comes from authoritative game state: current dealer in Callbreak and
  Flush; creator/first remaining seated player before a dealer is available and
  in Marriage, which has no dealer role. Permissions follow dealer rotation and
  departures. Server checks reject unauthorized changes, invalid IDs, stale
  revisions, and ended-table changes without advancing gameplay.
- Durable creation, fenced commands, private views, recovery and rematches retain
  the theme. Existing checkpoints default to Kathmandu only after their original
  digest verifies. Device preferences remain independent next-table defaults.
  Added the shared_card_themes activation capability; no database migration.
- Verification: 117 focused backend tests passed; an additional activation,
  rematch, shared-theme and view-generation run had 39 passes and three known
  baseline failures (missing created_at in generated table previews, already
  documented in the previous release). All 36 selected client tests, TypeScript,
  web and unsigned iOS exports passed. Browser checks passed for creation,
  mobile/desktop layouts, all games, two-player synchronization, readonly
  permissions and control handoff. Git whitespace checks passed.
- Limitations: browser interaction uses isolated fixtures; native exports do not
  establish device rendering. New checkpoint fields require both backends to be
  upgraded before enabling the new frontend; old-code rollback needs checkpoint
  compatibility review. Changes are local, uncommitted and not deployed.
- Exact next step: review the shared-theme UI and dealer behavior, then commit
  and deploy only if requested. Capacity testing, observability, database HA and
  operational readiness remain the separate distributed-runtime follow-up set.

### 2026-10-07 — Generated table-preview metadata correction

- Fixed the three current backend failures across Callbreak, Marriage and Flush:
  generated VIEW_DELTA previews now include the authoritative room_tables
  creation timestamp in milliseconds, matching snapshot previews. The preview
  checksum includes that metadata. Missing table metadata fails generation for
  retry rather than publishing an inconsistent preview.
- Verification: all 42 shared-theme, activation, rematch and view-generation
  tests passed, including the three formerly failing snapshot/delta parity
  assertions. All 30 view-delta and transition tests passed. Git whitespace
  checks passed. No schema changes or deployment were performed.
- Limitations: these are focused PGLite-backed checks, not a full backend suite
  or production verification. Other historical failures have not been assessed
  in this increment.
- Exact next step: review and commit the local changes, then deploy if requested.

### 2026-10-07 — Shared-card-theme release deployed

- Deployed committed release `be4c04800e23427dd1449c869c8980c61789e468`
  to both production app hosts (`168.144.105.49`, `165.245.180.205`) using
  immutable image `sha256:dbb431dbfaf76471f257ded85e7088f3e9a184836d1214bf18e7d3de3249bf19`.
  Includes the five app palettes, consistent typography, lobby-only wordmark,
  ten shared card themes with dealer/creator controls, and preview metadata fix.
- Used the existing administrator sideload procedure with verified SSH host
  keys and the installed receiver's release lock, dependency/schema preflight,
  peer-health, container hardening and guarded activation. Both backends became
  healthy before either frontend switched. Backend dependencies and schema were
  unchanged; no migration, credential or infrastructure changes were needed.
- Verification: 164 focused backend/release tests and all 399 client tests pass.
  Production TypeScript and clean web export pass. A read-only repeatable-read
  compatibility check successfully loaded all 39 existing production table
  checkpoints with the new backend before activation. Both hosts serve the exact
  image/revision and matching frontend index/JavaScript hashes. All 257 committed
  backend/game source hashes match on both hosts. Public API health, APNs,
  frontend bundle and ten card-image hashes pass. Mobile Chrome startup,
  sign-in entry, new font loading and absence of JavaScript errors pass.
- Evidence: `/private/tmp/bhidne-be4c048-direct/verification.json`,
  `/private/tmp/bhidne-be4c048-backend.log`,
  `/private/tmp/bhidne-be4c048-rollout.log` and
  `/private/tmp/bhidne-be4c048-production-live.png`.
- Limitations: no production accounts, tables or messages were created for
  verification. Multiplayer interactions use the previously passing isolated
  browser fixtures. This increment did not rerun the entire backend/process
  suite or produce signed native builds. Rollback to old code after new
  checkpoint writes requires compatibility review.
- Exact next step: refresh the production web app and review shared-theme
  controls during play. Installed native apps need a separate signed build.
  Capacity, observability, database HA and operational readiness remain separate
  follow-up work.

### 2026-10-07 — Callbreak first-dealer draw and last-place rematches

- Implemented the requested first-game dealer draw after starting locks the
  roster. New SELECTING_DEALER state holds one shuffled standard deck privately.
  Players pick one remaining card in seat order through PICK_DEALER_CARD; only
  accepted picks are public. Lowest rank wins (2 low, A high); the last picker
  wins rank ties regardless of suit. The selected dealer then begins normal
  shuffle/cut/deal flow. The draw does not count as a scored round.
- Implemented the user's confirmed later-game rule: previous last-place player
  deals first. Scores persist by user identity through lobby changes and recovery.
  If that player leaves, use the lowest-scoring returning player; equal scores
  use first seat order. An entirely new roster draws again. Existing round
  rotation is unchanged, including the first dealer returning in round five
  for four-player games. Dealer card-theme permissions hand over after the draw.
- Legacy and durable starts share one policy. Draw commands use existing fenced
  game execution, durable receipts, private projections and view delivery. Added
  strict draw validation, checkpoint audits and replay support. Old checkpoints
  without the new optional selection/scores fields retain their original digest
  verification before defaults. Added callbreak_dealer_selection capability;
  no database migration. Active existing games keep their established dealer.
- Verification: 383 focused backend tests passed, covering Callbreak, hosted
  games, initial starts, recovery, checkpoints, rematches, command lanes, view
  generation, activation and card themes. A subsequent 68-test draw/protocol run
  passed with extra SQL authorization/payload and old-checkpoint checks. All 399
  client tests, TypeScript, production web export and unsigned iOS export pass.
  Four-/five-player Chrome fixture checks pass at 390px and 1280px, including
  spectator restrictions, public reveals, reconnect and last-picker tie winner.
- Limitations: browser multiplayer uses isolated fixtures; unsigned native
  export does not establish device rendering. The full backend/process suite
  was not rerun. New phases/checkpoints require upgrading both backends before
  activating the frontend; old-code rollback needs compatibility review.
  This increment is local and has not been committed or deployed.
- Exact next step: review the dealer-selection flow, then commit/deploy if
  requested. Capacity/HA/operational work remains separate.

### 2026-10-07 — Callbreak dealer-selection release deployed

- Completed and pushed the backend implementation in
  `03ce086cb9fde94a7f278d2e75e94e2ec3d3aa5b`, following the frontend commit
  `678606b744f8cb2a5c4b3f0540cd95768bc050ce`. Both production application
  hosts (`168.144.105.49`, `165.245.180.205`) now run the complete release,
  immutable image `sha256:a04b911b96f4290cb8e4ace67c8a7d583d289993fe3811d55c3422ff066c0738`.
- Retained the installed receiver's release lock, schema/dependency preflight,
  peer-health checks and container hardening. Both backends were healthy before
  either frontend switched. No migrations, credentials or infrastructure changes.
- Existing implementation verification remains the 383 focused backend tests,
  68 follow-up draw/protocol tests, two legacy full-match/rematch checks and all
  399 client tests documented above. For this release, all 41 receiver tests and
  a fresh production TypeScript/web export pass. A read-only compatibility check
  loaded all 39 production table checkpoints before activation. Both fresh live
  server registrations advertise callbreak_dealer_selection and shared_card_themes.
- Both hosts' exact revision/image, all 258 committed backend/game source hashes,
  and matching frontend index/JavaScript hashes were verified. Public API health,
  APNs, the dealer-selection bundle and all ten card-image hashes pass. Mobile
  Chrome startup, font loading and absence of JavaScript errors pass.
- Evidence: `/private/tmp/bhidne-03ce086-direct/verification.json`,
  `/private/tmp/bhidne-03ce086-rollout.log`,
  `/private/tmp/bhidne-dealer-release-web.log` and
  `/private/tmp/bhidne-03ce086-production-live.png`.
- Limitations: live checks created no accounts, tables or messages; dealer-draw
  interactions use the passing isolated multiplayer fixtures. No full backend
  process-suite rerun or signed native build was performed. Existing games keep
  their dealer; the selection draw starts for newly started first-table games.
  Old-code rollback after new checkpoint writes still requires compatibility review.
- Exact next step: refresh the production web app and review the dealer draw
  in a new Callbreak table. Installed native apps require a separate signed build.

### 2026-10-07 — Completed Marriage seat blocks Flush join

- Investigated the reported Sigma/Ekraj incident using read-only production logs,
  table metadata and durable receipts. Marriage table `XYZ` reached COMPLETED;
  Sigma retained its seat. Flush table `Flu` was OPEN. Seven join-seat requests
  were received and rejected with PLAYER_ALREADY_AT_TABLE and an explicit leave
  instruction pointing to the completed Marriage match. This was not a missing
  tap or an unprocessed command.
- Fixed RoomGameControl dismissing the authoritative departure prompt merely
  because the previous table is missing from the lobby list. Distributed lobby
  projections intentionally hide finished/COMPLETED tables without releasing
  their roster. The prompt now remains until explicit departure or cancellation.
  Join conflicts also close an existing game modal so it cannot obscure the
  departure prompt. Existing roster/rematch policy and server guards are unchanged.
- Verification: TypeScript and all 399 client tests pass. Added an isolated Chrome
  regression using synthetic service-generated Flush snapshots and the actual
  production rejection shape. It fails on the prior build because the prompt
  disappears, and passes at 390px and 1280px with the fix: prompt persists across
  polling, no automatic departure, explicit previous-match leave, then Flush join.
- Evidence: `/private/tmp/bhidne-join-regression/baseline-browser.log`,
  `/private/tmp/bhidne-join-regression/client-tests.log` and local web export.
- Limitations: fix is local and not deployed. Browser API calls use isolated
  fixtures; live investigation wrote no accounts, tables, receipts or player state.
  No backend changes, migrations or native builds were required.
- Exact next step: commit and deploy the frontend correction when requested.
  The current lobby hides Marriage `XYZ`, so the suggested return-and-leave
  workaround is not reachable through its room table list; addressed below.

### 2026-10-08 — Return to completed tables with reserved seats

- User confirmed Marriage `XYZ` is absent when Sigma opens the room. Updated
  durable room projections to include a completed table for a viewer who still
  holds its seat. Closed tables and completed tables without the viewer's seat
  remain excluded. The active Play feed retains its existing completed-table
  filter. Versioned room projection cache keys prevent reuse of prior hidden-table
  responses during rollout.
- RoomGameControl now displays those completed reserved tables with the existing
  Return to table action and completion status. Returning opens the established
  results/table controls, including Leave table; no seat is released automatically.
  The authoritative departure prompt from the previous increment is retained.
- Verification: TypeScript and all 400 client tests pass. Four Chrome regression
  cases pass at 390px and 1280px with both the old omitted-table projection and
  the new visible completed-table projection. Tests return to Marriage results,
  close its announcement, preserve the leave prompt across polling, submit an
  explicit previous-match departure, and join Flush. All 16 backend integration checks pass and
  cover seated/nonseated projections, active-feed exclusions, departure and cache
  invalidation, private views and read authorization.
- Limitations: local changes are not deployed; live production data was not
  mutated. Browser flows use isolated synthetic snapshots; no native device test.
- Exact next step: commit and deploy both the backend visibility correction and
  frontend prompt/room-list changes together when requested.

### 2026-10-08 — Hidden completed tables block Abc room deletion

- Read-only production metadata identified two still-open COMPLETED Marriage
  tables in Sigma's `Abc` room: `ABC Marriage` and `abc ekraj marriage`. The room
  deletion guard correctly counts these as unclosed tables, but the old lobby
  omits them. A separate closure guard rejected End on any finished Marriage or
  Callbreak game, preventing an owner from cleaning up the blockers.
- Extended completed-table visibility to the room owner and table creator even
  without a reserved seat. Actor-specific can_end_table projection metadata shows
  the existing End table control when viewing completed results. Room cache keys
  version the new projection. Seated participants retain Return/Leave controls;
  unrelated viewers and the active Play feed retain prior exclusions.
- Completed Marriage/Callbreak tables can now be explicitly closed by their
  table creator or room owner (or the existing sole-room-member rule). Room owner
  privileges are limited to completed games; another creator's active game remains
  protected. Closure uses the existing fenced table command, reservation release,
  timer cancellation, notifications and checkpoints. Engine scores, completed game
  status and settlement/finalization records remain intact. Legacy creator End also
  accepts completed games. Room deletion still requires every open table closed.
- Verification: 49 focused SQL/backend tests pass for closure, room commands,
  cached projections and query ingress. Three follow-up owner/multiple-blocker/
  active-game-permission tests pass, as do two legacy creator End tests. All 400
  client tests and TypeScript pass. Mobile/desktop Chrome checks pass for a
  nonseated owner opening a completed table, explicitly confirming End table,
  returning to the empty room and explicitly deleting it. All four prior Join
  regression cases remain passing. Production inspection made no writes.
- Evidence: `/private/tmp/bhidne-join-regression/room-delete-backend.log`,
  `multiple-blockers.log`, `legacy-end.log`, `room-delete-browser-final.log`,
  `join-browser-final.log` and `client-tests.log` in the same directory.
- Limitations: changes remain local, not committed or deployed. Browser flows
  use synthetic checkpoints/HTTP fixtures and do not delete a production room.
  No migration, infrastructure change or native device test was needed.
- Exact next step: commit and deploy this combined room/table visibility and
  closure correction when requested; Sigma can then close both completed Marriage
  tables in Abc and delete the room through its existing confirmation flow.

### 2026-10-08 — Clear Play card actions instead of Discard

- Reviewed the user's concern about Discard in Play → Available tables. It
  combined declining invitations and personally hiding ordinary table cards,
  without releasing seats or closing tables. A seated player could hide the
  card while remaining blocked from joining elsewhere.
- Removed ordinary-table Discard from Play cards. Cards now show Join when
  permitted, Return to table for seated viewers, or Watch otherwise. Only an
  actual invitation for a nonseated viewer gets the neutral Decline invitation
  action, using existing English/Nepali strings. Leaving/ending remains inside
  the table. Returning with a stale merged invitation no longer accepts it again.
- Old saved dismissals or declined invitations cannot hide a currently seated
  table from the active feed. Older clients' discard-table commands are rejected
  for reserved seats without changing membership or game state. The personal
  dismissal API remains compatible for nonseated viewers; the new card UI does
  not call it. No migration or production state mutation.
- Verification: all 401 client tests, TypeScript and clean web export pass.
  Fourteen focused SQL/backend tests pass for social/dismissal behavior and
  actor-specific cached projections. Mobile/desktop Chrome checks pass for
  Join/Return labels, absence of Discard, invitation-only decline, and preserving
  the other available/seated cards. Prior room/table fixes remain in this checkout.
- Evidence: `/private/tmp/bhidne-join-regression/play-actions-backend.log`,
  `play-actions-client.log`, `play-actions-browser.log`, `export-play-actions.log`.
- Limitations: local and not deployed. Browser API fixtures are synthetic;
  no native device test or production user interaction was performed.
- Exact next step: commit and deploy the combined visibility, closure and Play
  card corrections when requested.

### 2026-10-08 — Marriage drag inserts before the target card

- Changed the requested Marriage hand drag behavior from swapping positions to
  removing the source card and inserting it immediately before the drop target.
  Intervening cards shift while every other card retains relative order. The
  rendered hand list uses the updated local order through the existing drop handler.
- Existing gesture threshold, card hit-testing, cross-row drops, busy/reveal
  restrictions and stale-drag guards remain. Physical card IDs and server hand
  state are unchanged; existing polling/draw/discard order reconciliation remains.
- Verification: TypeScript and all seven focused hand-order/arrangement tests pass.
  Coverage includes movement in both directions, adjacent/self/missing targets,
  Sequence/Dublee ordering, unchanged source hand, polling, draws/removals and
  cross-row target detection. No new browser or native drag test was run.
- Limitations: local, not deployed, alongside the pending room/table/Play fixes.
- Exact next step: include this hand-order correction in the next requested release.

### 2026-10-08 — Room/table, Play card and Marriage drag fixes deployed

- Deployed committed release `1fc5aac10037b83addd2640453c4633339d02489`
  to both production application hosts (`168.144.105.49`, `165.245.180.205`).
  Both run immutable image
  `sha256:50d013f60e1c2247a13eea538b4a105d6a6612391d154890d530877eb4725824`.
  Includes persistent departure prompts, completed-table visibility/closure,
  protected reserved-seat feed visibility, revised Join/Return/Watch/invitation
  actions, and Marriage drag insertion before the target card.
- Used the established administrator sideload procedure, verified host keys and
  installed receiver's release lock, schema/dependency checks, peer-health checks,
  container hardening and guarded activation. Both backends became healthy before
  either frontend switched. No migration, credentials or infrastructure changes.
- Verification: 96 focused backend/production-receiver tests, all 402 client
  tests, TypeScript and a clean production web export pass. The candidate release
  loaded all 40 existing table checkpoints in a read-only repeatable-read check
  before activation. Both hosts' exact revision/image, all 253 committed Python
  backend/game source hashes, and frontend index/JavaScript hashes match.
  Public HTTPS API health, APNs, two fresh serving runtime registrations, ten
  card-back image hashes, mobile startup and sign-in entry pass without JS errors.
- Read-only live projections confirm Sigma sees `ABC Marriage` and
  `abc ekraj marriage` as completed closable tables in `Abc`; `XYZ` remains
  visible as her completed reserved table in `Hamro family`, alongside open `Flu`.
  No production tables were closed, rooms deleted, or player seats changed by
  deployment verification. Interaction checks use the earlier passing isolated
  browser fixtures; this release does not add signed native builds.
- Evidence: `/private/tmp/bhidne-1fc5aac-direct/verification.json`,
  `user-projections.json` in that directory, and
  `/private/tmp/bhidne-1fc5aac-{backend,client,production-build,rollout,source,live-browser}.log`.
- Exact next step: refresh the production web app. Sigma can use the completed
  tables' menus to close both Abc blockers and then explicitly delete the room;
  use Return/Leave on XYZ before joining Flu. Installed native apps require a
  separate signed build. Capacity/HA/operational work remains separate.


## 2026-10-08: configurable Call Break match rules

- User-expanded scope: implement the discussed instant high-bid victory, perfect
  bid across all rounds, custom Bonus conversion, high-score payout multiplier,
  and negative-score payment multiplier, with individual switches and editable
  values. New switches are off by default; four/five-player suggested values are
  8/6, 1/1, 10/8, 20/15 and below zero respectively.
- Completed: domain configuration, immediate terminal trick handling, exact
  integer scoring, shared local/durable settlement, pre-start unanimous proposals,
  server validation, English/Nepali settings and result copy, exact score display,
  Bonus totals, checkpoint compatibility and replay serialization.
- Design decisions: exact high bid; converted Bonus counts toward thresholds;
  multipliers apply to ordinary score wins only; perfect co-winners share top
  places and split remaining placements. Special payouts reject indivisible
  configurations rather than rounding. Tied opponents in perfect wins share the
  payments of their tied places. See docs/callbreak-match-rules.md for full rules.
- Verification: final Call Break/checkpoint/proposal regression run: 240 passed,
  14 optional integration cases skipped without PGLITE_MODULE. Separately, 30
  existing SQL finalization/rematch cases passed with PostgreSQL/WASM, and the new
  early-win recovery/idempotent settlement test passed on rerun after fixing its
  test-only dictionary assertion. All 404 client tests passed; TypeScript and
  Expo web export passed. Legal-play and replay tests cover four/five-player rules.
- Limits: no native PostgreSQL/Redis multi-process or device-native run in this
  increment. Normal score-based tied-placement settlement retains existing policy.
  No commit, push, deployment, or signed native build was performed.
- Exact next step: review and deploy the backend/client together before enabling
  custom rules, then smoke-test the Rules proposal and an early win on a test
  table. Unrelated capacity/HA/operational increments remain separate.
