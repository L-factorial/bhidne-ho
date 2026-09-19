import test from 'node:test';
import assert from 'node:assert/strict';
import { initialHandDrawer, updateHandDrawer } from '../src/multiplayer/handDrawer.ts';
const input = { deal: 'match:1:1', turn: 'match:1:1:PLAYING:1', revision: 5, hand: ['AS', 'KH'], busy: false, error: '' };
test('opens once per turn, respecting manual collapse and repeated snapshots', () => {
  const opened = updateHandDrawer(initialHandDrawer, input);
  assert.equal(opened.open, true);
  const closed = { ...opened, open: false };
  assert.equal(updateHandDrawer(closed, { ...input, revision: 6 }).open, false);
  const disconnected = updateHandDrawer(closed, { ...input, turn: null, busy: true });
  assert.equal(updateHandDrawer(disconnected, input).open, false);
  assert.equal(updateHandDrawer(closed, { ...input, turn: 'match:1:1:PLAYING:2' }).open, true);
});
test('only a newer authoritative hand confirms a submitted play', () => {
  const state = { ...updateHandDrawer(initialHandDrawer, input), pending: { card: 'AS', revision: 5 } };
  assert.equal(updateHandDrawer(state, { ...input, busy: false }).open, true);
  assert.equal(updateHandDrawer(state, { ...input, hand: ['KH'] }).open, true);
  const accepted = updateHandDrawer(state, { ...input, turn: null, revision: 6, hand: ['KH'] });
  assert.equal(accepted.open, false);
  assert.equal(accepted.pending, null);
  assert.equal(updateHandDrawer(accepted, { ...input, revision: 6, turn: 'match:1:1:PLAYING:2', hand: ['KH'] }).open, true);
});
test('rejected play keeps hand available; interruption does not imply success', () => {
  const state = { ...updateHandDrawer(initialHandDrawer, input), pending: { card: 'AS', revision: 5 } };
  assert.deepEqual(updateHandDrawer(state, { ...input, busy: true, error: 'Offline' }), state);
  const rejected = updateHandDrawer(state, { ...input, error: 'Illegal move' });
  assert.equal(rejected.open, true);
  assert.equal(rejected.pending, null);
});
test('new deals and matches reset pending presentation state; spectator stays closed', () => {
  const state = { ...updateHandDrawer(initialHandDrawer, input), pending: { card: 'AS', revision: 5 } };
  const next = updateHandDrawer(state, { ...input, deal: 'match:1:2', turn: null });
  assert.equal(next.open, false);
  assert.equal(next.pending, null);
  assert.equal(updateHandDrawer(initialHandDrawer, { ...input, turn: null, hand: [] }).open, false);
});
