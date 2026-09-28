# Original frontend with the distributed runtime

The production product must retain the original frontend's screens, layout,
copy, navigation and gameplay interactions. Distributed execution changes the
implementation underneath those screens; the separate integration UI is not the
product acceptance baseline.

Baseline: the original frontend already merged into this branch, compared with
locally available `origin/main` at `873191ebcebd210b245ede6e0e149290a0c88c02`.
Preserve subsequent user changes. Do not reset files wholesale to that reference.

## Activation boundary

Do not switch the production build from the integration screen merely to restore
its appearance. The original screens still call legacy read, command and socket
contracts. Production selection changes only after the complete original flow is
connected and tested. No runtime switch or deployment is part of the foundation
increment below. Normal branch pushes trigger production CI: do not push partial
parity activation.

## Implementation and acceptance checklist

- [x] P3a: introduce an injectable room-action contract in the original room screen
  and session hook, retain legacy behavior as the default, and implement/test
  a distributed adapter for create/enter/leave/delete.
- [x] P3b: compose one authenticated distributed runtime/journal owner behind the
  original screens; integrate pending/recovered actions with their existing busy,
  error and navigation behavior. A restored accepted result must be presented
  before starting a different action; changing account must dispose the adapter.
- [x] Original lobby reads: own/joined/public/friends/recent rooms, active games,
  memberships, member counts/previews and presence. Preserve authorization,
  pagination and ordering; do not substitute empty arrays for unsupported data.
- [x] Original room management: member details, privacy, invitations, codes/links,
  entry/exit and deletion, including active-game departure confirmation.
- [ ] Original game controls: creation/settings, seating/watch/queue/invitations,
  rule votes, start/end, all three games, review/next deal/rematch, departure and
  cross-room seat conflicts. Keep table, match and durable game identities distinct.
- [ ] Original chat/social/notifications/profile/ledger panels, their unread state,
  sounds/pokes and delivery recovery. Reuse existing FriendsPanel/RoomLedger
  transport seams instead of redesigning their presentation.
- [ ] Original account/social sign-in flows, refresh restoration, invitations on
  cold start, sign-out and session expiry. Provider configuration is a separate
  requirement from rendering the original sign-in controls.
- [ ] Mobile and desktop screenshot comparisons and complete browser journeys for
  welcome, sign-in/sign-up, lobby tabs, rooms, each game, profile and social panels.
- [ ] Real two-server acceptance: delayed/lost replies, same-ID retries, refreshed
  tabs, reconnect to another gateway and revoked membership/session handling.
- [ ] Switch production composition only after all preceding acceptance checks.

## P3a contract and limitations

`RoomActions` resolves only for accepted operations. The original screens retain
navigation decisions and styling. `legacyRoomActions` preserves existing HTTP
and ambiguous-leave reconciliation. `DistributedRoomActions` uses a dedicated
`DurableCommandClient` slot owned by the authenticated runtime, never legacy room
HTTP endpoints. It preserves the original pending payload and ID, checks status
once a lane is known, and rejects a different action until the original result
is observed. Its `recover` method exposes the original committed action to the
future root composition, including accepted creation after a reload.

The adapter is mounted only in `distributed-original` builds. Active-game
leave and cross-table seating conflicts now carry structured, actor-specific
metadata from committed state into the existing confirmation dialogs.

## P3b implementation and verification

The original screen tree owns one authenticated `OriginalDistributedRuntime`.
`OriginalUiApi` translates its explicit read/command contracts to distributed
routes; it never redirects arbitrary fetches or falls back to legacy writes.
Authentication, player profiles and appearance retain their shared platform routes.
Original component layouts and game screens remain the main-branch reference.

Room creation/entry/departure, table controls, engine actions, social mutations,
chat, notifications and settlements retain captured command IDs, payloads and
revisions through uncertain replies. Restored offscreen intentions are reconciled
and their terminal outcomes presented before releasing their slots. Profile/chat
reads use the correct own-account endpoint. Table reactions retain the original
public visual behavior for authorized spectators; private pokes remain addressed.

Original lobby projections include authorized membership, table previews and
observed presence. Unknown presence is not fabricated as connected users.
Invitation links wait for runtime readiness and grant membership only through an
accepted entry command. Successful membership reads clear revoked navigation
without clearing a room entered during an older read.

Current bounds: 1,000 members per lobby room, 10,000 lobby rooms and 1,000 messages
per materialized native history. Legacy direct/notification history retains its
separate recent page. Exceeding a supported bound fails visibly. These are limits,
not measured production capacity.

`tests/test_distributed_original_ui.py` runs the checked-in TypeScript acceptance
script against disposable native PostgreSQL/Redis and independent gateways. Set
`POSTGRES_TEST_BIN` and `REDIS_TEST_SERVER` and use Node 22+. It exercises all three
games plus friendships, direct/room/table chat, notification reads, ledgers and
room departure through the original adapters. Unit tests additionally cover lost
replies, retained revisions, failed follow-up reads, account disposal and chat
history/unread baselines.

Production activation remains pending final acceptance and the build-mode switch.
Provider credentials for social sign-in remain an external configuration concern;
this change preserves the existing controls and authentication contracts.
