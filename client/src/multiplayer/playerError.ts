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
  NOT_YOUR_TURN: 'feedback.not_your_turn',
  PLAYER_ALREADY_AT_TABLE: 'feedback.leave_first',
  TABLE_FULL: 'feedback.that_table_is_full_choose_a_table_with_an_open_seat',
  INVALID_PHASE: 'feedback.action_unavailable',
  STALE_REVISION: 'feedback.action_unavailable',
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
