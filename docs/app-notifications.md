# Native app notifications

The distributed runtime supports direct APNs delivery for iOS and FCM HTTP v1
delivery for Android. Nothing uses the Expo push relay. Browser, chat and poke
notifications are outside this release.

## Server configuration

Apply database migrations through **38** and install the updated Python
dependencies (including HTTP/2 support). Configure either or both providers:

| Environment variable | Value |
| --- | --- |
| `BHIDNE_APNS_KEY_FILE` | Absolute path to the Apple `.p8` signing key |
| `BHIDNE_APNS_TEAM_ID` | Apple developer team ID |
| `BHIDNE_APNS_KEY_ID` | APNs signing key ID |
| `BHIDNE_APNS_TOPIC` | Exact built iOS bundle identifier; currently `com.lfactorial.bhidne-ho` |
| `BHIDNE_FCM_SERVICE_ACCOUNT_FILE` | Absolute path to Firebase service-account JSON with permission to send FCM messages |

Keep these credentials in the server secret store, outside source control and
client bundles. Missing provider configuration leaves that provider unavailable;
with neither configured, delivery workers do not start and client opt-in controls
remain hidden. Configured malformed credentials fail initialization.

Every distributed server may run a worker. Database leases coordinate delivery;
provider calls run outside gameplay transactions. Migration triggers enqueue
committed game revisions and room invitations. The worker rebuilds authorized
views to identify required actions, readiness and hosted invitations.

## Native builds

Rebuild the native app with the `expo-notifications` config plugin. Remote push
requires a development or production native build, not Expo Go. Enable Push
Notifications for the Apple application identifier and provisioning profile.
The app reads its APNs entitlement to register the sandbox or production token.
When the embedded provisioning profile is unavailable, registration uses the
production environment only after obtaining a valid native APNs token and
identifying the application release type as App Store (including TestFlight).
Development environments remain explicit; unknown builds fail with setup guidance.
Permission, token, environment and registration validation failures have separate
English/Nepali messages instead of the generic game-action error.
See [Expo notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)
and [Apple token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).

