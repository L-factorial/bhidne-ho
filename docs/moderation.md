# Reporting and moderation

Reports are grouped by the reported account ID. A moderator opens Profile →
Moderation, selects Pending or Reviewed, expands a player, and accepts or declines
individual reports with a required reason. The page uses the app header, language,
theme and Back navigation. Decisions are final classifications; accepting does
not remove messages, mute users, suspend accounts, or alter games. Enforcement controls are separate explicit actions on accepted reports.

## Moderator configuration

Backend-only environment settings:

```
BHIDNE_HO_MODERATOR_USER_IDS=user-00000000-0000-0000-0000-000000000001
BHIDNE_HO_MODERATOR_EMAILS=moderator@example.com
```

Both lists accept comma-separated values. Prefer the permanent Profile ID. Either
an explicit ID or a uniquely matching verified recovery email authorizes an active
account. Unverified signup emails and social-provider email claims do not qualify.
Email uses the existing recovery normalization: trim whitespace, lowercase the
DOMAIN, preserve the local part. Two accounts verifying the same mailbox disable
that mailbox's moderator grant; explicit IDs still work. Removing or changing the
verified email removes that grant on the next request. Deleting/recreating an
account does not inherit an ID grant, but a uniquely verified configured mailbox
can authorize the replacement account. Remove the email grant if this is unwanted.

An empty allowlist grants nobody access; malformed configuration prevents startup
rather than partially enabling it. Login is always required. Every list, detail and
decision request verifies permission against current PostgreSQL account/contact
records. The frontend never receives the allowlist. Moderators cannot decide
reports they submitted or reports about their own account; another moderator is
required. Decisions record moderator ID, reason and server time atomically. Repeating
an identical decision is safe; a different second decision returns a conflict.

On production app hosts, set the keys in the root-owned runtime environment used
by both gateway services. Restart ALL gateways after applying the same settings.
Do not set EXPO_PUBLIC variables. To provision reproducibly, supply a private or
Ansible Vault variables file with `moderation_environment` containing these keys to
`deploy/provision/apps.yml`, using the existing private inventory/secrets workflow.
The runtime template preserves these keys on subsequent provisioning runs; empty
strings explicitly revoke grants. This change does not configure any live account.

## Evidence, privacy and retention

Report entry points cover player rows and direct/room/table/game chat messages.
The server verifies the message sender and reporter's access. Direct-message
reports require the reporter to be its recipient; scoped chat uses existing lane
read authorization. Closed/inaccessible chat cannot be reported by guessing IDs.
A player report captures the current public profile. Message reports capture only
the referenced message and timestamp, never a full conversation. Optional reporter
text is limited to 1,000 characters and is displayed as an allegation, not verified
evidence. Reporter identity is stored privately and is not returned in the queue.

PostgreSQL migration 34 adds reports and decisions; no resets or existing-data
rewrites. Reports/decisions are excluded from reads at 90 days and purged hourly
while the distributed runtime runs (overdue rows are purged after restart).
Account deletion removes reports where the account is reporter, target or deciding
moderator, including their associated decisions. No separate indefinite audit copy
is kept. Future public privacy copy must document this collection and retention.

The per-account limit is ten new reports per hour, serialized by database locks
across hosts. A repeated report for the same target/message/category within 24
hours returns the original report; the duplicate does not overwrite evidence or
consume another slot. Moderation reads are paginated. The queue groups/sorts by
stable user ID and shows the latest report time, not a severity ranking.

## Rollout and remaining work

Deploy migration 34 and the code on all backend instances before the frontend;
configure the moderator(s), restart gateways, verify their Profile entry and deny
access for an ordinary account. Report capability is advertised only by the
supported distributed runtime. Legacy runtime remains unavailable for reports.

Next: explicit content removal/mute/suspension with safe game participation,
community rules, broader content checks, public support/privacy and appeals flow.
Native iOS/Android acceptance is still required before store submission.


## Enforcement and community safety

