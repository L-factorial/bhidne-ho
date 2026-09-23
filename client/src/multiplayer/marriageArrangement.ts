import type { MarriageCard } from './marriage.ts';
export type MarriageArrangement = 'sequence' | 'dublee';
const suitOrder = ['S', 'C', 'H', 'D'];
export function arrangeMarriageHand(hand: MarriageCard[], mode: MarriageArrangement) {
  const rank = (c: MarriageCard) => c.rank === 14 ? 1 : c.rank ?? 99;
  const sorted = [...hand].sort((a,b) => (a.card_type === 'man' ? 4 : suitOrder.indexOf(a.suit!)) - (b.card_type === 'man' ? 4 : suitOrder.indexOf(b.suit!))
    || rank(a)-rank(b) || a.card_id.localeCompare(b.card_id));
  const groups: {label: string; cards: MarriageCard[]}[] = [];
  const used = new Set<string>();
  if (mode === 'dublee') {
    for (let i=0;i<sorted.length-1;i++) {
      const a=sorted[i], b=sorted[i+1];
      if (a.card_type === 'standard' && a.suit===b.suit && a.rank===b.rank && !used.has(a.card_id)) {
        groups.push({label:'Dublee',cards:[a,b]}); used.add(a.card_id);used.add(b.card_id);i++;
      }
    }
  }
  for (const suit of [...suitOrder, null]) {
    const cards=sorted.filter(c=>c.suit===suit && !used.has(c.card_id));
    if(cards.length) groups.push({label:({S:'Spades',C:'Clubs',H:'Hearts',D:'Diamonds'} as Record<string,string>)[suit || ''] || 'Man',cards});
  }
  return groups;
}
