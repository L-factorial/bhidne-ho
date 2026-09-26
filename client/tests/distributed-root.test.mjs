import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedRootRuntime, distributedRoot } from '../src/multiplayer/DistributedRoot.ts';
import { createJournalOwner } from '../src/multiplayer/JournalOwner.ts';
const wait=async fn=>{for(let n=0;n<150;n++){if(fn())return;await new Promise(r=>setTimeout(r,2));}assert.fail('timed out');};
function setup(options={}){
 const data=new Map(),installed=[],removed=[],errors=[],sockets=[],sent=[];let room='r',revision=4;
 const owner=createJournalOwner({read:k=>data.get(k)??null,write:(k,v)=>data.set(k,v)},'alice',()=>{});
 const projection=()=>({room_id:room,snapshot:{room_id:room,table_id:'t',match_id:'m',durable_game_id:'g',table_revision:2,game:{revision}}});
 const fetcher=async(url,opts)=>{
  if(options.fetcher)return options.fetcher(url,opts);
  if(options.chatStatus&&url.endsWith('/streams/open')&&JSON.parse(opts.body).kind.endsWith('_chat'))return {ok:false,status:options.chatStatus};
  let value;
  if(url.endsWith('/commands')){sent.push(JSON.parse(opts.body));throw Error('response lost');}
  if(url.includes('/rooms/'))value=projection();
  else if(url.endsWith('/streams/recipient'))value={lane_id:'personal',target:{kind:'recipient',recipient_id:'alice'}};
  else if(url.includes('/streams/social'))value={items:[{lane_id:'personal'}],next_lane_id:null};
  else if(url.endsWith('/streams/open')){const target=JSON.parse(opts.body);value={lane_id:target.kind,target};}
  else value={items:[],next_sequence:null};
  return {ok:true,json:async()=>value};
 };
 const socketFactory=(url,token,device,failed)=>{
  const socket={failed,closed:false,opens:[],close(){this.closed=true;},async open(lane,id,page,revoked,signal){
   const sub={lane,page,revoked,signal,closed:false};this.opens.push(sub);return {cursor:0,acknowledge:async()=>{},close:()=>{sub.closed=true;}};
  }};sockets.push(socket);return socket;
 };
 const root=new DistributedRootRuntime(owner,'https://host/distributed','token',{install:(l,v)=>installed.push([l,v]),remove:l=>removed.push(l),error:(l,e)=>errors.push(e)},
 {fetcher,socketFactory,refreshMs:300000});
 return {root,owner,installed,removed,errors,sockets,sent,setRoom:v=>room=v,setRevision:v=>revision=v};
}
test('root assembles authenticated discovery, hosted/history views and journaled controls',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t',chat:['room_chat']});
 await wait(()=>f.installed.length===5);assert.deepEqual(f.sockets[0].opens.map(s=>s.lane).sort(),['game','personal','room','room_chat','table']);
 assert.equal(f.root.game('move','PLAY_CARD',{card:'AH'}),true);const c=f.root.session.command('move');assert.equal(c.request.body.expected_revision,4);
 assert.equal(c.request.target.game_id,'g');assert.equal(c.request.body.match_id,'m');
});
test('socket replacement preserves same pending command while old pages cannot install',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===4);
 f.root.game('move','PLAY_CARD',{card:'AH'});const c=f.root.session.command('move');await assert.rejects(c.reconcile());const original=c.request;
 const old=f.sockets[0];await f.root.reconnect();assert.equal(old.closed,true);assert.equal(f.root.session.command('move'),c);
 assert.deepEqual(c.request,original);assert.deepEqual(f.sent[0],f.sent[1]);
 const count=f.installed.length;old.opens[0].page({type:'DELIVERY_PAGE',lane_id:old.opens[0].lane,after_sequence:0,scanned_sequence:1,events:[],has_more:false});
 await new Promise(r=>setImmediate(r));assert.ok(f.installed.length>=count);assert.ok(old.opens.every(s=>s.signal.aborted));
});
test('selection clears controls until new authorized snapshot is installed',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===4);
 f.setRoom('next');const next=f.root.select({room:'next',table:'t'});assert.throws(()=>f.root.game('move','PLAY_CARD'),/Wait/);await next;
 await wait(()=>f.installed.some(([,v])=>v.kind==='snapshot'&&v.value.room_id==='next'));assert.equal(f.root.table('queue','join-queue'),true);
 assert.equal(f.root.session.command('queue').request.target.room_id,'next');
});
test('lower engine revision from another lane does not replace current snapshot',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===4);
 f.setRevision(2);const sub=f.sockets[0].opens.find(s=>s.lane==='game');sub.page({type:'DELIVERY_PAGE',lane_id:'game',after_sequence:0,scanned_sequence:1,events:[{event_id:'e',lane_id:'game',sequence:1,event_type:'X',event_version:1,payload:{}}],has_more:false});
 await new Promise(r=>setTimeout(r,10));f.root.game('move','PLAY_CARD');assert.equal(f.root.session.command('move').request.body.expected_revision,4);
});
test('unauthorized credentials close the root and journal without retrying commands',async()=>{
 const f=setup({fetcher:async()=>({ok:false,status:401})});await f.root.reconnect();assert.equal(f.sockets[0].closed,true);assert.throws(()=>f.owner.journal.check());
 await assert.rejects(f.root.reconnect(),/closed/);
});
test('account owner closes composed runtime and ignores old root factory',async()=>{
 let closed=0;const manager=distributedRoot(async()=>({clientId:'x',journal:{},close:()=>closed++}));
 await manager.select('a',()=>({close:()=>closed++}));manager.close();assert.equal(closed,2);
});

test('socket failure schedules replacement without releasing journal ownership',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===4);
 const c=f.root.session.command('move');f.root.game('move','PLAY_CARD');f.sockets[0].failed();assert.equal(f.sockets[0].closed,true);
 await new Promise(r=>setTimeout(r,1050));await wait(()=>f.sockets.length===2);
 assert.equal(f.root.session.command('move'),c);f.owner.journal.check();
});

test('paused chat cannot prevent an authorized game snapshot from loading',async t=>{
 const f=setup({chatStatus:403});t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t',chat:['room_chat']});await wait(()=>f.installed.length===4);
 assert.equal(f.errors.length,0);assert.equal(f.root.game('move','PLAY_CARD'),true);
 assert.ok(!f.sockets[0].opens.some(s=>s.lane==='room_chat'));
});
test('chat transport failures remain visible rather than silently discarding a stream',async t=>{
 const f=setup({chatStatus:503});t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t',chat:['room_chat']});assert.ok(f.errors.some(e=>e.status===503));
 assert.equal(f.installed.length,0);
});
