export type MarriageCard = { card_id: string; card_type: 'standard' | 'man'; rank: number | null; suit: string | null; deck_index: number | null };
export type MarriageMeld = { meld_type: 'pure_sequence' | 'tunnela' | 'dublee'; card_ids: string[] };
export type MarriageActions = { kinds: string[]; drawable_sources: string[]; discardable_card_ids: string[]; blocked_sources: { source: string; reason: string }[]; reason?: string | null };
export type MarriagePublic = { revision: number; status: string; current_player_id: string | null; phase: string | null; stock_count: number; top_discard: MarriageCard | null; winner: string | null;
  players: { player_id: string; hand_count: number; route: string; shown_melds: MarriageMeld[]; has_seen_maal: boolean; finished: boolean }[] };
export type MarriageMove = { sequence: number; revision: number; kind: 'CARD_DRAWN' | 'CARD_DISCARDED'; player_id: string; source: 'stock' | 'discard' | null; card: MarriageCard | null };
export type MarriageView = { public: MarriagePublic; moves?: MarriageMove[]; private: { player_id: string; hand: MarriageCard[]; actions: MarriageActions;
  maal: { tiplu: { rank: number; suit: string }; jhiplu: { rank: number; suit: string }; poplu: { rank: number; suit: string } } | null } | null };
const suits: Record<string, string> = { S: '♠', C: '♣', H: '♥', D: '♦' };
export const suitName: Record<string, string> = { S: 'Spades', C: 'Clubs', H: 'Hearts', D: 'Diamonds' };
export function marriageFace(card: { rank: number | null; suit: string | null }) {
  return card.rank === null || card.suit === null ? 'Man' : `${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] || card.rank}${suits[card.suit]}`;
}
export function physicalLabel(id: string) {
  if (id.startsWith('MAN:')) return `Man · ${Number(id.slice(4)) + 1}`;
  const [pack, face] = id.split(':');
  return `${face.slice(0, -1)}${suits[face.slice(-1)]} · ${Number(pack.slice(1)) + 1}`;
}
export function canSubmitMarriage(groups: MarriageMeld[]) {
  return groups.length === 7 && groups.every(g => g.meld_type === 'dublee') ? 'SHOW_DUBLEES'
    : groups.length === 3 && groups.every(g => g.meld_type !== 'dublee') ? 'SHOW_INITIAL_MELDS' : null;
}

// Local suggestions only: the engine remains authoritative on submission.
export function marriageSuggestions(hand: MarriageCard[]) {
  const faces = new Map<string, string[]>();
  for (const card of hand) {
    if (card.card_type !== 'standard') continue;
    const key = `${card.suit}:${card.rank === 14 ? 1 : card.rank}`;
    faces.set(key, [...(faces.get(key) || []), card.card_id]);
  }
  const pairs: MarriageMeld[] = [], candidates: MarriageMeld[] = [];
  for (const ids of faces.values()) {
    if (ids.length >= 2) pairs.push({ meld_type: 'dublee', card_ids: ids.slice(0, 2) });
    if (ids.length === 3) candidates.push({ meld_type: 'tunnela', card_ids: [...ids] });
  }
  for (const suit of ['S', 'C', 'H', 'D']) for (let rank = 1; rank <= 11; rank++) {
    for (const a of faces.get(`${suit}:${rank}`) || [])
      for (const b of faces.get(`${suit}:${rank + 1}`) || [])
        for (const c of faces.get(`${suit}:${rank + 2}`) || [])
          candidates.push({ meld_type: 'pure_sequence', card_ids: [a, b, c] });
  }
  function find(start: number, groups: MarriageMeld[], used: Set<string>): MarriageMeld[] | null {
    if (groups.length === 3) return groups;
    for (let i = start; i < candidates.length; i++) {
      const group = candidates[i];
      if (group.card_ids.some(id => used.has(id))) continue;
      const result = find(i + 1, [...groups, group], new Set([...used, ...group.card_ids]));
      if (result) return result;
    }
    return null;
  }
  return { dublees: pairs.length >= 7 ? pairs.slice(0, 7) : [], normal: find(0, [], new Set()) || [], pairCount: pairs.length };
}

export function marriageUsesArc(cardCount: number, mode: string, revealing: boolean) {
  return cardCount <= 15 && (revealing || mode === 'fan');
}
