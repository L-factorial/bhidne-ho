import assert from 'node:assert/strict';
import test from 'node:test';
import { GameCommandClient, createHttpGameTransport } from '../src/multiplayer/GameCommandClient.ts';
import { PendingGameAction } from '../src/multiplayer/PendingGameAction.ts';

const signal = () => new AbortController().signal;

for (const game of [
  { name: 'callbreak', url: 'http://local/test-games/table', command: 'PLAY_CARD', payload: { card: 'AH' },
    fields: { private: { hand: ['2C'] }, scoreboard: [{ total_score_tenths: 30 }] } },
  { name: 'echo', url: 'http://local/games/table', command: 'PING', payload: { message: 'hello' },
    fields: { command_count: 1 } },
]) {
  test(`${game.name}: shared HTTP client recovers a lost response with the same command`, async () => {
    const requests = [], receipts = new Map();
    let revision = 4, mutations = 0;
    const state = () => ({ match_id: 'match', game: { revision }, ...game.fields });
    const fetcher = async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-credential');
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ url, method: options.method, body });
      if (body) {
        assert.equal(body.command, game.command);
        assert.deepEqual(body.payload, game.payload);
        if (!receipts.has(body.command_id)) {
          mutations++; revision++;
          receipts.set(body.command_id, { command_id: body.command_id, status: 'accepted', revision });
          throw new TypeError('Response lost');
        }
      }
      return { ok: true, json: async () => ({ ...state(), ...(body ? { action_ack: receipts.get(body.command_id) } : {}) }) };
    };
    const client = new GameCommandClient(createHttpGameTransport(game.url, 'test-credential', fetcher));
    const original = (await client.refresh(signal())).snapshot;
    assert.equal(client.submit(original, game.command, game.payload), true);
    assert.equal(client.submit(original, game.command, game.payload), false);
    await assert.rejects(client.refresh(signal()), /Response lost/);
    assert.equal(client.pending, true);
    revision++; // Another player's command was processed before reconnect.
    const restored = await client.refresh(signal());
    assert.equal(restored.snapshot.game.revision, 6);
    assert.equal(restored.snapshot.action_ack.revision, 5);
    assert.equal(client.pending, false);
    assert.equal(mutations, 1);
    assert.deepEqual(requests.map(r => r.method), ['GET', 'GET', 'POST', 'GET', 'POST']);
    assert.equal(requests[2].url, game.url + '/action');
    assert.deepEqual(requests[2].body, requests[4].body);
    for (const [key, value] of Object.entries(game.fields)) assert.deepEqual(restored.snapshot[key], value);
  });

  test(`${game.name}: replacing a match does not submit an old pending command`, async () => {
    let sends = 0;
    const client = new GameCommandClient({ snapshot: async () => ({ match_id: 'new', game: { revision: 0 } }),
      action: async () => { sends++; assert.fail('Old match must not receive a command'); } });
    client.submit({ match_id: 'old', game: { revision: 2 } }, game.command, game.payload);
    assert.match((await client.refresh(signal())).error, /game changed/);
    assert.equal(sends, 0); assert.equal(client.pending, false);
  });
}

test('a snapshot started before submission cannot send the newly queued command', async () => {
  let finishSnapshot, sends = 0;
  const snapshot = { match_id: 'match', game: { revision: 2 } };
  const client = new GameCommandClient({ snapshot: () => new Promise(resolve => { finishSnapshot = resolve; }),
    action: async () => { sends++; assert.fail('Need a new snapshot first'); } });
  const refresh = client.refresh(signal());
  client.submit(snapshot, 'PING');
  finishSnapshot(snapshot);
  await refresh;
  assert.equal(sends, 0); assert.equal(client.pending, true);
});

test('aborting snapshot recovery preserves the command and stops action delivery', async () => {
  const controller = new AbortController();
  const snapshot = { match_id: 'match', game: { revision: 2 } };
  const client = new GameCommandClient({ snapshot: async () => { controller.abort(); return snapshot; },
    action: async () => assert.fail('Canceled snapshot cannot send a command') });
  client.submit(snapshot, 'PING');
  await client.refresh(controller.signal);
  assert.equal(client.pending, true);
});

test('a late duplicate acknowledgment cannot clear a newer pending intention', async () => {
  const pending = new PendingGameAction(), snapshot = { match_id: 'match' };
  pending.begin({ match_id: 'match', expected_revision: 0, command: 'PING', payload: {} });
  let finish;
  const ack = body => ({ ...snapshot, action_ack: { command_id: body.command_id, status: 'accepted', revision: 1 } });
  const old = pending.reconcile(snapshot, body => new Promise(resolve => { finish = () => resolve(ack(body)); }), signal());
  await pending.reconcile(snapshot, async body => ack(body), signal());
  pending.begin({ match_id: 'match', expected_revision: 1, command: 'PING', payload: { message: 'next' } });
  const next = pending.request;
  finish(); await old;
  assert.equal(pending.request, next);
});
