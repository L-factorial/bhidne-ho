# App Store and Google Play readiness TODO

Status: implementation authorized on 2026-09-30. Work in reviewable increments;
this checklist is not a claim of release readiness. No production rollout is
implied. Extend the existing distributed runtime; PostgreSQL remains authoritative.

## Existing baseline

- Password signup/login, scrypt hashes, hashed expiring sessions and server logout.
- Native SecureStore and web per-tab session storage.
- Browser Google/Apple/Facebook login with backend code exchange and verification;
  real credentials/device acceptance still required. See social-login-setup.md.
- Foreground game cues, invitation list, notification bell and local table-chat
  unread count; durable event delivery is not background push.
- Authorized room/table/game chat and friend DMs, with database-backed per-lane
  send cooldowns. Reporting, blocking and content moderation are absent.
- Privacy/terms controls currently show notices. No public deletion workflow.

## Increment checklist

### A1 — account recovery foundation

- [x] Append recovery contact/challenge/rate-limit schema without changing old migrations.
- [x] Require the current password to enroll a recovery address; verify mailbox
  possession before using it. Preserve the old verified address until replacement
  succeeds. Existing accounts without recovery email keep working.
- [x] Store only hashes of short-lived single-use tokens; bind purpose/account/email.
- [x] Serialize consumption, replacement and reset across gateways; rate-limit issuance
  in shared storage. A password reset revokes every application session and challenge.
- [x] Prevent a concurrent old-password login from issuing a session after reset.
- [x] Test real SQL, replay, expiry, rollback, replacement and cross-service revocation.
- [x] Keep this internal service unmounted until A2 supplies safe public delivery.

### A2 — recovery delivery, API and Settings

- [x] Signup-only Confirm password field, matching-password submission guard,
  keyboard focus progression and English/Nepali mismatch text (2026-09-30).
- [x] Require valid email on new password signup in client and API; save it privately
  as unverified without changing existing-account sign-in (2026-09-30).
- [x] Email enrollment remains optional for existing accounts; provide Settings
  enrollment and verification before allowing password recovery.
- [ ] Configure transactional email sender, public HTTPS origin and verified sender domain.
- [x] Durable bounded delivery retries; never log reset tokens, link queries or email bodies.
  Any queued secret must be encrypted with a deployment-managed key and promptly purged.
- [x] Authenticated enrollment/status/removal with fresh password proof; generic reset
  requests by username; shared account and ingress abuse limits, trusted proxy handling.
- [x] Add verification and reset completion pages, login Forgot password, and Account
  Settings; validate address inputs and localize English/Nepali messages.
- [x] Never expose an issuance token in an HTTP response. Keep missing/unverified/limited
  accounts indistinguishable in reset request responses. Protect against timing enumeration.
- [x] Password reset completes without auto-login. Return to sign-in and restore only
  authorized destinations. Reject expired, wrong-purpose and replayed links.
- [x] Decide recovery support for legacy accounts without verified email. Do not infer
  account ownership from a claimed address or merge social accounts by matching email.
- [ ] Validate SecureStore restart/upgrade/failure, session expiry/account switching,
  online logout and clear local-only logout behavior when offline.
- [ ] Configure and verify Google, Facebook and Apple on real iOS/Android devices.
  Native SDK adapters only where required; linking/unlinking remains a separate feature.

### A3 — account deletion

- [x] Profile/Settings and public `/delete-account` UI with English/Nepali/theme
  controls, explicit confirmation, password/email/social/guest proof and status.
- [x] Migration 32, atomic account disablement/session revocation, new-write guards,
  retryable cleanup jobs and encrypted provider revocation credentials.
- [x] Active participation rejection, room ownership transfer, preserved shared
  game points and cancellation of unfinished transfers involving the account.
- [x] Cleanup of account/social/chat data and associated durable copies; validated
  transformed checkpoints/receipts and an unlinked `Deleted player` reference.
- [x] User decisions recorded: game points only; verified account email is used
  privately by the public form; backups are not configured.
- [x] Local migration, cleanup/recovery, concurrency, HTTP and browser acceptance.
- [ ] Deploy all gateways and frontend with the capability initially disabled;
  validate real mail, provider revocation, native links and large-account behavior.
- [ ] Activate deletion after environment acceptance; establish deletion reapplication
  before introducing backup/restore. No anonymous-data or store-compliance claim.

See [account-deletion-design.md](account-deletion-design.md) for exact behavior,
retained shared content, migration implications, test limits and activation steps.

