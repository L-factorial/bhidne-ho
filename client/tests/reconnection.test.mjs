import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomConnection } from '../src/multiplayer/RoomConnection.ts';
import { readSession, saveSession } from '../src/multiplayer/session.ts';

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [], statuses = [], urls = [];
  const connection = new RoomConnection('ws://server/room?token=same-token', status => statuses.push(status), url => {
    urls.push(url);
    const socket = { onmessage: null, onclose: null, onerror: null, sent: [], closed: false,
      send(data) { this.sent.push(JSON.parse(data)); }, close() { this.closed = true; },
      receive(type) { this.onmessage?.({ data: JSON.stringify({ type }) }); } };
    sockets.push(socket); return socket;
  });
  connection.start();
  t.after(() => connection.stop());
  return { connection, sockets, statuses, urls };
}

test('reconnect uses the same credential, and ignores messages from a replaced socket', t => {
  const { sockets, statuses, urls } = fixture(t);
  sockets[0].receive('CONNECTED');
  const staleMessage = sockets[0].onmessage;
  sockets[0].onclose();
  assert.equal(statuses.at(-1), 'reconnecting');
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  assert.equal(urls[0], urls[1]);
  staleMessage({ data: '{"type":"CONNECTED"}' });
  assert.equal(statuses.at(-1), 'reconnecting');
  sockets[1].receive('CONNECTED');
  assert.equal(statuses.at(-1), 'connected');
});

test('heartbeat detects a silently dropped connection and stops retrying after leaving', t => {
  const { connection, sockets, statuses } = fixture(t);
  sockets[0].receive('CONNECTED');
  t.mock.timers.tick(5000);
  assert.deepEqual(sockets[0].sent, [{ type: 'HEARTBEAT' }]);
  t.mock.timers.tick(10000);
  assert.equal(statuses.at(-1), 'reconnecting');
  connection.stop();
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 1);
});

test('heartbeats keep healthy connections open and connecting sockets have a timeout', t => {
  const { sockets, statuses } = fixture(t);
  t.mock.timers.tick(10000);
  assert.equal(statuses.at(-1), 'reconnecting');
  t.mock.timers.tick(1000);
  sockets[1].receive('CONNECTED');
  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(5000); sockets[1].receive('HEARTBEAT_ACK');
  }
  assert.equal(sockets.length, 2);
  assert.equal(statuses.at(-1), 'connected');
});

test('leaving during connection setup cancels every reconnect timer', t => {
  const { connection, sockets } = fixture(t);
  connection.stop();
  assert.equal(sockets[0].closed, true);
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 1);
});

test('session restore is per browser tab and server, leaving preserves identity, signing out clears it', t => {
  const tabA = new Map(), tabB = new Map();
  let tab = tabA;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => tab.get(key) ?? null, setItem: (key, value) => tab.set(key, value), removeItem: key => tab.delete(key),
  } });
  t.after(() => { saveSession('server-a', null); delete globalThis.sessionStorage; });
  const saved = { session: { user_id: 'alice', token: 'credential' },
    room: { room_id: 'room', name: 'Friends', members: ['alice'] }, game: 'callbreak' };
  saveSession('server-a', saved);
  assert.equal(readSession('server-a').session.token, 'credential');
  assert.deepEqual(readSession('server-a').room.members, []);
  assert.equal(readSession('server-b'), null);
  tab = tabB;
  assert.equal(readSession('server-a'), null);
  tab = tabA;
  saveSession('server-a', { ...saved, room: null });
  assert.equal(readSession('server-a').room, null);
  assert.equal(readSession('server-a').session.user_id, 'alice');
  saveSession('server-a', null);
  assert.equal(readSession('server-a'), null);
});
