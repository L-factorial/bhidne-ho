import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, decodeApiResponse } from '../src/multiplayer/apiResponse.ts';

test('plain-text and HTML server errors retain HTTP status without JSON parsing errors', () => {
  for (const [status, body] of [[500, 'Internal Server Error'], [502, '<html>Bad Gateway</html>'], [503, ''], [500, 'null']]) {
    assert.throws(() => decodeApiResponse(body, status), error => error instanceof ApiError && error.status === status
      && error.message === 'The server could not complete this request. Please try again.');
  }
});
test('structured conflicts and authentication errors preserve the client contract', () => {
  const detail = { code: 'ACTIVE_GAME_EXISTS', detail: 'Leave your game first', match_id: 'match', requires_leave_game: true };
  assert.throws(() => decodeApiResponse(JSON.stringify({ detail }), 409), error => error instanceof ApiError
    && error.message === detail.detail && error.detail.match_id === 'match');
  assert.throws(() => decodeApiResponse('Unauthorized', 401), /Session expired/);
  assert.throws(() => decodeApiResponse('{"detail":"Only the owner can delete this room."}', 403), /Only the owner/);
  assert.throws(() => decodeApiResponse('', 400), error => error instanceof ApiError && error.status === 400);
});
test('successful deletes and JSON responses decode; malformed successes remain errors', () => {
  assert.equal(decodeApiResponse('', 204), undefined);
  assert.deepEqual(decodeApiResponse('{"room_id":"room"}', 200), { room_id: 'room' });
  assert.throws(() => decodeApiResponse('<html>Proxy page</html>', 200), /unexpected response/);
});
