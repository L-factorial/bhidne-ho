import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedReadClient } from '../src/multiplayer/DistributedReadClient.ts';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
import { gameControl,tableControl,roomControl,chatControl,readNotifications } from '../src/multiplayer/DistributedControls.ts';
const signal=()=>new AbortController().signal;
const view={room_id:'room',table_id:'table',match_id:'match',durable_game_id:'round-1',table_revision:7,game:{revision:12}};
const command=()=>new DurableCommandClient({submit:async()=>assert.fail(),status:async()=>assert.fail()});
test('game/table mappings use independent revisions and freeze round on retry',()=>{
 const g=command(),t=command();gameControl(g,view,'PLAY_CARD',{card:'AH'});tableControl(t,view,'join-queue');
 assert.equal(g.request.body.expected_revision,12);assert.equal(t.request.body.expected_revision,7);assert.equal(g.request.target.game_id,'round-1');
 assert.equal(gameControl(g,{...view,durable_game_id:'round-2'},'PLAY_CARD',{card:'2C'}),false);assert.equal(g.request.target.game_id,'round-1');assert.equal(g.request.body.match_id,'match');
});
test('room/chat/notification mappings omit game revisions and distinguish chat commands',()=>{
 const r=command();roomControl(r,'room','leave-room');assert.equal(r.request.body.expected_revision,undefined);
 const a=command(),b=command();chatControl(a,{kind:'room_chat',room_id:'room'},'hello');chatControl(b,{kind:'conversation',user_low:'a',user_high:'b'},'hello');
 assert.equal(a.request.body.command,'send-chat');assert.equal(b.request.body.command,'send-message');
 const n=command();readNotifications(n,{kind:'recipient',recipient_id:'a'},['one']);assert.equal(n.request.body.command,'read-notifications');
 assert.throws(()=>gameControl(command(),{...view,durable_game_id:null},'PLAY_CARD'));
});
test('snapshot pins selected table and history follows native sequence cursors',async()=>{
 const calls=[];const reader=new DistributedReadClient('https://host/distributed','token',async(url,options)=>{
 calls.push(url);assert.equal(options.headers.Authorization,'Bearer token');return {ok:true,json:async()=>url.includes('/history/')?
 (url.endsWith('after=0')?{items:[{id:'one',sequence:2}],next_sequence:2}:{items:[{id:'two',sequence:4}],next_sequence:null}):{snapshot:{}}};});
 await reader.room('r','selected',signal());assert.ok(calls[0].endsWith('/rooms/r?table_id=selected'));
 assert.deepEqual((await reader.history('social','lane',signal())).map(r=>r.id),['one','two']);
});
test('discovery bootstraps recipient and combines authorized social and selected scopes',async()=>{
 const reader=new DistributedReadClient('https://host/distributed','token',async(url,options)=>({ok:true,json:async()=>url.endsWith('/recipient')?
 {lane_id:'personal'}:url.endsWith('/open')?{lane_id:JSON.parse(options.body).room_id}:{items:[{lane_id:'personal'},{lane_id:'conversation'}],next_lane_id:null}}));
 const result=await reader.discover([{kind:'room',room_id:'room'}],signal());assert.deepEqual(result.items.map(i=>i.lane_id),['conversation','personal','room']);
});
test('legacy cursor remains separate and authorization errors do not become empty history',async()=>{
 let url;const reader=new DistributedReadClient('https://host/distributed','token',async path=>{url=path;return {ok:true,json:async()=>({source:'legacy',items:[],next_before:null})};});
 assert.equal((await reader.legacy('direct','user-a',{at:'2026-01-01T00:00:00+00:00',id:'old'},signal())).source,'legacy');assert.ok(url.includes('before_id=old'));
 const denied=new DistributedReadClient('https://host/distributed','token',async()=>({ok:false,status:403}));await assert.rejects(denied.history('chat','lane',signal()),/403/);
});
test('native platform reads preserve each independent pagination cursor and auth',async()=>{
 const calls=[];const reader=new DistributedReadClient('https://host/distributed/','token',async(url,opts)=>{
  calls.push(url);assert.equal(opts.headers.Authorization,'Bearer token');assert.equal(opts.cache,'no-store');return {ok:true,json:async()=>({items:[]})};
 });
 await reader.catalog('r/a',signal());await reader.members('r/a','user-b',signal());
 await reader.roomInvitations('invite/a',signal());await reader.tableInvitations('table-a',signal());await reader.ledger('r/a',signal());
 assert.deepEqual(calls.map(u=>u.replace('https://host/distributed','')),['/rooms?limit=50&after_room_id=r%2Fa','/rooms/r%2Fa/members?limit=100&after_user_id=user-b','/room-invitations?limit=50&after_id=invite%2Fa','/table-invitations?limit=50&after_table_id=table-a','/rooms/r%2Fa/ledger']);
});
test('friend and settlement intents capture canonical scope and cannot change on retry',async()=>{
 const {friendshipControl,settlementControl}=await import('../src/multiplayer/DistributedControls.ts');
 const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
 const c=command();friendshipControl(c,'user-'+b,'user-'+a,'request-friend');
 assert.deepEqual(c.request.target,{kind:'conversation',user_low:a,user_high:b});
 assert.throws(()=>friendshipControl(command(),a,a,'request-friend'));
 assert.throws(()=>friendshipControl(command(),'invalid',b,'request-friend'));
 const s=command();settlementControl(s,'room',{scope:'game',table_id:'t',game_id:'g'});
 assert.equal(s.request.body.command,'create-settlement');assert.equal(s.request.body.expected_revision,undefined);
 assert.equal(settlementControl(s,'other',{batch_id:'b',transfer_id:'t',action:'confirm'}),false);
 assert.equal(s.request.target.room_id,'room');assert.equal(s.request.body.payload.game_id,'g');
 const action=command();settlementControl(action,'room',{batch_id:'b',transfer_id:'t',action:'confirm'});
 assert.equal(action.request.body.command,'settlement-action');
});
test('browser fetch retains its global receiver when used by a reader instance',async()=>{
 const reader=new DistributedReadClient('https://host/distributed','token',function(){
  assert.equal(this,globalThis);return Promise.resolve({ok:true,json:async()=>({items:[],next_room_id:null})});
 });
 await reader.catalog(null,signal());
});
