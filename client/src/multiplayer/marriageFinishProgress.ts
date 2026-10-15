import type { MarriageCard, MarriageMeld, MarriageView, MarriageWinningMeld } from './marriage.ts';

export type SeenMaal = NonNullable<NonNullable<MarriageView['private']>['maal']>;
const rank = (card: MarriageCard) => card.rank === 14 ? 1 : card.rank!;
const sameFace = (a: { rank: number | null; suit: string | null }, b: { rank: number | null; suit: string | null }) => a.rank === b.rank && a.suit === b.suit;
export function isMarriageWild(card: MarriageCard, maal: SeenMaal) {
  return card.card_type === 'man' || card.rank === maal.tiplu.rank || sameFace(card, maal.jhiplu) || sameFace(card, maal.poplu);
}

/** Mirrors completion_meld in marriage/completion.py; the server still authorizes FINISH. */
export function completionKind(cards: MarriageCard[], maal: SeenMaal): MarriageWinningMeld['meld_type'] | null {
  if (cards.length < 3 || new Set(cards.map(c => c.card_id)).size !== cards.length) return null;
  const natural = cards.every(c => c.card_type === 'standard');
  if (natural && cards.length === 3 && cards.every(c => sameFace(c, cards[0]))) return "tunnela";
  const orders = [rank, (card: MarriageCard) => card.rank!];
  const runs = orders.map(value => cards.map(value).sort((a, b) => a - b));
  if (natural && cards.every(c => c.suit === cards[0].suit) && runs.some(ranks => ranks.every((r, i) => r === ranks[0] + i))) return 'pure_sequence';
  const fixed = cards.filter(c => !isMarriageWild(c, maal));
  const fixedRanks = fixed.map(rank).sort((a, b) => a - b);
  if (cards.length <= 13 && new Set(fixed.map(c => c.suit)).size <= 1 && orders.some(value => {
      const ranks = fixed.map(value).sort((a, b) => a - b);
      return new Set(ranks).size === ranks.length && (!ranks.length || ranks.at(-1)! - ranks[0] < cards.length);
    })) return "sequence";
  if (cards.length <= 4 && new Set(fixedRanks).size <= 1 && new Set(fixed.map(c => c.suit)).size === fixed.length) return "set";
  return null;
}

function remainingCards(hand: MarriageCard[], shown: MarriageMeld[]) {
  const used = new Set(shown.flatMap(g => g.card_ids));
  return [...new Map(hand.filter(c => !used.has(c.card_id)).map(c => [c.card_id, c])).values()]
    .sort((a, b) => a.card_id.localeCompare(b.card_id));
}

export function dubleeFinishProgress(hand: MarriageCard[], shown: MarriageMeld[], topDiscard?: MarriageCard | null) {
  const cards = remainingCards(hand, shown);
  const faces = new Map<string, MarriageCard[]>();
  for (const card of cards) if (card.card_type === 'standard') {
    const key = `${card.rank}:${card.suit}`;
    faces.set(key, [...(faces.get(key) || []), card]);
  }
  const pairs = [...faces.values()].filter(group => group.length >= 2).map(group => ({ meld_type: "dublee" as const, card_ids: group.slice(0, 2).map(c => c.card_id) }));
  const waiting = [...faces.values()].filter(group => group.length === 1).map(group => ({ card: group[0],
    // Three physical copies total; copies committed to shown pairs cannot return.
    possibleCopies: 3 - hand.filter(c => c.card_type === 'standard' && sameFace(c, group[0])).length,
  }));
  const discardHelps = !!topDiscard && topDiscard.card_type === 'standard' && !hand.some(c => c.card_id === topDiscard.card_id)
    && cards.some(c => c.card_type === 'standard' && sameFace(c, topDiscard));
  return { cards, pairs, waiting, discardHelps, man: cards.filter(c => c.card_type === 'man') };
}

/** Maximum disjoint coverage by valid finishing groups, leaving a discard after drawing.
 * At most 13 uncommitted cards remain after normal qualification.
 */
