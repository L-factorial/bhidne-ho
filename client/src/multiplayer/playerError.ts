import { ui, uiLabel } from '../i18n/copy.ts';
import { uiCatalogs, type UiKey } from '../i18n/catalogs.ts';

// Presentation only: never change the error/receipt used for recovery, auth or
// deduplication. Unknown server text (including HTML, SQL and IDs) is not UI copy.
const knownCopy = new Map<string, UiKey>();
for (const [group, entries] of Object.entries(uiCatalogs.en)) {
  for (const [key, value] of Object.entries(entries)) {
    if (!value.includes('{{')) {
      const id = `${group}.${key}` as UiKey;
      knownCopy.set(value, id);
      knownCopy.set((uiCatalogs.ne[group as keyof typeof uiCatalogs.ne] as Record<string, string>)[key], id);
    }
  }
}
const messages: Record<string, UiKey> = {
  'Only the table host can start the match.': 'feedback.host_start',
  'Only the table host can lock the roster.': 'feedback.host_lock',
  'Only the room owner may perform this command.': 'feedback.owner_only',
  'Only the game creator can propose rules.': 'feedback.rules_host',
  'Only seated players may vote.': 'feedback.vote_seated',
  'All seated players must accept the proposed rules before starting.': 'feedback.rules_accept',
  'Resolve the pending rule proposal first.': 'feedback.rules_pending',
  'Resolve the proposed rules before locking.': 'feedback.rules_lock',
  'Wait for enough players to take a seat.': 'feedback.players_needed',
  'Seat enough players in an open roster before locking.': 'feedback.roster_needed',
  'You already have a seat.': 'feedback.already_seated',
  'Settings are only available before the game begins.': 'feedback.settings_started',
  'This rule proposal is no longer current.': 'feedback.rules_stale',
  'This proposal has already been resolved.': 'feedback.rules_resolved',
  'Flush rules changed. Reload them before saving.': 'feedback.flush_rules_reload',
  'Flush rules changed. Review the saved rules before starting.': 'feedback.flush_rules_review',
  'Complete this match before creating the next one.': 'feedback.match_finish',
  'This match is no longer current.': 'feedback.match_current',
  'This game has already finished.': 'feedback.match_finished',
  'End every active table before deleting the room.': 'feedback.end_tables',
  'Room owners must delete their room after ending its tables.': 'feedback.owner_leave',
  'Only the game creator or the sole person in the room can end the game.': 'feedback.end_permission',
  'The locked roster remains reserved until the game is ended.': 'feedback.seat_reserved',
  'This seat offer is no longer available.': 'feedback.offer_gone',
  'This seat is no longer transferable.': 'feedback.seat_transfer',
  'This seat offer does not belong to you.': 'feedback.offer_other',
  'A seat is required; queued users may only read table chat.': 'feedback.chat_seat',
  'Invalid chat text.': 'feedback.chat_invalid',
  'Live chat is unavailable; try again later.': 'feedback.live_chat_unavailable',
  'One or more notifications are unavailable.': 'feedback.notification_gone',
  'Choose a reaction.': 'feedback.choose_reaction',
  'Unsupported player count or empty table name.': 'feedback.create_invalid_name',
  'The current host needs a ready roster with no outstanding releases or offers.': 'feedback.roster_unready',
  'Replacement requires your current completed table and its revision.': 'feedback.replacement_stale',
  'A waitlisted player is seated elsewhere; resolve the waitlist before departure.': 'feedback.waitlist_conflict',
  'This table chat is closed.': 'feedback.chat_closed',
  'This game chat is closed.': 'feedback.chat_closed',
  'Invitation is no longer available.': 'feedback.invitation_unavailable',
  'This offer is no longer available.': 'feedback.offer_gone',
  'Room is no longer available.': 'feedback.item_unavailable',
  'This table is no longer available.': 'feedback.item_unavailable',
  'Invitation recipient not found.': 'feedback.invite_player_missing',
  'An authenticated player is required.': 'feedback.session_sign_in',

  'An open table with that name already exists in this room.': 'feedback.table_name_exists',
  'This room has reached its open-table limit.': 'feedback.room_table_limit',
  'Leave your existing seat before creating another table.': 'feedback.create_leave_first',
  'Already seated at another active table.': 'feedback.invitee_seated',
  'A player is already seated at another table.': 'feedback.player_seated',
  'You are no longer a member of this room.': 'feedback.room_membership_lost',
  'The table changed. Refresh and try again.': 'feedback.table_changed',
  'The table changed. Reopen it before sending a poke.': 'feedback.poke_table_changed',
  'This table has ended.': 'feedback.table_ended',
  'This match has already started.': 'feedback.match_started',
  'The roster is locked.': 'feedback.roster_locked',
  'The table is full. Join the waitlist.': 'feedback.table_full_waitlist',
  'Table invitation is no longer available.': 'feedback.invitation_unavailable',
  'Player not found.': 'feedback.invite_player_missing',
  'You cannot invite yourself.': 'feedback.invite_self',
  'Ask the room owner to invite this player first.': 'feedback.invite_owner_required',
  'Too many invitations. Wait a minute before inviting more players.': 'feedback.invite_rate',
  'Take a seat before sending a poke.': 'feedback.poke_seat_required',
  'Take a seat before posting to the game.': 'feedback.social_seat_required',
  'Choose another occupied seat.': 'feedback.poke_target',
  'This poke expired before it could be sent.': 'feedback.poke_expired',
  'Give that poke a moment before sending another.': 'feedback.poke_rate',
  'Wait a moment before sending another message.': 'feedback.message_rate',
  'Only friends can message each other.': 'feedback.friends_required',
  'This table conversation is closed.': 'feedback.chat_closed',
  'Invalid table type, capacity, name, or payload fields.': 'feedback.invalid_create',

  'This account already has an active journal owner.': 'feedback.session_open_elsewhere',
  'Persistent storage and Web Locks are required.': 'feedback.session_storage_required',
  'Not your turn': 'feedback.not_your_turn',
  'Invalid room creation fields.': 'feedback.enter_a_room_name',
  'Wait for your turn.': 'feedback.not_your_turn',
  "It is another player's turn.": 'feedback.not_your_turn',
  'Invalid username or password.': 'feedback.credentials_incorrect',
  'Invalid username or password': 'feedback.credentials_incorrect',
  'Username already exists.': 'feedback.name_taken',
  'Username is already taken': 'feedback.name_taken',
  'Username already taken.': 'feedback.name_taken',
  'Action rejected.': 'feedback.action_unavailable',
  'Social action rejected.': 'feedback.action_unavailable',
  'Contact with this player is unavailable.': 'safety.contact_unavailable',
  'Delivery connection interrupted.': 'feedback.connection_interrupted_retrying',
  'Session is disconnected.': 'feedback.connection_lost',
};
const codes: Record<string, UiKey> = {
  PUSH_PERMISSION_REQUIRED: 'feedback.push_permission_required',
  PUSH_PERMISSION_FAILED: 'feedback.push_permission_failed',
  PUSH_TOKEN_FAILED: 'feedback.push_token_failed',
  PUSH_ENVIRONMENT_FAILED: 'feedback.push_environment_failed',
  PUSH_BUILD_REQUIRED: 'feedback.push_build_required',
  PUSH_REGISTRATION_FAILED: 'feedback.push_registration_failed',
  NOT_YOUR_TURN: 'feedback.not_your_turn',
  PLAYER_ALREADY_AT_TABLE: 'feedback.leave_first',
  TABLE_FULL: 'feedback.that_table_is_full_choose_a_table_with_an_open_seat',
  INVALID_PHASE: 'feedback.invalid_phase',
  STALE_REVISION: 'feedback.stale_revision',
};

