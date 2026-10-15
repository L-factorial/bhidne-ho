import type { MarriageCard, MarriageMeld } from './marriage.ts';

type Pattern = { kind: MarriageMeld['meld_type']; faces: number[] };
export type MaalGroup = { kind: MarriageMeld['meld_type']; held: MarriageCard[]; missing: { rank: number; suit: string }[] };
const suits = ['S', 'C', 'H', 'D'];
const face = (index: number) => ({ rank: index % 13 === 0 ? 14 : index % 13 + 1, suit: suits[Math.floor(index / 13)] });
const patterns: Pattern[] = suits.flatMap((_, suit) => [
  ...Array.from({ length: 12 }, (_, rank) => ({ kind: 'pure_sequence' as const, faces: [0, 1, 2].map(offset => suit * 13 + (rank + offset) % 13) })),
  ...Array.from({ length: 13 }, (_, rank) => ({ kind: "tunnela" as const, faces: Array(3).fill(suit * 13 + rank) as number[] })),
]);

/** Minimum additional natural cards for qualification, not a prediction of draws.
 * Three decks, Ace low or high (no wraparound), no wild substitutions before Maal is seen.
 */
function cardBuckets(hand: MarriageCard[]) {
  const buckets: MarriageCard[][] = Array.from({ length: 52 }, () => []);
  const seen = new Set<string>();
  for (const card of hand) {
    const suit = suits.indexOf(card.suit || '');
    const rank = card.rank === 14 ? 1 : card.rank;
    if (seen.has(card.card_id) || card.card_type !== 'standard' || suit < 0 || rank === null || rank < 1 || rank > 13) continue;
    seen.add(card.card_id); buckets[suit * 13 + rank - 1].push(card);
  }
  return buckets.map(cards => cards.sort((a, b) => a.card_id.localeCompare(b.card_id)));
}

export type MaalChoice = { route: 'normal' | 'dublee'; groups: MarriageMeld[] };

/** All distinct natural face combinations. Identical deck copies are interchangeable.
 * Nondecreasing pattern indices remove group-order duplicates while permitting
 * repeated sequences when the hand contains enough physical copies.
 */
const qualificationPatterns: Pattern[] = suits.flatMap((_, suit) => [
  ...[5,4,3].flatMap(size => Array.from({length:15-size}, (_, start) => ({kind:'pure_sequence' as const, faces:Array.from({length:size}, (_, offset)=>suit*13+(start+offset)%13)}))),
  ...Array.from({length:13}, (_, rank)=>({kind:'tunnela' as const, faces:Array(3).fill(suit*13+rank) as number[]})),
]);
export function maalChoices(hand: MarriageCard[], allowDublee = true): MaalChoice[] {
  const buckets = cardBuckets(hand);
  const choices: MaalChoice[] = [];
  function enumerate(route: MaalChoice['route'], candidates: Pattern[], count: number, repeat: boolean) {
    const remaining = buckets.map(cards => [...cards]);
    const chosen: MarriageMeld[] = [];
    function visit(start: number) {
      if (chosen.length === count) { choices.push({ route, groups: [...chosen].sort((a,b)=>b.card_ids.length-a.card_ids.length||a.meld_type.localeCompare(b.meld_type)||a.card_ids[0].localeCompare(b.card_ids[0])) }); return; }
      for (let i = start; i < candidates.length; i++) {
        const pattern = candidates[i];
        const taken: { face: number; card: MarriageCard }[] = [];
        for (const f of pattern.faces) {
          const card = remaining[f].shift();
          if (!card) break;
          taken.push({ face: f, card });
        }
        if (taken.length === pattern.faces.length) {
          chosen.push({ meld_type: pattern.kind, card_ids: taken.map(t => t.card.card_id) });
          visit(repeat ? i : i + 1);
          chosen.pop();
        }
        for (const t of taken.reverse()) remaining[t.face].unshift(t.card);
      }
    }
    visit(0);
  }
  enumerate('normal', qualificationPatterns.filter(p => p.faces.every(f => buckets[f].length >= (p.kind === 'tunnela' ? 3 : 1))), 3, true);
  if(allowDublee) enumerate("dublee", buckets.flatMap((cards, f) => cards.length >= 2 ? [{ kind: "dublee" as const, faces: [f, f] }] : []), 7, false);
  return choices;
}

