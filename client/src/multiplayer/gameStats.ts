import type { RoomSnapshot } from '../screens/LiveGameTable';

/** Completed rounds only: a live bid is never added to the previous-round row. */
export function callBreakPreviousStats(snapshot: RoomSnapshot, playerId: number) {
  const rounds = (snapshot.deal_history || []).filter(round => round.complete && round.deal_number < (snapshot.deal?.deal_number ?? Infinity));
  return rounds.reduce((total, round) => {
    const player = round.players.find(player => player.player_id === playerId);
    return { bids: total.bids + (player?.bid ?? 0), bonus: total.bonus + Math.max(0, (player?.tricks_won ?? 0) - (player?.bid ?? 0)) };
  }, { bids: 0, bonus: 0 });
}

export function callBreakTrickHistory(snapshot: RoomSnapshot, playerId: string | null) {
  const rounds = new Map((snapshot.deal_history || []).map(round => [round.deal_number, round.tricks || []]));
  if (snapshot.deal) rounds.set(snapshot.deal.deal_number, snapshot.deal.tricks);
  return [...rounds].sort(([a], [b]) => a - b).flatMap(([round, tricks]) => tricks
    .filter(trick => trick.complete && (playerId === null || trick.plays.some(play => String(play.player_id) === playerId)))
    .map(trick => ({ round, ...trick })));
}

export function flushStatsHistory(snapshot: RoomSnapshot, playerId: string | null) {
  return (snapshot.flush?.history || []).filter(event => playerId === null ||
    event.player_id === playerId || event.target_player_id === playerId ||
    event.loser_player_id === playerId || event.winner_ids.includes(playerId));
}