const ruleMessages = new Set([
  'Only the dealer can distribute.',
  'Wait for the cutter before distributing.',
  'Your hand does not qualify for a redeal.',
  'You have already accepted this hand.',
  'Your bid is already recorded.',
  'The five-deal match has finished.',
  'Game has already started.',
  'Game is not in progress.',
  'Player has folded.',
  'Complete initial Tunnela declarations before playing.',
  'Initial Tunnela declaration is unavailable.',
  'Declare distinct natural Tunnelas only.',
  'Card must be owned and uncommitted.',
  'Player has already qualified; routes cannot be changed.',
  'Normal finish requires 21 cards in valid melds and one final discard.',
  'Bet must be a whole number at least the current minimum.',
  'Only the other final player can reveal or fold.',
  'Only the requested player can respond to this side-show.',
  'Show requires exactly two active players.',
  'Leave the active game or resolve the locked roster before leaving this room.',
  'You no longer hold a seat in this game.',
  'Use a name without control characters.',
  'Enter your display name.',
]);

export function playerError(error: unknown, fallback?: string): string {
  const item = error && typeof error === 'object' ? error as {
    message?: unknown; status?: number; detail?: { code?: string }; code?: string;
  } : undefined;
  const message = typeof error === 'string' ? error : typeof item?.message === 'string' ? item.message : '';
  const code = item?.detail?.code ?? item?.code;
  if (code && codes[code]) return ui(codes[code]);
  if (messages[message]) return ui(messages[message]);
  if (item?.status === 401) return ui('feedback.session_sign_in');
  // An uncertain write is not a rejection. Never suggest sending it again.
  if (/outcome unresolved|still pending|waiting for .*confirm|waiting for confirmation|confirmation pending/i.test(message))
    return ui('feedback.please_wait_confirmation');
  if (ruleMessages.has(message)) return uiLabel(message);
  if (/^Chat is paused/.test(message)) return ui('feedback.chat_paused');
  const known = knownCopy.get(message);
  if (known) return ui(known);
  if (item?.status === 403) return ui('feedback.access_unavailable');
  if (item?.status === 404 || item?.status === 410) return ui('feedback.item_unavailable');
  if (item?.status === 429) return ui('feedback.slow_down');
  if (item?.status === 409) return ui('feedback.action_unavailable');
  if (item?.status && item.status >= 500) return ui('feedback.service_unavailable');
  // An AbortError reaching this boundary may be a timeout, not intentional
  // cancellation. Callers suppress only when THEIR lifetime signal was aborted.
  if (/abort|failed to fetch|fetch failed|network.*(?:error|failed)|load failed|timed? ?out/i.test(message))
    return ui('feedback.connection_lost');
  const key = knownCopy.get(message);
  if (key) return ui(key);
  return fallback || ui('feedback.generic_failure');
}
