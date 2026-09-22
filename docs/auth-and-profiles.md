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

Add sign-out and all-session revocation endpoints, periodic expired-session cleanup,
login rate limiting, password reset/email verification, and account conversion for
guests. Provider account linking must require fresh proof for both identities.

See [Social sign-in](social-auth.md) for provider setup and the client contract.

## Appearance preferences

Profile → Appearance offers Heritage, Himalayan, and Community Courtyard palettes,
each with Light, Dark, and Follow device modes. New profiles use Heritage / Follow
device. Nepali scenery is decorative; names, codes, settlement amounts, and controls
stay on readable solid surfaces. Playing card faces remain light in every palette.

Authenticated `GET /me/profile/appearance` and `PATCH /me/profile/appearance` read and
replace `{ "theme": "heritage", "mode": "system" }` for the current user only. Supported
family values are `heritage`, `himalayan`, and `courtyard`; mode values are `system`,
`light`, and `dark`. Migration 11 adds constrained columns to `user_profiles`; changing
a display name does not change appearance, and changing appearance does not change
the name. With PostgreSQL configured, selections survive backend restarts.

The client caches preferences using AsyncStorage on native and web, separately per
API server and account, and keeps the most recent appearance for the signed-out
welcome screen. Web loads cached colors synchronously; native waits for the cache
before rendering screens. Signing in restores that account's profile. Unsynced local
changes survive restarts and retry every 15 seconds and when the app returns to the
foreground (or the browser comes online). Pending local edits win over a fetched
profile; saves are serialized so rapid choices cannot finish in reverse order.
The profile shows whether preferences are saving, saved, or awaiting sync.

Validation: `node --test client/tests/theme.test.mjs` checks all six palettes;
`tests/test_player_profiles.py` checks ownership and persistence across sessions;
`client/tests/browser/appearance-profile.cjs` covers reloads, fresh-device restoration,
offline retry, rapid changes, system mode, and account isolation against a local app.

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
