# Facebook, Google, and Apple sign-in implementation plan

Status: browser sign-in increment implemented; see [current setup](social-login-setup.md).
The implementation uses browser code exchange across platforms. Native identity
SDKs, linking and deletion below remain planned. Assumes integration means sign-in
for the existing Expo web, iOS, and Android clients, not social posting or contacts.

## Existing foundation

- `app/social_auth` already verifies Google/Apple ID tokens and Facebook Graph
  access tokens, exposes provider discovery and login routes, and issues ordinary
  application sessions.
- `external_identities` already maps `(provider, provider_subject)` to a user.
  Email is metadata; matching emails must never silently merge accounts.
- `client/src/screens/WelcomeScreen.tsx` has disabled provider buttons.
- `client/src/multiplayer/useRoomSession.ts` and `session.ts` own current client
  authentication/session behavior. Extend or extract these into shared auth
  ownership so the welcome screen and rooms cannot hold conflicting sessions.
- The current verifier accepts an optional caller-supplied nonce, fetches JWKs
  on every login, and has no server-owned, single-use login attempt. Facebook
  currently has no Limited Login JWT path. These are implementation gaps.

## Product and interface design

Keep the existing welcome layout and offer “Continue with Google”, “Continue with
Apple”, and “Continue with Facebook” using each provider's approved button assets
and accessibility labels. Keep account/password login available.

Enable a button only when backend configuration, a release flag, and the local
platform adapter all support it. Hide unavailable production providers; development
builds may show a disabled control with a configuration explanation. Provider
discovery must expose public capabilities only, never secrets.

One tap starts authentication. Show progress on that button and prevent simultaneous
attempts. Cancellation returns quietly to the welcome screen. Distinguish retryable
network/provider outages from rejected credentials; preserve the original room or
invitation destination through successful login. First login offers display-name
completion; returning login goes directly to the intended destination. Missing
email and Apple's private relay email must both work.

Account settings will list connected providers and offer connect/disconnect,
sign-out, and account deletion. Connecting requires recent proof of the current
account and the new provider. Never merge another existing account automatically;
show an identity-in-use message. Prevent removal of the last usable login method.

## Provider adapters

| Provider | Web | iOS | Android | Backend work |
| --- | --- | --- | --- | --- |
| Google | Google Identity Services | Native Google sign-in | Native Google sign-in | Reuse JWT verification; bind attempt and expected audience; cache keys |
| Apple | Services ID browser flow | Native Apple authentication | Services ID browser flow | Add code exchange, callback handling, revocation support |
| Facebook | Facebook web login | Limited Login | Native Facebook login | Separate JWT and Graph access-token verification |

Use platform-specific files behind a common adapter interface: availability,
start, completion, and cancellation. Proposed client modules live under
`client/src/auth/`, with a shared session owner and provider-specific `.web.ts`
and native implementations. SDK objects and credentials never enter game code.

