import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseCard, createTestDeal, legalChoices, stepTestDeal } from '../src/testing/autoplay.ts';

test('heuristic follows suit, beats, trumps, and discards freely only when unable to win', () => {
  const lead = [{player: 0, card: '10♥'}];
  assert.deepEqual(legalChoices(['5♥', 'Q♥', 'A♠'], lead), ['Q♥']);
  assert.deepEqual(legalChoices(['5♥', 'A♠'], lead), ['5♥']);
  assert.deepEqual(legalChoices(['2♣', '3♠'], lead), ['3♠']);
  const trumped = [...lead, {player: 1, card: 'K♠'}];
  assert.deepEqual(legalChoices(['2♣', '3♠'], trumped), ['2♣', '3♠']);
  assert.equal(chooseCard(['2♠', '4♦', '3♣'], []), '3♣');
});

for (const capacity of [4, 5]) test(`${capacity} seats complete 100 deals without duplicate cards, illegal moves or lost tricks`, () => {
  for (let seed = 1; seed <= 100; seed++) {
    let value = seed;
    const random = () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 2 ** 32; };
    let deal = createTestDeal(capacity, random);
    const size = Math.floor(52 / capacity), seen = new Set();
    assert.equal(new Set(deal.hands.flat()).size, size * capacity);
    for (const [index, hand] of deal.hands.entries()) {
      const estimate = hand.filter(card => card.startsWith('A') || ['J♠','Q♠','K♠'].includes(card)).length;
      assert.equal(deal.bids[index], Math.max(1, estimate));
    }
    let steps = 0;
    while (!deal.complete) {
      assert.ok(++steps < 80);
      const before = JSON.stringify(deal), previous = deal;
      deal = stepTestDeal(deal);
      assert.equal(JSON.stringify(previous), before, 'transition must be immutable');
      if (previous.plays.length < capacity) {
        const play = deal.plays.at(-1);
        assert.equal(play.player, previous.turn);
        assert.ok(legalChoices(previous.hands[play.player], previous.plays).includes(play.card));
        assert.ok(!seen.has(play.card)); seen.add(play.card);
      } else {
        assert.equal(deal.turn, previous.lastWinner);
      }
    }
    assert.equal(seen.size, size * capacity);
    assert.equal(deal.tricks.reduce((a,b)=>a+b,0), size);
    assert.equal(deal.trick, size);
    assert.ok(deal.hands.every(hand=>!hand.length));
    assert.equal(stepTestDeal(deal), deal);
  }
});
