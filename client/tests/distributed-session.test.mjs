import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedSession, deliveryClientId } from '../src/multiplayer/DistributedSession.ts';
import { loadSequencedHistory, RevisionView } from '../src/multiplayer/DistributedViews.ts';
const wait = async predicate => { for (let i=0; i<100; i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,2)); } assert.fail('condition not reached'); };
const page = (a,n) => ({type:'DELIVERY_PAGE',lane_id:'a',after_sequence:a,scanned_sequence:n,has_more:false,
  events:[{event_id:`e${n}`,lane_id:'a',sequence:n,event_type:'UPDATE',event_version:1,payload:{}}]});
function fixture(overrides={}, limits={}) {
  const views=[], removed=[], errors=[], opened=[], acks=[]; let lanes=['a'];
  const transport={commands:{submit:async()=>{throw Error('offline');},status:async()=>{throw Error('offline');}},
    discover:async()=>({items:lanes.map(lane_id=>({lane_id})),next_lane_id:null}),
    open:async(lane,id,onPage,onClose)=>{ const h={lane,id,onPage,onClose,closed:false}; opened.push(h);
      return {cursor:0,acknowledge:async n=>acks.push(n),close:()=>{h.closed=true;}}; },
    load:async lane=>({lane}),...overrides};
  const session=new DistributedSession('device',transport,{install:(lane,v)=>views.push([lane,v]),remove:lane=>removed.push(lane),error:(lane,e)=>errors.push([lane,e])},{refreshMs:300000,...limits});
  return {session,views,removed,errors,opened,acks,setLanes:v=>{lanes=v;}};
}
test('device ID survives reconnect/reload storage; separate scopes remain independent',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 assert.equal(deliveryClientId(store,'tab',()=> 'one'),'one'); assert.equal(deliveryClientId(store,'tab',()=> 'two'),'one');
 assert.equal(deliveryClientId(store,'other',()=> 'two'),'two');
 assert.throws(()=>deliveryClientId({getItem:()=>null,setItem:()=>{throw Error('full');}},'tab'));
});
test('ordered buffered pages wait for initial history before ACK',async t=>{
 let finish,loads=0; const f=fixture({load:async()=> ++loads===1?new Promise(r=>finish=r):{}});t.after(()=>f.session.close());
 await f.session.connect(); await wait(()=>finish); f.opened[0].onPage(page(0,1));f.opened[0].onPage(page(1,2));
 assert.deepEqual(f.acks,[]); finish({});await wait(()=>f.acks.length===2); assert.deepEqual(f.acks,[1,2]);
});
test('reconnect preserves command slots; old callbacks cannot reach new subscription',async t=>{
 const f=fixture();t.after(()=>f.session.close());const c=f.session.command('table');c.begin({kind:'room',room_id:'r'},{command:'leave-room',payload:{}});
 await f.session.connect();await wait(()=>f.views.length===1);const old=f.opened[0];
 await f.session.connect();await wait(()=>f.opened.length===2);assert.equal(f.session.command('table'),c);assert.equal(c.pending,true);
 old.onPage(page(0,1));await new Promise(r=>setImmediate(r));assert.deepEqual(f.acks,[]);assert.equal(old.closed,true);
});
test('catalog refresh removes revoked views and adds newly discovered lanes',async t=>{
 const f=fixture();t.after(()=>f.session.close());await f.session.connect();await wait(()=>f.views.length===1);
 f.setLanes(['b']);await f.session.refresh();await wait(()=>f.views.length===2);assert.deepEqual(f.removed,['a']);assert.equal(f.opened[0].closed,true);
});
test('overflow closes subscription without acknowledging buffered work',async t=>{
 let finish;const f=fixture({load:()=>new Promise(r=>finish=r)},{pages:1});t.after(()=>f.session.close());
 await f.session.connect();await wait(()=>finish);f.opened[0].onPage(page(0,1));f.opened[0].onPage(page(1,2));
 assert.equal(f.opened[0].closed,true);assert.deepEqual(f.acks,[]);finish({});await new Promise(r=>setImmediate(r));assert.deepEqual(f.views,[]);
});
test('logout closes commands, clears views and prevents late account data',async()=>{
 let finish;const f=fixture({load:()=>new Promise(r=>finish=r)});const c=f.session.command('slot');
 await f.session.connect();await wait(()=>finish);f.session.close();finish({private:'old'});await new Promise(r=>setImmediate(r));
 assert.deepEqual(f.views,[]);assert.deepEqual(f.removed,['a']);assert.throws(()=>c.begin({kind:'room'},{command:'x',payload:{}}));await assert.rejects(f.session.connect());
});
test('late open handle is closed after disconnect',async t=>{
 let finish,closed=0;const f=fixture({open:()=>new Promise(r=>finish=r)});t.after(()=>f.session.close());await f.session.connect();await wait(()=>finish);
 f.session.disconnect();finish({cursor:0,acknowledge:async()=>{},close:()=>closed++});await wait(()=>closed===1);assert.deepEqual(f.views,[]);
});
test('open timeout removes failed entry so discovery can retry',async t=>{
 const f=fixture({open:()=>new Promise(()=>{})},{timeoutMs:10});t.after(()=>f.session.close());await f.session.connect();await wait(()=>f.errors.length===1);
 assert.deepEqual(f.removed,['a']);await f.session.refresh();await wait(()=>f.errors.length===2);
});
test('worker bound limits simultaneous recoveries',async t=>{
 const finishes=[];const f=fixture({load:()=>new Promise(r=>finishes.push(r))},{workers:2});f.setLanes(['a','b','c']);t.after(()=>f.session.close());
 await f.session.connect();await wait(()=>finishes.length===2);assert.equal(f.opened.length,2);finishes[0]({});await wait(()=>finishes.length===3);
});
test('history loader follows native cursors and refuses truncation',async()=>{
 const signal=new AbortController().signal;
 const fetch=async after=>after===0?{items:[{id:'a',sequence:2}],next_sequence:2}:{items:[{id:'b',sequence:5}],next_sequence:null};
 assert.deepEqual((await loadSequencedHistory(fetch,signal)).map(x=>x.id),['a','b']);await assert.rejects(loadSequencedHistory(fetch,signal,1));
 await assert.rejects(loadSequencedHistory(async()=>({items:[],next_sequence:1}),signal));
});
test('revision view ignores stale loads and old matches; clearing removes private state',()=>{
 const v=new RevisionView();v.select('old');v.install('old',5,{hand:['AH']});assert.equal(v.install('old',4,{}),false);
 v.select('new');assert.equal(v.current,null);assert.equal(v.install('old',6,{}),false);v.install('new',0,{});v.clear();assert.equal(v.current,null);
});

