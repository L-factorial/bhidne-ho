import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedRequestError } from '../src/multiplayer/DistributedHttpTransport.ts';
import { OriginalUiApi } from '../src/multiplayer/OriginalUiApi.ts';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
import { registerRuntimeRequests, runtimeRequest, sharedPlatformPath } from '../src/multiplayer/RuntimeRequests.ts';
const account={user_id:'user-00000000-0000-0000-0000-000000000001',token:'token'};
const signal=()=>new AbortController().signal;
const view={room_id:'r',table_id:'t',match_id:'m',table_revision:7,durable_game_id:'g',game:{revision:4},status:'waiting',
 game_type:'marriage',table:{phase:'OPEN',current_user:{can_leave_seat:true,can_abandon_match:false,is_in_active_match:false}}};
function receipt(r,status='accepted') {const command_id=r.body.command_id;return {lane_id:'lane',command_id,sequence:1,status,
 status_reference:{lane_id:'lane',command_id},outcome:{command_id,status,...(r.body.command==='create-table'?{table_id:'t',match_id:'m'}:{})}};}
function setup(submit) {
 const sent=[],shared=[],slots=new Map();
 const root={session:{command(slot){if(!slots.has(slot))slots.set(slot,new DurableCommandClient({submit:async r=>{sent.push(r);return submit?submit(r):receipt(r);},status:async()=>assert.fail()}));return slots.get(slot);},releaseCommand(slot){slots.get(slot)?.close();return slots.delete(slot);}},
 reads:{gameView:async()=>structuredClone(view),lobby:async()=>['lobby'],activity:async k=>[k],preview:async()=>({room_id:'r'}),memberProfiles:async()=>[],ledger:async()=>({})}};
 root.readGameView=(...args)=>root.reads.gameView(...args);
 root.targetForLane=()=>null;
 const api=new OriginalUiApi(root,account,async(...args)=>{shared.push(args);return {user_id:'player',display_name:'Player'};});
 return {api,root,sent,shared};
}
test('authenticated request routing fails closed for unconnected and stale-account calls',async()=>{
 const f=setup();assert.deepEqual(await f.api.request('/rooms',account),['lobby']);
 await f.api.request('/me/profile',account);assert.equal(f.shared.length,1);
 await assert.rejects(f.api.request('/legacy-writer',account,{}),/not connected/);
 await assert.rejects(f.api.request('/rooms',{...account,token:'stale'}),/changed/);
 f.api.close();await assert.rejects(f.api.request('/rooms',account),/changed/);
});
test('original table controls map to table revisions while next deal uses engine revision',async()=>{
 const f=setup();
 for(const suffix of ['join','table/lock','start','end','table/next-match','next-deal','leave'])await f.api.request('/test-games/r/'+suffix,account,{match_id:'m'});
 assert.deepEqual(f.sent.map(r=>r.body.command),['join-seat','lock','start','end','next-match','NEXT_DEAL','leave-seat']);
 assert.equal(f.sent[0].body.expected_revision,7);assert.equal(f.sent[5].body.expected_revision,4);
 assert.equal(f.sent[5].target.game_id,'g');assert.equal(f.shared.length,0);
});
test('a lost table reply retries the captured revision even if the current match is gone',async()=>{
 let first;
 const f=setup(r=>{if(!first){first=r;throw Error('lost response');}assert.deepEqual(r,first);return receipt(r);});
 await assert.rejects(f.api.request('/test-games/r/start',account,{match_id:'m',play_mode:'manual',rules_revision:undefined}),/lost/);
 f.root.reads.gameView=async(_room,match)=>{if(match!==null)throw new DistributedRequestError(404);return {...view,match_id:'next'};};
 const result=await f.api.request('/test-games/r/start',account,{match_id:'m',play_mode:'manual',rules_revision:undefined});
 assert.equal(result.match_id,'next');assert.equal(f.sent.length,2);assert.equal(first.body.expected_revision,7);
});
test('creation returns the committed match and privacy/invites use room commands',async()=>{
 const f=setup();
 assert.equal((await f.api.request('/test-games/r',account,{name:'Table',player_count:4,game_type:'callbreak'})).match_id,'m');
 assert.deepEqual(f.sent[0].body.payload,{name:'Table',capacity:4,game_type:'callbreak',invitees:[]});
 await f.api.request('/rooms/r',account,{visibility:'private'},undefined,'PATCH');
 await f.api.request('/rooms/r/invitations',account,{invitees:['user-b']});
 assert.deepEqual(f.sent.slice(1).map(r=>[r.target.kind,r.body.command]),[['room','room-visibility'],['room','invite-room']]);
});
test('API registrations cannot cross tokens or survive explicit disposal',()=>{
 const handler=async()=>{};const remove=registerRuntimeRequests(account,handler);
 assert.equal(runtimeRequest(account),handler);
 assert.throws(()=>runtimeRequest({...account,token:'changed'}),/changed/);
 assert.throws(()=>registerRuntimeRequests(account,handler),/already/);
 remove();assert.equal(runtimeRequest(account),null);
 assert.equal(sharedPlatformPath('/friends',{},'DELETE'),false);assert.equal(sharedPlatformPath('/friends'),true);
});