export function normalFinishProgress(hand: MarriageCard[], shown: MarriageMeld[], maal: SeenMaal) {
  const cards = remainingCards(hand, shown);
  const target = Math.max(0, 21 - shown.reduce((sum, g) => sum + g.card_ids.length, 0));
  if (cards.length > 13) return { groups: [] as MarriageWinningMeld[], unused: cards, covered: 0, target, ready: false };
  const count = 1 << cards.length;
  const sizes = new Uint8Array(count);
  const candidates: { mask: number; group: MarriageWinningMeld }[][] = cards.map(() => []);
  for (let mask = 1; mask < count; mask++) {
    sizes[mask] = sizes[mask >> 1] + (mask & 1);
    if (sizes[mask] < 3 || sizes[mask] > target) continue;
    const held = cards.filter((_, i) => mask & (1 << i));
    const kind = completionKind(held, maal);
    if (!kind) continue;
    const candidate = { mask, group: { meld_type: kind, card_ids: held.map(c => c.card_id) } };
    for (let i = 0; i < cards.length; i++) if (mask & (1 << i)) candidates[i].push(candidate);
  }
  const memo = new Map<number, { covered: number; groups: MarriageWinningMeld[] }>();
  function cover(mask: number): { covered: number; groups: MarriageWinningMeld[] } {
    if (!mask) return { covered: 0, groups: [] };
    const cached = memo.get(mask);
    if (cached) return cached;
    const bit = mask & -mask, first = 31 - Math.clz32(bit);
    let best = cover(mask ^ bit);
    for (const candidate of candidates[first]) if ((mask & candidate.mask) === candidate.mask) {
      const rest = cover(mask ^ candidate.mask);
      const covered = sizes[candidate.mask] + rest.covered;
      if (covered > best.covered) best = { covered, groups: [candidate.group, ...rest.groups] };
      if (best.covered === sizes[mask]) break;
    }
    memo.set(mask, best);
    return best;
  }
  // Removing one physical card first guarantees a legal final discard slot.
  let best = { covered: 0, groups: [] as MarriageWinningMeld[] };
  if (cards.length > target) {
    for (let i = 0; i < cards.length; i++) {
      const plan = cover((count - 1) ^ (1 << i));
      if (plan.covered > best.covered) best = plan;
    }
  } else best = cover(count - 1);
  const used = new Set(best.groups.flatMap(g => g.card_ids));
  return { ...best, unused: cards.filter(c => !used.has(c.card_id)), target,
    ready: hand.length === 22 && best.covered === target };
}

/** One-card completions of leftover two-card groups, not draw probabilities. */
export function finishingGaps(cards: MarriageCard[], hand: MarriageCard[], maal: SeenMaal) {
  const gaps: { held: MarriageCard[]; needed: { rank: number; suit: string }[]; wildHelps: boolean }[] = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const held = [cards[i], cards[j]];
    const needed: { rank: number; suit: string }[] = [];
    for (const suit of ['S', 'C', 'H', 'D']) for (let rank = 2; rank <= 14; rank++) {
      const candidate: MarriageCard = { card_id: 'candidate', card_type: 'standard', rank, suit, deck_index: null };
      if (!isMarriageWild(candidate, maal) && hand.filter(c => c.card_type === 'standard' && sameFace(c, candidate)).length < 3
        && completionKind([...held, candidate], maal)) needed.push({ rank, suit });
    }
    const wildHelps = !!completionKind([...held, { card_id: 'candidate', card_type: 'man', rank: null, suit: null, deck_index: null }], maal);
    if (needed.length || wildHelps) gaps.push({ held, needed, wildHelps });
  }
  return gaps;
}

export type MarriageWinChoice = { melds: MarriageWinningMeld[]; discard_card_id?: string; winning_pair?: string[]; pairs?:MarriageMeld[] };
/** Bounded exact covers: alternatives use physical IDs and keep locked melds intact. */
export function marriageWinChoices(hand: MarriageCard[], shown: MarriageMeld[], maal: SeenMaal|null, route: string, protectedDiscardIds: readonly string[] = [], playerCount=4): MarriageWinChoice[] {
  if(!maal)return unseenMarriageWinChoices(hand,shown,route,playerCount,protectedDiscardIds);
  if (hand.length !== 22) return [];
  const cards = remainingCards(hand, shown);
  if (route === 'dublee' && shown.length === 7) {
    const choices: MarriageWinChoice[] = [];
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].card_type === 'standard' && cards[j].card_type === 'standard' && sameFace(cards[i], cards[j])) {
        const pair = [cards[i].card_id, cards[j].card_id];
        choices.push({ melds: [...shown, { meld_type: 'dublee', card_ids: pair }], winning_pair: pair });
      }
    }
    return choices;
  }
  if (route !== 'normal' || shown.length !== 3 || cards.length > 13) return [];
  const full = (1 << cards.length) - 1;
  const candidates: { mask: number; group: MarriageWinningMeld }[][] = cards.map(() => []);
  for (let mask = 1; mask <= full; mask++) {
    const held = cards.filter((_, i) => mask & (1 << i));
    const kind = completionKind(held, maal);
    if (!kind) continue;
    const item = { mask, group: { meld_type: kind, card_ids: held.map(c => c.card_id) } };
    for (let i = 0; i < cards.length; i++) if (mask & (1 << i)) candidates[i].push(item);
  }
  const memo = new Map<number, MarriageWinningMeld[][]>();
  function covers(mask: number): MarriageWinningMeld[][] {
    if (!mask) return [[]];
    const cached = memo.get(mask); if (cached) return cached;
    const result: MarriageWinningMeld[][] = [];
    const first = 31 - Math.clz32(mask & -mask);
    for (const item of candidates[first]) if ((mask & item.mask) === item.mask) {
      for (const rest of covers(mask ^ item.mask)) {
        result.push([item.group, ...rest]);
        if (result.length >= 24) { memo.set(mask, result); return result; }
      }
    }
    memo.set(mask, result); return result;
  }
  const result: MarriageWinChoice[] = [];
  const protectedDiscards = new Set(protectedDiscardIds);
  for (let i = 0; i < cards.length; i++) {
    if (protectedDiscards.has(cards[i].card_id)) continue;
    for (const groups of covers(full ^ (1 << i))) {
    result.push({ melds: [...shown, ...groups], discard_card_id: cards[i].card_id });
    if (result.length >= 24) return result;
    }
  }
  return result;
}

