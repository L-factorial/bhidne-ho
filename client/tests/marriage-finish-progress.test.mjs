import test from 'node:test';
import assert from 'node:assert/strict';
import { completionKind, dubleeFinishProgress, finishingGaps, isMarriageWild, normalFinishProgress } from '../src/multiplayer/marriageFinishProgress.ts';
const card = (rank, suit = 'H', deck_index = 0) => ({ card_id: `D${deck_index}:${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[rank] || rank}${suit}`, card_type: 'standard', rank, suit, deck_index });
const man = (i = 0) => ({ card_id: `MAN:${i}`, card_type: 'man', rank: null, suit: null, deck_index: null });
const maal = { tiplu: { rank: 8, suit: 'S' }, jhiplu: { rank: 7, suit: 'S' }, poplu: { rank: 9, suit: 'S' } };
const lockedCards = [2, 5, 11].flatMap(r => [0, 1, 2].map(d => card(r, 'C', d)));
const locked = [0, 3, 6].map(i => ({ meld_type: 'tunnela', card_ids: lockedCards.slice(i, i + 3).map(c => c.card_id) }));

test('wildcards match Tiplu rank across suits, same-suit neighbors, and Man', () => {
  for (const c of [card(8, 'D'), card(7, 'S'), card(9, 'S'), man()]) assert.equal(isMarriageWild(c, maal), true);
  for (const c of [card(7, 'H'), card(9, 'D'), card(2)]) assert.equal(isMarriageWild(c, maal), false);
});

test('completion rules allow natural groups, wildcard sets and sequences, and all-wild groups', () => {
  assert.equal(completionKind([card(14), card(2), card(3)], maal), 'pure_sequence');
  assert.equal(completionKind([card(12), card(13), card(14)], maal), null);
  assert.equal(completionKind([card(4), card(6), man()], maal), 'sequence');
  assert.equal(completionKind([card(4), card(4, 'D'), man()], maal), 'set');
  assert.equal(completionKind([card(4), card(4, 'H', 1), man()], maal), null);
  assert.equal(completionKind([card(4), card(4, 'H', 1), card(4, 'H', 2)], maal), 'tunnela');
  assert.equal(completionKind([man(), card(8, 'D'), card(7, 'S')], maal), 'sequence');
  assert.equal(completionKind([card(4), card(4), man()], maal), null);
  assert.equal(completionKind([card(3), card(7), man()], maal), null);
});

test('Dublee ignores locked pairs and identifies exhausted singleton faces', () => {
  const shown = [{ meld_type: 'dublee', card_ids: [card(4).card_id, card(4, 'H', 1).card_id] }];
  const hand = [card(4), card(4, 'H', 1), card(4, 'H', 2), card(8, 'D'), man()];
  const plan = dubleeFinishProgress(hand, shown, card(8, 'D', 1));
  assert.equal(plan.pairs.length, 0);
  assert.equal(plan.waiting.find(w => w.card.rank === 4).possibleCopies, 0);
  assert.equal(plan.discardHelps, true);
  assert.equal(plan.man.length, 1);
  assert.equal(dubleeFinishProgress(hand, shown, man(1)).discardHelps, false);
  assert.equal(dubleeFinishProgress(hand, shown, card(8, 'D')).discardHelps, false);
});

test('Dublee needs a natural pair even when both unmatched cards are wildcards', () => {
  assert.equal(dubleeFinishProgress([card(8, 'D'), card(8, 'H'), man()], []).pairs.length, 0);
  const hand = [card(8, 'D', 1), card(8, 'D'), card(4), card(4, 'H', 1)];
  const plan = dubleeFinishProgress(hand, []);
  assert.equal(plan.pairs.length, 2);
  assert.deepEqual(plan.pairs, dubleeFinishProgress([...hand].reverse(), []).pairs);
});

test('normal route produces disjoint winning groups and exactly one discard', () => {
  const remaining = [card(3), card(4), card(5), card(6, 'D'), card(7, 'D'), man(),
    card(10), card(10, 'D'), card(10, 'S'), card(12, 'D'), card(13, 'D'), card(8, 'D'), card(2, 'S')];
  const hand = [...lockedCards, ...remaining];
  const plan = normalFinishProgress(hand, locked, maal);
  assert.equal(plan.ready, true);
  assert.equal(plan.covered, 12);
  assert.equal(plan.target, 12);
  assert.equal(plan.unused.length, 1);
  const used = plan.groups.flatMap(g => g.card_ids);
  assert.equal(new Set(used).size, 12);
  assert.ok(used.every(id => !locked.flatMap(g => g.card_ids).includes(id)));
  for (const group of plan.groups) assert.ok(completionKind(hand.filter(c => group.card_ids.includes(c.card_id)), maal));
  assert.deepEqual(normalFinishProgress([...hand].reverse(), locked, maal), plan);
  const before = normalFinishProgress(hand.filter(c => c.card_id !== plan.unused[0].card_id), locked, maal);
  assert.equal(before.covered, 12);
  assert.equal(before.ready, false, 'must draw before finishing');
});

test('coverage reserves a discard even when all thirteen remaining cards form a sequence', () => {
  const hand = [...lockedCards, ...[14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(r => card(r))];
  const plan = normalFinishProgress(hand, locked, maal);
  assert.equal(plan.covered, 12);
  assert.equal(plan.unused.length, 1);
  assert.equal(plan.ready, true);
});

test('long shown sequences reduce the remaining target; they are never reused', () => {
  const shownCards = [2, 3, 4, 5].map(r => card(r, 'C'));
  const shown = [{ meld_type: 'pure_sequence', card_ids: shownCards.map(c => c.card_id) }, ...locked.slice(1)];
  const lockedHand = [...shownCards, ...lockedCards.slice(3)];
  const rest = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(r => card(r));
  const plan = normalFinishProgress([...lockedHand, ...rest], shown, maal);
  assert.equal(plan.target, 11);
  assert.equal(plan.covered, 11);
  assert.equal(plan.unused.length, 1);
});

test('gap hints find inside sequence gaps and same-rank sets without counting an owned fourth copy', () => {
  const gaps = finishingGaps([card(4), card(6)], [card(4), card(6)], maal);
  assert.deepEqual(gaps[0].needed, [{ rank: 5, suit: 'H' }]);
  assert.equal(gaps[0].wildHelps, true);
  const sets = finishingGaps([card(4), card(4, 'D')], [card(4), card(4, 'D')], maal);
  assert.deepEqual(sets[0].needed, [{ rank: 4, suit: 'S' }, { rank: 4, suit: 'C' }]);
  const hand = [card(4), card(6), ...[0, 1, 2].map(d => card(5, 'H', d))];
  assert.deepEqual(finishingGaps(hand.slice(0, 2), hand, maal)[0].needed, []);
});
