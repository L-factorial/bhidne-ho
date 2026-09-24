import { ui, uiLabel } from './copy.ts';
import type { UiKey } from './catalogs.ts';

// Protocol values stay on the wire. Translate them only at the display boundary.
const phases: Record<string, UiKey> = {
  OPEN: 'rooms.open', LOCKED: 'rooms.ready_to_start', STARTED: 'rooms.playing',
  COMPLETED: 'rooms.completed', ENDED: 'rooms.ended',
  AWAITING_SHUFFLE: 'callbreak.shuffle', SHUFFLING: 'callbreak.shuffling',
  AWAITING_CUT: 'callbreak.cut', AWAITING_DISTRIBUTION: 'callbreak.deal',
  HAND_REVIEW: 'callbreak.review_your_hand', BIDDING: 'callbreak.bidding',
  PLAYING: 'rooms.playing', DEAL_COMPLETE: 'callbreak.deal_complete',
  MATCH_COMPLETE: 'callbreak.match_complete', WAITING: 'rooms.waiting',
};
export function phaseLabel(value: string): string {
  const key = phases[value.toUpperCase()];
  return key ? ui(key) : uiLabel(value.replaceAll('_', ' '));
}
export function gameLabel(value: string): string {
  return uiLabel(({ callbreak: 'Call Break', marriage: 'Marriage', flush: 'Flush' } as Record<string, string>)[value] || value, 'rooms');
}
export function meldLabel(value: string): string {
  return uiLabel(({ pure_sequence: 'Sequence', sequence: 'Sequence + wildcards', tunnela: 'Tunnela', dublee: 'Dublee', set: 'Set' } as Record<string, string>)[value] || value, 'marriage');
}
