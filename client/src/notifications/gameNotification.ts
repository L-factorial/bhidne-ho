import type { RoomSnapshot } from '../screens/LiveGameTable';

// Timer-only polls must not generate another notification.
export function notificationKey(snapshot: RoomSnapshot | null): string {
  if (!snapshot?.match_id) return '';
  return JSON.stringify([snapshot.match_id, snapshot.status, snapshot.game?.revision,
    snapshot.players?.length, snapshot.settings, snapshot.error]);
}

export function notificationText(snapshot: RoomSnapshot): string {
  if (snapshot.error) return snapshot.error;
  if (snapshot.game_type === 'flush') {
    const fold = snapshot.flush?.folds?.at(-1);
    if (fold && fold.revision === snapshot.game?.revision) return foldText(snapshot, fold.player_id);
  }
  if (snapshot.game_type === 'marriage' && snapshot.game) {
    if (snapshot.game.finished) return 'Marriage complete · view the result';
    if (snapshot.your_player_id === snapshot.game.turn.player_id) return snapshot.game.phase === 'MUST_DRAW' ? 'Your turn · take a card' : 'Your turn · show, finish, or discard';
    return 'Marriage · the table has updated';
  }
  if (snapshot.game?.finished) return 'Game complete · see the final scores';
  if (snapshot.status === 'waiting') return snapshot.ready ? 'Everyone is ready · the creator can start' : `${snapshot.players?.length}/${snapshot.capacity} players seated`;
  const phase = snapshot.game?.phase;
  const yourTurn = !!snapshot.your_player_id && snapshot.game?.turn.player_id === snapshot.your_player_id;
  if (yourTurn) return phase === 'BIDDING' ? 'Your turn to bid' : phase === 'PLAYING' ? 'Your turn to play a card' : 'Your turn · return to the table';
  if (phase === 'HAND_REVIEW') return 'Your cards are ready · review your hand';
  if (phase === 'BIDDING') return 'Bidding is open';
  return `Deal ${snapshot.deal?.deal_number || 1} · ${phase?.replaceAll('_', ' ').toLowerCase() || 'Game updated'}`;
}

export function foldText(snapshot: RoomSnapshot, playerId: string): string {
  const name = snapshot.flush?.participants?.find(p => p.player_id === playerId)?.display_name
    || snapshot.players?.find(p => String(p.player_id) === playerId)?.display_name || `Player ${playerId}`;
  return `${name} folded`;
}
