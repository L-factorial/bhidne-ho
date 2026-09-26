# C3c: shared platform routes and compatibility audit

The isolated distributed integration app now composes `SharedPlatform` from the
same PostgreSQL pool and authenticator as its native command/socket routes. It mounts
only reviewed method/path pairs from the account, profile and player routers. New
routes added to those legacy routers are not automatically exposed. If a reviewed
route disappears or changes its method contract, assembly fails for review.

Shared routes participate in `DistributedServer.admission`, so startup/shutdown
refusals and task cleanup apply before the pool closes. The protocol middleware
allows only reviewed HTTP method/path matches outside `/distributed`, sets shared
responses to `Cache-Control: no-store`, and still rejects old room/game/social writers.
CORS permits PATCH for profile updates using the same exact origin allowlist.
Production application selection remains unchanged.

## Mounted shared routes

| Method/path | Contract |
| --- | --- |
| POST `/auth/signup`, `/auth/signin`, `/auth/signout`; GET `/auth/me` | Existing account/session behavior using the supplied authenticator. PostgreSQL authentication issues and revokes the same tokens consumed by native routes. |
| POST `/auth/guest` | Explicit `build_server(..., guest_login_enabled=True)` only; disabled by default, independent of the legacy app's environment setting. |
| GET/PATCH `/me/profile`, `/me/profile/appearance` | Existing validated, authenticated own-profile reads and absolute-value updates. No client-supplied actor authority. |
| GET `/players/search`, `/players/directory`, `/players/{player_id}` | PostgreSQL-backed public player reads. Search is bounded to 20 results; reads bypass gateway-local profile caches to observe other gateways' updates. Malformed player IDs return 404. |
| GET `/friends` | Existing authenticated friendship snapshot; no friendship mutation or notification generation. Retains the existing full-snapshot response, not a new pagination contract. |

`PlatformPlayers` overrides only public player/search reads; legacy runtime behavior
is unchanged. Account/profile operations retain their existing semantics, not the
durable game inbox receipt protocol. In particular, signup is not a new idempotent
catalog command, and signout invalidates the token for subsequent authentication.
The supplied authenticator must support authentication, signup, signin, guest issuance
and revocation when using these shared routes. The production implementation is
`PostgresAuthService`; no parallel account store or authentication namespace is added.

## Native platform reads

All routes below use bearer-derived identity, the existing transport error mapping
and `no-store` responses. Parameters are validated before query execution.

| Native GET route | Query contract |
| --- | --- |
| `/distributed/rooms` | Authorized catalog; `after_room_id`, limit 1–100, default 50. |
| `/distributed/room-invitations` | Own pending invitations; `after_id`, limit 1–100. |
| `/distributed/table-invitations` | Own eligible pending table invitations; UUID `after_table_id`, limit 1–100. |
| `/distributed/rooms/{room_id}/members` | Membership-authorized page; `after_user_id`, limit 1–100. |
| `/distributed/rooms/{room_id}/ledger` | Existing bounded, authorized, read-only ledger snapshot. It never invokes legacy game finalization. Oversized histories fail explicitly rather than truncate totals. |

These expose the existing query adapters; no new schema/index or response shape is
introduced. Old `/rooms` and invitation aliases remain blocked, so clients must use
the native page/cursor contracts. Native discovery/chat/social history and authorized
legacy-history reads remain available through the routes added in earlier increments.

## Remaining compatibility decisions

| Feature | Current integration behavior / required follow-up |
| --- | --- |
| Friendship request/accept/remove | C3d now supports native `request-friend`, `accept-friend`, `remove-friend` commands with atomic notification intents. Old writes remain blocked; see the friendship contract. |
| Message send and notification read | Use native `send-message`/`read-notifications` commands and their receipt lifecycle. Old message writes and mark-all-read route remain blocked. Notification reads specify exact owned IDs. |
| Message/notification history | Use native streams/history or explicit legacy-history pages; old unsequenced response aliases are not mounted. |
| Room/table invitation mutation, entry/exit, room settings | Existing native room/table commands retain command ID and revision requirements. No legacy writer aliases are enabled. |
| Manual settlement creation/actions | C3g supports room-lane create-settlement and settlement-action commands, atomic receipts/effects and payer/payee authorization. Old routes stay blocked. |
| Browser/provider social login | C3f mounts reviewed browser provider/start/callback/complete routes with shared PostgreSQL attempts and sessions. Provider exchange smoke still requires configured credentials. |
| Session revocation for an already open socket | C3e now checks established sockets periodically and before operations/delivery when confirmation is stale; invalid tokens close the socket. See the socket session contract for the bounded detection window. |
| Active-table/membership aggregates and legacy client response shapes | Still require client mapping or explicit native queries; do not restore legacy reads that depend on process-local game state. |
| Generic/Echo/ad-hoc games and legacy sockets | Remain unsupported in the distributed integration app. |

C3d friendship commands are now implemented; see the
[friendship contract](distributed-runtime-friendship.md). Exact next increment:
**C3f — browser/provider sign-in composition**, followed by the remaining account/platform compatibility
items above and live client integration. Main 4/7 remain open. Production writer
exclusion, independent-process correctness, browser/native checks and load balancing
remain separate activation gates. Dedicated integration data is still required.

## Verification

53 targeted platform/application/server/transport/account/profile/catalog/ledger tests
passed against PostgreSQL/WASM and controlled broker peers. New tests cover real token
issuance and revocation, guest gating, actor-bound profile updates, cross-service
profile freshness, blocked legacy methods, catalog privacy, member/ledger authorization
and page bounds. Existing ledger tests verify reads do not perform pending settlement.
The SQL harness now serializes datetime parameters so real authentication session SQL
can run. No production migration, client change or deployment was performed.


C3e session lifetime enforcement is complete in the integration transport; see the
[socket session contract](distributed-runtime-socket-session.md). Browser/provider
sign-in composition is the next slice. Production remains unchanged.

C3f/C3g close browser sign-in composition and manual settlement command gaps.
The next implementation is native client mapping and mounted integration. Earlier
verification records describe their original increment, not current open items.

## Mounted integration client and phrases

The explicit integration build now binds existing friendship and ledger panels to
native durable commands, maps ISO history timestamps for display, and preserves drafts
while message outcomes are pending. Profile edits, shared phrases, recipient reads,
room/table invitations and room settings are available without legacy room writers.
Room/table/game chat has explicit scopes; optional chat authorization cannot suppress
an otherwise authorized game snapshot. Phrases use reviewed GET/POST/PATCH/DELETE
routes backed by the existing PostgreSQL service; CORS admits DELETE for those routes.
See [poke semantics](distributed-runtime-pokes.md) for expiring presentation, storage
and the deliberate advisory-presence difference from legacy offline rejection.

The default production UI remains unchanged. The integration screen is a separate
composition, so product-level visual/navigation parity and real native-device smoke
must still be validated before replacing it. Generic/Echo/ad-hoc games remain explicitly
unsupported, rather than silently converted.