For Android, supply the existing published application ID through
`BHIDNE_ANDROID_APPLICATION_ID` and set `GOOGLE_SERVICES_JSON` to the native
Firebase client configuration file for that same application. The repository
does not guess an Android package name. Enable Firebase Cloud Messaging HTTP v1
in the server project. Client `google-services.json` and server service-account
JSON have different purposes; never bundle the service-account file.
See [Expo direct APNs/FCM delivery](https://docs.expo.dev/push-notifications/sending-notifications-custom/)
and [Firebase HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/auth-server).

## Behavior and limits

- Device opt-in requests OS permission only after the player presses Enable.
  Account preferences control required actions, invitations, sound and quiet hours.
- Game notifications expire after 90 seconds; invitations after one day. Before
  sending, the worker checks current authorized action, invitation status, account
  and session validity, blocks, preferences and room deletion.
- A 25-second foreground heartbeat renews a 60-second current-game lease. Alerts
  defer while the game is visible and may send after the lease expires. Elsewhere,
  the native foreground handler presents a banner.
- Taps validate the signed-in account, open the target room/match and retrieve
  fresh authorized state. Push payloads contain generic text and routing IDs,
  never hands, cards or chat text.
- Logout/revocation removes session-bound devices and pending deliveries. Account
  erasure also removes preferences. Invalid native tokens are discarded.
- Transient provider failures retry with bounded backoff and eight attempts.
  Delivery is at least once: a crash after provider acceptance may resend. Stable
  IDs, provider collapse keys and tap deduplication reduce duplicate handling.
  Provider acceptance cannot guarantee OS display, and an action can change
  between the final database check and network delivery. Opening always reconciles.
- Quiet hours use the device's last reported UTC offset, refreshed on activity.
  A device that remains offline through a timezone/DST change may use its old offset.

## Release verification

Local automated tests cover committed enqueue/rollback, authorized action
generation, deduplication, foreground lease expiry, stale actions, revoked sessions,
preferences, invitation cancellation/expiry/block history, concurrent claims,
retries, native provider authentication and invalid-token responses.

Before release, configure credentials and verify on physical iOS and Android
devices: permission opt-in/revocation, foreground current-game suppression,
foreground elsewhere, background and terminated delivery, notification taps,
account switching/logout, sound and quiet hours, expired turns and answered
invitations, token rotation, provider outages and worker restarts. Check both iOS
sandbox and production builds. These real-provider/device checks remain outstanding.

## Notification destinations

Native response handling retains a valid recipient-bound destination through
sign-in and runtime startup. The OS launch response is cleared after navigation
or explicit dismissal, rather than when authentication is temporarily absent.
A newer live tap wins over a delayed initial-response read. Duplicate response
IDs are suppressed while the app remains mounted; cleanup prevents an unmounted
listener from navigating. Different-account destinations show an explanation and
remain pending until dismissed or the intended account signs in.

| Kind | Destination |
| --- | --- |
| Direct chat | Sender's private conversation; first unread message when its source is in loaded history, otherwise latest messages |
| Room chat | Originating room with chat open |
| Table chat | Exact match with table chat open |
| Game chat | Exact match with the durable game chat selected; retain `game_id` when supplied |
| Poke | Originating match; existing expiry rules prevent replaying old effects |
| Room/game invitation, created-table invitation | Preview followed by explicit Open room/Open table; tapping alone does not accept an invitation or take a seat |
| Ready, bid, play, shuffle, cut, deal, review, declare, draw, discard, finish, bet, side_show | Exact match with controls derived from its current authorized snapshot; never execute the old action automatically |
| Friend request/accepted/rejected | Friends, highlighting the actor when present; pending requests keep their explicit accept/decline controls |

Friend events currently remain in-app notifications; this routing change does
not enable additional phone push categories. The original UI notification bell
preserves the same routing context, and failed read acknowledgement does not
block opening a conversation. Destination readers retain their existing retry
behavior and acknowledge relevant activity after loading. Unavailable matches
show feedback, retry/dismiss, and an Open room fallback when the room was read
successfully. Access failures do not bypass authorization.

Social payloads now include `scope` and `source_notification_id`; table-backed
payloads include `table_id`, and game chat preserves `game_id` when available.
No message content is added. Older chat payloads infer room versus table from
the presence of `match_id`; older pushes cannot recover an omitted game scope.
Unknown kinds, malformed identifiers and contradictory chat scopes are ignored.

Release checks must exercise each row above from foreground, background, locked
and terminated states on signed iOS/Android builds. Include signed-out startup,
wrong-account sign-in, offline retry, duplicate taps, rapid different taps,
already-open conversations, answered invitations, deleted rooms and expired games.
Local mock/browser tests and native bundle exports do not replace these checks.

## Ledger settlement notifications

Migration **44** extends the transactional push trigger to new
`settlement_requested` and `settlement_accepted` inbox entries for all game types.
Marking a payment paid notifies the payee; confirmation notifies the payer.
Historical notices are not backfilled. Deliveries expire after one day and use
existing action, sound and quiet-hour preferences, session/device validation,
block checks, retry limits and provider configuration.

The worker checks unread status, transfer status, payer/payee identities and room
membership immediately before delivery. Requests confirmed before sending expire.
Ledger notices require no active game checkpoint and are not suppressed by the
current-game foreground lease. English/Nepali alerts contain no amounts, payment
details or chat contents. Tapping opens the authorized room ledger, including for
completed games; it never confirms a payment automatically.

Background delivery uses existing APNs/FCM visible alerts and does not rely on
JavaScript polling in the background. OS permission, enabled push registration,
configured provider credentials and a compatible signed native build are required.
OS display is not guaranteed. Browser background push is not implemented.
Apply migration 44 and deploy compatible backend/client together; old clients do
not recognize settlement push destinations. Physical-device foreground/background,
terminated-launch and tap tests remain required before claiming device validation.
