import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecoveryLink } from '../src/auth/recoveryLink.ts';
const token = 'x'.repeat(43);
test('recovery accepts web and app fragments without accepting query credentials', () => {
  for (const origin of ['https://game.example.test/', 'bhidneho://recover']) {
    for (const purpose of ['verify_email','reset_password']) assert.deepEqual(readRecoveryLink(`${origin}#recovery=${purpose}&token=${token}`), {purpose,token});
  }
  for (const url of ['broken', `https://game.example.test/?recovery=verify_email&token=${token}`, 'https://game.example.test/#recovery=verify_email&token=short', `https://game.example.test/#recovery=unknown&token=${token}`]) assert.equal(readRecoveryLink(url),null);
});
