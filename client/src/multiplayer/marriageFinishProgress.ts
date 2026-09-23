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
  if (natural && cards.length === 3 && cards.every(c => sameFace(c, cards[0]))) return 'tunnela';
  const ranks = cards.map(rank).sort((a, b) => a - b);
  if (natural && cards.every(c => c.suit === cards[0].suit) && ranks.every((r, i) => r === ranks[0] + i)) return 'pure_sequence';
  const fixed = cards.filter(c => !isMarriageWild(c, maal));
  const fixedRanks = fixed.map(rank).sort((a, b) => a - b);
  if (cards.length <= 13 && new Set(fixed.map(c => c.suit)).size <= 1 && new Set(fixedRanks).size === fixedRanks.length
    && (!fixedRanks.length || fixedRanks.at(-1)! - fixedRanks[0] < cards.length)) return 'sequence';
  if (cards.length <= 4 && new Set(fixedRanks).size <= 1 && new Set(fixed.map(c => c.suit)).size === fixed.length) return 'set';
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
  const pairs = [...faces.values()].filter(group => group.length >= 2).map(group => ({ meld_type: 'dublee' as const, card_ids: group.slice(0, 2).map(c => c.card_id) }));
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

export type MarriageWinChoice = { melds: MarriageWinningMeld[]; discard_card_id?: string; winning_pair?: string[] };
/** Bounded exact covers: alternatives use physical IDs and keep locked melds intact. */
export function marriageWinChoices(hand: MarriageCard[], shown: MarriageMeld[], maal: SeenMaal, route: string): MarriageWinChoice[] {
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
  for (let i = 0; i < cards.length; i++) for (const groups of covers(full ^ (1 << i))) {
    result.push({ melds: [...shown, ...groups], discard_card_id: cards[i].card_id });
    if (result.length >= 24) return result;
  }
  return result;
}