test('accepted table reads retain the selected match',async()=>{
 const f=setup();const matches=[];
 f.root.reads.gameView=async(_room,match)=>{matches.push(match);return structuredClone(view);};
 await f.api.request('/test-games/r/table/lock',account,{match_id:'m'});
 assert.deepEqual(matches,['m','m']);
});
test('completed table replacement retains the original revision on retry',async()=>{
 let first;
 const f=setup(r=>{if(!first){first=r;throw Error('lost response');}assert.deepEqual(r,first);return receipt(r);});
 f.root.reads.gameView=async()=>({...structuredClone(view),can_create_new_game:true});
 const body={name:'Next',player_count:2,game_type:'marriage'};
 await assert.rejects(f.api.request('/test-games/r',account,body),/lost/);
 f.root.reads.gameView=async()=>({...view,table_revision:99});
 await f.api.request('/test-games/r',account,body);
 assert.equal(first.body.payload.replace_table_id,'t');assert.equal(first.body.payload.replace_revision,7);
});
test('failed follow-up read preserves accepted intention without resubmission',async()=>{
 const f=setup();let count=0;
 f.root.reads.gameView=async()=>{if(++count===2)throw Error('read unavailable');return structuredClone(view);};
 await assert.rejects(f.api.request('/test-games/r/table/lock',account,{match_id:'m'}),/read unavailable/);
 await assert.rejects(f.api.request('/test-games/r/start',account,{match_id:'m'}),/previous action/);
 await f.api.request('/test-games/r/table/lock',account,{match_id:'m'});
 assert.equal(f.sent.length,1);
});
test('chat history establishes a baseline before live unread delivery',async()=>{
 const f=setup();let resolveHistory;
 f.root.reads.open=async()=>({lane_id:'chat'});
 f.root.reads.history=()=>new Promise(resolve=>{resolveHistory=resolve;});
 const delivered=[],channel={receive:r=>delivered.push(r)};
 f.api.attachSocial(channel);f.api.selectedRoom='r';
 const history=channel.transport('TABLE_CHAT_HISTORY','m',{},signal());
 while(!resolveHistory)await new Promise(resolve=>setTimeout(resolve,0));
 const old={id:'old',sender_id:'player',sent_at:'2026-01-01T00:00:00Z'};
 await f.api.deliverChat('chat',[old]);assert.equal(delivered.length,0);
 resolveHistory([old]);await history;
 await f.api.deliverChat('chat',[old,{...old,id:'new'}]);
 assert.deepEqual(delivered.map(r=>r.id),['new']);
 f.api.close();assert.equal(channel.transport,undefined);
});

