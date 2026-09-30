import test from 'node:test';
import assert from 'node:assert/strict';
import { validSignupEmail } from '../src/auth/email.ts';

test('signup accepts mailbox aliases and rejects malformed email before submission', () => {
  for (const email of ['player@example.com', ' Player.Name+tag@EXAMPLE.COM ', 'a@b.test']) {
    assert.equal(validSignupEmail(email), true, email);
  }
  for (const email of ['', ' ', 'missing', 'x@localhost', 'a..b@example.com', '.a@example.com',
    'a.@example.com', 'a@-example.com', 'a@example..com', 'a@exam_ple.com', 'x@@example.com',
    'a\r\nb@example.com', 'a\n@example.com', 'a@example.\ncom', 'नमस्ते@example.com', 'a'.repeat(65) + '@example.com']) {
    assert.equal(validSignupEmail(email), false, email);
  }
});
