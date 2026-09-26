import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandJournal } from '../src/multiplayer/CommandJournal.ts';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
import { DistributedSession } from '../src/multiplayer/DistributedSession.ts';
const target={kind:'room',room_id:'room'}, body={command:'leave-room',payload:{}};
const status=(r,state='accepted')=>({command_id:r.body.command_id,lane_id:'lane',sequence:1,status:state,
 status_reference:{lane_id:'lane',command_id:r.body.command_id},outcome:state==='pending'?null:{command_id:r.body.command_id,status:state}});
const memory=()=>{const data=new Map();return {data,read:k=>data.get(k)??null,write:(k,v)=>data.set(k,v)};};
function client(store,transport,account='alice'){
 const journal=new CommandJournal(store,account,'phone');const c=new DurableCommandClient(transport,{newId:()=> 'original',persistence:journal.bind('slot')});return {c,journal};
}
test('request persisted before send; reload retries original ID after lost committed response',async()=>{
 const store=memory();let effects=0,first;
 const a=client(store,{submit:async r=>{first=r;effects++;assert.ok([...store.data.values()][0].includes('original'));throw Error('lost');},status:async()=>assert.fail()});
 a.c.begin(target,body);await assert.rejects(a.c.reconcile());a.c.close();a.journal.close();
 const b=client(store,{submit:async r=>{assert.deepEqual(r,first);return status(r);},status:async()=>assert.fail()});
 assert.equal(b.c.pending,true);assert.equal(b.c.begin(target,body),false);await b.c.reconcile();assert.equal(effects,1);assert.equal(b.c.pending,false);
});
test('crash before first send restores saved intention',async()=>{
 const store=memory();const a=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});a.c.begin(target,body);a.c.close();a.journal.close();
 let sent;const b=client(store,{submit:async r=>{sent=r;return status(r);},status:async()=>assert.fail()});await b.c.reconcile();assert.equal(sent.body.command_id,'original');
});
test('pending receipt restores status-only recovery; terminal receipt never resubmits',async()=>{
 const store=memory();const a=client(store,{submit:async r=>status(r,'pending'),status:async()=>assert.fail()});a.c.begin(target,body);await a.c.reconcile();a.c.close();a.journal.close();
 const b=client(store,{submit:async()=>assert.fail(),status:async()=>status({body:{command_id:'original'}},'rejected')});await b.c.reconcile();b.c.close();b.journal.close();
 const c=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});assert.equal(c.c.pending,false);assert.equal((await c.c.reconcile()).status,'rejected');
});
for(const committed of [false,true])test(`failed initial write (committed=${committed}) blocks sends until reopen`,async()=>{
 const store=memory(),write=store.write;store.write=(k,v)=>{if(committed)write(k,v);throw Error('disk');};
 const a=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});assert.throws(()=>a.c.begin(target,body),/disk/);
 await assert.rejects(a.c.reconcile());assert.throws(()=>a.c.begin(target,body));store.write=write;a.journal.close();
 const j=new CommandJournal(store,'alice','phone');assert.equal(j.slots.length,committed?1:0);
});
test('receipt write failure preserves recoverable original request and blocks replacement',async()=>{
 const store=memory(),write=store.write;const a=client(store,{submit:async r=>status(r),status:async()=>assert.fail()});a.c.begin(target,body);
 store.write=()=>{throw Error('disk');};await assert.rejects(a.c.reconcile(),/disk/);assert.equal(a.c.pending,true);assert.throws(()=>a.c.begin(target,body));
 store.write=write;a.c.close();a.journal.close();const b=client(store,{submit:async r=>status(r),status:async()=>assert.fail()});await b.c.reconcile();assert.equal(b.c.pending,false);
});
test('logout retains uncertain work only for the original account',()=>{
 const store=memory();const a=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});a.c.begin(target,body);a.c.close();a.journal.close();
 const bob=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()},'bob');assert.equal(bob.c.request,null);
 const alice=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});assert.equal(alice.c.request.body.command_id,'original');
});
test('corrupt or wrong-scope records are preserved and fail closed',()=>{
 for(const raw of ['{','null',JSON.stringify({version:2,account:'alice',device:'phone',slots:[]}),JSON.stringify({version:1,account:'bob',device:'phone',slots:[]})]){
 const store=memory();new CommandJournal(store,'alice','phone');store.write('distributed-commands:["alice","phone"]',raw);
 assert.throws(()=>new CommandJournal(store,'alice','phone'));assert.equal(store.read('distributed-commands:["alice","phone"]'),raw);
 }
});
test('stale journal owner cannot overwrite changes or submit its memory request',async()=>{
 const store=memory();const a=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});
 const b=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});a.c.begin(target,body);
 assert.throws(()=>b.c.begin(target,body),/changed/);await assert.rejects(b.c.reconcile());
});
test('cannot release pending work; terminal slot can be removed',async()=>{
 const store=memory();const {c,journal}=client(store,{submit:async r=>status(r),status:async()=>assert.fail()});c.begin(target,body);
 assert.throws(()=>journal.release('slot'),/unresolved/);await c.reconcile();journal.release('slot');assert.deepEqual(journal.slots,[]);
});
test('session restores offscreen intentions before connect and closes journal on logout',async()=>{
 const store=memory();const a=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});a.c.begin(target,body);a.c.close();a.journal.close();
 let sends=0;const j=new CommandJournal(store,'alice','phone');
 const session=new DistributedSession('phone',{commands:{submit:async r=>{sends++;return status(r);},status:async()=>assert.fail()},discover:async()=>({items:[],next_lane_id:null}),open:async()=>assert.fail(),load:async()=>assert.fail()},
 {install:()=>{},remove:()=>{},error:()=>{}},{refreshMs:300000},j);
 try {assert.equal(session.command('slot').pending,true);await session.connect();assert.equal(sends,1);} finally {session.close();}
 assert.throws(()=>j.bind('new'));
});
test('oversized journal refuses admission before network submission',()=>{
 const store=memory();const {c}=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});
 assert.throws(()=>c.begin(target,{command:'message',payload:{text:'x'.repeat(600000)}}),/bound/);assert.equal(store.data.size,0);
});

