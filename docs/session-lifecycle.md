# Session persistence and logout acceptance

The client retains the existing per-origin session key and saved-session format.
Web sessions remain per tab; native uses the existing SecureStore adapter and
WHEN_UNLOCKED_THIS_DEVICE_ONLY protection. This increment needs no schema change.

## Implemented behavior

- The latest in-process login or logout takes precedence over older persisted data
  if a storage write fails. Logout records an in-memory cleared state immediately.
- Saved room navigation contains only ID/name, not member/profile caches. Restoring
  the older format discards those caches before reconnecting to authoritative data.
- Storage read/write/clear failures produce English/Nepali notices. Retry saves or
  removes the latest session after storage becomes available; it never restores the
  previous account's value. Read failure requires reopening or signing in again.
- Online logout requests revocation of the captured token and immediately disconnects
  local account state. HTTP 401 counts as already revoked. Network/server failure
  produces a local-only logout notice; no background revocation retry retains tokens.
- If storage removal AND server revocation fail, the prior saved token can survive
  an app restart. The notices explicitly explain both limitations; Retry handles
  storage removal. Password reset or server expiry invalidates an outstanding token.
- Expired/revoked sessions return to sign-in and clear account views/password fields.
  Late room responses and logout failures cannot overwrite a newer login.
- Account-specific distributed command journals retain uncertain commands under
  their existing owner identity. They are not transferred to a different account.

## Local verification

- `node --experimental-strip-types --test client/tests/session-lifecycle.test.mjs
  client/tests/journal-owner.test.mjs client/tests/distributed-session.test.mjs
  client/tests/command-journal.test.mjs`: 61 passed.
- Localization tests: four passed. TypeScript and Expo web export passed.
- `RECOVERY_BROWSER=1` plus the documented local PostgreSQL/Playwright paths runs
  `tests/test_recovery_browser.py`: recovery and session browser flows passed.
  The session flow covers reload, external revocation, online/offline logout,
  switching accounts, failed saves/removals and Retry. Mail is captured locally.

## Physical-device acceptance still required

- [ ] iOS and Android: sign in, force-close, reopen, verify the correct account.
- [ ] Upgrade an installed build without clearing app data; restore the old session.
- [ ] Lock/unlock the device, simulate unavailable secure storage, verify notices/Retry.
- [ ] Logout online; confirm the old token no longer accesses authenticated routes.
- [ ] Logout offline; confirm local login is cleared and the server warning appears.
- [ ] Revoke/reset from another device, foreground this app, verify return to sign-in.
- [ ] Switch A → B with room/chat requests in flight; check no A data appears for B.
- [ ] Check keyboard, safe areas, accessibility and notices in English/Nepali.

No native upgrade, keychain failure or physical-device test is claimed by the browser
checks. Real provider login and native recovery-link acceptance remain separate A2 work.
