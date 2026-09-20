# Room lobby redesign

The room keeps its existing routing, server permissions and membership lifecycle. Tables remain the default; the room toolbar adds an explicit Tables destination and remains accessible inside Chat, Members and More sheets.

The signed-in header exposes identity, notifications and Profile. Profile holds language and appearance controls (including system appearance). Members are grouped by server-reported presence, with initial avatars and a fixed invite action. The room API currently supplies member IDs, so existing Guest labels are retained rather than inferring names from table players.

Room chat uses the shared RoomSheet and a reusable ChatComposer. The sheet owns the single iOS KeyboardAvoidingView; Android uses the native window resize behavior. History flexes above a composer capped at 104 points, with a 500-code-point limit and a counter at 450. Sending retains focus, and a successful response does not erase a newer draft. Table chat remains separate, including its existing concurrent changes.

Validation performed:

- 68 frontend unit tests and 758 backend tests passed.
- TypeScript typecheck and Expo web, iOS and Android exports passed.
- Room browser regression: default navigation, profile settings, light/dark appearance, members/invite (including a 41-member list at 320px), ledger, owner confirmation, leave membership, chat limits/multiline/focus/drafts/unread, mobile and desktop.
- Navigation browser regression: room/table creation, taking a seat, watching, queueing, return/reload/back, switching tables and a last-seat race.
- Ended-table browser regression: all three games, before starting and during play.
- No lint script is configured in the client package.

Physical-device validation remains necessary for the iPhone software keyboard, Android IME and native safe-area behavior. Native exports validate bundling, not device interaction.
