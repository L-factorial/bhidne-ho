import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeMarriageHand} from '../src/multiplayer/marriageArrangement.ts';
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${rank}${suit}`,rank,suit,deck_index:deck,card_type:'standard'});
test('sequence tab clusters suits and keeps Ace low and copies adjacent without mutating the hand',()=>{
 const hand=[card(3,'H'),card(2,'S'),card(14,'S'),card(3,'H',1)];
 const original=[...hand], grouped=arrangeMarriageHand(hand,'sequence');
 assert.deepEqual(grouped.map(g=>g.cards.map(c=>c.rank)),[[14,2],[3,3]]);
 assert.deepEqual(hand,original);
});
test('Dublee arrangement pairs three copies once and keeps the third with sorted leftovers',()=>{
 const hand=[card(4,'H',2),card(4,'H'),card(4,'H',1),card(2,'S'),{card_id:'MAN:0',rank:null,suit:null,card_type:'man',deck_index:null}];
 const groups=arrangeMarriageHand(hand,'dublee');
 assert.equal(groups[0].label,'Dublee');assert.equal(groups[0].cards.length,2);
 assert.equal(groups.filter(g=>g.label==='Dublee').length,1);
 assert.deepEqual(groups.flatMap(g=>g.cards.map(c=>c.card_id)).sort(),hand.map(c=>c.card_id).sort());
});

test('both arrangements alternate black and red suit groups without losing copies',()=>{
 for(const mode of ['sequence','dublee']) {
  const hand=['D','C','H','S'].flatMap(suit=>[card(4,suit),card(4,suit,1),card(7,suit)]);
  const groups=arrangeMarriageHand(hand,mode);
  const ordered=groups.filter(g=>mode==='sequence'||g.label==='Dublee').map(g=>g.cards[0].suit);
  assert.deepEqual(ordered,['S','H','C','D']);
  assert.deepEqual(groups.flatMap(g=>g.cards.map(c=>c.card_id)).sort(),hand.map(c=>c.card_id).sort());
 }
});
