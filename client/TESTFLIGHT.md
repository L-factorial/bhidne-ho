# First TestFlight upload

Run these commands from `client/`, using Node.js 22.13 or newer:

```sh
npx eas-cli@latest login
npx testflight
```

Enter passwords and Apple two-factor codes only in the local terminal prompts.
Apple Developer Program enrollment must be paid and approved. The wizard links
the app to your Expo account, asks for the iOS bundle identifier, manages signing,
and builds and submits the app to App Store Connect. Choose a permanent unique
identifier, for example `com.lfactorial.bhidneho` if that namespace is yours.
Keep the generated EAS project ID and bundle identifier in `app.json` for later builds.

The `production` profile in `eas.json` uses the same API, website, and
`distributed-original` runtime as `scripts/build-production.mjs`. Build numbers
are managed remotely and incremented for subsequent uploads.

Native launcher artwork is still pending: the supplied icons are small and
non-square. Supply an opaque 1024 × 1024 PNG and configure `expo.ios.icon` in
`app.json` before the first upload. See `assets/branding/README.md`.

After Apple processes the upload, open the app in App Store Connect → TestFlight,
complete any required export-compliance information, and add the build to a tester
group. Internal testers must be App Store Connect users; external testers may
require Apple's beta review. Install TestFlight on the iPhone and accept the invite.

Verification before uploading:

```sh
npm run typecheck
EXPO_PUBLIC_API_URL=https://api.prod.bhidne-ho.lfactorial.com EXPO_PUBLIC_WEB_URL=https://prod.bhidne-ho.lfactorial.com EXPO_PUBLIC_RUNTIME_MODE=distributed-original npx expo export --platform ios --output-dir /tmp/bhidne-ho-ios-export
```

An export checks JavaScript bundling; the EAS build still needs to verify native
compilation and signing. On the installed build, check sign-in, room/game joining,
reconnection, sound, and social-login return links.

## Game dialog dismissal regression

The native game dialog cleanup change requires a **new iOS/TestFlight build**.
Pushing the frontend or updating the backend cannot change the installed build 3.

On two phones, verify the following with the updated build:

1. Create a Call Break table, join from the other phone, and keep two seats empty.
   Open the table menu, cancel an end confirmation, then end for everyone. The
   room's member/chat controls must remain tappable, and another table must open.
2. End remotely while the other phone has its table menu, chat draft, theme
   picker, or confirmation open. Both phones must return to usable room controls.
3. Back out to the room and reenter repeatedly. Old menus/confirmations must not
   reopen. Repeat the end flow in Flush and Marriage. Check dialog scrolling,
   keyboard input, language menus, VoiceOver and Android Back if available.

Local fixture checks (all data intercepted; no production game mutations):

```sh
# Serve a legacy web export at the same TEST_WEB_URL/API origin.
TEST_WEB_URL=http://127.0.0.1:8099 node tests/browser/game-modal-ending.cjs
# Registry behavior is part of the ordinary Node test suite.
node --experimental-strip-types --test tests/game-modal-layers.test.mjs
# Optional React lifecycle harness, with matching tools outside project dependencies.
npm install --prefix /private/tmp/bhidne-native-modal-tests --no-audit --no-fund react@19.2.3 react-test-renderer@19.2.3
TEST_REACT_TOOLS=/private/tmp/bhidne-native-modal-tests node --test tests/native-game-modal.cjs
```

The lifecycle harness models the iOS Modal boundary; it does not exercise UIKit.
Browser checks and successful bundling do not replace the two-phone retest.

## Room and profile dismissal regression

Room/profile dismissal cleanup also requires a **new TestFlight build** created
after these client changes. Existing builds cannot receive it through backend
deployment.

Use a disposable room/account for deletion checks:

1. In Room Options, open Delete room and cancel. Reopen and confirm deletion.
   The sheet must close and the lobby must respond to Home/Profile/room creation.
2. From the lobby's room card, cancel its Delete/Leave confirmation, then confirm.
   The card must disappear after success and other room controls must respond.
