# Email verification and password recovery

Recovery is opt-in at deployment and requires PostgreSQL. Migration 30 adds only
queue/rate-limit tables; it does not erase accounts, sessions, games or chat.
Run the normal migration/bootstrap before deploying gateways. Older accounts may
continue signing in without an email. They enroll from Profile → Recovery email
using their current password. There is no recovery path for an account without a
verified email, and no ownership inference or account merge from a claimed address.
Social-only accounts continue using their identity provider.

When enabled, password signup saves an unverified address and queues verification
atomically. Profile supports status, resend/replacement with password proof, and
confirmed removal. Verification does not prevent ordinary gameplay. Forgot password
uses the username; only the verified mailbox receives a reset. Reset revokes every
server session and requires a fresh sign-in. Existing verified addresses remain
active until a replacement is confirmed. Confirmation also invalidates old resets.

## Deployment settings

Use `deploy/recovery.env.example`. Required with `BHIDNE_HO_RECOVERY_ENABLED=1`:

- `BHIDNE_HO_RECOVERY_PUBLIC_ORIGIN`: frontend HTTPS origin, without path/query.
- `BHIDNE_HO_RECOVERY_FROM`: provider-verified sender mailbox.
- `BHIDNE_HO_RECOVERY_SMTP_HOST`, `SMTP_PORT` (same prefix): SMTP endpoint.
- `BHIDNE_HO_RECOVERY_SMTP_TLS`: `starttls` (default, port 587) or `ssl` (465).
- `BHIDNE_HO_RECOVERY_SMTP_USERNAME` and `SMTP_PASSWORD`: provider credentials,
  where required. Supply through the existing secret manager/private runtime env.
- `BHIDNE_HO_RECOVERY_KEYS`: comma-separated Fernet keys, newest first. Generate
  with `python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`
  in a secure administrative shell. All gateways must use the same keys.

The Compose backend workflow accepts optional `BHIDNE_HO_RECOVERY_CONFIG` as a
JSON secret containing the allowlisted environment names and string values; it is
written into the private generated env file without printing values. An absent
secret leaves recovery disabled. For the distributed production rollout, add these
settings to the existing root-owned runtime environment on **each** gateway through
your secret-management process. The provisioning runtime template preserves installed recovery settings on
reruns; an explicit `recovery_environment` mapping can update them. The release process fingerprints that environment and passes it
to the new container. No live settings are created by this change.

Verify the sender domain's SPF/DKIM/DMARC with the chosen provider. Confirm inbox
and spam-folder delivery before enabling publicly. Live provider delivery and
physical iOS/Android testing remain deployment acceptance work. The local SMTP
mode `local` is allowed only for loopback hosts, and HTTP public origins only for
loopback testing. Production SMTP always verifies TLS certificates.

Rate limits use the ASGI client address, never an arbitrary forwarded header.
Configure Uvicorn's trusted proxy allowlist to **only** your reverse proxy addresses;
otherwise proxies share an IP budget, or untrusted forwarding can defeat it.
Retain ingress request/body limits and never log request bodies on recovery routes.

## Delivery and privacy

The challenge table stores SHA-256 token hashes. A separate transactional outbox
stores only encrypted mail envelopes, with a 30-minute verification or 15-minute
reset expiry. Workers claim with a two-minute lease and `SKIP LOCKED`, send outside
SQL transactions in a background thread, then delete envelopes. SMTP errors retry
with capped exponential delays, at most five attempts. Expired/stale/exhausted
payloads and rate buckets are purged in bounded worker batches. After an ambiguous
SMTP timeout or worker crash, duplicate delivery is possible; the link still works
only once. A message already in flight can arrive after removal/replacement, but
its invalidated token cannot change the account.

Reset requests are encrypted and queued for at most ten minutes without looking up
the account on the HTTP path. Unknown, unverified and throttled usernames receive
the same `202 {accepted:true}`. Budgets: 20 reset requests/IP/10 minutes,
5 requests/username/hour, 10 messages/recipient/hour across signups, plus existing
one link/account/purpose/minute and five/hour. Enrollment/consumption endpoints
have 30 requests/IP/10 minutes, and email password proofs allow 10 attempts/account/hour. Rate identities are hashed; verified and pending
emails remain private account data. Tokens, mail bodies, SMTP errors and credentials
are never included in application logs or public issuance responses.