### A4 — chat safety

- [ ] Report message/player across all chat scopes, with bounded evidence and reasons.
- [ ] Block/unblock and blocked-player Settings; server checks on sends, history/delivery,
  requests, invitations, mentions and push, including commands queued before a block.
- [ ] Define shared-table behavior: block social interaction without hiding game state.
- [ ] Account-wide bursts, repeated-message and invitation/report abuse limits across hosts.
- [ ] English/Nepali/transliterated content checks for messages, names and saved phrases.
- [ ] Community rules accepted before posting; decide guest posting and age policy.
- [ ] Protected moderator queue with server-enforced roles, minimal evidence access,
  dismiss/remove/mute/suspend actions and audited decisions; assign human coverage.
- [ ] Test bypass attempts, concurrent block/send, unauthorized moderator access and appeals.

### A5 — notifications

- [ ] Consistent foreground invitation banners/turn cues and durable chat read positions.
- [ ] Explicit user-ID mentions with membership/visibility validation.
- [ ] Per-account category/sound/preview preferences; permission request at a useful moment.
- [ ] Native token registration/rotation, multiple installs and account-switch isolation.
- [ ] Durable push jobs from committed events; retries, deduplication, invalid-token cleanup,
  stale-turn expiry and privacy-safe payloads. Never wait for push in gameplay transactions.
- [ ] Suppress blocked/revoked/deleted destinations; unregister on logout/deletion.
- [ ] Tap navigation through login/cold start; recheck access and handle ended/missing content.
- [ ] Device tests: foreground/background/terminated, denied permission, duplicate/delayed
  pushes, multiple devices, account switch and expired session.

### A6 — privacy and support

- [ ] Publish /privacy, /support, /delete-account and community rules/terms without login.
- [ ] Replace welcome notices and add Settings links; English/Nepali coverage.
- [ ] Actual data inventory, purpose, provider list, retention, deletion and monitored contact.
- [ ] Match Apple privacy disclosures and Play Data safety to shipped behavior and SDKs.

### A7 — native builds and store testing

- [ ] Prepare private native builds early: bundle/package IDs, signing, build profiles,
  icons, versioning, staging/production origins, provider redirects and push capabilities.
- [ ] Read Expo 57 docs before client implementation; validate native dependency compatibility.
- [ ] Real-device full journey: login/reset, invite/game/chat, block/report, logout/delete.
- [ ] Reconnect/cross-server tests, accessibility, English/Nepali and permission checks.
- [ ] Reviewer access/instructions, content ratings, public URLs and privacy declarations.
- [ ] TestFlight and Google Play testing acceptance before production submission.

## Data lifecycle design baseline

| Data | Planned treatment | Decision still required |
| --- | --- | --- |
| Password credentials, unverified signup email, sessions, recovery contacts/challenges | Delete on account deletion; reset revokes sessions/challenges | Expired-row cleanup schedule |
| Provider subjects and metadata | Revoke grants and delete links | Apple revocation credential strategy |
| Profiles, names, phrases, friendships, invites, devices/preferences | Remove personal records and duplicated payloads | Guest lifecycle |
| Room/table/game chat and DMs | Delete authored personal content, including delivery copies | Ordinary message retention |
| Game journals, receipts, snapshots, ledgers | Reviewed purge/anonymization preserving other players' consistency | Settlement meaning and retention basis |
| Reports and moderation audit | Restricted evidence, time-limited retention | Retention and moderator owner |
| Logs and backups | Minimize/redact, expire, reapply deletions after restore | Actual providers and expiry periods |

Do not publish invented retention periods, support contacts or legal claims. Existing
username-only users must enroll a verified email while they still have access.
Email matching never silently links identities. Recovery email can serve more than
one username; reset targets a username, not all accounts sharing an address.

## External decisions / release dependencies

- Public support address, transactional email provider and sender domain.
- Moderator coverage, target audience/age policy and guest chat permissions.
- Retention periods and whether balances/settlements represent real money.
- Apple/Google/Meta registrations, developer accounts and push credentials.
- Production capacity/HA/operations remain separately tracked in the runtime plan.

## Verification and handoff

Record each completed increment here with exact checks and limitations. Do not tick
device/provider/deployment tasks based on mocked tests. Public routes remain disabled
until their end-to-end dependencies are ready.

### A1 completed locally — 2026-09-30

- Migration 28 adds verified recovery contacts, purpose-bound hashed challenges and
  persistent issuance limits. Credential deletion cascades through this new data;
  this does not implement deletion of other account data.
