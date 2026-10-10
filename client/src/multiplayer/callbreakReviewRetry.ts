/** Only definitive revision rejections may create a new review command. */
export type ReviewSnapshot = {
  match_id?: string; game_type?: string; status?: string;
  game?: { revision: number; phase?: string };
  deal?: { deal_number?: number; attempt?: number } | null;
  private?: { hand: string[]; can_accept_hand?: boolean; can_claim_redeal?: boolean } | null;
};
export type ReviewIntent = { match: string; deal: number; attempt: number; hand: string; command: 'ACCEPT_HAND'|'CLAIM_REDEAL' };
export function captureReview(snapshot: ReviewSnapshot, command: string): ReviewIntent | null {
  if (snapshot.game_type !== 'callbreak' || snapshot.game?.phase !== 'HAND_REVIEW' || !snapshot.match_id || !snapshot.private ||
      !(command === 'ACCEPT_HAND' ? snapshot.private.can_accept_hand : snapshot.private.can_claim_redeal) ||
      !Number.isInteger(snapshot.deal?.deal_number) || !Number.isInteger(snapshot.deal?.attempt) ||
      !['ACCEPT_HAND','CLAIM_REDEAL'].includes(command)) return null;
  return {match:snapshot.match_id,deal:snapshot.deal!.deal_number!,attempt:snapshot.deal!.attempt!,
    hand:JSON.stringify([...snapshot.private.hand].sort()),command:command as ReviewIntent['command']};
}
export function isRevisionRejection(detail: string | undefined): boolean {
  // Current local/distributed APIs return these exact concurrency messages.
  // Do not treat other 409s or generic failures as safe to retry.
  return detail === 'The turn changed. Your view has been refreshed; try again.' ||
    detail === 'The game state changed; refresh and try again.' ||
    detail === 'Refresh game state before retrying.';
}
export function reviewRetry(intent: ReviewIntent, snapshot: ReviewSnapshot): 'retry'|'resolved'|'stop' {
  if (snapshot.match_id !== intent.match || snapshot.game_type !== 'callbreak' ||
      snapshot.deal?.deal_number !== intent.deal || snapshot.status === 'ended') return 'stop';
  if ((snapshot.deal?.attempt ?? -1) > intent.attempt) return 'resolved'; // Another player redealt this hand.
  if (snapshot.deal?.attempt !== intent.attempt || !snapshot.private ||
      JSON.stringify([...snapshot.private.hand].sort()) !== intent.hand) return 'stop';
  if (snapshot.game?.phase === 'AWAITING_REDEAL') return 'resolved';
  if (snapshot.game?.phase !== 'HAND_REVIEW') {
    return intent.command === 'ACCEPT_HAND' && !snapshot.private.can_accept_hand ? 'resolved' : 'stop';
  }
  if (intent.command === 'ACCEPT_HAND') return snapshot.private.can_accept_hand ? 'retry' : 'resolved';
  return snapshot.private.can_claim_redeal ? 'retry' : 'stop';
}