test('receipt write that commits then throws restores terminal result without resubmission',async()=>{
 const store=memory(),write=store.write;const a=client(store,{submit:async r=>status(r),status:async()=>assert.fail()});a.c.begin(target,body);
 store.write=(k,v)=>{write(k,v);throw Error('uncertain write');};await assert.rejects(a.c.reconcile());a.c.close();a.journal.close();store.write=write;
 const b=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});assert.equal((await b.c.reconcile()).status,'accepted');
});
test('late response after logout cannot overwrite retained pending work',async()=>{
 const store=memory();let finish;const a=client(store,{submit:r=>new Promise(resolve=>{finish=()=>resolve(status(r));}),status:async()=>assert.fail()});
 a.c.begin(target,body);const work=a.c.reconcile();await new Promise(r=>setImmediate(r));a.c.close();a.journal.close();await assert.rejects(work);
 finish();await new Promise(r=>setImmediate(r));const j=new CommandJournal(store,'alice','phone');assert.equal(j.bind('slot').load().receipt,null);
});
test('mismatched stored receipt cannot restore a falsely completed request',()=>{
 const store=memory();const a=client(store,{submit:async()=>assert.fail(),status:async()=>assert.fail()});a.c.begin(target,body);a.c.close();a.journal.close();
 const [key,raw]=[...store.data.entries()][0],data=JSON.parse(raw);data.slots[0][1].receipt=status({body:{command_id:'different'}});store.write(key,JSON.stringify(data));
 assert.throws(()=>new CommandJournal(store,'alice','phone'),/Mismatched/);
});
test('journal scope must match session device identity',()=>{
 const j=new CommandJournal(memory(),'alice','phone');assert.throws(()=>j.assertDevice('laptop'),/another device/);
});
