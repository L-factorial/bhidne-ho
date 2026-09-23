import test from 'node:test';
import assert from 'node:assert/strict';
import { maalChoices, maalProgress } from '../src/multiplayer/maalProgress.ts';
const card = (rank, suit = 'H', deck_index = 0) => ({ card_id: `D${deck_index}:${rank}${suit}`, card_type: 'standard', rank, suit, deck_index });
const triple = (rank, suit) => [0, 1, 2].map(i => card(rank, suit, i));

test('offers both three repeated sequences and three Tunnelas without group-order duplicates', () => {
  const hand = [2, 3, 4].flatMap(rank => triple(rank, 'H'));
  const choices = maalChoices(hand);
  assert.equal(choices.length, 2);
  assert.deepEqual(choices.map(c => c.groups.map(g => g.meld_type)).sort(), [
    ['pure_sequence', 'pure_sequence', 'pure_sequence'], ['tunnela', 'tunnela', 'tunnela'],
  ]);
  for (const choice of choices) {
    const ids = choice.groups.flatMap(g => g.card_ids);
    assert.equal(new Set(ids).size, 9);
    assert.deepEqual(ids.sort(), hand.map(c => c.card_id).sort());
  }
  assert.deepEqual(maalChoices([...hand].reverse()), choices);
});

test('eight available pairs offer every choice of seven pairs', () => {
  const hand = [2, 3, 4, 5, 6, 7, 8, 9].flatMap(rank => [card(rank), card(rank, 'H', 1)]);
  const choices = maalChoices(hand).filter(c => c.route === 'dublee');
  assert.equal(choices.length, 8);
  assert.equal(new Set(choices.map(c => c.groups.flatMap(g => g.card_ids).sort().join(','))).size, 8);
  assert.ok(choices.every(c => c.groups.length === 7 && new Set(c.groups.flatMap(g => g.card_ids)).size === 14));
  assert.ok(maalChoices(hand).some(c => c.route === 'normal'));
});

test('ready choices update on drawing and disappear when the necessary card is discarded', () => {
  const before = [...triple(9, 'S'), ...triple(12, 'D'), card(4), card(6)];
  assert.deepEqual(maalChoices(before), []);
  const after = [...before, card(5)];
  assert.equal(maalChoices(after).length, 1);
  assert.deepEqual(maalChoices(after.filter(c => c.card_id !== card(4).card_id)), []);
  assert.deepEqual(maalChoices([...before, card(12), card(13), card(14)]), []);
});

test('duplicate IDs, overlapping groups, and Man never create false qualification', () => {
  assert.deepEqual(maalChoices([2, 3, 4, 5, 6].map(rank => card(rank))), []);
  assert.deepEqual(maalChoices(Array(9).fill(card(2))), []);
  assert.deepEqual(maalChoices([...triple(9, 'S'), ...triple(12, 'D'), card(4), card(6),
    { card_id: 'MAN:0', card_type: 'man', rank: null, suit: null, deck_index: null }]), []);
});
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
test('each route accounts for the whole hand, including Man outside natural groups', () => {
  const man = { card_id: 'MAN:0', card_type: 'man', rank: null, suit: null, deck_index: null };
  const hand = [...triple(9, 'S'), card(4), card(6), card(12, 'D'), man];
  for (const plan of Object.values(maalProgress(hand))) {
    const held = plan.groups.flatMap(g => g.held.map(c => c.card_id));
    const unused = plan.unused.map(c => c.card_id);
    assert.deepEqual([...held, ...unused].sort(), hand.map(c => c.card_id).sort());
    assert.ok(unused.includes('MAN:0'));
    assert.equal(new Set([...held, ...unused]).size, hand.length);
  }
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