- `app/auth/recovery.py` provides password-proven email enrollment, one-use email
  confirmation, username-targeted reset issuance, atomic password reset and bounded
  expired-challenge cleanup. No new HTTP routes or delivery integration are mounted.
- Email verification expires after 30 minutes; reset expires after 15 minutes.
  Each account/purpose allows one issuance per 60 seconds and five per hour.
  Resending supersedes the previous link; rate-limited requests leave it valid.
  HTTP-level IP/request limits and enumeration protection remain A2 work.
- Addresses use a conservative ASCII mailbox format, preserve local-part spelling
  and lowercase domains. Internationalized mailbox support is deferred until the
  delivery provider is chosen. Shared recovery addresses do not merge accounts.
- Reset revokes all current app sessions and pending recovery challenges. Mailbox
  replacement invalidates resets sent to the old mailbox. No automatic login.
- Credential-row locking now covers password verification plus session insertion,
  so a login using the previous password cannot survive a concurrent reset.
- Verification: **53 passed** across account recovery, auth runtime, distributed
  platform, migration upgrade and socket session tests with PGlite enabled.
  **3 additional real PostgreSQL tests passed** for both login/reset lock orderings
  and concurrent duplicate reset consumption. These use independent connections
  to a disposable local database, not production. The sandbox initially blocked
  shared memory; the approved local rerun passed. `git diff --check` passed.
- PGlite tests cover schema upgrade with existing accounts, invalid proof, hashed
  tokens, wrong purpose, replay, expiry, mailbox replacement, shared limits,
  rollback on injected failure, unrelated-account isolation and bounded cleanup.
- Run the SQL suite with `PGLITE_MODULE` pointing to installed `@electric-sql/pglite`;
  run `tests/test_account_recovery_concurrency.py` with `POSTGRES_TEST_BIN` pointing
  to local PostgreSQL binaries. Existing production CI supplies both variables.
- No email sent, native device validation, commit, push or deployment performed.

Exact next increment: **A2**. Select/configure a transactional email provider and
public HTTPS origin, implement delivery plus generic/rate-limited public routes,
then email verification/reset pages and Account Settings. Never expose the internal
`IssuedChallenge` result in API responses or logs. Its secret is returned only to
the future trusted mail adapter; the database keeps the token hash only.

### Signup confirmation follow-up — 2026-09-30

- Added masked Confirm password to the original UI and explicit integration signup
  form. Missing/mismatched confirmation blocks signup, including keyboard submission;
  sign-in retains one password field. Confirmation is local UI validation only and
  is not added to the API payload or persisted.
- Added English/Nepali labels and mismatch text, cleared confirmation on mode changes,
  and updated existing browser fixtures for the additional field/focus step.
- Verification: TypeScript passed after web export completed, Expo web export passed,
  4 localization tests passed, diff whitespace check passed. Initial concurrent
  typecheck/export raced over generated dist files; sequential typecheck passed.
  Updated browser fixtures were not run; real-device keyboard validation remains open.
- No commit/push/deployment. Next remains A2 delivery/API/recovery Settings work.

### Mandatory signup email — 2026-09-30

- User approved mandatory email for new password accounts and optional later
  enrollment for existing accounts. Both Expo signup forms now require a valid
  address, with English/Nepali guidance, email keyboard/autofill and guarded submit.
  Login still accepts only username/password without requiring email.
- `SignUpInput` enforces the requirement at the API boundary, including on the
  distributed platform. Password confirmation stays client-side. The test console,
  existing browser/backend fixtures and load-test enrollment follow the new contract.
- Migration 29 adds nullable `account_credentials.unverified_email`; it performs
  no deletion or backfill. PostgreSQL signup stores the normalized address in the
  same transaction as account/session creation. Existing credentials/sessions and
  verified contacts are preserved. In-memory development signup mirrors storage.
- Signup email is private and unverified, excluded from public profiles and auth
  responses. It cannot issue a reset; only successful mailbox-proof verification
  creates a trusted recovery contact and clears the pending signup address.
  Shared addresses do not merge identities. ASCII validation is shared with recovery.
- Internal account creation can omit email for legacy fixtures/imports; public
  HTTP registration cannot. Older clients can still log in but signup without email
  receives 422, so release both gateways and client together after applying 28/29.
