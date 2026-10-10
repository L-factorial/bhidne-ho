# Authentication and profile persistence

Authentication and profiles are durable when `BHIDNE_HO_DATABASE_URL` is set. Without it,
the application retains its in-memory implementation for tests and disposable local
runs. The application only knows a PostgreSQL connection URL; Docker is not part of
the persistence API.

## Data ownership

- `users` owns stable identities and distinguishes guest and account identities.
- `account_credentials` owns normalized usernames and scrypt password hashes. Plain
  passwords are never stored.
- `auth_sessions` stores only SHA-256 hashes of random bearer tokens. Sessions expire
  after 30 days and can be revoked without changing the user identity.
- `user_profiles` is keyed by user ID, not by session, so a profile follows an account
  across sign-ins and token rotation.
- `external_identities` maps provider subjects to internal users. Email is metadata,
  not an identity key, so matching emails are never silently linked.
- `friendships` and `direct_messages` own durable player relationships and private
  conversation history; see [Players, friends, and direct messages](players-friends-chat.md).

The existing `user-<uuid>` public IDs remain unchanged. Room metadata and
player-room membership are durable; connected presence, tables, and active games
remain memory-resident. See [Social room feed and room visibility](social-room-feed.md).

## Local container deployment

Create a private deployment environment file (do not commit it):

```sh
printf 'POSTGRES_PASSWORD=replace-with-a-long-random-value\n' > deploy/.env
printf 'BHIDNE_HO_DATABASE_URL=postgresql://bhidne_ho_test:replace-with-a-long-random-value@postgres:5432/bhidne_ho_test\n' >> deploy/.env
docker compose --env-file deploy/.env -f deploy/compose.yaml up --build
```

PostgreSQL is reachable only on the Compose network and stores its files in the
`bhidne-ho-test-postgres-data` named volume. The backend waits for the database
health check. Outside this stack, leaving `BHIDNE_HO_DATABASE_URL` and the legacy
`DATABASE_URL` unset selects the in-memory development implementation.

## GitHub test environment

The backend workflow targets the GitHub environment `test` and consumes this
environment-scoped Actions secret:

```text
BHIDNE_HO_POSTGRES_PASSWORD
```

Generate a URL-safe value with `openssl rand -hex 32`. Do not commit the value or
place it in a repository-level variable. The workflow writes it to a mode-0600
release `.env`, includes that file in the encrypted SSH upload, and never prints it.

## Moving PostgreSQL out of Docker

Provision PostgreSQL with TLS, backups, and a least-privilege application user, then
set `BHIDNE_HO_DATABASE_URL` to the provider URL and remove the `postgres` service plus the
backend `depends_on` entry. No Python code or image change is needed. For example:

```text
postgresql://bhidne_app:password@managed-host:5432/bhidne_ho?sslmode=require
```

Schema changes are installed through the application's append-only numbered
migrations under a PostgreSQL advisory lock. A later deployment hardening step may
move migration execution into a separate release command so the runtime database
role no longer needs schema-changing privileges.

## Next security increments

New password-account signup requires `email` along with `username` and `password`,
and explicit acceptance of the community rules. Both signup forms show an unchecked
“I agree to the community rules” checkbox with a link to read them. The API requires
`community_rules_version` matching the current rules version (`2026-10-01`);
missing or stale acceptance fails validation before account creation. PostgreSQL
saves acceptance in the same transaction as the account and session, making new
accounts immediately eligible for chat and invitations under the other policy checks.
Existing accounts continue to accept rules through Profile. Older clients that omit
the acceptance field can sign in but must update before creating an account.
The original client also requires profile name and matching password confirmation.
The API rejects missing, blank and malformed email. Sign-in remains username/password
only, including for existing accounts without email; social/guest login is unchanged.

Migration 29 adds nullable `account_credentials.unverified_email` without backfilling
or deleting existing data. Signup saves the normalized address in the same transaction
as credentials/profile/session creation. It is private account metadata, not a profile
field, and does not establish mailbox ownership. Only the existing verification
protocol writes `account_recovery_contacts`; successful verification clears the
unverified signup address. Matching emails do not merge accounts.

The internal `sign_up(..., email=None)` default is retained for trusted legacy-data
fixtures/imports. The HTTP signup model always requires and supplies a valid email.
When deployment enables email recovery, signup atomically queues a verification
email. Public verification/reset screens and Profile → Recovery email settings are
implemented. Recovery stays disabled without configured SMTP/encryption settings;
the in-memory runtime cannot enable delivery and retains signup email until restart.

Deployment must apply migrations 28/29/30 and release both gateways plus the updated
client together. Older clients that omit email can still sign in but receive 422 on
new signup. Do not reset PostgreSQL or remove its storage volume for these migrations.

Single-session sign-out is implemented at `POST /auth/signout`. Add an all-session
revocation endpoint, periodic expired-session cleanup, shared login rate limiting,
and account conversion for guests. Provider account linking must require fresh
proof for both identities.

The internal PostgreSQL recovery service and migration 28 now implement verified
recovery email enrollment and atomic password reset with all-session revocation.
Public routes now use encrypted durable mail delivery, shared ingress limits and
localized client screens. See [Account recovery](account-recovery.md) for deployment,
privacy, delivery semantics and outstanding live-provider/device acceptance.

See [Social sign-in](social-auth.md) for provider setup and the client contract.

## Fixed appearance

The current client has one Nepali design: cream lobby and room pages, burgundy
controls, and felt game tables. Appearance settings and light/dark/system switches
have been removed from profile, welcome, and game menus. Device settings and old
local or profile appearance selections do not affect rendering. The client makes
no requests to the appearance endpoint and has no preference-sync timers.

The authenticated `GET /me/profile/appearance` and `PATCH /me/profile/appearance`
endpoints and migration 11 columns remain for compatibility with older installed
clients. Their supported values and ownership checks are unchanged; no saved
profile data is deleted by this UI change.

Validation: `node --test client/tests/theme.test.mjs` checks contrast for the fixed
palette. `client/tests/browser/appearance-profile.cjs` verifies that old cached and
server preferences and device color settings are ignored, selectors are absent,
and the client makes no appearance requests.

## Room deletion and retained history

Room deletion writes a `deleted_rooms` tombstone and removes memberships in one
transaction. The PostgreSQL room row remains because game journals, completed
results, and settlement records reference it with restrictive foreign keys. Live
catalog queries and entry checks exclude tombstoned rooms, including after restart;
deleting a room does not cascade through game or financial history. This uses the
existing tombstone table and requires no new migration.

Deletion is serialized with table creation and rechecks that all tables have ended.
The durable deletion completes before hosted tables are discarded or members receive
`ROOM_DELETED`. If persistence fails, the room remains available for retry. The client
preserves HTTP error status and shows a readable message for non-JSON failures.
