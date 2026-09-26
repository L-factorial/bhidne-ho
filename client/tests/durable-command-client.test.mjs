import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
const target = { kind: 'game', room_id: 'room', table_id: 'table', game_id: 'old-game' };
const body = { command: 'PLAY_CARD', match_id: 'old-match', expected_revision: 4, payload: { card: 'AH' } };
const status = (id, state = 'pending') => ({ lane_id: 'lane', sequence: 1, command_id: id, status: state,
  status_reference: { lane_id: 'lane', command_id: id },
  outcome: state === 'pending' ? null : { command_id: id, status: state, revision: 5 } });
const start = transport => {
  let n = 0;
  const c = new DurableCommandClient(transport, { newId: () => `id-${++n}` });
  c.begin(target, body); return c;
};

test('lost committed response retries original ID, payload, revision and old match after reconnect', async () => {
  const seen = [], receipts = new Map(); let effects = 0;
  const c = start({ submit: async request => {
    seen.push(request);
    const id = request.body.command_id;
    if (!receipts.has(id)) { effects++; receipts.set(id, status(id, 'accepted')); throw Error('lost response'); }
    return receipts.get(id);
  }, status: async () => assert.fail('No lane receipt yet') });
  await assert.rejects(c.reconcile(), /lost response/);
  assert.equal(c.begin({ ...target, game_id: 'new-game' }, body), false);
  const exposed = c.request; exposed.body.payload.card = '2C'; exposed.target.game_id = 'new-game';
  assert.equal((await c.reconcile()).status, 'accepted');
  assert.deepEqual(seen[0], seen[1]); assert.equal(effects, 1); assert.equal(c.pending, false);
  assert.equal(c.begin(target, body), true); assert.equal(c.request.body.command_id, 'id-2');
});

test('pending means status-only recovery; rejection is terminal without requiring game revision', async () => {
  let sends = 0, polls = 0;
  const c = start({ submit: async r => { sends++; return status(r.body.command_id); }, status: async ref => {
    polls++; const r = status(ref.command_id, polls === 1 ? 'pending' : 'rejected');
    if (r.outcome) { delete r.outcome.revision; r.outcome.detail = 'Permission revoked'; } return r;
  } });
  await c.reconcile(); assert.equal(c.pending, true);
  await c.reconcile(); assert.equal(c.pending, true);
  assert.equal((await c.reconcile()).outcome.detail, 'Permission revoked');
  await c.reconcile(); assert.equal(sends, 1); assert.equal(polls, 2); assert.equal(c.pending, false);
});

for (const code of [400, 401, 403, 404, 409, 422, 500]) test(`HTTP ${code} does not clear an uncertain command`, async () => {
  const c = start({ submit: async r => status(r.body.command_id), status: async () => { throw Error(`HTTP ${code}`); } });
  await c.reconcile(); const original = c.request;
  await assert.rejects(c.reconcile(), new RegExp(String(code)));
  assert.equal(c.pending, true); assert.deepEqual(c.request, original); assert.equal(c.begin(target, body), false);
});

for (const corrupt of [r => ({ ...r, command_id: 'wrong' }), r => ({ ...r, lane_id: 'other' }),
  r => ({ ...r, sequence: 2 }), r => ({ ...r, status: 'accepted', outcome: null }),
  r => ({ ...r, outcome: { command_id: r.command_id, status: 'accepted' } }),
  r => ({ ...r, status: 'accepted', outcome: { command_id: r.command_id, status: 'rejected' } })]) {
  test('malformed or mismatched receipt preserves pending request', async () => {
    const c = start({ submit: async r => status(r.body.command_id), status: async ref => corrupt(status(ref.command_id)) });
    await c.reconcile(); await assert.rejects(c.reconcile()); assert.equal(c.pending, true);
  });
}

test('timeout bounds an uncooperative transport; late result cannot resolve a newer attempt', async () => {
  let finish, calls = 0;
  const c = new DurableCommandClient({ submit: async r => {
    calls++; if (calls === 1) return new Promise(resolve => { finish = () => resolve(status(r.body.command_id, 'accepted')); });
    return status(r.body.command_id);
  }, status: async ref => status(ref.command_id, 'rejected') }, { timeoutMs: 15, newId: () => 'id' });
  c.begin(target, body);
  await assert.rejects(c.reconcile(), /timed out/); assert.equal(c.pending, true);
  await c.reconcile(); finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.latest.status, 'pending'); assert.equal((await c.reconcile()).status, 'rejected');
});

test('concurrent reconnect reconciliation is bounded and abort retains the intention', async () => {
  let sends = 0;
  const c = start({ submit: async () => { sends++; return new Promise(() => {}); }, status: async () => assert.fail() });
  const abort = new AbortController(), running = c.reconcile(abort.signal);
  await assert.rejects(c.reconcile(), /already running/);
  abort.abort(); await assert.rejects(running, /aborted/);
  assert.equal(sends, 1); assert.equal(c.pending, true);
});

test('logout aborts in-flight work and permanently closes the authenticated session', async () => {
  const c = start({ submit: async () => new Promise(() => {}), status: async () => assert.fail() });
  const running = c.reconcile(); c.close(); await assert.rejects(running);
  assert.equal(c.request, null); assert.equal(c.latest, null);
  assert.throws(() => c.begin(target, body), /closed/); await assert.rejects(c.reconcile(), /closed/);
});

test('caller and transport mutation cannot change retry contents', async () => {
  const input = structuredClone(body), original = structuredClone(target);
  const c = new DurableCommandClient({ submit: async r => { r.body.payload.card = 'bad'; throw Error('failed'); }, status: async () => assert.fail() });
  c.begin(original, input); input.payload.card = '2C'; original.game_id = 'new';
  await assert.rejects(c.reconcile()); assert.equal(c.request.body.payload.card, 'AH'); assert.equal(c.request.target.game_id, 'old-game');
});

test('ID generation works without Web Crypto on native runtimes', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    const transport = { submit: async () => assert.fail(), status: async () => assert.fail() };
    const a = new DurableCommandClient(transport), b = new DurableCommandClient(transport);
    a.begin(target, body); b.begin(target, body);
    assert.ok(a.request.body.command_id.length > 0);
    assert.notEqual(a.request.body.command_id, b.request.body.command_id);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});
