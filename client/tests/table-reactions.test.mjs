import test from 'node:test';
import assert from 'node:assert/strict';
import { readTableReaction, tableReactions } from '../src/multiplayer/tableReactions.ts';
const event = { type: 'TABLE_REACTION', id: 'one', room_id: 'room', match_id: 'match', sender_id: 'a', sender_name: 'Alice', sender_player_id: 1, recipient_id: 'b', recipient_player_id: 2, reaction: 'love', expires_at: 2000 };
test('public reactions support every picker tool and retain both endpoints', () => {
  for (const reaction of Object.keys(tableReactions)) {
    const result = readTableReaction({ ...event, reaction }, 'room', 'match', 1000);
    assert.equal(result.sender_player_id, 1);
    assert.equal(result.recipient_player_id, 2);
    assert.equal(result.reaction, reaction);
  }
});
test('ignore other matches, expired, private and malformed events', () => {
  for (const change of [{ match_id: 'other' }, { room_id: 'other' }, { expires_at: 1000 }, { type: 'ROOM_POKE' }, { reaction: '__proto__' }, { reaction: 'unknown' }, { recipient_player_id: null }, { sender_player_id: 0 }]) {
    assert.equal(readTableReaction({ ...event, ...change }, 'room', 'match', 1000), null);
  }
  assert.equal(readTableReaction(null, 'room', 'match', 1000), null);
});
