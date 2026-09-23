import test from 'node:test';
import assert from 'node:assert/strict';
import { marriageAnnouncements } from '../src/multiplayer/marriageAnnouncements.ts';
const meld = { meld_type: 'dublee', card_ids: ['D0:2H', 'D1:2H'] };
const player = { player_id: '1', route: 'dublee', has_seen_maal: true, shown_melds: [meld], finished: false };
const pub = { status: 'in_progress', revision: 1, players: [player], winner: null };
test('qualification uses shown groups only, and stays stable across polling revisions', () => {
  const events = marriageAnnouncements(pub);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'qualification');
  assert.deepEqual(events[0].groups, [meld]);
  assert.equal(marriageAnnouncements({ ...pub, revision: 200 })[0].id, events[0].id);
  assert.deepEqual(marriageAnnouncements({ ...pub, players: [{ ...player, has_seen_maal: false }] }), []);
});
test('eighth-pair victory displays only the public pair and seven shown groups', () => {
  const pair = ['D0:3H', 'D1:3H'];
  const events = marriageAnnouncements({ ...pub, status: 'finished', winner: '1', winning_pair: pair, players: [{ ...player, finished: true }] });
  const win = events.at(-1);
  assert.equal(win.kind, 'win'); assert.equal(win.dublee, true);
  assert.deepEqual(win.winningPair, pair); assert.deepEqual(win.groups, [meld]);
  assert.equal(events.length, 2);
});
test('normal victory preserves the full winning groups and final discard', () => {
  const normal_finish = { melds: [{ meld_type: 'set', card_ids: ['D0:5H', 'D0:5S', 'D0:5D'] }], discard_card_id: 'D0:KH' };
  const win = marriageAnnouncements({ ...pub, status: 'finished', winner: '1', normal_finish, players: [{ ...player, route: 'normal', finished: true }] }).at(-1);
  assert.equal(win.dublee, false); assert.equal(win.discard, 'D0:KH');
  assert.deepEqual(win.groups, normal_finish.melds);
});
test('a winner flag alone does not announce an unconfirmed finish', () => {
  assert.equal(marriageAnnouncements({ ...pub, winner: '1' }).filter(e => e.kind === 'win').length, 0);
});
