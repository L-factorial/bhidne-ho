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

References: [Expo TestFlight wizard](https://docs.expo.dev/build-reference/npx-testflight/)
and [TestFlight distribution](https://docs.expo.dev/submit/testflight/).