/** Natural candidates only: no indicator lookup, wildcard substitution or 2^22 scan. */
function unseenNaturalGroups(cards:MarriageCard[]):MarriageWinningMeld[]{
  const buckets=new Map<string,MarriageCard[]>();
  for(const c of cards)if(c.card_type==='standard'){
    const key=`${c.suit}:${c.rank}`;buckets.set(key,[...(buckets.get(key)||[]),c]);
  }
  const groups:MarriageWinningMeld[]=[],seen=new Set<string>();
  const add=(kind:MarriageWinningMeld['meld_type'],held:MarriageCard[])=>{
    const ids=held.map(c=>c.card_id),key=[...ids].sort().join(',');
    if(!seen.has(key)){seen.add(key);groups.push({meld_type:kind,card_ids:ids});}
  };
  for(const bucket of buckets.values())if(bucket.length===3)add('tunnela',bucket);
  const orders=[[14,...Array.from({length:12},(_,i)=>i+2)],Array.from({length:13},(_,i)=>i+2)];
  for(const suit of ['S','C','H','D'])for(const order of orders)for(let start=0;start<order.length;start++)for(let size=3;size<=order.length-start;size++){
    const held=order.slice(start,start+size).map(r=>buckets.get(`${suit}:${r}`)||[]);
    if(held.some(bucket=>!bucket.length))break;
    const choose=(index:number,plan:MarriageCard[])=>{if(index===held.length){add('pure_sequence',plan);return;}for(const c of held[index])choose(index+1,[...plan,c]);};
    choose(0,[]);
  }
  return groups.sort((a,b)=>a.card_ids.length-b.card_ids.length||a.card_ids.join(',').localeCompare(b.card_ids.join(',')));
}

export function unseenMarriageWinChoices(hand:MarriageCard[],shown:MarriageMeld[],route:string,playerCount:number,protectedDiscardIds:readonly string[]=[]):MarriageWinChoice[]{
  if(hand.length!==22)return [];
  const cards=remainingCards(hand,shown),protectedIds=new Set(protectedDiscardIds);
  const results:MarriageWinChoice[]=[];
  if(route!=='dublee'){
    const positions=new Map(cards.map((c,i)=>[c.card_id,i])),full=(1<<cards.length)-1;
    const candidates:{mask:number;group:MarriageWinningMeld}[][]=cards.map(()=>[]);
    for(const group of unseenNaturalGroups(cards)){
      const mask=group.card_ids.reduce((n,id)=>n|(1<<positions.get(id)!),0);
      for(const id of group.card_ids)candidates[positions.get(id)!].push({mask,group});
    }
    const memo=new Map<number,MarriageWinningMeld[][]>();
    function cover(mask:number):MarriageWinningMeld[][]{
      if(!mask)return [[]];
      const cached=memo.get(mask);if(cached)return cached;
      const first=31-Math.clz32(mask&-mask),plans:MarriageWinningMeld[][]=[];
      for(const item of candidates[first])if((mask&item.mask)===item.mask){
        for(const rest of cover(mask^item.mask)){plans.push([item.group,...rest]);if(plans.length>=24){memo.set(mask,plans);return plans;}}
      }
      memo.set(mask,plans);return plans;
    }
    const limit=route==='unqualified'&&playerCount>=4?12:24;
    naturalPlans:for(let i=0;i<cards.length;i++)if(!protectedIds.has(cards[i].card_id)){
      for(const groups of cover(full^(1<<i))){results.push({melds:[...shown,...groups],discard_card_id:cards[i].card_id});if(results.length>=limit)break naturalPlans;}
    }
  }
  if(route==='normal'||playerCount<4)return results;
  for(const discard of cards){
    if(protectedIds.has(discard.card_id))continue;
    const faces=new Map<string,MarriageCard[]>();
    for(const c of cards)if(c.card_id!==discard.card_id&&c.card_type==='standard'){
      const key=`${c.suit}:${c.rank}`;faces.set(key,[...(faces.get(key)||[]),c]);
    }
    const pairs:MarriageMeld[]=[...faces.values()].filter(cs=>cs.length>=2).map(cs=>({meld_type:'dublee',card_ids:cs.slice(0,2).map(c=>c.card_id)}));
    function choose(start:number,plan:MarriageMeld[]){
      if(plan.length+shown.length===8){const all=[...shown,...plan];results.push({melds:all,pairs:all,discard_card_id:discard.card_id});return;}
      for(let i=start;i<pairs.length&&results.length<24;i++)choose(i+1,[...plan,pairs[i]]);
    }
    choose(0,[]);if(results.length>=24)return results;
  }
  return results;
}
