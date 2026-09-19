import test from 'node:test';
import assert from 'node:assert/strict';
import { flushDecision, observeFlushDecision } from '../src/multiplayer/flushDecision.ts';

const view = (changes = {}) => ({ public: { status: 'in_progress', round_number: 1, current_player_id: '1', ...changes } });
test('decision follows the requested responder and stops at terminal states', () => {
  assert.equal(flushDecision(view(), true).actor, '1');
  assert.equal(flushDecision(view({ pending_show: { target_id: '2' } }), true).actor, '2');
  assert.equal(flushDecision(view({ pending_side_show: { target_id: '3', revision: 7 } }), true).actor, '3');
  assert.equal(flushDecision(view(), false), null);
  assert.equal(flushDecision(view({ status: 'finished' }), true), null);
  assert.equal(flushDecision(undefined, true), null);
});
test('cue occurs once per personal decision, never on hydration or repeated snapshots', () => {
  let previous = null;
  const observe = (v, personal, ready = true, scope = 'match:me') => {
    const result = observeFlushDecision(previous, { scope, ready, decision: flushDecision(v, true)?.key ?? null }, personal);
    previous = result.observation;
    return result.cue;
  };
  assert.equal(observe(view(), true), false);
  assert.equal(observe(view({ current_player_id: '2' }), false), false);
  assert.equal(observe(view(), true), true);
  assert.equal(observe(view(), true), false);
  assert.equal(observe(view({ revision: 9, visibility: 'seen' }), true), false, 'seeing cards preserves the decision');
  assert.equal(observe(view({ round_number: 2 }), true), true);
  assert.equal(observe(view({ round_number: 2 }), true), false);
  assert.equal(observe(view({ pending_show: { target_id: '1' } }), true), true);
  assert.equal(observe(view({ pending_side_show: { target_id: '1', revision: 12 } }), true), true);
  assert.equal(observe(view({ pending_side_show: { target_id: '1', revision: 12 } }), true), false);
  assert.equal(observe(view({ status: 'finished' }), false), false);
});
test('reconnection and switching match or viewer establish a quiet baseline', () => {
  const previous = { scope: 'a:1', ready: true, decision: 'old' };
  const disconnected = observeFlushDecision(previous, { ...previous, ready: false }, true);
  assert.equal(disconnected.cue, false);
  const synced = observeFlushDecision(disconnected.observation, { ...previous, decision: 'new' }, true);
  assert.equal(synced.cue, false);
  assert.equal(observeFlushDecision(previous, { ...previous, scope: 'b:1', decision: 'new' }, true).cue, false);
  assert.equal(observeFlushDecision(previous, { ...previous, scope: 'a:2', decision: 'new' }, true).cue, false);
});
