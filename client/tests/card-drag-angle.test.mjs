import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDragAngle } from '../src/multiplayer/cardDragAngle.ts';

test('fan drag rotates toward the displaced card position and remains bounded',()=>{
 for(const initial of [-60,-30,0,30,60]) {
  assert.ok(Math.abs(cardDragAngle(initial,0,0)-initial)<1e-9);
  assert.ok(cardDragAngle(initial,30,0)>initial);
  assert.ok(cardDragAngle(initial,-30,0)<initial);
 }
 assert.ok(cardDragAngle(30,0,-100)<30);
 assert.ok(cardDragAngle(30,0,70)>30);
 for(const dx of [-1000,0,1000]) for(const dy of [-1000,0,1000]) {
  const value=cardDragAngle(0,dx,dy);
  assert.ok(Number.isFinite(value)&&Math.abs(value)<=85);
 }
});
