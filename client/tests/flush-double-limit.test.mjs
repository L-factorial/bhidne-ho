import test from 'node:test';
import assert from 'node:assert/strict';
import { flushDoubleLimit } from '../src/multiplayer/flush.ts';
test('doubling settings accept every whole number from one through five', () => {
  for (const value of [1,2,3,4,5]) {
    assert.equal(flushDoubleLimit(value), value);
    assert.equal(flushDoubleLimit(String(value)), value);
  }
});
test('invalid or missing doubling settings restore one', () => {
  for (const value of [undefined,null,true,false,'','abc','1.5',1.5,0,6,-1,'-1','1e0',NaN,Infinity]) assert.equal(flushDoubleLimit(value),1);
});