3. Open Profile from both the lobby and a room. Check display-name editing,
   Back/reopening, Privacy/Back and Delete account/Back. Opening deletion or
   backing out must not itself delete the account.
4. On the disposable account, verify the password/DELETE prerequisites, rejected
   proof/retry and successful deletion/status/Back. Also test Profile sign-out
   from both entry points. The following screen must remain tappable.

The local fixture suite verifies canceled/failed/retried room deletion, profile
editing/policy navigation, account proof failure/success and sign-out. Every API
and WebSocket request is intercepted; no real data is deleted. Serve a web export
configured with `EXPO_PUBLIC_RUNTIME_MODE=legacy` and matching localhost API/web
URLs, then run:

```sh
# If Playwright is not installed, keep browser tools outside project dependencies.
npm install --prefix /private/tmp/bhidne-deletion-browser-tools --no-audit --no-fund playwright
PLAYWRIGHT_MODULE=/private/tmp/bhidne-deletion-browser-tools/node_modules/playwright TEST_WEB_URL=http://127.0.0.1:8101 node tests/browser/deletion-dismissal.cjs
TEST_REACT_TOOLS=/private/tmp/bhidne-native-modal-tests node --test tests/native-deletion-dismissal.cjs tests/native-game-modal.cjs
```

The React tests use the same temporary matching React tools described above.
They verify iOS dismissal ordering, duplicate taps, cancellation and failure
recovery with a mocked Modal boundary. UIKit and signed native builds still
require physical-device testing.

References: [Expo TestFlight wizard](https://docs.expo.dev/build-reference/npx-testflight/)
and [TestFlight distribution](https://docs.expo.dev/submit/testflight/).

## Socket retention and event-driven fallback polling — 2026-10-03

The distributed-original client now retains its authenticated socket across room,
table and chat selection changes. Foreground/online recovery checks PING/PONG and
refreshes state rather than unconditionally restarting the connection. Stream
recovery has separate game/chat updating notices. Successful authoritative reads
reset the active game's fallback poll for 30 seconds; command and failed-read
retries keep their separate schedule. HTTP and WebSocket contracts are unchanged.

Local verification: TypeScript and 330 frontend tests passed. Intercepted Chrome
checks verified one socket across initial room/table selection and online recovery,
a near-deadline game event canceling the old fallback poll, fallback resuming after
30 seconds without updates, isolated chat recovery without reconnecting gameplay,
and genuine socket close followed by one replacement and restored subscriptions.
Local distributed web export and production-configured iOS Hermes export passed.

Reproduce the intercepted browser test with a localhost distributed-original web
build (API and web URL matching that localhost), served on port 8102 by default:

```sh
.venv/bin/python tests/export_distributed_views.py /private/tmp/socket-browser-views
PLAYWRIGHT_MODULE=/path/to/playwright node client/tests/browser/distributed-connection.cjs
```

All API/WebSocket calls are fixtures. Set `TEST_WEB_URL` and `VIEW_FIXTURES` for
other local paths. The test asserts a localhost target and never writes production
rooms, accounts or commands.

On a fresh native build, check iOS and Android with two players:

- Switch rooms/tables and open/close chat; the healthy connection should remain.
- Background for a few seconds and then for more than a minute; verify recovery
  checks the socket, restoring it only if suspension actually dropped it.
- Wait at least two minutes for a move; updates must arrive promptly and fallback
  checks must continue thirty seconds after successful game refreshes.
- Toggle airplane mode during an unresolved move; after recovery, verify its
  original command resolves once and both players agree on state.
- During a reported reconnect, inspect the runtime's bounded
  `root.connectionDiagnostics` (cause, timestamp, close code/reason/clean flag).
  Chat/discovery errors should not produce a socket-close entry. Server auth and
  invalid protocol/ACK protections still intentionally close real connections.

No signed native build, physical-device acceptance, TestFlight upload or deployment
was performed. A Hermes export verifies bundling, not native suspension behavior.
