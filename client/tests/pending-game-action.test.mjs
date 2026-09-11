import assert from 'node:assert/strict';
import test from 'node:test';
import { PendingGameAction, GameRequestError } from '../src/multiplayer/PendingGameAction.ts';

const initial = { match_id: 'match', game: { revision: 4 } };
const signal = () => new AbortController().signal;
function queue() {
  const pending = new PendingGameAction();
  pending.begin({ match_id: 'match', expected_revision: 4, command: 'PLAY_CARD', payload: { card: 'AH' } });
  return pending;
}
function response(request, status = 'accepted') {
  return { match_id: 'match', game: { revision: 7 }, private: { hand: ['2C'] },
    action_ack: { command_id: request.command_id, status, revision: 5, detail: status === 'rejected' ? 'Turn changed.' : undefined } };
}

test('lost response retries the exact request, then reconciles a fresh hand and revision', async () => {
  const pending = queue();
  const original = structuredClone(pending.request);
  const requests = [], receipts = new Map();
  let mutations = 0;
  async function send(request) {
    requests.push(structuredClone(request));
    if (!receipts.has(request.command_id)) {
      mutations++;
      receipts.set(request.command_id, response(request));
      throw new TypeError('Response lost after commit');
    }
    return receipts.get(request.command_id);
  }
  await assert.rejects(pending.reconcile(initial, send, signal()), /Response lost/);
  assert.deepEqual(pending.request, original);
  const result = await pending.reconcile({ ...initial, game: { revision: 7 } }, send, signal());
  assert.equal(mutations, 1);
  assert.deepEqual(requests, [original, original]);
  assert.deepEqual(result.snapshot.private.hand, ['2C']);
  assert.equal(result.snapshot.game.revision, 7);
  assert.equal(result.error, '');
  assert.equal(pending.request, null);
});

test('a request lost before arrival can still be accepted with its original revision', async () => {
  const pending = queue();
  await assert.rejects(pending.reconcile(initial, async () => { throw new TypeError('offline'); }, signal()));
  assert.equal((await pending.reconcile(initial, async request => response(request), signal())).error, '');
  assert.equal(pending.request, null);
});

test('a changed turn resolves as a rejection instead of changing the original move', async () => {
  const pending = queue();
  const result = await pending.reconcile({ ...initial, game: { revision: 9 } }, async request => {
    assert.equal(request.expected_revision, 4);
    return response(request, 'rejected');
  }, signal());
  assert.equal(result.error, 'Turn changed.');
  assert.equal(pending.request, null);
});

test('disconnect during delivery keeps the action and ignores the obsolete response', async () => {
  const pending = queue(), controller = new AbortController();
  const request = pending.request;
  const result = await pending.reconcile(initial, async body => {
    controller.abort(); return response(body);
  }, controller.signal);
  assert.equal(result.snapshot, initial);
  assert.equal(pending.request, request);
  await pending.reconcile(initial, async body => response(body), signal());
  assert.equal(pending.request, null);
});

test('changed or missing matches never receive an old action', async () => {
  for (const snapshot of [{ match_id: 'replacement' }, { status: 'empty' }]) {
    const pending = queue();
    const result = await pending.reconcile(snapshot, async () => assert.fail('must not send'), signal());
    assert.match(result.error, /game changed/);
    assert.equal(pending.request, null);
  }
});

test('double taps cannot replace a pending move; new intentions receive different IDs', () => {
  const pending = queue(), original = structuredClone(pending.request);
  assert.equal(pending.begin({ ...original, command: 'PLACE_BID', payload: { amount: 2 } }), false);
  assert.deepEqual(pending.request, original);
  assert.notEqual(queue().request.command_id, original.command_id);
});

test('network, timeout, membership, throttle and server failures retain the pending action', async () => {
  for (const error of [new TypeError('network'), new Error('timeout'), ...[403, 408, 429, 500, 503].map(code => new GameRequestError(code, 'retry'))]) {
    const pending = queue();
    await assert.rejects(pending.reconcile(initial, async () => { throw error; }, signal()));
    assert.ok(pending.request);
  }
});

test('definitive HTTP failures clear the action and show their reason', async () => {
  for (const status of [400, 401, 404, 409, 422]) {
    const pending = queue();
    const result = await pending.reconcile(initial, async () => { throw new GameRequestError(status, 'Rejected request'); }, signal());
    assert.equal(result.error, 'Rejected request');
    assert.equal(pending.request, null);
  }
});

test('missing or unrelated acknowledgments never falsely confirm a move', async () => {
  for (const change of [value => { delete value.action_ack; }, value => { value.action_ack.command_id = 'wrong'; },
    value => { value.match_id = 'wrong'; }, value => { value.action_ack.status = 'unknown'; }]) {
    const pending = queue();
    await assert.rejects(pending.reconcile(initial, async request => {
      const value = response(request); change(value); return value;
    }, signal()), /confirm/);
    assert.ok(pending.request);
  }
});
