import test from 'node:test';
import assert from 'node:assert/strict';
import { maalProgress } from '../src/multiplayer/maalProgress.ts';
const card = (rank, suit = 'H', deck_index = 0) => ({ card_id: `D${deck_index}:${rank}${suit}`, card_type: 'standard', rank, suit, deck_index });
const triple = (rank, suit) => [0, 1, 2].map(i => card(rank, suit, i));
test('complete natural groups and an inside gap identify the exact needed card', () => {
  const hand = [...triple(9, 'S'), ...triple(12, 'D'), card(4), card(6)];
  const result = maalProgress(hand).normal;
  assert.equal(result.complete, 2);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.groups.flatMap(g => g.missing), [{ rank: 5, suit: 'H' }]);
  assert.equal(maalProgress([...hand, card(5)]).normal.missing, 0);
});
test('overlapping sequences never reuse a physical card', () => {
  const result = maalProgress([1, 2, 3, 4, 5].map(rank => card(rank === 1 ? 14 : rank))).normal;
  assert.equal(result.missing, 4);
  const used = result.groups.flatMap(g => g.held.map(c => c.card_id));
  assert.equal(new Set(used).size, used.length);
});
test('three copies can form three distinct sequences without requesting a fourth copy', () => {
  const hand = [2, 3, 4].flatMap(rank => triple(rank, 'H'));
  assert.equal(maalProgress(hand).normal.complete, 3);
  assert.equal(maalProgress(hand).normal.missing, 0);
  const plan = maalProgress([card(2), card(3)]).normal;
  const counts = new Map();
  for (const g of plan.groups) for (const c of [...g.held, ...g.missing]) {
    const key = `${c.rank}:${c.suit}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert.ok([...counts.values()].every(n => n <= 3));
});
test('Dublees count complete pairs and missing partners rather than triples twice', () => {
  const hand = [2, 3, 4, 5, 6, 7].flatMap(rank => [card(rank), card(rank, 'H', 1)]);
  const result = maalProgress([...hand, card(10)]).dublee;
  assert.equal(result.complete, 6);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.groups.flatMap(g => g.missing), [{ rank: 10, suit: 'H' }]);
  assert.equal(maalProgress([...hand, card(10), card(10, 'H', 1)]).dublee.missing, 0);
  assert.equal(maalProgress(triple(9, 'S')).dublee.complete, 1);
});
test('Ace is low; Man and duplicate physical IDs cannot qualify', () => {
  const base = [...triple(9, 'S'), ...triple(12, 'D')];
  assert.equal(maalProgress([...base, card(14), card(2), card(3)]).normal.missing, 0);
  assert.equal(maalProgress([...base, card(12), card(13), card(14)]).normal.missing, 1);
  const man = { card_id: 'MAN:0', card_type: 'man', rank: null, suit: null, deck_index: null };
  assert.equal(maalProgress([man]).normal.missing, 9);
  assert.equal(maalProgress([man]).dublee.missing, 14);
  assert.equal(maalProgress([card(2), card(2)]).dublee.complete, 0);
});
