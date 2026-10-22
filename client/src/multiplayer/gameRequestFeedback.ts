import {ui} from '../i18n/copy.ts';
import type {RoomSnapshot} from '../screens/LiveGameTable';
import {isActivityCopy} from './activityCopy.ts';

// Clear only the turn denial contradicted by the authoritative game view.
export function clearObsoleteTurnError(message: string, snapshot?: RoomSnapshot): string {
  if (!snapshot || snapshot.status !== 'playing' || !snapshot.your_player_id
      || message !== ui('feedback.not_your_turn')) return message;
  const current = snapshot.game_type === 'flush' ? snapshot.flush?.public.current_player_id
    : snapshot.game_type === 'marriage' ? snapshot.marriage?.public.current_player_id
    : snapshot.game?.turn.player_id;
  return current != null && String(current) === String(snapshot.your_player_id) ? '' : message;
}

// Retry progress must not enter game-specific rejection/hand-recovery logic.
export function gameRequestFeedback(message: string, busy: boolean, connectionReady: boolean, ended: boolean, snapshot?: RoomSnapshot) {
  const retrying = isActivityCopy(message);
  return {
    error: retrying ? '' : clearObsoleteTurnError(message, snapshot),
    active: busy || retrying || (!ended && !connectionReady),
  };
}
