import test from 'node:test';
import assert from 'node:assert/strict';
import {LivePresentation} from '../src/multiplayer/LivePresentation.ts';

test('background effects stay quiet until a new foreground read completes',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);
 const window=new LivePresentation();
 assert.equal(window.fresh(1000),true);
 const original=window.snapshot().epoch;
 now=2000;window.activity(false);
 assert.equal(window.fresh(2000),false);
 window.confirm(window.snapshot().epoch);
 assert.equal(window.snapshot().ready,false);
 now=3000;window.activity(true);
 const current=window.snapshot().epoch;
 window.confirm(original);assert.equal(window.snapshot().ready,false);
 now=4000;window.confirm(current);
 assert.equal(window.fresh(3500),false,'unexpired catch-up effects remain historical');
 assert.equal(window.fresh(4001),true,'new live effects work after hydration');
});
test('a second suspension invalidates an in-flight resume read',t=>{
 let now=1000;t.mock.method(Date,'now',()=>now);
 const window=new LivePresentation();
 window.activity(false);window.activity(true);const request=window.snapshot().epoch;
 window.activity(false);window.activity(true);window.confirm(request);
 assert.equal(window.snapshot().ready,false);
 now=2000;window.confirm(window.snapshot().epoch);assert.equal(window.snapshot().ready,true);
 window.reset();assert.equal(window.snapshot().ready,false);
});
test('normal refreshes preserve the live baseline and listeners clean up',()=>{
 const window=new LivePresentation();let changes=0;
 const stop=window.subscribe(()=>changes++);
 const first=window.snapshot();window.confirm(first.epoch);window.activity(true);
 assert.equal(window.snapshot(),first);
 window.activity(false);assert.equal(changes,1);
 stop();window.activity(true);assert.equal(changes,1);
});
