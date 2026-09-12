import test from 'node:test';
import assert from 'node:assert/strict';
import { bidProgress } from '../src/multiplayer/bidProgress.ts';

test('bid progress covers pending, chasing, meeting and exceeding a bid', () => {
  assert.equal(bidProgress(0, 0, 13).state, 'pending');
  assert.deepEqual(bidProgress(4, 2, 5), { text: 'Need 2', state: 'chasing' });
  assert.equal(bidProgress(4, 4, 2).text, 'Met');
  assert.equal(bidProgress(4, 6, 0).text, 'Met');
});
test('a bid stays reachable when every remaining trick is needed', () => {
  for (const total of [10, 13]) {
    assert.equal(bidProgress(total, total - 2, 2).state, 'chasing');
    assert.equal(bidProgress(total, total - 2, 1).text, 'Cannot reach bid');
  }
  assert.equal(bidProgress(1, 0, 0).state, 'missed');
  assert.equal(bidProgress(3, 1).text, 'Need 2');
});
