import test from 'node:test';
import assert from 'node:assert/strict';
import { isActiveTable } from '../src/multiplayer/tableNavigation.ts';

test('active tabs omit all terminal lifecycle representations', () => {
  for (const status of ['ended', 'finished', 'completed', 'closed', 'abandoned']) {
    assert.equal(isActiveTable({ status }), false);
  }
  for (const phase of ['COMPLETED', 'ENDED']) assert.equal(isActiveTable({ status: 'waiting', phase }), false);
  for (const [status, phase] of [['waiting', 'OPEN'], ['waiting', 'LOCKED'], ['playing', 'STARTED']]) {
    assert.equal(isActiveTable({ status, phase }), true);
  }
});