test('server revocation immediately clears view and ignores subsequent pages',async t=>{
 const f=fixture();t.after(()=>f.session.close());await f.session.connect();await wait(()=>f.views.length===1);
 f.opened[0].onClose();f.opened[0].onPage(page(0,1));assert.deepEqual(f.removed,['a']);assert.deepEqual(f.acks,[]);
});
test('failed discovery preserves existing subscriptions instead of applying a partial catalog',async t=>{
 let fail=false;const f=fixture({discover:async()=>{if(fail)throw Error('unavailable');return {items:[{lane_id:'a'}],next_lane_id:null};}});
 t.after(()=>f.session.close());await f.session.connect();await wait(()=>f.views.length===1);fail=true;
 await assert.rejects(f.session.refresh());assert.deepEqual(f.removed,[]);assert.equal(f.opened[0].closed,false);
});
test('a discovery response from a disconnected session cannot open subscriptions',async t=>{
 let finish;const f=fixture({discover:()=>new Promise(r=>finish=r)});t.after(()=>f.session.close());const connecting=f.session.connect();
 await wait(()=>finish);f.session.disconnect();await connecting;finish({items:[{lane_id:'a'}],next_lane_id:null});
 await new Promise(r=>setImmediate(r));assert.deepEqual(f.opened,[]);
});

test('failed stream discovery does not strand previously pending command receipts',async t=>{
 let sends=0;const f=fixture({discover:async()=>{throw Error('catalog unavailable');},commands:{submit:async r=>{sends++;return {lane_id:'lane',sequence:1,command_id:r.body.command_id,status:'pending',outcome:null,status_reference:{lane_id:'lane',command_id:r.body.command_id}};},status:async()=>{throw Error('offline');}}});
 t.after(()=>f.session.close());f.session.command('move').begin({kind:'room',room_id:'r'},{command:'leave-room',payload:{}});
 await f.session.connect();assert.equal(sends,1);assert.equal(f.session.command('move').pending,true);
});
