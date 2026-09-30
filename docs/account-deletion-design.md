# Account deletion

The three A3 code increments are implemented for local review: a durable backend
request/cleanup path, Profile/Settings deletion, and the public `/delete-account`
page. Activation and real-provider acceptance are separate from code completion.
The user owns commits, pushes and deployment monitoring. No production deletion,
database reset, real email or provider revocation was performed during development.

## Confirmed policy

- Balances and settlements are game points, not money.
- The public form privately asks for the account's username and **verified recovery
  email**, then sends a confirmation link to that address. A signup address that
  has not been verified cannot authorize deletion. No profile email is published
  and no support mailbox is invented. Social accounts use provider sign-in and
  the authenticated profile flow.
- Database backups are not configured. The UI says so; there is no invented
  backup retention deadline. Configure restore/re-erasure procedures if backups
  are introduced later. SQL deletion does not promise forensic disk erasure.

## User flow

1. Open Delete account from login or Profile/Settings. The page uses the same
   English/Nepali and theme controls as account recovery.
2. Signed-in password accounts enter their current password. Guests use their
   authenticated session. Social accounts must sign in again within five minutes
   through every linked provider, supplying a fresh verified revocation grant.
3. Alternatively, request a link using the matching username and verified email.
   The response is identical for matching and unknown accounts. Links expire after
   15 minutes, work once, and are delivered by the encrypted recovery mail outbox.
4. Type `DELETE` and confirm. Opening an email link alone never deletes anything.
   Link secrets are in the URL fragment and removed from browser history.
5. Active seats/tables and pending account commands must be left/drained first.
   Acceptance atomically disables account access, revokes all app sessions and
   invalidates recovery challenges/queued account mail. The UI clears its session.
6. A private random status capability distinguishes pending, retrying and completed.
   Only its hash is stored in PostgreSQL. The browser stores the capability in
   session storage; native storage uses the existing secure adapter. Keep the status
   page until completion. Losing the response or this capability loses status access;
   it does not cancel the accepted job.

## Backend and retained shared records

Migration 32 adds pending/erased flags, deletion jobs, encrypted provider grants,
mail-purpose support and a non-personal social-login generation. It preserves
existing users/data and requires no PostgreSQL reset. It adds update cascades to
user foreign keys, retaining existing delete semantics. Normal writes retain the
immutable-history checks; only a transaction bound to an unfinished deletion job
may transform the explicitly listed history tables.

The worker uses a PostgreSQL advisory lock to serialize gateways. Provider HTTP
calls run outside row-locking transactions. Successful revocations are recorded
individually so retries resume remaining work. Database cleanup is atomic and
uses lock/statement timeouts. A failure rolls back cleanup and schedules a retry;
it is never reported as completed. Room fences are advanced before another owner
can serve transformed history. Normal distributed authentication checks close old
sessions; new commands and relational writes cannot revive disabled identities.

Cleanup removes credentials, verified/unverified email, recovery tokens/mail,
provider identities/grants, phrases, friendship links, invitations, authored chat,
private conversations (both participants' copies), associated conversation lanes,
receipts and delivery copies. It transforms remaining associated command/event/
outbox/checkpoint copies, including stored request fingerprints and typed checkpoint
digests. Recovery loading validates transformed current checkpoints before commit.
Ready social handoffs for the removed identity are purged. The generation barrier
also prevents a previously started browser handoff from recreating the identity;
an unrelated concurrent social login may need to restart after a deletion.

Shared game points, game replay structure and results remain under a fresh,
non-login `Deleted player` reference. There is no original-ID-to-replacement mapping
in the completed job. This is **pseudonymization, not a claim of anonymity**: another
player may remember the historical opponent. Shared room/table titles and other
players' messages remain shared content. Other players' ledger values are unchanged.
Unfinished point transfers involving the removed account are cancelled; amounts
and resolved history remain. Owned rooms transfer to their oldest available member;
an empty historical room retains the non-login reference.

Cleanup waits while a shared live checkpoint or pending command still references
the identity. It does not silently remove an active seat or corrupt a live game.
Versioned read-cache keys prevent fresh reads from returning removed profiles.
Workers prune expired local payloads and legacy profile dictionaries. Completion
waits at least 60 seconds (65 with the default distributed cache) after database
cleanup for Redis/local TTL expiry. Already downloaded content, delivered mail,
other users' screenshots and independently retained client copies cannot be recalled.

## Deployment and acceptance

Default: **disabled**. Distributed gateways enable the request endpoints and worker
with `BHIDNE_HO_ACCOUNT_DELETION_ENABLED=1` only when recovery mail is configured.
Legacy in-memory runtime deletion remains unavailable. The public page still
explains unavailability without accepting requests when the capability is off.

1. Deploy migration 32 and this backend to **all** gateways/workers with deletion
   disabled. Mixed old/new mail workers must not consume new deletion-purpose work.
2. Deploy the frontend and verify `/delete-account` resolves to the exported app.
   The production Nginx SPA fallback already covers it; the local FastAPI static
   host now explicitly serves the route. Use the actual web origin in recovery
   mail configuration. No credentials belong in the frontend.
3. Validate a disposable password account and verified mailbox through both paths,
   and restart a worker during cleanup. Confirm the status page and other players'
   points/history after completion. Do not reset PostgreSQL for this migration.
4. Validate actual Google, Facebook and Apple revocation using test accounts before
   enabling those providers for public deletion. Existing provider accounts need
   fresh browser authorization; a native ID token alone is not a revocation grant.
   Google/Apple retain encrypted refresh grants; Facebook retains an encrypted
   access grant. Google `invalid_token` is the documented terminal retry response;
   other unexpected errors remain retryable. Monitor unresolved jobs operationally.
5. Native deep-link/device acceptance and real-email/provider acceptance remain
   unchecked. Large-account load/timeout behavior also needs operational testing:
   cleanup currently scans reviewed shared-history tables in one transaction,
   rather than batching an unbounded history across transactions. Do not advertise
   an exact deletion deadline or store-readiness certification from local tests.

If restoring an older snapshot in future, keep traffic and mail workers stopped,
reconcile deletions that happened after the snapshot, then reopen service. No backup
restore test is claimed while backups are unconfigured.

## Verification

Tests cover password rejection, verified-email-only one-use proofs, active-seat
rejection, session revocation, concurrent sign-in, actor write rejection, shared
point preservation, ownership transfer, cancelled unfinished transfers, private and
room-chat copies, all three engine recovery paths, social-handoff invalidation,
provider outage/retry, HTTP validation/no-store responses and status capability
isolation. Browser acceptance covers both entry paths, explicit confirmation,
fragment removal, status persistence, and English/Nepali/theme controls using a
fake mailbox and disposable PostgreSQL. See the handoff in the readiness plan for
final command results and remaining acceptance.

Provider references:
- [Google revocation and terminal errors](https://developers.google.com/identity/openid-connect/reference#revocation-endpoint)
- [Apple token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
- [Facebook permission revocation](https://developers.facebook.com/docs/facebook-login/guides/permissions/request-revoke/)
