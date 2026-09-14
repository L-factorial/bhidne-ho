import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSubmitMarriage, marriageFace, physicalLabel, marriageSuggestions, marriageUsesArc } from '../src/multiplayer/marriage.ts';
test('physical labels distinguish all three copies and Man', () => {
  assert.equal(new Set([0,1,2].map(i => physicalLabel(`D${i}:7H`))).size, 3);
  assert.equal(marriageFace({rank:14, suit:'S'}), 'A♠');
  assert.equal(marriageFace({rank:null, suit:null}), 'Man');
  assert.equal(physicalLabel('MAN:2'), 'Man · 3');
});

const card = (rank, suit, deck_index = 0) => ({ card_id: `D${deck_index}:${rank === 14 ? 'A' : rank}${suit}`, rank, suit, deck_index, card_type: 'standard' });
test('suggestions find seven distinct pairs and exclude Man', () => {
  const hand = Array.from({ length: 7 }, (_, i) => [card(i + 2, 'H'), card(i + 2, 'H', 1)]).flat();
  const result = marriageSuggestions([...hand, { card_id: 'MAN:0', card_type: 'man', rank: null, suit: null }]);
  assert.equal(result.dublees.length, 7);
  assert.equal(new Set(result.dublees.flatMap(g => g.card_ids)).size, 14);
  assert.equal(marriageSuggestions(hand.slice(1)).dublees.length, 0);
});
test('normal suggestions search disjoint physical groups, including Ace low', () => {
  const hand = [card(14, 'S'), card(2, 'S'), card(3, 'S'), ...[0, 1, 2].map(i => card(7, 'H', i)), card(8, 'C'), card(9, 'C'), card(10, 'C')];
  const result = marriageSuggestions(hand).normal;
  assert.equal(result.length, 3);
  assert.equal(new Set(result.flatMap(g => g.card_ids)).size, 9);
  assert.ok(result.some(g => g.meld_type === 'tunnela'));
  assert.equal(marriageSuggestions([card(12, 'S'), card(13, 'S'), card(14, 'S')]).normal.length, 0);
  assert.equal(marriageSuggestions([card(2, 'S'), card(3, 'S'), card(4, 'S'), card(5, 'S'), card(6, 'S')]).normal.length, 0);
});
test('awareness hints expose partial Dublees and melds before qualification is ready', () => {
  const hand = [card(2, 'H'), card(2, 'H', 1), card(3, 'H'), card(4, 'H')];
  const hints = marriageSuggestions(hand);
  assert.equal(hints.pairs.length, 1);
  assert.equal(hints.melds.length, 2, 'both physical copies can participate in a sequence');
  assert.equal(hints.dublees.length, 0);
  assert.equal(hints.normal.length, 0);
  const remaining = marriageSuggestions(hand.filter(c => !hints.pairs[0].card_ids.includes(c.card_id)));
  assert.equal(remaining.pairs.length, 0);
  assert.equal(remaining.melds.length, 0, 'staged cards must not be reused in suggestions');
});
test('arc threshold applies during reveal and after filtering too', () => {
  assert.equal(marriageUsesArc(21, 'fan', true), false);
  assert.equal(marriageUsesArc(16, 'fan', false), false);
  assert.equal(marriageUsesArc(15, 'fan', false), true);
  assert.equal(marriageUsesArc(7, 'grid', false), false);
});
test('declaration submission uses the supported exact group routes', () => {
  const d = {meld_type:'dublee',card_ids:[]}, s = {meld_type:'pure_sequence',card_ids:[]}, t = {meld_type:'tunnela',card_ids:[]};
  assert.equal(canSubmitMarriage(Array(7).fill(d)), 'SHOW_DUBLEES');
  assert.equal(canSubmitMarriage([s,t,s]), 'SHOW_INITIAL_MELDS');
  assert.equal(canSubmitMarriage(Array(6).fill(d)), null);
  assert.equal(canSubmitMarriage([s,d,t]), null);
});
