import test from 'node:test';
import assert from 'node:assert/strict';
import { tableEntry, isVisibleRoomTable, isActiveTable } from '../src/multiplayer/tableNavigation.ts';
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
test('completed room tables remain reachable only while the viewer holds a seat', () => {
  const completed = { status: 'finished', ...table('COMPLETED', { is_seated: true, can_leave_seat: true }) };
  assert.equal(isVisibleRoomTable(completed), true);
  assert.equal(tableEntry(completed).label, 'Return to table');
  assert.equal(isActiveTable(completed), false);
  assert.equal(isVisibleRoomTable({ ...completed, current_user: { is_seated: false } }), false);
  assert.equal(isVisibleRoomTable({ ...completed, current_user: { is_seated: false }, can_end_table: true }), true);
  assert.equal(isVisibleRoomTable({ ...completed, phase: 'ENDED' }), false);
  assert.equal(isVisibleRoomTable({ ...completed, status: 'ended' }), false);
  assert.equal(isVisibleRoomTable({ status: 'waiting', ...table('OPEN') }), true);
});
