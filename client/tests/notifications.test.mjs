import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationKey, notificationText } from '../src/notifications/gameNotification.ts';
const snapshot = { match_id: 'match-1', status: 'playing', your_player_id: 1,
  game: { revision: 10, phase: 'BIDDING', turn: { player_id: 1 } },
  deal: { deal_number: 1 }, remaining_ms: 3000 };
test('timer refreshes do not notify again, but new revisions and matches do', () => {
  assert.equal(notificationKey(snapshot), notificationKey({ ...snapshot, remaining_ms: 2000 }));
  assert.notEqual(notificationKey(snapshot), notificationKey({ ...snapshot, game: { ...snapshot.game, revision: 11 } }));
  assert.notEqual(notificationKey(snapshot), notificationKey({ ...snapshot, match_id: 'match-2' }));
});
test('waiting room joins, saved settings, and errors generate updates', () => {
  const waiting = { match_id: 'm', status: 'waiting', players: [{ player_id: 1 }] };
  assert.notEqual(notificationKey(waiting), notificationKey({ ...waiting, players: [...waiting.players, { player_id: 2 }] }));
  assert.notEqual(notificationKey(waiting), notificationKey({ ...waiting, settings: { payments: [1, 2, 3, 0] } }));
  assert.notEqual(notificationKey(snapshot), notificationKey({ ...snapshot, error: 'Game paused' }));
});
test('messages identify bids, card turns, and completion without treating spectators as active', () => {
  assert.equal(notificationText(snapshot), 'Your turn to bid');
  assert.equal(notificationText({ ...snapshot, your_player_id: null }), 'Bidding is open');
  assert.equal(notificationText({ ...snapshot, game: { ...snapshot.game, phase: 'PLAYING' } }), 'Your turn to play a card');
  assert.equal(notificationText({ ...snapshot, game: { ...snapshot.game, finished: true } }), 'Game complete · see the final scores');
});
