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
