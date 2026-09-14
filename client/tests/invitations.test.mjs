import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invitationLink, readInvitation } from '../src/multiplayer/invitations.ts';

test('room and game invitations preserve deployment paths without leaking credentials', () => {
  const base = 'https://example.org/bhidne/?token=secret&room=old&match=old#private';
  const room = invitationLink(base, { roomId: 'room-123' });
  assert.equal(room, 'https://example.org/bhidne/?room=room-123');
  assert.deepEqual(readInvitation(room), { roomId: 'room-123' });
  const game = invitationLink(base, { roomId: 'room-123', matchId: 'game_456' });
  assert.deepEqual(readInvitation(game), { roomId: 'room-123', matchId: 'game_456' });
  assert.ok(!game.includes('secret'));
});
test('invalid and unrelated links do not produce invitations', () => {
  for (const url of ['bad', 'https://example.org', 'https://example.org/?match=x', 'https://example.org/?room=..%2Fx',
    'https://example.org/?room=r&match=', 'https://example.org/?room=r&match=%2F', 'javascript:?room=r&match=g'])
    assert.equal(readInvitation(url), null, url);
});
test('native app scheme uses the same invitation identity', () => {
  assert.deepEqual(readInvitation('bhidneho://invite?room=r&match=g'), { roomId: 'r', matchId: 'g' });
});
