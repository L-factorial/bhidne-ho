import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileHandOrder,swapHandCards,cardDropTarget,marriageCardMarker} from '../src/multiplayer/marriageHandOrder.ts';
import {arrangeMarriageHand} from '../src/multiplayer/marriageArrangement.ts';
const card=(id,rank,suit='H')=>({card_id:id,rank,suit,card_type:'standard',deck_index:0});

test('manual swaps work over both arrangements and do not change the private hand',()=>{
  const hand=[card('a',4),card('b',2),card('c',4),card('d',3)];
  for(const mode of ['sequence','dublee']){
    const arranged=arrangeMarriageHand(hand,mode).flatMap(group=>group.cards);
    const ids=arranged.map(card=>card.card_id);
    const swapped=swapHandCards(ids,ids[0],ids[2]);
    assert.equal(swapped[0],ids[2]);assert.equal(swapped[2],ids[0]);
    assert.equal(swapped[1],ids[1]);assert.equal(swapped[3],ids[3]);
    assert.deepEqual(reconcileHandOrder(arranged,swapped).map(card=>card.card_id),swapped);
    assert.deepEqual(reconcileHandOrder(arranged,[]),arranged,'arrangement buttons restore automatic order');
    assert.deepEqual(hand.map(card=>card.card_id),['a','b','c','d']);
  }
});
test('polling preserves manual order, departed cards disappear, and drawn cards append',()=>{
  const hand=[card('a',2),card('b',3),card('c',4)];
  const order=['c','b','a'];
  assert.deepEqual(reconcileHandOrder(hand,order).map(card=>card.card_id),order);
  assert.deepEqual(reconcileHandOrder([hand[0],hand[2],card('new',5)],order).map(card=>card.card_id),['c','a','new']);
  assert.deepEqual(reconcileHandOrder(hand,['c','c','unknown']).map(card=>card.card_id),['c','a','b']);
  assert.deepEqual(swapHandCards(order,'missing','a'),order);
  assert.deepEqual(swapHandCards(order,'c','c'),order);
});
test('drops require a different card hit, including across hand rows',()=>{
  const bounds=[{id:'a',x:10,y:10,width:48,height:76},{id:'b',x:65,y:10,width:48,height:76},{id:'c',x:10,y:105,width:48,height:76}];
  assert.equal(cardDropTarget(bounds,'a',80,40),'b');
  assert.equal(cardDropTarget(bounds,'a',30,140),'c');
  assert.equal(cardDropTarget(bounds,'a',30,40),null);
  assert.equal(cardDropTarget(bounds,'a',60,40),null);
  assert.equal(cardDropTarget(bounds,'a',300,300),null);
});
test('discard selection overrides the newly drawn marker, and deselection restores it',()=>{
  assert.equal(marriageCardMarker(true,false),'drawn');
  assert.equal(marriageCardMarker(false,true),'discard');
  assert.equal(marriageCardMarker(true,true),'discard');
  assert.equal(marriageCardMarker(false,false),null);
});