Migration 35 adds restrictions, action audit records, removal markers, rule acceptance,
and shared abuse counters. It is additive: do not reset PostgreSQL. Deploy schema
and code together across gateways; mixed runtime versions are unsupported.

- Accepted message reports offer **Remove message**. Accepted reports also offer
  mute/restore chat and suspend/restore account. Every action requires a reason;
  duration choices are 1 hour, 1 day, 7 days, or 30 days. Retries use a UUID and
  cannot change the action, reason, report, moderator, or duration for that UUID.
- Muting disables room/table/game/direct chat, pokes/reactions and outbound
  friend/room/table/seat invitations. It leaves gameplay available.
- Suspension revokes sessions and prevents new sessions and commands. It is
  rejected while active/reserved games, table positions or pending commands
  exist. Use mute immediately; suspend after the player leaves. There is no
  automatic kick, game forfeiture or scheduled suspension in this version.
- Restoring an account does not restore revoked sessions; sign in again.
- Removal markers redact live reads, history and durable replay. Existing open
  chats refresh through their normal polling (up to roughly three seconds).
  Clients preserve known removals against older in-flight responses. Original
  message/outbox data is not overwritten; report evidence remains moderator-only.
  Markers outlive reports and are only purged when both source and replay records
  are absent, so retention cleanup cannot resurrect a message.
- Rules are available in Profile and chat. Signed-in accounts must explicitly
  accept the current server version before posting or inviting. Existing accounts
  are not silently opted in. Guest posting is denied in the distributed runtime.
- Account-wide PostgreSQL counters allow 20 messages/pokes/reactions per minute,
  and 20 invitation recipients per hour, across gateways and lanes. Repeating the
  most recent normalized message within 30 seconds is rejected. Existing tighter
  per-channel cooldowns remain. Counters older than two days are purged hourly.
- `content.py` is a small reviewed English/Nepali/transliterated denylist, with
  Unicode/zero-width/limited leetspeak normalization and word boundaries. It
  checks chat, punchlines, signup/profile names, room names and table names.
  It does not detect all abusive language or contextual harassment; reporting,
  blocking and human moderation remain necessary. Existing account names are
  not retroactively rejected at sign-in.
- Action history expires after 90 days. Deletion clears related reports/audits,
  rule acceptance and abuse counters. Restriction expiry uses database time.

Modules: `service.py` reports/decisions; `actions.py` enforcement; `policy.py`
acceptance/rate limits; `content.py` text filtering; `visibility.py` read-time
redaction; `public_policy.py` non-secret publishing metadata. Client controls,
actions, rules, public pages and removal merging live in `components/moderation`.

## Public pages and operator configuration

`/privacy`, `/support`, `/terms`, `/community-rules` are public web routes with
English/Nepali text, the shared theme/header and Back navigation. Login and Profile
link to them. Existing `/delete-account` remains available. Appeals use the support
email; there is no promised response deadline or separate appeal queue.

Set the four **public**, non-secret fields in `deploy/policy.env.example`, or the
`policy_environment` provisioning dictionary. Provisioning preserves configured
values and rejects unknown keys/newlines. `/public/policy` exposes only these
publishing fields, never moderator grants or recovery secrets.

The owner confirmed Lfactorial as operator, `prajwal@lfactorial.com` as the monitored
support/appeals inbox, minimum age 18, and no configured database backups. These
are the backend's public defaults and are recorded in `deploy/policy.env.example`.
Explicit environment settings override them; an explicitly empty/incomplete override
keeps the publication warning visible. No secret is needed for these public fields.

Publication still requires deployment. Confirm the infrastructure/provider list and
log retention against deployment before store submission. Update the backup disclosure
when backups are configured. Age disclosure is configurable; a verified-age system
is not implemented.

No live settings, permissions, deployment, commits or pushes were changed. After
configuration/deployment, verify public URLs without login and run physical
Android/iOS acceptance. Push notifications remain deferred.
