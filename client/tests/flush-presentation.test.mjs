import test from 'node:test';
import assert from 'node:assert/strict';
import { sortedFlushCards, flushPlayerName } from '../src/multiplayer/flush.ts';

test('revealed Flush cards sort numerically, with face cards and Ace high, without changing deal order', () => {
  const cards = Object.freeze(['AS', '3H', '10D', 'QC', '2S', 'JH', 'KD']);
  assert.deepEqual(sortedFlushCards(cards), ['2S', '3H', '10D', 'JH', 'QC', 'KD', 'AS']);
  assert.deepEqual(cards, ['AS', '3H', '10D', 'QC', '2S', 'JH', 'KD']);
  assert.deepEqual(sortedFlushCards(['7S', '7D', '7H']), ['7D', '7H', '7S']);
  assert.deepEqual(sortedFlushCards([]), []);
});

test('Flush results retain departed participants and never substitute a new player in that seat', () => {
  const participants = [{player_id: '1', display_name: 'ekraj'}, {player_id: '2', display_name: 'prabingiri'}];
  const current = [{player_id: 1, display_name: 'ekraj'}, {player_id: 3, display_name: 'New player'}];
  assert.equal(flushPlayerName('2', participants, current), 'prabingiri');
  assert.equal(flushPlayerName(1, participants, current), 'ekraj');
  assert.equal(flushPlayerName('3', participants, current), 'New player');
  assert.equal(flushPlayerName('1', [], current), 'ekraj');
  assert.equal(flushPlayerName('2', undefined, current), undefined);
});
