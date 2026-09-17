# Google, Apple, and Facebook sign-in

Social authentication is isolated in `app/social_auth`. Provider credentials never
enter game, room, WebSocket, or profile code. The module verifies a credential,
maps it to one internal user, and returns the same opaque Bhidne Ho session used by
guest and password authentication.

## Request flow

1. A provider SDK signs the user in and returns a Google/Apple ID token or Facebook
   user access token.
2. The client sends it over HTTPS to `POST /auth/social/{provider}` as
   `{"credential":"...","nonce":"..."}`. Clients should use a nonce for OpenID
   Connect whenever their provider SDK supports one.
3. Google and Apple JWT signatures are checked against published JWK sets. Issuer,
   audience, expiry, issued-at, subject, and any supplied nonce are validated.
4. Facebook's debug endpoint must report a valid token issued to this app. Its user
   ID is cross-checked with `/me`, which is called with `appsecret_proof`.
5. `(provider, subject)` resolves an internal user. First login creates the user,
   profile, and mapping; later logins reuse it and issue a new application session.

Provider tokens are not persisted or accepted as application bearer tokens. Only a
SHA-256 hash of each Bhidne Ho session token is stored. Errors and logs must never
include provider credentials. `GET /auth/social/providers` lists configured providers.

## Database schema

```sql
external_identities (
  provider          text,       -- google | apple | facebook
  provider_subject  text,       -- stable provider-specific user identifier
  user_id           uuid references users(id) on delete cascade,
  email             text null,  -- metadata; never an identity key
  email_verified    boolean,
  created_at        timestamptz,
  last_login_at     timestamptz,
  primary key (provider, provider_subject)
)
```

Social users have `users.kind = 'account'`. The same person using two providers gets
two accounts until a deliberate linking flow verifies both identities. Matching email
addresses are never enough to link accounts.

## Environment

```dotenv
# Include every web/iOS/Android audience that can send an ID token.
GOOGLE_CLIENT_IDS=web-id.apps.googleusercontent.com,ios-id.apps.googleusercontent.com
APPLE_CLIENT_IDS=com.example.bhidne.web,com.example.bhidne
FACEBOOK_APP_ID=123456789
FACEBOOK_APP_SECRET=server-side-secret
```

An unset provider stays disabled and returns HTTP 503. Keep the Facebook secret in a
deployment secret manager; it must never be an `EXPO_PUBLIC_` value or ship in a client.
The current automatic deployment leaves all four variables empty, so social login is
disabled and existing guest/password behavior is unchanged.

## Provider configuration

For Google, create OAuth clients for every platform and configure the consent screen.
The client must send an ID token, never a plain user ID. Google's official
[OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect)
and [backend authentication guide](https://developers.google.com/identity/sign-in/web/backend-auth)
describe the required signature, issuer, audience, and expiry verification.

For Apple, enable Sign in with Apple for the App ID, create a Services ID for web,
and register domains and return URLs. Apple recommends its stable subject—not email—
as the identity key. See [Receiving an identity token](https://developer.apple.com/documentation/signinwithapple/receiving-a-users-identity-token)
and [Apple's public verification keys](https://developer.apple.com/documentation/signinwithapplerestapi/fetch-apple%27s-public-key-for-verifying-token-signature).
Apple may supply the person's name only during initial authorization and outside the
ID token, so users can set or edit their display name through the profile endpoint.

For Facebook, configure Facebook Login for each platform and request only necessary
permissions. The backend accepts a user access token and verifies that it belongs to
`FACEBOOK_APP_ID`. Email can be absent and is not marked verified here.

## API contract

```http
GET /auth/social/providers

POST /auth/social/google
Content-Type: application/json

{"credential":"provider ID token","nonce":"client-generated nonce"}
```

Apple uses `/auth/social/apple` with an ID token. Facebook uses
`/auth/social/facebook` with a user access token and normally no nonce. A successful
response is `{"user_id":"user-...","token":"..."}` with `Cache-Control: no-store`.
Invalid credentials return 401, unconfigured providers return 503, and an invalid
provider path returns 422.

## Client and release status

The backend verification, API, persistent mapping, and application sessions are
implemented. The existing Expo provider buttons remain disabled until provider SDK
credentials are registered for each target and the SDK callbacks send credentials to
this API. Before enabling a provider:

- use its maintained SDK and Authorization Code + PKCE where available;
- generate and validate a nonce for OpenID Connect;
- test web, iOS, and Android audiences independently;
- publish real Terms and Privacy pages and complete provider review;
- enable HTTPS, rate limiting, secret injection, and credential-redacted logging;
- implement explicit account linking/deletion rather than email-based merging.
