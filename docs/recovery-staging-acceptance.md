# A2 staging email activation and acceptance

Status: activation authorized; awaiting the email provider, verified sender and
securely configured credentials. Real email delivery has not been tested.

## Target and prerequisites

The existing test environment uses frontend `https://bhidne-ho.lfactorial.com`
and API `https://api-bhidne-ho.lfactorial.com`. Its workflows deploy from `main`.
The `bhidne-ho-scalability-prod` branch uses the separate production workflow;
pushing this branch is not a staging rollout. Prepare/review the recovery changes
for the intended test release before triggering either workflow.

Before activation, record the chosen provider, verified sender, SMTP host/port/TLS
mode and a consenting tester's mailbox. Obtain the provider's exact DNS verification
records; do not invent SPF/DKIM records or replace existing domain records blindly.
Keep SMTP credentials and encryption keys in private configuration, not this document.

Configure the GitHub Actions **test environment** secret
`BHIDNE_HO_RECOVERY_CONFIG` with a JSON object of string values:

| Setting | Staging value |
| --- | --- |
| `BHIDNE_HO_RECOVERY_ENABLED` | `1` after prerequisites are ready |
| `BHIDNE_HO_RECOVERY_PUBLIC_ORIGIN` | `https://bhidne-ho.lfactorial.com` |
| `BHIDNE_HO_RECOVERY_FROM` | Provider-verified sender; pending |
| `BHIDNE_HO_RECOVERY_SMTP_HOST` | Provider endpoint; pending |
| `BHIDNE_HO_RECOVERY_SMTP_PORT` | Provider port, usually `587` or `465` |
| `BHIDNE_HO_RECOVERY_SMTP_TLS` | Provider-supported `starttls` or `ssl` |
| `BHIDNE_HO_RECOVERY_SMTP_USERNAME` | Private provider credential |
| `BHIDNE_HO_RECOVERY_SMTP_PASSWORD` | Private provider credential |
| `BHIDNE_HO_RECOVERY_KEYS` | Dedicated staging Fernet key; retain across deployments |

See [account recovery](account-recovery.md) for key generation and rotation.
Do not generate a replacement key on every release. Do not use production keys
or production player accounts for this acceptance run.

## Rollout and acceptance record

- [ ] Provider/sender verified; DNS authentication complete.
- [ ] Private test-environment configuration installed.
- [ ] Recovery code reviewed and included in the staging release.
- [ ] Normal migrations applied, including additive migration 30; existing storage retained.
- [ ] Updated backend and frontend deployed to the matching test environment.
- [ ] Health responds successfully and `/auth/recovery/capabilities` reports enabled.
- [ ] Existing test account still signs in and its saved profile remains intact.
- [ ] Fresh tester signup sends a real verification email; inspect inbox and spam.
- [ ] Link opens the test frontend; opening alone does not verify the mailbox.
- [ ] Verify succeeds; repeat use is rejected; Profile shows the verified address.
- [ ] Forgot password sends a reset link to that verified mailbox.
- [ ] Unknown and unverified usernames receive the same public accepted response.
- [ ] Reset rejects mismatched passwords in the client, then succeeds with matching ones.
- [ ] Old password fails, existing sessions lose authenticated access, new password signs in.
- [ ] Replacement email requires current password and verification before replacing the old contact.
- [ ] Removal requires current password and confirmation; invalidated links no longer work.
- [ ] Expired verification/reset links are rejected and a fresh request works.
- [ ] Proxy trust is configured for the actual ingress; rate limits behave as intended.
- [ ] Delivery queue drains without persistent retry failures; no secrets/mail bodies in logs.

Record release identifiers, test time, pass/fail and non-sensitive failure details.
Do not paste live links, tokens, passwords or message bodies into the repository.
If delivery fails, inspect provider delivery status and generic worker errors, then
correct configuration. Do not erase PostgreSQL to retry. Disabling recovery pauses
worker delivery/cleanup; it does not delete accounts or roll back migrations.

Physical-device session/link tests and real Google/Facebook/Apple login acceptance
remain subsequent A2 work. Passing this checklist does not complete those checks.
