import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';
function harness(){
 const hooks=[],effects=[],frames=new Map();let index=0,frameId=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const react={
  useRef(value){const i=index++;return hooks[i]??=( {current:value} );},
  useCallback(fn,deps){const i=index++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={fn,deps};return hooks[i].fn;},
  useEffect(fn,deps){const i=index++;if(!hooks[i]||!same(hooks[i].deps,deps)){hooks[i]={deps};effects.push(fn);}},
 };
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('../src/components/useChatScroll.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{assert.equal(name,'react');return react;},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
 return {render(scope,last,focusId){index=0;const hook=exports.useChatScroll(scope,last,'me',focusId);effects.splice(0).forEach(fn=>fn());return hook;},flush(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}
const position=(offset,height=1000,viewport=200)=>({nativeEvent:{contentOffset:{y:offset},contentSize:{height},layoutMeasurement:{height:viewport}}});
test('sending while reading older messages scrolls to the new message and follows viewport resizing',()=>{
 const h=harness();let scrolls=0;
 let hook=h.render('friend',{id:'old',sender_id:'friend'});hook.scroll.current={scrollToEnd:()=>scrolls++};h.flush();assert.equal(scrolls,1);
 hook.onScroll(position(0));hook=h.render('friend',{id:'incoming',sender_id:'friend'});h.flush();assert.equal(scrolls,1,'incoming message must not pull user away from history');
 hook=h.render('friend',{id:'sent',sender_id:'me'});h.flush();assert.equal(scrolls,2,'own new message must become visible');
 hook.followLayout();assert.equal(scrolls,3,'keyboard/composer resize keeps sent message visible');
 hook=h.render('friend',{id:'sent',sender_id:'me'});h.flush();assert.equal(scrolls,3,'unchanged polls must not repeatedly scroll');
});
test('explicit send completion and opening another conversation reveal latest messages',()=>{
 const h=harness();let scrolls=0;let hook=h.render('room');hook.scroll.current={scrollToEnd:()=>scrolls++};h.flush();
 hook.onScroll(position(0));hook.showLatest();h.flush();assert.equal(scrolls,2);
 hook.onScroll(position(0));hook=h.render('other-room');h.flush();assert.equal(scrolls,3);
});

test('notification opening positions the first unread message once and preserves subsequent reading',()=>{
 const h=harness(),positions=[];let ends=0;
 let hook=h.render('friend',{id:'last',sender_id:'friend'},'unread');
 hook.scroll.current={scrollToEnd:()=>ends++,scrollTo:point=>positions.push(point.y)};
 hook.focusLayout('unread',300);h.flush();assert.deepEqual(positions,[288]);assert.equal(ends,0);
 hook.focusLayout('unread',300);hook.followLayout();h.flush();assert.deepEqual(positions,[288]);
 hook=h.render('friend',{id:'newer',sender_id:'friend'},'unread');h.flush();assert.equal(ends,0);
 hook.showLatest();h.flush();assert.equal(ends,1);
});

test('settling an unread anchor does not jump to a newer own message already in history',()=>{
 const h=harness();let ends=0;
 let hook=h.render('friend',{id:'own-history',sender_id:'me'},'unread');
 hook.scroll.current={scrollToEnd:()=>ends++,scrollTo:()=>{}};
 hook.focusLayout('unread',300);h.flush();
 hook=h.render('friend',{id:'own-history',sender_id:'me'},'unread');h.flush();assert.equal(ends,0);
});
