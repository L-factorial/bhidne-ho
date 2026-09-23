import type { MarriageCard, MarriageMeld } from './marriage.ts';

type Pattern = { kind: MarriageMeld['meld_type']; faces: number[] };
export type MaalGroup = { kind: MarriageMeld['meld_type']; held: MarriageCard[]; missing: { rank: number; suit: string }[] };
const suits = ['S', 'C', 'H', 'D'];
const face = (index: number) => ({ rank: index % 13 === 0 ? 14 : index % 13 + 1, suit: suits[Math.floor(index / 13)] });
const patterns: Pattern[] = suits.flatMap((_, suit) => [
  ...Array.from({ length: 11 }, (_, rank) => ({ kind: 'pure_sequence' as const, faces: [0, 1, 2].map(offset => suit * 13 + rank + offset) })),
  ...Array.from({ length: 13 }, (_, rank) => ({ kind: 'tunnela' as const, faces: Array(3).fill(suit * 13 + rank) as number[] })),
]);

/** Minimum additional natural cards for qualification, not a prediction of draws.
 * Three decks, Ace low, no wild substitutions before Maal is seen.
 */
export function maalProgress(hand: MarriageCard[]) {
  const buckets: MarriageCard[][] = Array.from({ length: 52 }, () => []);
  const seen = new Set<string>();
  for (const card of hand) {
    const suit = suits.indexOf(card.suit || '');
    const rank = card.rank === 14 ? 1 : card.rank;
    if (seen.has(card.card_id) || card.card_type !== 'standard' || suit < 0 || rank === null || rank < 1 || rank > 13) continue;
    seen.add(card.card_id); buckets[suit * 13 + rank - 1].push(card);
  }
  const cost = (pattern: Pattern) => {
    const counts = new Map<number, number>();
    pattern.faces.forEach(f => counts.set(f, (counts.get(f) || 0) + 1));
    return [...counts].reduce((sum, [f, count]) => sum + Math.max(0, count - buckets[f].length), 0);
  };
  const ordered = [...patterns].sort((a, b) => cost(a) - cost(b));
  const required = Array(52).fill(0) as number[];
  let bestCost = 10, best: Pattern[] = [];
  function search(start: number, chosen: Pattern[], missing: number) {
    if (missing >= bestCost) return;
    if (chosen.length === 3) { bestCost = missing; best = [...chosen]; return; }
    for (let i = start; i < ordered.length; i++) {
      const pattern = ordered[i];
      let extra = 0, valid = true;
      for (const f of pattern.faces) {
        required[f]++;
        if (required[f] > 3) valid = false;
        if (required[f] > buckets[f].length) extra++;
      }
      if (valid) search(i, [...chosen, pattern], missing + extra);
      pattern.faces.forEach(f => required[f]--);
    }
  }
  search(0, [], 0);
  function allocate(plan: Pattern[]): MaalGroup[] {
    const remaining = buckets.map(cards => [...cards]);
    return plan.map(pattern => {
      const held: MarriageCard[] = [], missing: { rank: number; suit: string }[] = [];
      for (const f of pattern.faces) {
        const card = remaining[f].shift();
        if (card) held.push(card); else missing.push(face(f));
      }
      return { kind: pattern.kind, held, missing };
    });
  }
  const pairFaces = buckets.map((cards, index) => ({ index, count: cards.length })).sort((a, b) => b.count - a.count || a.index - b.index).slice(0, 7);
  const normal = allocate(best);
  const dublee = allocate(pairFaces.map(({ index }) => ({ kind: 'dublee', faces: [index, index] })));
  const summary = (groups: MaalGroup[]) => ({ groups, missing: groups.reduce((sum, g) => sum + g.missing.length, 0), complete: groups.filter(g => !g.missing.length).length });
  return { normal: summary(normal), dublee: summary(dublee) };
}
