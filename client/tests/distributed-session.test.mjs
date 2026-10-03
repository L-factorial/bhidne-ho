import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedSession, deliveryClientId } from '../src/multiplayer/DistributedSession.ts';
import { loadSequencedHistory, RevisionView } from '../src/multiplayer/DistributedViews.ts';
const wait = async predicate => { for (let i=0; i<100; i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,2)); } assert.fail('condition not reached'); };
const page = (a,n) => ({type:'DELIVERY_PAGE',lane_id:'a',after_sequence:a,scanned_sequence:n,has_more:false,
  events:[{event_id:`e${n}`,lane_id:'a',sequence:n,event_type:'UPDATE',event_version:1,payload:{}}]});
function fixture(overrides={}, limits={}) {
  const views=[], removed=[], errors=[], opened=[], acks=[], sources=[], health=[]; let lanes=['a'];
  const transport={commands:{submit:async()=>{throw Error('offline');},status:async()=>{throw Error('offline');}},
    discover:async()=>({items:lanes.map(lane_id=>({lane_id})),next_lane_id:null}),
    open:async(lane,id,onPage,onClose)=>{ const h={lane,id,onPage,onClose,closed:false}; opened.push(h);
      return {cursor:0,acknowledge:async n=>acks.push(n),close:()=>{h.closed=true;}}; },
    load:async lane=>({lane}),...overrides};
  const session=new DistributedSession('device',transport,{health:ready=>health.push(ready),install:(lane,v)=>views.push([lane,v]),remove:lane=>removed.push(lane),error:(lane,e,source)=>{errors.push([lane,e]);sources.push(source);}},{refreshMs:300000,...limits});
  return {session,views,removed,errors,opened,acks,sources,health,setLanes:v=>{lanes=v;}};
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

test('intentional disconnect during command recovery does not report a connection failure',async()=>{
 let started=false;
 const f=fixture({commands:{submit:(_request,signal)=>new Promise((_resolve,reject)=>{
   started=true;signal.addEventListener('abort',()=>reject(Error('fetch is aborted')),{once:true});
 }),status:async()=>assert.fail()}});
 f.session.command('game').begin({kind:'game'},{command:'BET',payload:{}});
 try {
   const connecting=f.session.connect();await wait(()=>started);f.session.disconnect();await connecting;
   assert.deepEqual(f.errors,[]);assert.equal(f.session.command('game').pending,true);
 } finally {f.session.close();}
});

test('failed command recovery is separate from delivery health',async()=>{
 const f=fixture();
 try {
   f.session.command('poke').begin({kind:'table'},{command:'send-reaction',payload:{}});
   await f.session.connect();await wait(()=>f.views.length===1);
   assert.deepEqual(f.sources,['command']);assert.equal(f.opened[0].closed,false);
   assert.equal(f.session.command('poke').pending,true);
   f.opened[0].onClose();assert.deepEqual(f.sources,['command','delivery']);
 } finally {f.session.close();}
});

test('successful discovery clears interruption without replacing healthy subscriptions',async t=>{
 let fail=false;
 const f=fixture({discover:async()=>{if(fail)throw Error('temporary failure');return {items:[{lane_id:'a'}],next_lane_id:null};}});
 t.after(()=>f.session.close());await f.session.connect();await wait(()=>f.health.at(-1)===true);
 fail=true;await assert.rejects(f.session.refresh());assert.deepEqual(f.health,[true,false]);
 fail=false;await f.session.refresh();assert.deepEqual(f.health,[true,false,true]);
 assert.equal(f.opened.length,1);assert.equal(f.opened[0].closed,false);assert.equal(f.views.length,1);
});

test('health waits for every authorized stream and ignores obsolete recovery',async t=>{
 const pending={};const f=fixture({load:lane=>new Promise(resolve=>pending[lane]=resolve)});
 f.setLanes(['a','b']);t.after(()=>f.session.close());await f.session.connect();await wait(()=>pending.b);
 pending.a({});await wait(()=>f.views.length===1);assert.deepEqual(f.health,[]);
 f.session.disconnect();pending.b({});await new Promise(r=>setImmediate(r));assert.deepEqual(f.health,[]);
});

test('failed stream automatically recovers while retaining other subscriptions',async t=>{
 const f=fixture({}, {refreshMs:20});f.setLanes(['a','b']);t.after(()=>f.session.close());
 await f.session.connect();await wait(()=>f.health.at(-1)===true);
 const unaffected=f.opened.find(s=>s.lane==='b');f.opened.find(s=>s.lane==='a').onClose();
 assert.equal(f.health.at(-1),false);await wait(()=>f.health.at(-1)===true);
 assert.equal(unaffected.closed,false);assert.equal(f.opened.filter(s=>s.lane==='b').length,1);
 assert.equal(f.opened.filter(s=>s.lane==='a').length,2);
});

test('initial connection becomes healthy only after all stream snapshots are installed',async t=>{
 const pending={};const f=fixture({load:lane=>new Promise(resolve=>pending[lane]=resolve)});
 f.setLanes(['a','b']);t.after(()=>f.session.close());await f.session.connect();await wait(()=>pending.b);
 pending.a({});await wait(()=>f.views.length===1);assert.deepEqual(f.health,[]);
 pending.b({});await wait(()=>f.health.at(-1)===true);assert.equal(f.views.length,2);
});


test('pending command receipts retry without waiting for or repeating healthy discovery',async t=>{
 let discoveries=0,sends=0;
 const f=fixture({discover:async()=>{discoveries++;return {items:[{lane_id:'a'}],next_lane_id:null};},
  commands:{submit:async request=>{
   if(++sends===1)throw Error('response lost');
   const command_id=request.body.command_id;
   return {lane_id:'a',sequence:1,command_id,status:'accepted',outcome:{command_id,status:'accepted',revision:2},status_reference:{lane_id:'a',command_id}};
  },status:async()=>assert.fail()}});
 t.after(()=>f.session.close());await f.session.connect();await wait(()=>f.views.length===1);
 const command=f.session.command('move');command.begin({kind:'game'},{command:'DRAW_CARD',payload:{source:'stock'},expected_revision:1});
 const original=command.request;await assert.rejects(command.reconcile(),/response lost/);
 await new Promise(resolve=>setTimeout(resolve,1100));
 assert.equal(command.latest.status,'accepted');assert.equal(sends,2);assert.equal(discoveries,1);
 assert.deepEqual(command.request,original);assert.equal(f.opened.length,1);
});
