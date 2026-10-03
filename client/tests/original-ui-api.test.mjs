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
