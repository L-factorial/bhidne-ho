import assert from 'node:assert/strict';
import test from 'node:test';
import { appendPoke, limitPokeText, pokeTextLength, POKE_TEXT_LIMIT, readPoke } from '../src/multiplayer/pokes.ts';
import { RoomConnection } from '../src/multiplayer/RoomConnection.ts';

const event = (overrides = {}) => ({ type: 'ROOM_POKE', id: 'poke-1', room_id: 'room', match_id: 'match',
  sender_id: 'alice', sender_player_id: 1, recipient_id: 'bob', recipient_player_id: 2,
  scope: 'private', text: 'Your move, legend!', expires_at: 6000, ...overrides });

test('private poke parsing accepts only this recipient in this room', () => {
  assert.ok(readPoke(event(), 'room', 'bob', 1000));
  assert.equal(readPoke(event(), 'elsewhere', 'bob', 1000), null);
  assert.equal(readPoke(event(), 'room', 'alice', 1000), null);
  assert.equal(readPoke(event(), 'room', 'bob', 6000), null);
  assert.equal(readPoke(event({ text: 'x'.repeat(POKE_TEXT_LIMIT + 1) }), 'room', 'bob', 1000), null);
  assert.equal(readPoke(event({ sender_player_id: 0 }), 'room', 'bob', 1000), null);
});

test('table pokes have no private recipient and can be shown to any room member', () => {
  const broadcast = event({ scope: 'table', recipient_id: null, recipient_player_id: null });
  assert.ok(readPoke(broadcast, 'room', 'spectator', 1000));
  // Flush retains stable seat IDs as players leave and join the table.
  assert.ok(readPoke({ ...broadcast, sender_player_id: 19 }, 'room', 'spectator', 1000));
  assert.equal(readPoke(event({ scope: 'table' }), 'room', 'bob', 1000), null);
});

test('popup inbox deduplicates, expires messages, and bounds simultaneous messages', () => {
  let inbox = appendPoke([], event(), 1000);
  inbox = appendPoke(inbox, event(), 1000);
  assert.equal(inbox.length, 1);
  for (let i = 2; i <= 5; i++) inbox = appendPoke(inbox, event({ id: `poke-${i}` }), 1000);
  assert.deepEqual(inbox.map(p => p.id), ['poke-3', 'poke-4', 'poke-5']);
  assert.deepEqual(appendPoke(inbox, event({ id: 'new', expires_at: 12000 }), 7000).map(p => p.id), ['new']);
});

test('poke payloads respect the current Unicode limit without splitting emoji', () => {
  assert.equal(limitPokeText('x'.repeat(40)), 'x'.repeat(POKE_TEXT_LIMIT));
  assert.equal(limitPokeText('😏'.repeat(40)), '😏'.repeat(POKE_TEXT_LIMIT));
  assert.equal(pokeTextLength('😏'.repeat(25)), 25);
});

test('room socket forwards live events and ignores obsolete sockets after reconnect', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [], received = [];
  const connection = new RoomConnection('ws://local/room', () => {}, () => {
    const socket = { send() {}, close() {}, onmessage: null, onclose: null, onerror: null };
    sockets.push(socket); return socket;
  }, message => received.push(message));
  connection.start(); t.after(() => connection.stop());
  sockets[0].onmessage({ data: JSON.stringify(event()) });
  const obsolete = sockets[0].onmessage;
  sockets[0].onclose(); t.mock.timers.tick(1000);
  obsolete({ data: JSON.stringify(event({ id: 'old' })) });
  sockets[1].onmessage({ data: 'null' });
  sockets[1].onmessage({ data: JSON.stringify(event({ id: 'new' })) });
  assert.deepEqual(received.map(p => p.id), ['poke-1', 'new']);
});
