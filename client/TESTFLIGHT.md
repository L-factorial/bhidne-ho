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

References: [Expo TestFlight wizard](https://docs.expo.dev/build-reference/npx-testflight/)
and [TestFlight distribution](https://docs.expo.dev/submit/testflight/).
