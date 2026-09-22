# UI refinement plan

Implement the supplied UI brief incrementally without modifying API contracts,
server rules, permissions, navigation ownership, or game commands.

1. Use semantic colors, spacing, typography and radius tokens. Preserve readable
   contrast where the suggested decorative colors are too faint for text/controls.
2. Reduce room banner height; improve resume context. Make table-card entry one
   coherent target, keeping the existing seat/watch/queue decisions. Group sharing
   into the existing sheet primitive and support the native share dialog.
3. Keep room and global navigation separate. Add a code copy affordance, compact
   member rows with presence dots and a detail sheet using supported actions only.
   Move chat sound into the sheet header. Simplify ledger context without changing
   any settlement records or commands.
4. Distinguish pre-game seating from active play using the same table renderers.
   Show capacity/empty seats and compact host status with server-derived eligibility.
   Keep active cards, privacy, gestures and game actions intact.
5. Show table names in game headers; tighten drawer grouping, add icons and share
   access, and retain confirmed end-table actions as secondary host controls.
6. Verify touch targets, 320–390px phones and desktop, keyboard/composer behavior,
   avatar fallbacks, sharing, all game flows, and settlement actions. Web automation
   does not replace native iOS device testing.

Appearance decision: retain the recently selected fixed cream design unless the
user explicitly asks to restore theme switching in response to clarification.

## Delivered

Implemented the shared palette/tokens, compact room/table cards, room code copying,
member profile/friend actions, table sharing sheet, chat header controls, ledger
code disclosure and game balances, pre-game seating, named game headers and compact
drawers. Existing game renderers, command eligibility and confirmed end actions
remain in use. No backend files, API contracts or dependencies were changed.

## Verification

- TypeScript check and Expo web export pass; all 70 client unit tests pass.
- Browser checks cover lobby/room navigation, actual friend requests, sharing,
  pre-game empty seats, ledger settlement actions, round-result avatar fallbacks,
  fixed appearance, game menus and social controls across all three games.
- Flush checks cover legal/rejected actions, reconnect, blind/seen privacy,
  side-show, final show, results, rules and history.
- Responsive browser checks cover narrow phones and desktop. Native iOS keyboard,
  safe-area and platform share-sheet behavior still need device verification.
- Member messaging/removal actions without existing supported UI/API paths were
  not added; supported friend requests use the existing endpoints.
