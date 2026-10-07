import test from 'node:test';
import assert from 'node:assert/strict';
import { playerError } from '../src/multiplayer/playerError.ts';
import { DistributedRequestError } from '../src/multiplayer/DistributedHttpTransport.ts';
import { ApiError } from '../src/multiplayer/apiResponse.ts';
import { RoomActionPending } from '../src/multiplayer/DistributedRoomActions.ts';
import i18n from '../src/i18n/core.ts';

test('unknown infrastructure details never become player copy', () => {
  for (const message of ['SQLSTATE 40001: secret-db-host', '<html>502 Bad Gateway</html>',
    'Invalid receipt lane_id=abc', 'Redis connection refused', 'TypeError: undefined', 'unfamiliar backend error']) {
    assert.equal(playerError(Error(message), 'Could not load chat.'), 'Could not load chat.');
    assert.doesNotMatch(playerError(Error(message)), /SQLSTATE|Redis|lane_id|html|TypeError|backend/);
  }
});
test('uncertain writes do not look rejected or invite duplicate actions', () => {
  for (const error of [new DistributedRequestError(409), new RoomActionPending()]) {
    const message = playerError(error);
    assert.match(message, /Still confirming/);
    assert.doesNotMatch(message, /failed|rejected|Please retry|409/);
  }
});
test('auth expiry wins over transport ambiguity and leaves diagnostic unchanged', () => {
  const error = new DistributedRequestError(401);
  const before = error.message;
  assert.equal(playerError(error), 'Your session has expired. Please sign in again.');
  assert.equal(error.message, before);
  assert.equal(error.status, 401);
});
test('actionable rules and structured conflicts survive sanitization', () => {
  assert.equal(playerError(Error('Wait for your turn.')), 'Please wait for your turn.');
  assert.equal(playerError(Error('Bet must be a whole number at least the current minimum.')),
    'Bet must be a whole number at least the current minimum.');
  const error = new ApiError(409, 'internal detail', {code:'PLAYER_ALREADY_AT_TABLE',match_id:'private-id'});
  assert.equal(playerError(error), 'Leave your current table before joining another one.');
  assert.equal(error.detail.match_id, 'private-id');
  assert.match(playerError(Error('Username is already taken')), /choose another/);
});
test('timeouts remain visible; cancellation is decided by the caller signal', () => {
  assert.match(playerError(new DOMException('The operation was aborted.', 'AbortError')), /Check your internet/);
  assert.match(playerError(Error('Failed to fetch')), /Check your internet/);
});
test('status-specific feedback and translations are stable through repeated formatting', async () => {
  for (const status of [403,404,429,503]) {
    const message = playerError(new ApiError(status, 'secret internals'));
    assert.equal(playerError(message), message);
    assert.doesNotMatch(message, /secret|internals/);
  }
  await i18n.changeLanguage('ne');
  try { assert.match(playerError(new ApiError(401, 'expired')), /साइन इन/); }
  finally { await i18n.changeLanguage('en'); }
});

test('read failures do not claim an unconfirmed player action', async () => {
  const { DistributedReadClient } = await import('../src/multiplayer/DistributedReadClient.ts');
  const reads = new DistributedReadClient('https://example.test/distributed', 'token',
    async () => ({ok:false,status:503,json:async()=>({})}));
  await assert.rejects(reads.open({kind:'lobby'}, new AbortController().signal), error => {
    assert.match(playerError(error), /cannot connect/);
    assert.doesNotMatch(playerError(error), /confirming/);
    return true;
  });
});

test('session startup failures explain recovery without exposing journal terminology', () => {
  const busy = playerError(Error('This account already has an active journal owner.'));
  assert.match(busy, /another tab or window/);
  assert.match(busy, /Close it, then retry/);
  assert.doesNotMatch(busy, /journal/);
  assert.equal(playerError(busy), busy);
  assert.match(playerError(Error('Persistent storage and Web Locks are required.')), /Allow site storage/);
});

test('native setup failures provide specific localized guidance without native error text',async()=>{
 const {PushSetupError}=await import('../src/notifications/nativeRegistration.ts');
 const codes=['PUSH_PERMISSION_REQUIRED','PUSH_PERMISSION_FAILED','PUSH_TOKEN_FAILED','PUSH_ENVIRONMENT_FAILED','PUSH_BUILD_REQUIRED','PUSH_REGISTRATION_FAILED'];
 try{
  for(const language of ['en','ne']){
   await i18n.changeLanguage(language);
   for(const code of codes){
    const text=playerError(new PushSetupError(code));
    assert.notEqual(text,playerError(Error('unknown error')));assert.doesNotMatch(text,/PUSH_|synthetic-token|native failure/);
   }
  }
 }finally{await i18n.changeLanguage('en');}
});

test('table creation rejections show the exact cause before the HTTP conflict fallback',()=>{
  assert.equal(playerError(new ApiError(409,'An open table with that name already exists in this room.')),
    'A table with this name already exists in this room. Try a different name.');
  assert.match(playerError(new ApiError(409,'Already seated at another active table.')),/invited player.*another table/);
  assert.match(playerError(new ApiError(409,'This room has reached its open-table limit.')),/table limit/);
});


test('community acceptance errors point to the rules instead of generic forbidden feedback',()=>{
  assert.equal(playerError(new ApiError(403,'Accept the community rules in Profile before posting.')),
    'Open Community Rules and accept them to use chat.');
});
