import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedRootRuntime, distributedRoot } from '../src/multiplayer/DistributedRoot.ts';
import { createJournalOwner } from '../src/multiplayer/JournalOwner.ts';
const wait=async fn=>{for(let n=0;n<150;n++){if(fn())return;await new Promise(r=>setTimeout(r,2));}assert.fail('timed out');};
function setup(options={}){
 const data=new Map(),installed=[],removed=[],errors=[],sockets=[],sent=[],health=[],recovery=[];let room='r',revision=4,tableRevision=2,roomReads=0;
 const owner=createJournalOwner({read:k=>data.get(k)??null,write:(k,v)=>data.set(k,v)},'alice',()=>{});
 const projection=()=>({room_id:room,snapshot:{room_id:room,table_id:'t',match_id:'m',durable_game_id:'g',table_revision:tableRevision,game:{revision}}});
 const fetcher=async(url,opts)=>{
  if(options.fetcher)return options.fetcher(url,opts);
  if(options.chatStatus&&url.endsWith('/streams/open')&&JSON.parse(opts.body).kind.endsWith('_chat'))return {ok:false,status:options.chatStatus};
  let value;
  if(url.endsWith('/commands')){sent.push(JSON.parse(opts.body));throw Error('response lost');}
  if(url.includes('/rooms/')){roomReads++;value=options.roomRead?await options.roomRead(projection()):projection();}
  else if(url.endsWith('/streams/recipient'))value={lane_id:'personal',target:{kind:'recipient',recipient_id:'alice'}};
  else if(url.includes('/streams/social'))value={items:[{lane_id:'personal'}],next_lane_id:null};
  else if(url.endsWith('/streams/open')){const target=JSON.parse(opts.body);value={lane_id:target.kind,target};}
  else value={items:[],next_sequence:null};
  return {ok:true,json:async()=>value};
 };
 const socketFactory=(url,token,device,failed,ready)=>{
  queueMicrotask(()=>ready?.());
  const socket={capabilities:options.capabilities??[],failed,closed:false,opens:[],close(){this.closed=true;},async open(lane,id,page,revoked,signal){
   const sub={lane,page,revoked,signal,closed:false};this.opens.push(sub);return {cursor:0,acknowledge:async()=>{},close:()=>{sub.closed=true;}};
  }};sockets.push(socket);return socket;
 };
 const root=new DistributedRootRuntime(owner,'https://host/distributed','token',{install:(l,v)=>installed.push([l,v]),remove:l=>removed.push(l),error:(l,e)=>errors.push(e),health:v=>health.push(v),recovery:v=>recovery.push(v)},
 {fetcher,socketFactory,refreshMs:300000});
 return {root,owner,installed,removed,errors,sockets,sent,health,recovery,roomReads:()=>roomReads,setRoom:v=>room=v,setRevision:v=>revision=v,setTableRevision:v=>tableRevision=v};
}
test('root assembles authenticated discovery, hosted/history views and journaled controls',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t',chat:['room_chat']});
 await wait(()=>f.installed.length===6);assert.deepEqual(f.sockets[0].opens.map(s=>s.lane).sort(),['game','lobby','personal','room','room_chat','table']);
 assert.equal(f.root.game('move','PLAY_CARD',{card:'AH'}),true);const c=f.root.session.command('move');assert.equal(c.request.body.expected_revision,4);
 assert.equal(c.request.target.game_id,'g');assert.equal(c.request.body.match_id,'m');
});
test('socket replacement preserves same pending command while old pages cannot install',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 f.root.game('move','PLAY_CARD',{card:'AH'});const c=f.root.session.command('move');await assert.rejects(c.reconcile());const original=c.request;
 const old=f.sockets[0];old.failed();await f.root.reconnect();assert.equal(old.closed,true);assert.equal(f.root.session.command('move'),c);
 assert.deepEqual(c.request,original);assert.deepEqual(f.sent[0],f.sent[1]);
 const count=f.installed.length;old.opens[0].page({type:'DELIVERY_PAGE',lane_id:old.opens[0].lane,after_sequence:0,scanned_sequence:1,events:[],has_more:false});
 await new Promise(r=>setImmediate(r));assert.ok(f.installed.length>=count);assert.ok(old.opens.every(s=>s.signal.aborted));
});
test('selection clears controls until new authorized snapshot is installed',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 f.setRoom('next');const next=f.root.select({room:'next',table:'t'});assert.throws(()=>f.root.game('move','PLAY_CARD'),/Wait/);await next;
 await wait(()=>f.installed.some(([,v])=>v.kind==='snapshot'&&v.value.room_id==='next'));assert.equal(f.root.table('queue','join-queue'),true);
 assert.equal(f.root.session.command('queue').request.target.room_id,'next');
});
test('lower engine revision from another lane does not replace current snapshot',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
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
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 const c=f.root.session.command('move');f.root.game('move','PLAY_CARD');f.sockets[0].failed();assert.equal(f.sockets[0].closed,true);
 await new Promise(r=>setTimeout(r,1050));await wait(()=>f.sockets.length===2);
 assert.equal(f.root.session.command('move'),c);f.owner.journal.check();
});

