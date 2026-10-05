import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalView, applyViewDelta } from '../src/multiplayer/GameViewDelta.ts';
import { viewDigest } from '../src/multiplayer/ViewDigest.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/game-view-delta.json',import.meta.url),'utf8'));
const digest=async value=>createHash('sha256').update(value,'ascii').digest('hex');

test('Python delta and checksum apply identically in TypeScript',async()=>{
 assert.equal(canonicalView(fixture.before),fixture.canonical_before);
 const original=structuredClone(fixture.before);
 assert.deepEqual(await applyViewDelta(fixture.before,fixture.delta,'match',10,digest),{value:fixture.after,revision:11});
 assert.deepEqual(fixture.before,original);
});
for(const failure of ['gap','identity','base','result','omission','overlap','prototype','array-index']){
 test(`reject ${failure} without changing the installed view`,async()=>{
  const before=structuredClone(fixture.before),delta=structuredClone(fixture.delta);
  if(failure==='gap')delta.base_revision=9;
  if(failure==='identity')delta.game_id='other';
  if(failure==='base')before.turn='unexpected';
  if(failure==='result')delta.checksum='0'.repeat(64);
  if(failure==='omission')delta.operations.pop();
  if(failure==='overlap')delta.operations.push(delta.operations[0]);
  if(failure==='prototype')delta.operations[0].path=['__proto__','polluted'];
  if(failure==='array-index')delta.operations=[{op:'set',path:['cards','0'],value:'X'}];
  const original=structuredClone(before);
  await assert.rejects(applyViewDelta(before,delta,'match',10,digest));
  assert.deepEqual(before,original);assert.equal({}.polluted,undefined);
 });
}
test('canonical checksum ignores insertion order and normalizes negative zero',()=>{
 assert.equal(canonicalView({b:1,a:-0}),canonicalView({a:0,b:1}));
 assert.notEqual(canonicalView({a:true}),canonicalView({a:1}));
 assert.equal(canonicalView({'\u{10000}':1,'\ue000':2}),
  '["object",[["d800dc00",["number","3ff0000000000000"]],["e000",["number","4000000000000000"]]]]');
});
test('unsupported JSON values fail closed',()=>{
 for(const value of [NaN,Infinity,2**53,undefined,{constructor:1},new Date(),[undefined],Array(2)])
  assert.throws(()=>canonicalView(value));
});
test('native-compatible SHA-256 matches independent crypto vectors',async()=>{
 for(const value of ['', 'abc', 'a'.repeat(64), 'a'.repeat(1000),fixture.canonical_before])
  assert.equal(await viewDigest(value),await digest(value));
 assert.deepEqual((await applyViewDelta(fixture.before,fixture.delta,'match',10,viewDigest)).value,fixture.after);
 await assert.rejects(viewDigest('नेपाल'));
});