- Verification: 89 backend tests passed (signup/recovery, console, players/profiles,
  tables, distributed platform, auth and migration upgrade); 5 email/localization
  checks and 11 load-driver checks passed. TypeScript and Expo web export passed.
  Chrome signup/profile check passed at mobile width: blank/invalid email, mismatched
  confirmation, valid registration, profile edits and friend/identity persistence.
  The initial browser attempt used a stale bundle pointing to another localhost port;
  rebuilding with an explicit test origin and a cleared Metro cache resolved it.
- The broader keyboard-form script passed the signup email/confirmation focus and
  reduced-viewport checks, then failed its unrelated private-chat assertion expecting
  raw `Message test failure` text. Existing `playerError` intentionally replaces
  unknown server text; that stale chat assertion is not changed in this increment.
- No verification messages are sent yet; delivery, public verification/reset routes
  and optional existing-account Settings enrollment remain A2 work. No production
  database access, native-device test, commit, push or deployment performed.
- Exact next step: configure the email provider/sender and implement reliable
  verification delivery, then public verification/reset and Account Settings UI.

### Keyboard regression test repair — 2026-09-30

- User authorized the minor test repair as part of this increment. Updated the
  private-chat and room-create error assertions to expect the intended friendly
  messages and explicitly verify that raw server text remains hidden. Draft-retention
  and error-visibility assertions remain intact.
- Updated stale navigation steps: select Create or Join before room actions, use
  the always-expanded room invitation fields, and open Marriage's Rules and config.
  No application behavior was changed.
- Generated disposable game snapshots with
  `PYTHONPATH=. .venv/bin/python scripts/social_browser_fixtures.py` and reran
  `client/tests/browser/keyboard-forms.cjs` against the local in-memory server and
  existing web build configured for that origin. **The complete script passed**:
  signup focus/submit, profile/phrases, private-chat errors and drafts, room/table
  creation, and Call Break/Marriage/Flush numeric rules and poke forms under a
  reduced visual viewport. This resolves the earlier keyboard-test failure.
- Syntax and `git diff --check` passed. Physical-device keyboard testing remains
  separate. No backend/frontend product change, commit, push or deployment.
- Next remains A2 email delivery and public recovery/Settings completion.

## Policy references

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/support/offering-account-deletion-in-your-app/
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://support.google.com/googleplay/android-developer/answer/9876937
- https://support.google.com/googleplay/android-developer/answer/10144311

Reviewed during planning on 2026-09-30; recheck before submission.


### A2 delivery and public recovery implementation — 2026-09-30

- Added migration 30 with encrypted mail/reset-request queues and hashed ingress
  rate buckets. Migration upgrade tests preserve existing users, credentials,
  profiles, sessions and verified contacts; no PostgreSQL reset is required.
- New password signup queues verification in the same transaction as account
  creation. Shared background workers lease jobs, send outside transactions,
  retry at most five times and purge sent/expired/stale payloads. SMTP supports
  certificate-verified STARTTLS/SSL; all gateways share rotating encryption keys.
- Mounted reviewed recovery routes in both legacy and distributed gateways.
  Reset requests perform no account lookup on the HTTP path and return the same
  accepted response for missing, unverified and limited usernames. Account/IP/
  recipient budgets, single-use tokens and fresh password proof protect mutations.
- Added English/Nepali Forgot password, explicit verification, matching-password
  reset and Profile → Recovery email settings (status, enrollment, resend,
  replacement, confirmed removal). Existing users may enroll voluntarily; accounts
  without verified mail must sign in normally to enroll. No email-based ownership
  inference or social-account merging. Reset revokes all sessions without auto-login.
- URL fragments are removed from browser history and kept only in memory. Opening
  a link never consumes it. Browser testing identified and corrected email-label
  interpolation and handling of recovery links in an already-open tab.
- Deployment remains opt-in. Added a private allowlisted CI configuration writer,
  example environment and [setup/operations guide](account-recovery.md). No external
  email, production access, commit, push or deployment was performed.
- Verification: recovery/signup/distributed-platform database tests, SMTP formatting/
  TLS tests, retry/restart/expiry/rate-limit/lifecycle tests, additive-upgrade and
  rollback tests, deployment/console tests; independent PostgreSQL concurrency
  checks passed. TypeScript, Expo web export and six localization/email/link checks
  passed. The final mobile-width Chrome flow passed against disposable PostgreSQL
  and captured test mail: signup verification, explicit consume, same-tab reset-link
  opening, confirmation mismatch, session revocation, fresh login and Settings
  removal. Both product issues found during browser testing are resolved; one
  ambiguous test sign-in selector was also corrected. Local test resources stopped.
