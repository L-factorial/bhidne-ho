import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCallBreakRules, formatCallBreakScore } from '../src/multiplayer/callbreakRules.ts';

test('four and five player rule values start disabled with the agreed defaults', () => {
  const four = defaultCallBreakRules(4), five = defaultCallBreakRules(5);
  assert.equal(four.instant_win_bid, 8);
  assert.equal(five.instant_win_bid, 6);
  assert.equal(four.bonus_per_point, 10);
  assert.equal(five.bonus_per_point, 8);
  assert.equal(four.double_win_threshold, 20);
  assert.equal(five.double_win_threshold, 15);
  assert.equal(four.perfect_bid, 1);
  for (const [key, value] of Object.entries(four)) if (key.endsWith('_enabled')) assert.equal(value, false);
});

test('score rendering preserves every Bonus without rounding ties', () => {
  assert.equal(formatCallBreakScore(42), '4.2');
  assert.equal(formatCallBreakScore(33, 8), '4 + 1/8');
  assert.equal(formatCallBreakScore(14, 3), '4 + 2/3');
  assert.equal(formatCallBreakScore(-8, 8), '-1');
  assert.notEqual(formatCallBreakScore(200, 100), formatCallBreakScore(201, 100));
});