test('restored offscreen intention is reconciled and presented before its slot is retired',async()=>{
 let first;
 const f=setup(r=>{if(!first){first=r;throw Error('lost response');}return receipt(r);});
 await assert.rejects(f.api.request('/test-games/r/table/lock',account,{match_id:'m'}),/lost/);
 f.api.close();
 const restored=new OriginalUiApi(f.root,account,async()=>({}));
 const notices=[];
 restored.recover(message=>notices.push(message));
 for(let i=0;i<100&&!notices.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(notices,['Previous lock action confirmed.']);
 assert.equal(f.sent[1].body.command_id,first.body.command_id);
 assert.equal(f.root.session.command('ui-table-control').request,null);
 await restored.request('/test-games/r/start',account,{match_id:'m'});
 assert.equal(f.sent.at(-1).body.command,'start');
 restored.close();
});

test('own chat messages use the authenticated profile endpoint',async()=>{
 const f=setup();f.root.reads.open=async()=>({lane_id:'chat'});
 f.root.reads.history=async()=>[{id:'own',sender_id:account.user_id,text:'Hello',sent_at:'2026-01-01T00:00:00Z'}];
 const messages=await f.api.messages({kind:'room_chat',room_id:'r'},signal());
 assert.equal(messages[0].sender_name,'Player');assert.equal(f.shared[0][0],'/auth/me');
});

test('UI waits for root receipt recovery instead of racing a second reconciliation',async()=>{
 let finish;
 const f=setup(r=>new Promise(resolve=>{finish=()=>resolve(receipt(r));}));
 const command=f.root.session.command('ui-table-control');
 command.begin({kind:'table',room_id:'r',table_id:'t'}, {command:'lock',match_id:'m',expected_revision:7,payload:{}});
 const background=command.reconcile();await new Promise(resolve=>setTimeout(resolve,0));
 const ui=f.api.request('/test-games/r/table/lock',account,{match_id:'m'});
 finish();await background;await ui;
 assert.equal(f.sent.length,1);
});

test('live game chat uses only cached view and ephemeral endpoint, bounded local history',async()=>{
 const f=setup(),delivered=[],calls=[];
 f.root.ephemeralEnabled=true;f.root.cachedGameView=()=>structuredClone(view);
 f.root.reads.gameView=async()=>assert.fail('unexpected snapshot fetch');
 f.root.reads.ephemeral=async(target,body)=>{
  calls.push([target,body]);return {message:{type:'TABLE_CHAT_MESSAGE',id:body.command_id,
   room_id:'r',match_id:'m',sender_id:account.user_id,text:body.payload.text,ephemeral:true,sent_at:Date.now(),expires_at:Date.now()+30000}};
 };
 const channel={receive:row=>delivered.push(row)};f.api.attachSocial(channel);f.api.selectedRoom='r';
 assert.deepEqual((await channel.transport('TABLE_CHAT_HISTORY','m',{},signal())).messages,[]);
 const ack=await channel.transport('TABLE_CHAT_SEND','m',{text:'Hi'},signal());
 assert.equal(calls[0][0].kind,'table');assert.equal(calls[0][1].expected_revision,7);
 assert.equal(f.sent.length,0);assert.equal(delivered.length,1);
 f.api.deliverEphemeral(ack.message);assert.equal(delivered.length,1);
 f.api.deliverEphemeral({...ack.message,id:'wrong-room',room_id:'other'});assert.equal(delivered.length,1);
 f.api.deliverEphemeral({...ack.message,id:'expired',expires_at:0});assert.equal(delivered.length,1);
 for(let n=0;n<110;n++)f.api.deliverEphemeral({...ack.message,id:'live-'+n});
 assert.equal((await channel.transport('TABLE_CHAT_HISTORY','m',{},signal())).messages.length,100);
 f.api.close();assert.equal(channel.transport,undefined);
});

test('room chat push uses committed names without profile or history fetch',async()=>{
 const f=setup(),received=[];
 f.root.targetForLane=()=>({kind:'room_chat',room_id:'r'});
 const stop=f.api.observeChat('/rooms/r/chat',rows=>received.push(rows));
 const row={id:'message',sender_id:account.user_id,sender_name:'Alice',text:'Hi',sent_at:'2026-01-01T00:00:00Z'};
 await f.api.deliverChat('room-chat',[row]);
 assert.equal(received[0][0].sender_name,'Alice');assert.equal(typeof received[0][0].sent_at,'number');
 assert.equal(f.shared.length,0);assert.equal(f.sent.length,0);
 stop();await f.api.deliverChat('room-chat',[row]);assert.equal(received.length,1);f.api.close();
});

test('native fallback IDs satisfy the server contract for table chat and every poke route',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
 try{
  const f=setup(),bodies=[];f.root.ephemeralEnabled=true;f.root.cachedGameView=()=>structuredClone(view);
  f.root.reads.ephemeral=async(_target,body)=>{bodies.push(body);return {message:null};};
  const channel={};f.api.attachSocial(channel);f.api.selectedRoom='r';
  await channel.transport('TABLE_CHAT_SEND','m',{text:'hello'},signal());
  await channel.transport('TABLE_POKE_SEND','m',{recipient_player_id:2,reaction:'love'},signal());
  await f.api.request('/test-games/r/poke',account,{match_id:'m',text:'hello',recipient_player_id:2});
  assert.equal(bodies.length,3);
  assert.equal(new Set(bodies.map(b=>b.command_id)).size,3);
  for(const body of bodies){assert.match(body.command_id,/^[A-Za-z0-9_-]{1,128}$/);assert.equal(body.expected_revision,7);}
  f.api.close();
 }finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
});
const endedView=()=>({...structuredClone(view),status:'ended',table:{phase:'ENDED',current_user:{can_leave_seat:false,can_abandon_match:false,is_in_active_match:false}}});
test('leaving an already closed table succeeds without another mutation',async()=>{
 for(const suffix of ['leave','table/leave-seat','table/abandon']){
  const f=setup();f.root.reads.gameView=async()=>endedView();
  const result=await f.api.request('/test-games/r/'+suffix,account,{match_id:'m'});
  assert.equal(result.status,'ended');assert.equal(f.sent.length,0);f.api.close();
 }
});
test('a definitive leave rejection racing closure reconciles to the ended table',async()=>{
 const f=setup(r=>receipt(r,'rejected'));let reads=0;
 f.root.reads.gameView=async()=>++reads===1?structuredClone(view):endedView();
 const result=await f.api.request('/test-games/r/leave',account,{match_id:'m'});
 assert.equal(result.status,'ended');assert.equal(f.sent.length,1);f.api.close();
});
test('a leave rejection while the table is still active remains an error',async()=>{
 const f=setup(r=>receipt(r,'rejected'));
 await assert.rejects(f.api.request('/test-games/r/leave',account,{match_id:'m'}),{status:409});f.api.close();
});
test('closure does not discard or resubmit an unresolved leave intention',async()=>{
 const f=setup(()=>{throw Error('lost reply');});
 await assert.rejects(f.api.request('/test-games/r/leave',account,{match_id:'m'}),/lost reply/);
 const original=f.root.session.command('ui-table-control').request;
 f.root.reads.gameView=async()=>endedView();
 await assert.rejects(f.api.request('/test-games/r/leave',account,{match_id:'m'}),/lost reply/);
 assert.deepEqual(f.sent[1],original);assert.equal(f.root.session.command('ui-table-control').pending,true);f.api.close();
});

