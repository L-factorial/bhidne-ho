const suits = ['S', 'H', 'C', 'D'];
const red = (suit: string) => suit === 'H' || suit === 'D';
const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Prefer alternation among the suits actually present, then avoid the last order. */
export function shuffledCallBreakSuits(previous: readonly string[] = [], present: readonly string[] = suits, random = Math.random): string[] {
  const permutations = (items: string[]): string[][] => items.length ? items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest])) : [[]];
  const visible = (order: readonly string[]) => order.filter(suit => present.includes(suit));
  const score = (order: readonly string[]) => visible(order).slice(1).reduce((sum, suit, index) => sum + Number(red(suit) !== red(visible(order)[index])), 0);
  const candidates = permutations(suits);
  const best = Math.max(...candidates.map(score));
  const alternating = candidates.filter(order => score(order) === best);
  const changed = alternating.filter(order => visible(order).join() !== visible(previous).join());
  const choices = changed.length ? changed : alternating;
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

export function groupedCallBreakHand(hand: readonly string[], order: readonly string[]) {
  return [...hand].sort((a, b) => order.indexOf(a.slice(-1)) - order.indexOf(b.slice(-1))
    || ranks.indexOf(a.slice(0, -1)) - ranks.indexOf(b.slice(0, -1)));
}

export function reconcileCallBreakHand(hand: readonly string[], manual: readonly string[]) {
  return [...manual.filter(card => hand.includes(card)), ...hand.filter(card => !manual.includes(card))];
}