test('paused chat cannot prevent an authorized game snapshot from loading',async t=>{
 const f=setup({chatStatus:403});t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t',chat:['room_chat']});await wait(()=>f.installed.length===5);
 assert.equal(f.errors.length,0);assert.equal(f.root.game('move','PLAY_CARD'),true);
 assert.ok(!f.sockets[0].opens.some(s=>s.lane==='room_chat'));
});
test('chat transport failures remain visible rather than silently discarding a stream',async t=>{
 const f=setup({chatStatus:503});t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t',chat:['room_chat']});assert.ok(f.errors.some(e=>e.status===503));
 await wait(()=>f.installed.some(([,v])=>v.kind==='snapshot'));
 assert.equal(f.sockets.length,1);assert.equal(f.root.game('move','PLAY_CARD'),true);
});

test('reselecting the same table retains subscriptions and pending moves',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});
 const selection={room:'r',table:'t',chat:['room_chat','table_chat']};
 await f.root.select(selection);await wait(()=>f.installed.length===7);
 f.root.game('move','PLAY_CARD',{card:'AH'});const command=f.root.session.command('move');
 const original=command.request, socket=f.sockets[0];
 await f.root.select({...selection});
 assert.equal(f.sockets.length,1);assert.equal(socket.closed,false);
 assert.ok(socket.opens.every(s=>!s.closed && !s.signal.aborted));
 assert.equal(f.root.session.command('move'),command);assert.deepEqual(command.request,original);
 assert.equal(f.sent.length,0);
});


test('foreground wake and selection changes retain the original socket and account streams',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 const socket=f.sockets[0],personal=socket.opens.find(s=>s.lane==='personal');
 await f.root.wake();assert.equal(f.sockets.length,1);
 f.setRoom('next');await f.root.select({room:'next',table:'t'});
 assert.equal(f.sockets.length,1);assert.equal(socket.closed,false);assert.equal(personal.closed,false);
 await f.root.select(null);assert.equal(f.sockets.length,1);assert.equal(personal.closed,false);
});
test('failed discovery does not replace an authenticated socket or healthy subscriptions',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 const socket=f.sockets[0];f.root.reads.recipient=async()=>{throw Error('temporary discovery failure');};
 await assert.rejects(f.root.wake(),/discovery/);
 assert.equal(f.sockets.length,1);assert.equal(socket.closed,false);assert.ok(socket.opens.every(s=>!s.closed));
});


test('an event read and overlapping game poll share one authoritative snapshot request',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 let reads=0,finish;
 const original=f.root.reads.room.bind(f.root.reads);
 f.root.reads.room=async(...args)=>{reads++;await new Promise(resolve=>finish=resolve);return original(...args);};
 const subscription=f.sockets[0].opens.find(s=>s.lane==='game');
 subscription.page({type:'DELIVERY_PAGE',lane_id:'game',after_sequence:0,scanned_sequence:1,
  events:[{event_id:'move',lane_id:'game',sequence:1,event_type:'GAME_STATE_CHANGED',event_version:1,payload:{}}],has_more:false});
 await wait(()=>finish);
 const poll=f.root.readGameView('r','m',new AbortController().signal);finish();
 assert.equal((await poll).match_id,'m');assert.equal(reads,1);
 assert.ok(f.root.snapshotClock.delay('r','m')>29000);
 // Periodic subscription discovery must not add another independent game poll.
 await f.root.session.refresh();assert.equal(reads,1);
});


test('late discovery from an old selection cannot install private state into a new room',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 let finish;const original=f.root.reads.room.bind(f.root.reads);
 f.root.reads.room=async(room,table,signal)=>{
  if(room==='old')return new Promise(resolve=>finish=resolve);
  return original(room,table,signal);
 };
 const old=f.root.select({room:'old',table:'t'});await wait(()=>finish);
 f.setRoom('next');await f.root.select({room:'next',table:'t'});
 finish({room_id:'old',snapshot:{room_id:'old',table_id:'t',table_revision:99,match_id:'old-private',durable_game_id:'old',game:{revision:99}}});
 await old;await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(f.sockets.length,1);f.root.game('move','PLAY_CARD');
 assert.equal(f.root.session.command('move').request.target.room_id,'next');
 assert.ok(!f.installed.some(([,v])=>v.kind==='snapshot' && v.value.snapshot?.match_id==='old-private'));
});