- Remaining acceptance: choose/configure the live provider and verified sender,
  public HTTPS frontend origin and encryption keys; validate real inbox delivery,
  proxy trust and physical-device links. SecureStore/device lifecycle and native
  Google/Facebook/Apple acceptance remain unchecked A2 tasks. Queues pause while
  recovery is disabled; SMTP can deliver duplicates after ambiguous timeouts, and
  in-flight invalidated links may arrive but cannot be consumed.
- Exact next step: configure staging recovery with the private settings, verify a
  real mailbox through signup → reset → fresh sign-in, then complete A2 device and
  social-provider acceptance before beginning A3 account deletion.

### A2 staging activation preparation — 2026-09-30

- User authorized email-provider setup and real-mail staging acceptance.
- Confirmed the existing `test` workflow consumes private recovery configuration;
  its release branch is `main`, distinct from the current production branch.
- No recovery environment variables are present in the current shell. Local
  provisioning secrets are encrypted; their contents were not exposed or changed.
- Added `docs/recovery-staging-acceptance.md` with exact configuration names,
  target separation, rollout prerequisites and real-mail acceptance checklist.
- Activation remains pending provider/sender selection and private credentials.
  No emails sent, secrets changed, deployments triggered or database data changed.
- Exact next step: receive provider/sender details, verify provider setup, configure
  the private staging secret and release the reviewed code to the test environment;
  then execute the recorded mailbox acceptance checks.

### A2 target clarification and private key preparation

- User chose this branch's production target rather than the initially proposed
  staging target. Resend domain `notify.lfactorial.com` is verified and the user
  created the `bhidne-ho-prod` sending key.
- Added `deploy/recovery/configure-secrets.py`: hidden local credential input,
  owner-only Git-ignored configuration, production frontend origin, Resend STARTTLS
  port 2587 and encryption-key preservation. Two local tests passed.
- Pending: local key entry, production provisioning integration, both-host SMTP
  connectivity and live recovery acceptance. No deployment or external email yet.

### A2 SMTP ready; application release pending

- User clarified production and staging testing use this same branch/environment.
  Deferred database reset remains a separate future action.
- Both hosts authenticated to Resend over TLS. Private recovery settings were
  installed without restarting apps or touching PostgreSQL, and provisioning now
  preserves them. Five setup/deployment tests passed. Full Ansible execution was
  not performed; the local backend venv lacks Jinja for a standalone render check.
- One requested delivery-test email was accepted by Resend; inbox receipt pending.
- The live recovery endpoint returns 409, so real signup/reset acceptance still
  requires deploying the uncommitted application changes through the normal branch
  release. No commit, push or deployment occurred during this configuration step.

### A2 forgot-username increment

- [x] Added Forgot username to both sign-in interfaces, with required email entry,
  client/API validation and English/Nepali generic confirmation.
- [x] Added reviewed public username-request route; missing, unverified and limited
  addresses are indistinguishable in valid HTTP responses. Lookup runs in the
  background against verified contacts only.
- [x] Reused encrypted requests/outbox and worker leases/retries. One reminder
  contains all matching verified password-account usernames, rechecked before send.
  Pending emails are excluded; username recovery does not change sessions/passwords.
- [x] Migration 31 preserves existing accounts/sessions/challenges/queued mail while
  extending delivery to tokenless reminders and indexing email lookup.
- Verification: 58 backend recovery/signup/platform checks passed; expanded real
  PostgreSQL browser recovery flow and mail-worker concurrency check passed;
  TypeScript, Expo web export and five localization/link checks passed. Additional
  focused SMTP-message and generic-response coverage recorded in the test suite.
- No live mail, deployment, commit, push or production database changes in this
  increment. Exact next step: deploy migrations and both gateways before enabling
  the updated client, then validate real verification/username/reset emails.

### A2 consistent account-page layout

- [x] Matched forgot username/password, email verification, password reset and
  their success states to the original login panel, fields, buttons and spacing.
- [x] Added the shared branded header with English/Nepali and theme controls to
  recovery pages and the distributed integration sign-in interface. Shared account
  styles keep these forms aligned with the main login/signup interface.
- Verification: TypeScript and Expo web export passed. The disposable PostgreSQL
  browser recovery flow passed, including language/theme switching on login,
  signup, recovery and success screens, plus preservation of entered form values.
- No schema changes, external email or deployment in this layout increment.
  Native device appearance/keyboard acceptance remains pending.
- Exact next step: release the accumulated recovery changes (both gateways before
  the client), then run real-mail verification/username/reset acceptance.

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
