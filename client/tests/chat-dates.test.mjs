import test from 'node:test';
import assert from 'node:assert/strict';
import { chatDayLabel, localChatDay, localChatTime } from '../src/chatDates.ts';

test('local dates split midnight and use calendar days across daylight saving', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const now = Date.parse('2026-03-09T00:30:00-07:00');
    // Yesterday began over 24 hours ago because of the spring clock change.
    const yesterday = Date.parse('2026-03-08T00:15:00-08:00');
    assert.equal(chatDayLabel(yesterday, now, 'Today', 'Yesterday'), 'Yesterday');
    assert.equal(chatDayLabel(now, now, 'Today', 'Yesterday'), 'Today');
    assert.notEqual(localChatDay(now), localChatDay(Date.parse('2026-03-08T23:59:00-07:00')));
    assert.match(chatDayLabel(Date.parse('2025-12-31T12:00:00Z'), now, 'Today', 'Yesterday'), /2025/);
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test('one instant displays on different local dates in Nepal and California', () => {
  const original = process.env.TZ;
  try {
    const timestamp = Date.parse('2026-10-13T02:00:00Z');
    process.env.TZ = 'America/Los_Angeles';
    const california = localChatDay(timestamp);
    assert.match(localChatTime(timestamp), /PM/);
    process.env.TZ = 'Asia/Kathmandu';
    assert.notEqual(localChatDay(timestamp), california);
    assert.match(localChatTime(timestamp), /7:45.*AM/);
    assert.equal(chatDayLabel(timestamp, timestamp, 'आज', 'हिजो'), 'आज');
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});
