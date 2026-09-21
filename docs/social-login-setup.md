# Configure Google, Apple, and Facebook sign-in

The welcome and room sign-in screens now support browser authorization for all
three providers. Providers remain hidden until credentials and an explicit enable
flag are configured. Password sign-in works independently.

Web redirects in the initiating tab. Native development/production builds use
Expo's system authentication browser and `bhidneho://auth`; rebuild after installing
the new plugins. Expo Go is not the target for this custom-scheme flow. Native
sessions/pending proofs use SecureStore; web credentials use per-tab sessionStorage.

This increment uses server-side authorization-code exchange across platforms.
Facebook browser login returns a Graph access token. Native provider SDKs, including
Facebook Limited Login JWTs, are separate future adapters.

## Settings and provider registration

Copy [deploy/social.env.example](../deploy/social.env.example) into your private
deployment environment. Never put secrets in `EXPO_PUBLIC_` variables.

| Setting | Value |
| --- | --- |
| `BHIDNE_HO_SOCIAL_ENABLED_PROVIDERS` | Comma-separated `google,apple,facebook`; enable ready providers only |
| `BHIDNE_HO_SOCIAL_PUBLIC_URL` | API origin, e.g. `https://api-bhidne-ho.lfactorial.com` |
| `BHIDNE_HO_SOCIAL_REDIRECT_URIS` | Exact client returns, e.g. `https://bhidne-ho.lfactorial.com/,bhidneho://auth` |
| `BHIDNE_HO_GOOGLE_WEB_CLIENT_ID` | Google OAuth web application client ID |
| `BHIDNE_HO_GOOGLE_WEB_CLIENT_SECRET` | Matching server-side secret |
| `BHIDNE_HO_APPLE_SERVICE_ID` | Services ID associated with a primary App ID enabled for Sign in with Apple |
| `BHIDNE_HO_APPLE_CLIENT_SECRET` | Apple client-secret JWT signed with the developer's key; rotate before expiry |
| `BHIDNE_HO_FACEBOOK_APP_ID` | Meta app ID |
| `BHIDNE_HO_FACEBOOK_APP_SECRET` | Meta app secret |
| `BHIDNE_HO_FACEBOOK_GRAPH_VERSION` | Supported version from the Meta console, in `vNN.0` form |

Register these exact provider callbacks, substituting your API origin:

```text
https://api-bhidne-ho.lfactorial.com/auth/social/browser/google/callback
https://api-bhidne-ho.lfactorial.com/auth/social/browser/apple/callback
https://api-bhidne-ho.lfactorial.com/auth/social/browser/facebook/callback
```

The provider returns to the API, which returns to the allowlisted client URL.
Return matching is exact, including trailing slash. Configured return URLs cannot
contain queries/fragments; the client privately saves and restores the original
web URL, including room invitations.

Use separate local registrations for an API at `http://localhost:8000` and client
at `http://localhost:8081/`. Apple needs a registered HTTPS callback; use staging.
Do not include local return URLs in production. Complete the provider console's
privacy/terms, test-user and review setup before public release.

Google requests `openid email profile`, binds exchange with PKCE, and verifies the
web client audience. See [Google's server flow](https://developers.google.com/identity/protocols/oauth2/web-server).
Apple uses form POST/state/nonce and saves the initial name as editable metadata.
Facebook requests `public_profile,email`. Missing email/name does not block login;
email is never used as the identity key.

## GitHub deployment

Set the `test` environment's `BHIDNE_HO_SOCIAL_CONFIG` Actions secret to a JSON object
whose keys are the settings above and whose values are strings. For example:

```json
{
  "BHIDNE_HO_SOCIAL_ENABLED_PROVIDERS": "google",
  "BHIDNE_HO_SOCIAL_PUBLIC_URL": "https://api-bhidne-ho.lfactorial.com",
  "BHIDNE_HO_SOCIAL_REDIRECT_URIS": "https://bhidne-ho.lfactorial.com/,bhidneho://auth",
  "BHIDNE_HO_GOOGLE_WEB_CLIENT_ID": "replace-with-registered-client-id",
  "BHIDNE_HO_GOOGLE_WEB_CLIENT_SECRET": "replace-with-secret"
}
```

`scripts/write_social_environment.py` validates an allowlist and appends settings to
the private Compose env file without printing values. An absent secret leaves all
browser providers disabled. Deployment does not create provider registrations.

## Protocol and persistence

1. `GET /auth/social/browser/providers` discovers enabled providers.
2. `POST /auth/social/browser/{provider}/start` takes `{redirect_uri}` and returns
   `{attempt_id, secret, authorization_url}`. The client saves the initiating secret.
3. The callback atomically claims server-owned state, exchanges the provider code,
   and verifies identity. Google/Apple check signature, issuer, exact audience,
   expiry and nonce. Facebook checks `/debug_token` and cross-checks `/me` with
   `appsecret_proof`. Public signing keys are cached with controlled refresh.
4. The API redirects with `social_attempt` and a random `social_code`. This code is
   not an app bearer token. Both the initiating secret and callback code are needed;
   merely creating/sharing an authorization URL cannot redeem another browser's login.
5. `POST /auth/social/browser/complete` takes `{attempt_id, secret, handoff}` and
   consumes the attempt once before issuing `{user_id, token}`. The client removes
   pending proof/callback parameters and enters the usual lobby.

Migration 9 persists attempts in PostgreSQL. State, initiating secret and handoff
code are hashed. Attempts expire after ten minutes and expired rows are cleaned
on subsequent starts. Temporary PKCE verifier/nonce values are discarded after
callback verification. Provider tokens are never persisted. The in-memory store
is for disposable local runs. A lost completion response requires a fresh login.

Existing `(provider, provider_subject)` mappings, user IDs, profiles and opaque app
sessions are reused. Matching emails never merge accounts. Game authentication
continues to use application sessions, never provider tokens.

Legacy `POST /auth/social/{provider}` is disabled by default (410).
`BHIDNE_HO_SOCIAL_LEGACY_CREDENTIALS_ENABLED=1` enables compatibility only; leave it
unset publicly. The old client-ID list variables apply to that legacy route.

## Validation and remaining work

Tests cover signed provider fixtures, wrong audience/issuer/nonce/expiry, return
binding, callback/completion replay and concurrency, key lookup, cancellation,
malformed inputs, and throttling. Browser checks mock external providers and cover
all three buttons through app session creation plus unsolicited callback rejection.
Real-provider/device and PostgreSQL deployment validation still require target
credentials and infrastructure; mocked success does not verify those configurations.

The bounded route limiter is per-process, 60 requests/minute per ASGI peer. Add a
shared ingress limit and trusted proxy IP configuration for production. Redact
callback query codes and credentials from access/error logs. Client API logging
omits response bodies to avoid recording app tokens.

Account linking/unlinking, deletion with Apple token revocation, provider revocation
notifications and native identity SDK adapters remain follow-up work from the
[plan](social-auth-implementation-plan.md). This increment does not claim app-store
release readiness. Apple's deletion flow needs a deliberate revocation design;
see [Apple's guidance](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).
