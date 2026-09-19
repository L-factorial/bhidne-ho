import test from 'node:test';
import assert from 'node:assert/strict';
import { tableEntry } from '../src/multiplayer/tableNavigation.ts';
const table = (phase, me = {}) => ({ phase, current_user: me });
test('table entry follows server permissions and lifecycle', () => {
  assert.deepEqual(tableEntry(table('OPEN', { can_join: true })), { label: 'Take seat', action: 'seat' });
  assert.deepEqual(tableEntry(table('OPEN', { can_queue: true })), { label: 'Join queue', action: 'queue' });
  for (const phase of ['LOCKED', 'STARTED']) assert.equal(tableEntry(table(phase, { can_join: true })).action, 'watch');
  assert.equal(tableEntry(table('OPEN', { is_seated: true, can_join: true })).label, 'Return to table');
  assert.equal(tableEntry(table('OPEN', { is_queued: true, can_queue: true })).action, 'watch');
  assert.equal(tableEntry(table('ENDED', { is_seated: true })).label, 'View results');
  assert.equal(tableEntry(table('COMPLETED')).label, 'View results');
  assert.equal(tableEntry({ status: 'waiting' }).action, 'watch');
});