export type MaalOption = {choice:MaalChoice; variants:MaalChoice[]};
const choiceKey=(choice:MaalChoice)=>choice.route+'|'+choice.groups.map(g=>g.meld_type+':'+[...g.card_ids].sort().join(',')).sort().join('|');
export const maalChoiceSizes=(choice:MaalChoice)=>choice.groups.map(g=>g.card_ids.length).join('-');

/** Prefer the fullest feasible groups; put each unique shorter choice under one
 * parent only. Deck copies are interchangeable for eligibility, as in maalChoices.
 */
export function maalOptions(hand:MarriageCard[], allowDublee=true):MaalOption[]{
  const choices=maalChoices(hand,allowDublee).sort((a,b)=>
    b.groups.reduce((sum,g)=>sum+g.card_ids.length,0)-a.groups.reduce((sum,g)=>sum+g.card_ids.length,0)
    || maalChoiceSizes(b).localeCompare(maalChoiceSizes(a)) || choiceKey(a).localeCompare(choiceKey(b)));
  const byId=new Map(hand.map(c=>[c.card_id,c]));
  const faceKey=(id:string)=>{const c=byId.get(id)!;return `${c.suit}:${c.rank}`;};
  const signature=(choice:MaalChoice)=>choice.route+'|'+choice.groups.map(g=>g.meld_type+':'+g.card_ids.map(faceKey).sort().join(',')).sort().join('|');
  function within(child:MaalChoice,parent:MaalChoice):MaalChoice|null{
    if(child.route!==parent.route)return null;
    function match(index:number,used:Set<number>,groups:MarriageMeld[]):MarriageMeld[]|null{
      if(index===child.groups.length)return groups;
      const group=child.groups[index];
      for(let i=0;i<parent.groups.length;i++){
        const full=parent.groups[i];if(used.has(i)||full.meld_type!==group.meld_type)continue;
        const available=[...full.card_ids],ids:string[]=[];
        for(const id of group.card_ids){const j=available.findIndex(c=>faceKey(c)===faceKey(id));if(j<0)break;ids.push(available.splice(j,1)[0]);}
        if(ids.length!==group.card_ids.length)continue;
        const result=match(index+1,new Set([...used,i]),[...groups,{meld_type:group.meld_type,card_ids:ids}]);if(result)return result;
      }
      return null;
    }
    const groups=match(0,new Set(),[]);return groups?{route:child.route,groups:groups.sort((a,b)=>parent.groups.findIndex(p=>a.card_ids.every(id=>p.card_ids.includes(id)))-parent.groups.findIndex(p=>b.card_ids.every(id=>p.card_ids.includes(id))))}:null;
  }
  const options:MaalOption[]=[],seen=new Set<string>();
  for(const choice of choices){
    const key=signature(choice);if(seen.has(key))continue;seen.add(key);
    let placed=false;
    if(choice.route==='normal')for(const option of options){const variant=within(choice,option.choice);if(variant){option.variants.push(variant);placed=true;break;}}
    if(!placed)options.push({choice,variants:[choice]});
  }
  return options;
}

export function maalProgress(hand: MarriageCard[]) {
  const buckets = cardBuckets(hand);
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
  const summary = (groups: MaalGroup[]) => {
    const used = new Set(groups.flatMap(g => g.held.map(c => c.card_id)));
    return { groups, missing: groups.reduce((sum, g) => sum + g.missing.length, 0), complete: groups.filter(g => !g.missing.length).length,
      unused: hand.filter(c => !used.has(c.card_id)) };
  };
  return { normal: summary(normal), dublee: summary(dublee) };
}
