import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffledCallBreakSuits, groupedCallBreakHand, reconcileCallBreakHand } from '../src/multiplayer/callbreakHandOrder.ts';
import { insertHandCardBefore } from '../src/multiplayer/marriageHandOrder.ts';

test('suit shuffle alternates available colors, changes visible order and retains all four suits', () => {
  const red = suit => 'HD'.includes(suit);
  for (const present of [['S','H','C','D'], ['H','C','D'], ['S','C','H'], ['S','H'], ['S','C'], ['D']]) {
    let previous = ['S','H','C','D'];
    for (let i = 0; i < 24; i++) {
      const next = shuffledCallBreakSuits(previous, present, () => i / 24);
      assert.deepEqual([...next].sort(), ['C','D','H','S']);
      const visible = next.filter(suit => present.includes(suit));
      if (present.length > 1) assert.notDeepEqual(visible, previous.filter(suit => present.includes(suit)));
      const colorChanges = visible.slice(1).filter((suit, i) => red(suit) !== red(visible[i])).length;
      assert.equal(colorChanges, present.every(suit => red(suit) === red(present[0])) ? 0 : present.length - 1);
      previous = next;
    }
  }
});

test('manual hand order survives removals and suit filtering, and regrouping restores rank order', () => {
  const hand = ['AS','2H','4S','KC','10D','3H'];
  const grouped = groupedCallBreakHand(hand, ['H','S','D','C']);
  assert.deepEqual(grouped, ['2H','3H','4S','AS','10D','KC']);
  const manual = insertHandCardBefore(grouped, 'KC', '3H');
  assert.deepEqual(reconcileCallBreakHand(grouped, manual), ['2H','KC','3H','4S','AS','10D']);
  assert.deepEqual(reconcileCallBreakHand(grouped.filter(card => card !== '4S'), manual), ['2H','KC','3H','AS','10D']);
  assert.deepEqual(reconcileCallBreakHand(grouped, []).filter(card => card.endsWith('H')), ['2H','3H']);
});
