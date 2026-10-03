import test from 'node:test';
import assert from 'node:assert/strict';
import {CoalescedRead} from '../src/multiplayer/CoalescedRead.ts';
const signal=()=>new AbortController().signal;
test('simultaneous invalidations share one read; later invalidations get a fresh read',async()=>{
 let calls=0,finish;
 const reader=new CoalescedRead(async()=>{calls++;if(calls===1)return new Promise(r=>finish=r);return calls;});
 const first=reader.load(signal()),second=reader.load(signal());
 while(!finish)await new Promise(r=>setTimeout(r,5));
 const later=reader.load(signal());finish(1);
 assert.deepEqual(await Promise.all([first,second,later]),[1,1,2]);assert.equal(calls,2);
});
test('cancelling one subscriber does not cancel another subscriber',async()=>{
 const controller=new AbortController();let calls=0;
 const reader=new CoalescedRead(async()=>++calls);
 const first=reader.load(controller.signal),second=reader.load(signal());controller.abort();
 await assert.rejects(first,/cancelled/);assert.equal(await second,1);assert.equal(calls,1);
});
import {committedSnapshot} from '../src/multiplayer/committedSnapshot.ts';
test('late recovery cannot overwrite newer delivered state; a new game may reset its revision',()=>{
 const latest={table_id:'t',table_revision:4,durable_game_id:'g',game:{revision:8}};
 assert.equal(committedSnapshot(latest,{...latest,game:{revision:7}}),latest);
 assert.equal(committedSnapshot(latest,{...latest,table_revision:3}),latest);
 const next={...latest,table_revision:5,durable_game_id:'new',game:{revision:0}};
 assert.equal(committedSnapshot(latest,next),next);
});


test('fallback poll joins the event read in flight rather than scheduling a duplicate',async()=>{
 let calls=0,finish;
 const reader=new CoalescedRead(async()=>{calls++;return new Promise(resolve=>finish=resolve);});
 const event=reader.load(signal());while(!finish)await new Promise(r=>setTimeout(r,2));
 const poll=reader.load(signal(),false);finish(7);
 assert.deepEqual(await Promise.all([event,poll]),[7,7]);assert.equal(calls,1);
});
test('a poll follows a queued newer invalidation rather than joining its older in-flight read',async()=>{
 let calls=0,finish;
 const reader=new CoalescedRead(async()=>{calls++;if(calls===1)return new Promise(resolve=>finish=resolve);return 2;});
 const old=reader.load(signal());while(!finish)await new Promise(r=>setTimeout(r,2));
 const notification=reader.load(signal()),poll=reader.load(signal(),false);finish(1);
 assert.deepEqual(await Promise.all([old,notification,poll]),[1,2,2]);assert.equal(calls,2);
});
