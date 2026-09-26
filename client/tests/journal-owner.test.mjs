import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireJournal } from '../src/multiplayer/journalPlatform.ts';
import { acquireNativeJournal } from '../src/multiplayer/nativeJournalOwner.ts';
import { OwnedSession } from '../src/multiplayer/JournalOwner.ts';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
const signal=()=>new AbortController().signal;
const turn=()=>new Promise(r=>setImmediate(r));
function environment() {
 const data=new Map(),held=new Set();
 return {data,held,storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},
 locks:{request:async(key,options,callback)=>{
   assert.equal(options.ifAvailable,true);
   if(held.has(key)) return callback(null);
   held.add(key);try{return await callback({name:key});}finally{held.delete(key);}
 }}};
}
const begin=owner=>{
 const c=new DurableCommandClient({submit:async()=>assert.fail(),status:async()=>assert.fail()},{persistence:owner.journal.bind('table')});
 c.begin({kind:'room',room_id:'r'},{command:'leave-room',payload:{}});return c;
};
test('browser duplicates cannot bypass unresolved commands; handoff restores ID and request',async()=>{
 const env=environment(),owner=await acquireJournal('alice',signal(),env),c=begin(owner),request=c.request;
 await assert.rejects(acquireJournal('alice',signal(),env),/active journal/);
 const id=owner.clientId;c.close();owner.close();await turn();
 const next=await acquireJournal('alice',signal(),env);
 try {assert.equal(next.clientId,id);assert.deepEqual(next.journal.bind('table').load().request,request);}finally{next.close();}
});
test('browser storage errors release lock and never return an owner',async()=>{
 const env=environment();env.storage.setItem=()=>{throw Error('quota');};
 await assert.rejects(acquireJournal('alice',signal(),env),/quota/);await turn();assert.equal(env.held.size,0);
});
test('missing browser capabilities fail closed without an unlocked fallback',async()=>{
 await assert.rejects(acquireJournal('alice',signal(),{storage:null,locks:null}),/required/);
});
test('aborting browser owner invalidates journal before releasing lock',async()=>{
 const env=environment(),abort=new AbortController(),owner=await acquireJournal('alice',abort.signal,env);begin(owner);
 abort.abort();assert.throws(()=>owner.journal.check());await turn();assert.equal(env.held.size,0);
});
test('corrupt browser journal is preserved and lock released',async()=>{
 const env=environment(),owner=await acquireJournal('alice',signal(),env);begin(owner);owner.close();await turn();
 const key=[...env.data.keys()].find(k=>k.startsWith('distributed-commands'));env.data.set(key,'broken');
 await assert.rejects(acquireJournal('alice',signal(),env));await turn();assert.equal(env.data.get(key),'broken');assert.equal(env.held.size,0);
});
test('different browser accounts have isolated journals',async()=>{
 const env=environment(),a=await acquireJournal('alice',signal(),env),b=await acquireJournal('bob',signal(),env);
 try {begin(a);assert.deepEqual(b.journal.slots,[]);}finally{a.close();b.close();}
});
test('native synchronous owner prevents second writer and restores saved work',async()=>{
 const env=environment(),store={read:env.storage.getItem,write:env.storage.setItem};
 const first=await acquireNativeJournal(store,'native-alice',signal());begin(first);
 await assert.rejects(acquireNativeJournal(store,'native-alice',signal()),/active/);first.close();
 const next=await acquireNativeJournal(store,'native-alice',signal());try{assert.deepEqual(next.journal.slots,['table']);}finally{next.close();}
});
test('native failed write releases ownership; abort closes new owner',async()=>{
 const env=environment(),store={read:env.storage.getItem,write:()=>{throw Error('locked');}};
 await assert.rejects(acquireNativeJournal(store,'native-failure',signal()),/locked/);
 store.write=env.storage.setItem;const abort=new AbortController();const owner=await acquireNativeJournal(store,'native-failure',abort.signal);abort.abort();assert.throws(()=>owner.journal.check());
});
test('account replacement closes session before owner release',async()=>{
 const trace=[];const manager=new OwnedSession(async account=>({clientId:account,journal:{},close:()=>trace.push(`owner:${account}`)}));
 await manager.select('a',()=>({close:()=>trace.push('session:a')}));await manager.select('b',()=>({close:()=>trace.push('session:b')}));manager.close();
 assert.deepEqual(trace,['session:a','owner:a','session:b','owner:b']);
});
test('late acquisition after account switch cannot create old session',async()=>{
 let finish,oldClosed=0;const manager=new OwnedSession((account)=>account==='a'?new Promise(r=>finish=r):Promise.resolve({close:()=>{}}));
 const old=manager.select('a',()=>assert.fail());await manager.select('b',()=>({close:()=>{}}));finish({close:()=>oldClosed++});
 assert.equal(await old,null);assert.equal(oldClosed,1);manager.close();
});
test('failed session construction releases owner and restores pending journal later',async()=>{
 const env=environment(),manager=new OwnedSession((account,abort)=>acquireJournal(account,abort,env));
 await assert.rejects(manager.select('alice',owner=>{begin(owner);throw Error('construction');}),/construction/);await turn();
 const owner=await acquireJournal('alice',signal(),env);assert.deepEqual(owner.journal.slots,['table']);owner.close();manager.close();
});
test('logout during acquisition aborts it and prevents factory execution',async()=>{
 const env=environment(),manager=new OwnedSession((account,abort)=>acquireJournal(account,abort,env));
 const pending=manager.select('alice',()=>assert.fail());manager.close();assert.equal(await pending,null);await turn();assert.equal(env.held.size,0);
});

test('session stops before abort releases browser lock',async()=>{
 const env=environment();let heldDuringClose=false;
 const manager=new OwnedSession((account,abort)=>acquireJournal(account,abort,env));
 await manager.select('alice',owner=>({close:()=>{owner.journal.check();heldDuringClose=env.held.size===1;}}));
 manager.close();assert.equal(heldDuringClose,true);await turn();assert.equal(env.held.size,0);
});
test('throwing session cleanup still releases journal ownership',async()=>{
 const env=environment(),manager=new OwnedSession((account,abort)=>acquireJournal(account,abort,env));
 await manager.select('alice',()=>({close:()=>{throw Error('cleanup');}}));assert.throws(()=>manager.close(),/cleanup/);
 await turn();assert.equal(env.held.size,0);
});
test('journal identity separates deployments and rejects ambiguous server URLs',async()=>{
 const {distributedIdentity}=await import('../src/multiplayer/distributedIdentity.ts');
 assert.notEqual(distributedIdentity('https://one.example','user-a'),distributedIdentity('https://two.example','user-a'));
 assert.equal(distributedIdentity('https://one.example/','user-a'),distributedIdentity('https://one.example','user-a'));
 assert.throws(()=>distributedIdentity('https://user:password@one.example','user-a'));
 assert.throws(()=>distributedIdentity('https://one.example/?token=secret','user-a'));
 assert.throws(()=>distributedIdentity('https://one.example','x'.repeat(128)));
});