test('a recovered leave rejection after a lost reply recognizes closure without a new ID',async()=>{
 let attempts=0;const f=setup(r=>{if(++attempts===1)throw Error('lost reply');return receipt(r,'rejected');});
 await assert.rejects(f.api.request('/test-games/r/leave',account,{match_id:'m'}),/lost reply/);
 const original=f.sent[0];f.root.reads.gameView=async()=>endedView();
 const result=await f.api.request('/test-games/r/leave',account,{match_id:'m'});
 assert.equal(result.status,'ended');assert.deepEqual(f.sent[1],original);f.api.close();
});

test('Play creation sends room notification intent with selected invitations',async()=>{
 const f=setup();
 await f.api.request('/test-games/r',account,{name:'Friday',player_count:10,game_type:'flush',invitees:['user-b'],notify_room:true});
 assert.deepEqual(f.sent[0].body.payload,{name:'Friday',capacity:10,game_type:'flush',invitees:['user-b'],notify_room:true});
});

test('automatic Marriage capacity is left to the server and Call Break preserves five-player choice',async()=>{
 const f=setup();
 await f.api.request('/test-games/r',account,{name:'Marriage',game_type:'marriage',notify_room:true});
 assert.deepEqual(f.sent[0].body.payload,{name:'Marriage',game_type:'marriage',invitees:[],notify_room:true});
 await f.api.request('/test-games/r',account,{name:'Call Break',game_type:'callbreak',player_count:5,notify_room:true});
 assert.equal(f.sent[1].body.payload.capacity,5);
});