Links carry tokens in URL fragments, which the client removes from browser history
on opening and keeps only in component memory. GET/page loading never consumes a
link: the user presses Verify or submits matching new passwords. Refreshing after
the fragment is removed requires reopening the original email. HTTPS links work in
the web client; native universal/app-link association and physical-device acceptance
are a later release task. Client handlers also recognize the app-scheme fragment.

Rotate keys by first distributing `[new, old]` to all gateways, then waiting for all
old encrypted requests/outbox records to expire and be cleaned before removing the
old key. A lost key cannot recover its queued envelopes; retain it until cleanup or
explicitly discard those requests and ask users to request new links. Disabling
recovery pauses delivery and maintenance; expired envelopes remain encrypted until
workers resume. Database backup expiry must include these private records.

Monitor the generic `Recovery delivery failed`/`Recovery worker cycle failed` logs
and counts/oldest age in queue tables without selecting envelopes into logs. There
is no SMTP receipt/delivery webhook or dedicated queue dashboard in this increment.


## Local verification

Run the SQL/API tests with `PGLITE_MODULE` configured:
`python -m pytest -q tests/test_account_recovery.py tests/test_signup_email.py tests/test_recovery_delivery.py tests/test_distributed_platform.py`.
Independent connection tests use `POSTGRES_TEST_BIN` pointing at a local PostgreSQL
bin directory: `python -m pytest -q tests/test_account_recovery_concurrency.py tests/test_recovery_delivery_concurrency.py`.

For browser acceptance, export the frontend with
`EXPO_PUBLIC_API_URL=http://127.0.0.1:8197 EXPO_PUBLIC_RUNTIME_MODE=legacy npm --prefix client run build:web`.
Then set `RECOVERY_BROWSER=1`, `POSTGRES_TEST_BIN` and `PLAYWRIGHT_MODULE` and run
`python -m pytest -q -s tests/test_recovery_browser.py`. This launcher starts and
stops disposable PostgreSQL and a local server, captures mail in a private temporary
file, and deletes captured credentials afterwards. No external SMTP is contacted.

## Production key preparation for the current branch

The user selected the current `bhidne-ho-scalability-prod` branch's production
target and created a Resend key named `bhidne-ho-prod`. Domain
`notify.lfactorial.com` is verified (user-confirmed after public DNS checks).
The intended sender is `accounts@notify.lfactorial.com` and frontend origin is
`https://prod.bhidne-ho.lfactorial.com`.

From the repository root, run:

```sh
.venv/bin/python deploy/recovery/configure-secrets.py
```

Paste the key only at the hidden terminal prompt. This creates an owner-readable/
writable, Git-ignored `deploy/provision/recovery.local.yml` containing the Resend
settings and a generated encryption key. Reruns preserve the existing encryption
key. It uses STARTTLS on Resend port 2587; connectivity from both production hosts
still requires verification. Keep this file private and back up the encryption key
securely. This helper does not install settings on hosts, deploy, or send mail.
The production settings have now been installed on both application hosts without
restarting containers. The provisioning template preserves installed recovery
settings; administrators can also supply `-e @deploy/provision/recovery.local.yml`
to apps.yml to update them. The separate test workflow's JSON secret does not
configure this production branch.

## Forgot username

Sign-in now offers **Forgot username?** alongside Forgot password. The email-entry
form calls `POST /auth/recovery/username/request` with `{email}`. Valid known,
unknown, unverified and throttled addresses receive the same `202 {accepted:true}`.
The HTTP handler performs no account lookup; encrypted requests use the existing
background request queue. Only exact normalized verified recovery addresses match
(trim outer spaces/lowercase domain; preserve the mailbox's local-part case).

The worker sends one reminder listing the currently verified password-account
usernames for that email. It rechecks the contact associations immediately before
sending, excludes pending signup/replacement addresses, and never includes a
password, login token or reset link. SMTP already in flight cannot be recalled.
The reminder uses the existing encrypted outbox, leases, five-attempt retry limit
and recipient budget. Request limits are one/minute and five/hour per email,
sharing the 20/IP/10-minute ingress budget with password-reset requests. Reminder
jobs expire after ten minutes. Passwords and sessions are not changed.

Migration 31 extends the mail-purpose constraint, permits tokenless username
reminders and indexes verified email lookup; existing accounts, sessions and queued
verification/reset messages are preserved. Apply migration 31 before the new
backend; complete both gateway upgrades before exposing the updated client, since
old workers do not understand username reminders. No database reset is required.
