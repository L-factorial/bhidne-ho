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
