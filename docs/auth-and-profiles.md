# Authentication and profile persistence

Authentication and profiles are durable when `DATABASE_URL` is set. Without it,
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

The existing `user-<uuid>` public IDs remain unchanged. Rooms and active games are
still memory-resident and require one backend worker; database persistence in this
milestone covers identity, credentials, sessions, and profiles only.

## Local container deployment

Create a private deployment environment file (do not commit it):

```sh
printf 'POSTGRES_PASSWORD=replace-with-a-long-random-value\n' > deploy/.env
docker compose --env-file deploy/.env \
  -f deploy/compose.yaml -f deploy/compose.postgres.yaml up --build
```

PostgreSQL is reachable only on the Compose network and stores its files in the
`postgres-data` named volume. The backend waits for the database health check.
Running only `deploy/compose.yaml` does not start PostgreSQL or set `DATABASE_URL`;
that is the safe, in-memory mode used by the current automatic test deployment.

## Moving PostgreSQL out of Docker

Provision PostgreSQL with TLS, backups, and a least-privilege application user, then
set `DATABASE_URL` to the provider URL and remove the `postgres` service plus the
backend `depends_on` entry. No Python code or image change is needed. For example:

```text
postgresql://bhidne_app:password@managed-host:5432/bhidne_ho?sslmode=require
```

The startup schema is intentionally idempotent for this first milestone. Before the
first schema evolution, adopt versioned migrations (for example Alembic) and run them
as a release step rather than granting the runtime user schema-changing privileges.

## Next security increments

Add sign-out and all-session revocation endpoints, periodic expired-session cleanup,
login rate limiting, password reset/email verification, and account conversion for
guests. Provider account linking must require fresh proof for both identities.

See [Social sign-in](social-auth.md) for provider setup and the client contract.