test('ordinary table discard uses a durable personal command without seat departure',async()=>{
 const f=setup();
 await f.api.request('/active-tables/discard',account,{room_id:'r',table_id:'t',match_id:'m'});
 assert.equal(f.sent.length,1);
 assert.deepEqual(f.sent[0].target,{kind:'recipient',recipient_id:account.user_id.slice(5)});
 assert.equal(f.sent[0].body.command,'discard-table');
 assert.deepEqual(f.sent[0].body.payload,{table_id:'t',match_id:'m'});
});
test('chat and poke notices reach the original bell and its mark-read command',async()=>{
 const f=setup();
 f.root.reads.recipient=async()=>({lane_id:'recipient'});
 f.root.reads.history=async()=>['chat','poke'].map((kind,index)=>({id:String(index),kind,actor_id:account.user_id,created_at:'2026-10-07T11:00:00Z',read:false,payload:{room_id:'r'}}));
 f.root.reads.legacy=async()=>({items:[]});
 const notifications=await f.api.request('/notifications',account);
 assert.deepEqual(notifications.map(row=>row.kind),['chat','poke']);
 await f.api.request('/notifications/read',account,{});
 assert.equal(f.sent[0].body.command,'read-notifications');
 assert.deepEqual(f.sent[0].body.payload.ids,['0','1']);
});

test('card theme creation and updates use durable room/table commands',async()=>{
 const f=setup();
 await f.api.request('/test-games/r',account,{game_type:'flush',name:'Cards',card_theme:'annapurna'});
 assert.equal(f.sent[0].body.command,'create-table');assert.equal(f.sent[0].body.payload.card_theme,'annapurna');
 await f.api.request('/test-games/r/card-theme',account,{match_id:'m',card_theme:'lumbini'});
 assert.equal(f.sent[1].body.command,'card-theme');assert.equal(f.sent[1].body.expected_revision,7);
 assert.equal(f.sent[1].target.kind,'table');assert.deepEqual(f.sent[1].body.payload,{card_theme:'lumbini'});
 assert.equal(f.shared.length,0);
});

test('accepted end closes the UI even when the released table projection disappears',async()=>{
 const f=setup();let reads=0;
 f.root.reads.gameView=async()=>{reads++;if(reads>1)throw new DistributedRequestError(404);return structuredClone(view);};
 const result=await f.api.request('/test-games/r/end',account,{match_id:'m'});
 assert.equal(result.status,'ended');assert.equal(result.match_id,'m');assert.equal(result.table.phase,'ENDED');
 assert.equal(reads,1);assert.equal(f.sent.length,1);
 assert.equal(f.root.session.command('ui-table-control').request,null);
 f.api.close();
});

test('a rejected end retains error feedback and never reports successful closure',async()=>{
 const f=setup(r=>receipt(r,'rejected'));
 await assert.rejects(f.api.request('/test-games/r/end',account,{match_id:'m'}),/rejected/);
 assert.equal(f.sent.length,1);f.api.close();
});

test('a definitive end rejection racing an already-closed table returns closure without another command',async()=>{
 const f=setup(r=>receipt(r,'rejected'));let reads=0;
 f.root.reads.gameView=async()=>++reads===1?structuredClone(view):endedView();
 const result=await f.api.request('/test-games/r/end',account,{match_id:'m'});
 assert.equal(result.status,'ended');assert.equal(f.sent.length,1);f.api.close();
});
