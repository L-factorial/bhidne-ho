import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invitationLink, readInvitation, readJoinTarget, roomInvitationCode, tableInvitationCode } from '../src/multiplayer/invitations.ts';

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

test('join accepts table codes and links while keeping room codes compatible', () => {
  const target = { roomId: 'room-123', matchId: 'table_456' };
  assert.deepEqual(readJoinTarget(tableInvitationCode(target.roomId, target.matchId)), target);
  assert.deepEqual(readJoinTarget(invitationLink('https://example.org/', target)), target);
  assert.deepEqual(readJoinTarget(' room-123 '), { roomId: 'room-123' });
  for (const value of ['table:r:', 'table::m', 'table:r:m:extra', 'table:../r:m', 'table:r:m/x', '', 'https://example.org/?match=m'])
    assert.equal(readJoinTarget(value), null);
});

test('prefixed codes distinguish rooms and tables without changing stored IDs', () => {
  assert.equal(roomInvitationCode('abc123'), 'r-abc123');
  assert.equal(tableInvitationCode('abc123', 'def456'), 't-abc123:def456');
  assert.deepEqual(readJoinTarget(' r-abc123 '), { roomId: 'abc123' });
  assert.deepEqual(readJoinTarget('T-abc123:def456'), { roomId: 'abc123', matchId: 'def456' });
  assert.deepEqual(readJoinTarget('R-abc123'), { roomId: 'abc123' });
  assert.deepEqual(readJoinTarget('table:abc123:def456'), { roomId: 'abc123', matchId: 'def456' });
  for (const value of ['r-', 'r-../room', 't-', 't-room', 't-room:', 't-:match', 't-room:match:extra', 't-room:../match'])
    assert.equal(readJoinTarget(value), null, value);
});