Expo recommends native Google and Facebook integration libraries in its
[authentication guide](https://docs.expo.dev/guides/using-authentication/).
Select exact versions only after checking compatibility with the installed Expo 57
and React Native versions; use native development builds for end-to-end validation.
Read the [Expo 57 reference](https://docs.expo.dev/versions/v57.0.0/) before client
implementation. Apple native support and browser support are separate adapters.

Facebook Limited Login returns an identity token with nonce handling, requiring
a separate path from Graph access tokens; see the
[Firebase integration documentation](https://firebase.google.com/docs/auth/ios/facebook-login).
Confirm exact issuer, key endpoint, and nonce transformation against the selected
Facebook SDK before coding. Meta's documentation returned HTTP 429 during planning.

## Authentication protocol

1. Add `POST /auth/social/{provider}/attempts`: create a short-lived attempt bound
   to provider, platform/client registration, purpose (`login` or `link`), and an
   initiating-client secret. Store only its secret hash. Generate nonce/state
   server-side; keep attempts in shared persistent storage with expiry.
2. Launch the approved SDK or browser flow. For supported authorization-code
   flows, use PKCE. Apply each SDK's documented nonce encoding/hashing exactly.
   For adapters without nonce support, use the provider's documented code/CSRF
   binding rather than pretending an optional nonce protects the flow.
3. Extend completion with a strict credential-kind discriminator (`id_token`,
   `access_token`, or `authorization_code`), attempt ID, and possession proof.
   Do not infer token type from token contents. Accept only registered combinations.
4. Verify provider proof, expected audience/issuer, signature, expiry and subject.
   Validate nonce/state against server-owned values, not another value supplied
   with the token. Code exchange must use the exact registered redirect URI.
5. Atomically consume the attempt and create/resolve the identity and application
   session. Concurrent callbacks must not create duplicate users or sessions.
   Reject reused/expired attempts; a lost completion response starts a fresh login.
6. Native/JS completions return the existing application session shape. Browser
   callbacks use a short-lived, single-use handoff code bound to the initiating
   client; never put provider or application bearer tokens in redirect URLs.

Add server callback routes where browser provider flows require them, including
Apple form POST handling. Allowlist redirect destinations and validate state;
account for cross-site POST cookie behavior instead of relying on a Lax cookie
alone. Retire the unbound legacy completion path before public enablement.

Cache JWKs with bounded lifetime and a controlled refresh on unknown key IDs.
Distinguish upstream outages from invalid credentials. Add rate limits to attempt,
completion, and linking routes, with redacted structured errors and `no-store`
headers on success and failure. Pin a supported Facebook Graph API version at
implementation time. Validate required Facebook subject/type/expiry fields.
Google's [verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
supports subject-based identity, audience verification, and caching rotating keys.

## Session, data, and account lifecycle

Reuse internal user IDs, profiles, room access and game authentication. Add a
numbered migration for login attempts and any lifecycle metadata; keep unique
provider-subject constraints and exercise concurrent creation in PostgreSQL.

Store native application sessions in secure platform storage. Preserve the
existing per-tab web session behavior for this increment, documenting its XSS
exposure and applying CSP/log redaction; a cookie-session migration is separate
because HTTP and WebSocket authentication must change together. Never persist
provider credentials in client storage.

Add server session revocation for sign-out and clear local credentials/socket
state. Deletion revokes all sessions, disconnects sockets, and removes or anonymizes
owned data under an explicit retention policy. Define treatment of active tables,
friendships, messages and durable game history before enabling deletion.

Apple requires a deliberate token-revocation path. Exchange the authorization
code server-side and retain only the revocation material needed, encrypted under
a managed key, in a separate restricted table. This is an explicit change to the
current “no provider-token persistence” policy; do not store raw tokens in
`external_identities` or `auth_sessions`. Delete the material after revocation,
with an idempotent retry job for transient failures. Handle provider revocation
notifications with authenticated validation. See Apple's
[account deletion and token revocation guidance](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).

## Delivery sequence and acceptance gates

1. **Registration and contract:** inventory production/staging domains, bundle/package
   IDs, signing fingerprints, callback URLs, and provider console access. Register
   separate environment credentials; define adapter token/nonce behavior and
   capabilities. Deliver a configuration matrix with no secret values.
2. **Backend foundation:** attempts, callback/handoff exchange, verifier hardening,
   Facebook Limited Login, migrations, rate limiting, and revocation primitives.
   Gate: rejection and concurrency tests pass with providers still disabled.
3. **Shared client integration and Google:** consolidate session ownership, add
   secure native storage, capability discovery, adapter and UI states; implement
   Google across web/iOS/Android. Gate: first and returning login preserve the same
   user/profile and can join a room after restart.
4. **Apple:** native iOS and browser web/Android flow; initial-name handling,
   private relay, code exchange and revocation. Gate: repeat authorization without
   name/email, cancellation and account deletion all pass on real devices.
5. **Facebook:** web/Android access tokens and iOS Limited Login; minimal scopes
   and no dependency on email availability. Gate: each token kind is accepted only
   by its intended verifier and all enabled platforms pass real-provider testing.
6. **Account settings and release:** explicit linking/unlinking, deletion UX,
   real Terms/Privacy pages, required provider configuration/review and deletion
   callbacks. Roll out per provider/platform/environment behind flags. A rollback
   stops new provider logins without invalidating existing application sessions.

Tests must cover wrong signature/issuer/audience, expired tokens, missing subject,
nonce/state mismatch, replay, cross-client handoff theft, disallowed redirects,
key rotation, outages, duplicate callbacks, identity conflicts, linking races,
last-method removal, deletion retries, and existing password authentication.
Use the existing social-auth tests plus PostgreSQL integration tests; run client
typecheck/web export and native development-build checks. Exercise popup blocking,
deep links, interrupted flows, session restoration, and real provider test users.
Measure success/cancellation/error rates and callback latency by provider/platform
without recording credentials or personal profile details.

Provider console registrations and real-device credentials are external release
dependencies. Implementation can start with the backend contracts, fixtures and
shared client architecture while those are prepared. This plan does not configure
provider consoles, install SDKs, or enable sign-in.