test('isolated chat subscription failure changes recovery status without changing socket health',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t',chat:['table_chat']});await wait(()=>f.installed.length===6);
 const socket=f.sockets[0],game=socket.opens.find(s=>s.lane==='game'),chat=socket.opens.find(s=>s.lane==='table_chat');
 chat.revoked();assert.equal(f.recovery.at(-1),'chat');assert.deepEqual(f.health,[true]);
 assert.equal(game.closed,false);assert.equal(f.root.game('move','PLAY_CARD'),true);
 socket.failed({cause:'close',code:1001,reason:'fixture disconnect',wasClean:true});
 assert.equal(f.health.at(-1),false);assert.equal(f.root.connectionDiagnostics.at(-1).code,1001);
});
test('changing chat selection preserves the healthy game and table subscriptions',async t=>{
 const f=setup();t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t',chat:['room_chat']});await wait(()=>f.installed.length===6);
 const socket=f.sockets[0],game=socket.opens.find(s=>s.lane==='game'),table=socket.opens.find(s=>s.lane==='table');
 await f.root.select({room:'r',table:'t',chat:['room_chat','table_chat']});
 assert.equal(f.sockets.length,1);assert.equal(game.closed,false);assert.equal(table.closed,false);
 assert.equal(socket.opens.filter(s=>s.lane==='game').length,1);
});

async function pushedDelta(f,base=2,next=3,corrupt=false,sequence=1){
 const {canonicalView}=await import('../src/multiplayer/GameViewDelta.ts');
 const {viewDigest}=await import('../src/multiplayer/ViewDigest.ts');
 const before={room_id:'r',table_id:'t',match_id:'m',durable_game_id:'g',table_revision:base,game:{revision:base+2}};
 const after={...before,table_revision:next,game:{revision:next+2}};
 const delta={version:1,game_id:'m',base_revision:base,revision:next,
  base_checksum:await viewDigest(canonicalView(before)),checksum:corrupt?'0'.repeat(64):await viewDigest(canonicalView(after)),
  operations:[{op:'set',path:['table_revision'],value:next},{op:'set',path:['game','revision'],value:next+2}]};
 f.sockets[0].opens.find(s=>s.lane==='table').page({type:'DELIVERY_PAGE',lane_id:'table',after_sequence:sequence-1,
  scanned_sequence:sequence,has_more:false,events:[{event_id:'delta'+sequence,lane_id:'table',sequence,event_type:'VIEW_DELTA',event_version:1,payload:{type:'VIEW_DELTA',delta}}]});
}
test('committed delta updates controls and fallback clock without a snapshot HTTP request',async t=>{
 const f=setup({capabilities:['view-delta-v1']});t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 const reads=f.roomReads();await pushedDelta(f);await wait(()=>f.root.cachedGameView('r','m')?.table_revision===3);
 assert.equal(f.roomReads(),reads);assert.ok(f.root.snapshotClock.delay('r','m')>29000);
 f.root.game('move','PLAY_CARD');assert.equal(f.root.session.command('move').request.body.expected_revision,5);
 await pushedDelta(f,2,3,false,2);await new Promise(r=>setTimeout(r,10));assert.equal(f.roomReads(),reads);
});
for(const failure of ['gap','checksum'])test(`${failure} reconciles immediately instead of installing an invalid delta`,async t=>{
 const f=setup({capabilities:['view-delta-v1']});t.after(()=>{f.root.close();f.owner.close();});
 await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 const reads=f.roomReads();await pushedDelta(f,failure==='gap'?3:2,4,failure==='checksum');
 await wait(()=>f.roomReads()>reads);assert.equal(f.root.cachedGameView('r','m').table_revision,2);
});
test('HTTP read started before a push returns the newer installed view',async t=>{
 let release=null,delay=false;
 const f=setup({capabilities:['view-delta-v1'],roomRead:v=>delay?new Promise(resolve=>{release=()=>resolve(v);}):v});
 t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 delay=true;const reading=f.root.readGameView('r','m',new AbortController().signal,true);await wait(()=>release!==null);
 await pushedDelta(f);await wait(()=>f.root.cachedGameView('r','m')?.table_revision===3);release();
 assert.equal((await reading).table_revision,3);assert.equal(f.root.cachedGameView('r','m').table_revision,3);
});

test('pushed selected-table preview stays current without replacing other room tables',async t=>{
 const f=setup({capabilities:['view-delta-v1'],roomRead:v=>({...v,snapshot:{...v.snapshot,tables:[
  {table_id:'t',match_id:'m',table_revision:2,name:'Before'},
  {table_id:'other',match_id:'other-match',name:'Keep'}]}})});
 t.after(()=>{f.root.close();f.owner.close();});await f.root.select({room:'r',table:'t'});await wait(()=>f.installed.length===5);
 const {canonicalView}=await import('../src/multiplayer/GameViewDelta.ts');
 const {viewDigest}=await import('../src/multiplayer/ViewDigest.ts');
 const sub=f.sockets[0].opens.find(s=>s.lane==='table'),original=sub.page;
 const preview={table_id:'t',match_id:'m',table_revision:3,name:'After'};
 sub.page=page=>{page.events[0].payload.table_preview=preview;
  page.events[0].payload.preview_checksum=checksum;original(page);};
 const checksum=await viewDigest(canonicalView(preview)),reads=f.roomReads();
 await pushedDelta(f);await wait(()=>f.root.cachedGameView('r','m')?.table_revision===3);
 assert.deepEqual(f.root.cachedGameView('r','m').tables,[preview,{table_id:'other',match_id:'other-match',name:'Keep'}]);
 assert.equal(f.roomReads(),reads);
});
