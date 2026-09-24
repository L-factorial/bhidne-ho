import type { MarriagePublic, MarriageWinningMeld } from './marriage.ts';
export type MarriageAnnouncement = {
  id: string; playerId: string; kind: 'qualification' | 'tunnela' | 'win'; dublee: boolean;
  wonByFold?: boolean; groups: MarriageWinningMeld[]; winningPair: string[]; discard?: string;
};
/** Accepts only the public projection, never private Maal or a player's hand. */
export function marriageAnnouncements(pub: MarriagePublic): MarriageAnnouncement[] {
  const shown: MarriageAnnouncement[] = pub.players.filter(p => p.has_seen_maal && p.shown_melds.length > 0).map(p => ({
    id: `shown:${p.player_id}:${p.shown_melds.map(g => g.card_ids.join(',')).join(';')}`,
    playerId: p.player_id, kind: 'qualification', dublee: p.route === 'dublee', groups: p.shown_melds, winningPair: [],
  }));
  shown.push(...pub.players.filter(p => p.initial_tunnelas?.length).map(p => ({
    id:`tunnela:${p.player_id}:${p.initial_tunnelas!.flatMap(m=>m.card_ids).join(',')}`,
    playerId:p.player_id,kind:"tunnela" as const,dublee:false,groups:p.initial_tunnelas!,winningPair:[],
  })));
  const winner = pub.players.find(p => p.player_id === pub.winner && p.finished);
  if (winner && pub.status === 'finished') shown.push({
    id: `win:${winner.player_id}`, playerId: winner.player_id, kind: 'win', wonByFold: pub.won_by_fold, dublee: !pub.won_by_fold && winner.route === 'dublee',
    groups: pub.won_by_fold ? [] : pub.normal_finish?.melds || winner.shown_melds,
    winningPair: pub.winning_pair || [], discard: pub.normal_finish?.discard_card_id,
  });
  return shown;
}
