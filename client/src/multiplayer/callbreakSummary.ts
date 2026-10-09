import type { RoomSnapshot } from '../screens/LiveGameTable';

/** Seat order after the dealer, with the dealer last. */
export function summaryPlayers(snapshot: RoomSnapshot, lead = snapshot.deal?.dealer, leadFirst = false) {
  const players = snapshot.players || [];
  const index = players.findIndex(player => player.player_id === lead);
  if (index < 0) return players;
  const start = (index + (leadFirst ? 0 : 1)) % players.length;
  return [...players.slice(start), ...players.slice(0, start)];
}

export function summaryScore(snapshot: RoomSnapshot, player: number, round: number) {
  const history = snapshot.deal_history?.find(deal => deal.deal_number === round && deal.complete);
  if (!history) return null;
  return history.players.find(row => row.player_id === player)?.score_tenths
    ?? snapshot.scoreboard?.find(row => row.player_id === player)?.deal_scores_tenths[round - 1] ?? null;
}

export function summaryTotal(snapshot: RoomSnapshot, player: number, final = false) {
  if (final && snapshot.game?.finished) {
    const total = snapshot.scoreboard?.find(row => row.player_id === player)?.total_score_tenths;
    if (total !== undefined) return total;
  }
  if (final && summaryScore(snapshot, player, 5) === null) return null;
  return Array.from({ length: final ? 5 : 4 }, (_, i) => summaryScore(snapshot, player, i + 1))
    .reduce<number>((sum, score) => sum + (score ?? 0), 0);
}
