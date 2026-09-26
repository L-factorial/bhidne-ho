import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableDeliveryClient, discoverDeliveryStreams } from '../src/multiplayer/DurableDeliveryClient.ts';
const event = n => ({ event_id: `e${n}`, lane_id: 'lane', sequence: n, event_type: 'UPDATE', event_version: 1, payload: {} });
const page = (after, scanned, numbers = []) => ({ type: 'DELIVERY_PAGE', lane_id: 'lane', after_sequence: after,
  scanned_sequence: scanned, has_more: false, events: numbers.map(event) });
function setup(overrides = {}) {
  const installed = [], acks = []; let revision = 0;
  const c = new DurableDeliveryClient('lane', { load: async () => ++revision,
    install: v => installed.push(v), acknowledge: async n => acks.push(n), ...overrides });
  return { c, installed, acks };
}
test('recovery loads state without ACK; new events refresh once, duplicates never reapply', async () => {
  const { c, installed, acks } = setup(); await c.recover(2);
  assert.deepEqual(acks, []); await c.receive(page(2, 5, [3, 5])); await c.receive(page(2, 5, [3, 5]));
  assert.deepEqual(installed, [1, 2]); assert.deepEqual(acks, [5, 5]); assert.equal(c.appliedSequence, 5);
});
test('private sequence gaps and empty pages advance safely', async () => {
  const { c, installed, acks } = setup(); await c.recover(0);
  await c.receive(page(0, 4)); await c.receive(page(4, 8, [7]));
  assert.deepEqual(installed, [1, 2]); assert.deepEqual(acks, [4, 8]);
});
test('missing frame does not ACK or move cursor', async () => {
  const { c, acks } = setup(); await c.recover(0);
  await assert.rejects(c.receive(page(3, 4, [4])), /gap/); assert.equal(c.appliedSequence, 0); assert.deepEqual(acks, []);
});
test('lost ACK retries without duplicate view application', async () => {
  let calls = 0; const { c, installed } = setup({ acknowledge: async () => { if (++calls === 1) throw Error('lost ACK'); } });
  await c.recover(0); await assert.rejects(c.receive(page(0, 1, [1])), /lost ACK/);
  await c.receive(page(0, 1, [1])); assert.deepEqual(installed, [1, 2]); assert.equal(calls, 2);
});
test('reconnect on another gateway refreshes current view before replaying old events', async () => {
  const { c, installed } = setup({ load: async () => ({ revision: 50 }) }); await c.recover(0);
  await c.receive(page(0, 2, [1, 2])); assert.ok(installed.every(s => s.revision === 50));
});
test('failed refresh or revoked authorization never ACKs new events', async () => {
  let reads = 0; const { c, acks } = setup({ load: async () => { if (++reads > 1) throw Error('revoked'); return {}; } });
  await c.recover(0); await assert.rejects(c.receive(page(0, 1, [1])), /revoked/);
  assert.equal(c.appliedSequence, 0); assert.deepEqual(acks, []);
});
for (const mutate of [p => p.lane_id = 'other', p => p.events[0].event_version = 2,
  p => p.events[0].sequence = 5, p => p.events.push(p.events[0]), p => p.after_sequence = -1,
  p => p.scanned_sequence = Number.MAX_SAFE_INTEGER + 1]) test('invalid pages fail closed', async () => {
  const { c, acks } = setup(); await c.recover(0); const p = page(0, 1, [1]); mutate(p);
  await assert.rejects(c.receive(p)); assert.deepEqual(acks, []); assert.equal(c.appliedSequence, 0);
});
test('closing subscription ignores an obsolete in-flight snapshot', async () => {
  let finish; const { c, installed } = setup({ load: () => new Promise(resolve => { finish = resolve; }) });
  const pending = c.recover(0); await new Promise(resolve => setImmediate(resolve));
  c.close(); await assert.rejects(pending); finish('private'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(installed, []); assert.equal(c.appliedSequence, null);
});
test('slow stream times out; late results cannot install; another stream progresses', async () => {
  let finish; const installed = [];
  const c = new DurableDeliveryClient('lane', { load: () => new Promise(r => { finish = r; }), install: v => installed.push(v), acknowledge: async () => {} }, 10);
  await assert.rejects(c.recover(0), /timed out/); finish('late'); await new Promise(r => setImmediate(r)); assert.deepEqual(installed, []);
  const other = setup(); await other.c.recover(0); await other.c.receive(page(0, 1, [1])); assert.equal(other.c.appliedSequence, 1);
});
test('devices retain independent application cursors', async () => {
  const a = setup(), b = setup(); await a.c.recover(4); await b.c.recover(0);
  await a.c.receive(page(4, 5, [5])); assert.equal(b.c.appliedSequence, 0);
});
test('catalog pagination discovers new streams and removes revoked ones on next complete refresh', async () => {
  const calls = [], signal = new AbortController().signal;
  const lanes = await discoverDeliveryStreams(async after => { calls.push(after); return after === null
    ? { items: [{ lane_id: 'a' }], next_lane_id: 'a' } : { items: [{ lane_id: 'b' }], next_lane_id: null }; }, signal);
  assert.deepEqual(lanes, ['a', 'b']); assert.deepEqual(calls, [null, 'a']);
  assert.deepEqual(await discoverDeliveryStreams(async () => ({ items: [{ lane_id: 'b' }], next_lane_id: null }), signal), ['b']);
});
test('failed, cyclic or oversized discovery never returns a partial subscription replacement', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(discoverDeliveryStreams(async () => ({ items: [{ lane_id: 'a' }], next_lane_id: 'a' }), signal));
  await assert.rejects(discoverDeliveryStreams(async () => ({ items: [{ lane_id: 'a' }, { lane_id: 'b' }], next_lane_id: null }), signal, 1));
  await assert.rejects(discoverDeliveryStreams(async () => { throw Error('unavailable'); }, signal));
});
test('discovery abort bounds an uncooperative transport', async () => {
  const abort = new AbortController(); const pending = discoverDeliveryStreams(async () => new Promise(() => {}), abort.signal);
  abort.abort(); await assert.rejects(pending);
});

test('overlapping page handlers are refused without an unbounded queue', async () => {
  let finish, reads = 0;
  const { c, acks } = setup({ load: async () => ++reads === 1 ? {} : new Promise(r => { finish = r; }) });
  await c.recover(0); const work = c.receive(page(0, 1, [1]));
  await new Promise(r => setImmediate(r));
  await assert.rejects(c.receive(page(1, 2, [2])), /Serialize/);
  finish({}); await work; assert.deepEqual(acks, [1]);
});
test('failed initial history load does not establish a cursor or permit skipping recovery', async () => {
  const { c, acks } = setup({ load: async () => { throw Error('history unavailable'); } });
  await assert.rejects(c.recover(12)); assert.equal(c.appliedSequence, null);
  await assert.rejects(c.receive(page(12, 13, [13])), /Recover/); assert.deepEqual(acks, []);
});
test('transient presentation is validated, delivered once per cursor and cannot block ACKs',async()=>{
 let shown=0;const {c,acks}=setup({transient:events=>{shown+=events.length;throw Error('UI failed');}});
 await c.recover(0);const p=page(0,1,[1]);p.events[0].event_type='ROOM_POKE';
 await c.receive(p);await c.receive(p);assert.equal(shown,1);assert.deepEqual(acks,[1,1]);
 const invalid=page(1,2,[2]);invalid.events[0].event_type='ROOM_POKE';invalid.events[0].event_version=99;
 await assert.rejects(c.receive(invalid));assert.equal(shown,1);
});
