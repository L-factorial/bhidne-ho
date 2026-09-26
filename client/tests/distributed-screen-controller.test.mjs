import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
import { DistributedScreenController, leaveControl } from '../src/multiplayer/DistributedScreenController.ts';
import { CommandJournal } from '../src/multiplayer/CommandJournal.ts';
import { distributedHttpTransport } from '../src/multiplayer/DistributedHttpTransport.ts';
const view=(game_type='callbreak',phase='STARTED')=>({room_id:'r',table_id:'t',match_id:'m',durable_game_id:'g',table_revision:3,game:{revision:8},game_type,
 table:{phase,current_user:{can_leave_seat:['OPEN','COMPLETED','ENDED'].includes(phase),can_abandon_match:game_type==='callbreak',is_in_active_match:phase==='STARTED'}}});
const receipt=(body,state='accepted')=>({lane_id:'lane',sequence:1,command_id:body.command_id,status:state,status_reference:{lane_id:'lane',command_id:body.command_id},
 outcome:state==='pending'?null:{command_id:body.command_id,status:state,...(state==='rejected'?{detail:'Not your turn'}:{})}});
function setup(transport){const c=new DurableCommandClient(transport),states=[],navigation=[];
 const screen=new DistributedScreenController(c,{changed:s=>states.push(s),accepted:r=>navigation.push(r)});return {c,screen,states,navigation};}
for(const [type,phase,kind,command,revision] of [['callbreak','OPEN','table','leave-seat',3],['callbreak','COMPLETED','table','leave-seat',3],['callbreak','STARTED','table','abandon',3],['marriage','STARTED','game','FOLD_AND_LEAVE',8],['flush','STARTED','game','FOLD_AND_LEAVE',8]]){
 test(`${type}/${phase} leave freezes ${command} target and revision`,()=>{
  const c=new DurableCommandClient({submit:async()=>assert.fail(),status:async()=>assert.fail()});leaveControl(c,view(type,phase));
  assert.equal(c.request.target.kind,kind);assert.equal(c.request.body.command,command);assert.equal(c.request.body.expected_revision,revision);
  assert.equal(leaveControl(c,view('callbreak','OPEN')),false);assert.equal(c.request.body.command,command);
 });
}
test('locked or unseated leave fails before creating a request',()=>{
 const c=new DurableCommandClient({submit:async()=>assert.fail(),status:async()=>assert.fail()});assert.throws(()=>leaveControl(c,view('marriage','LOCKED')));assert.equal(c.request,null);
});
test('pending blocks repeated clicks; background acceptance navigates once',async()=>{
 let body;const f=setup({submit:async r=>{body=r.body;return receipt(body,'pending');},status:async()=>receipt(body)});
 await f.screen.table(view(),'join-queue');assert.equal(f.screen.state.busy,true);assert.equal(f.navigation.length,0);
 assert.equal(await f.screen.table(view(),'join-queue'),false);await f.c.reconcile();assert.equal(f.navigation.length,1);await f.screen.recover();assert.equal(f.navigation.length,1);f.screen.dispose();
});
test('durable rejection shows detail and does not navigate',async()=>{
 const f=setup({submit:async r=>receipt(r.body,'rejected'),status:async()=>assert.fail()});await f.screen.game(view(),'PLAY_CARD');
 assert.equal(f.screen.state.status,'rejected');assert.equal(f.screen.state.error,'Not your turn');assert.equal(f.navigation.length,0);assert.equal(f.screen.state.busy,false);f.screen.dispose();
});
test('lost response keeps the leave intention even when the screen changes game state',async()=>{
 let saved;const f=setup({submit:async r=>{if(!saved){saved=r;throw Error('offline');}assert.deepEqual(r,saved);return receipt(r.body);},status:async()=>assert.fail()});
 await f.screen.leave(view('flush'));assert.equal(f.screen.state.status,'pending');assert.equal(f.navigation.length,0);
 assert.equal(await f.screen.leave(view('callbreak','OPEN')),false);await f.screen.recover();assert.equal(f.navigation.length,1);assert.equal(saved.body.command,'FOLD_AND_LEAVE');f.screen.dispose();
});
test('disposed screen cannot navigate on a late response; session intention remains',async()=>{
 let finish;const f=setup({submit:r=>new Promise(resolve=>finish=()=>resolve(receipt(r.body))),status:async()=>assert.fail()});const work=f.screen.room('r','leave-room');
 await new Promise(r=>setImmediate(r));f.screen.dispose();await work;finish();await new Promise(r=>setImmediate(r));assert.equal(f.c.pending,true);assert.equal(f.navigation.length,0);
});
test('room creation persists before POST and recovers same room after lost response/reload',async()=>{
 const values=new Map(),storage={read:k=>values.get(k)??null,write:(k,v)=>values.set(k,v)};let first,mutations=0;
 const fetcher=async(url,options)=>{
  assert.ok(url.endsWith('/distributed/rooms'));const body=JSON.parse(options.body);assert.equal(body.name,'My room');assert.ok(values.size);
  if(!first){first=body;mutations++;throw Error('lost response');}assert.deepEqual(body,first);
  return {ok:true,json:async()=>({command_id:body.command_id,status:'accepted',room_id:'a'.repeat(32)})};
 };
 let j=new CommandJournal(storage,'alice','device');let c=new DurableCommandClient(distributedHttpTransport('https://host/distributed','token',fetcher),{persistence:j.bind('create')});
 let nav=[];let screen=new DistributedScreenController(c,{changed:()=>{},accepted:r=>nav.push(r)});await screen.createRoom('My room','private');assert.equal(nav.length,0);screen.dispose();c.close();j.close();
 j=new CommandJournal(storage,'alice','device');c=new DurableCommandClient(distributedHttpTransport('https://host/distributed','token',fetcher),{persistence:j.bind('create')});
 screen=new DistributedScreenController(c,{changed:()=>{},accepted:r=>nav.push(r)});await screen.recover();assert.equal(nav[0].room_id,'a'.repeat(32));assert.equal(mutations,1);assert.equal('lane_id' in c.latest,false);
 screen.dispose();c.close();j.close();j=new CommandJournal(storage,'alice','device');c=new DurableCommandClient({submit:async()=>assert.fail(),status:async()=>assert.fail()},{persistence:j.bind('create')});assert.equal(c.pending,false);await c.reconcile();
});
test('malformed catalog receipt cannot resolve pending creation',async()=>{
 const f=setup({submit:async r=>({command_id:r.body.command_id,status:'accepted',room_id:123}),status:async()=>assert.fail()});await f.screen.createRoom('Name','private');assert.equal(f.c.pending,true);assert.equal(f.navigation.length,0);f.screen.dispose();
});
test('UI callback failures cannot strand controller or alter committed result',async()=>{
 const c=new DurableCommandClient({submit:async r=>receipt(r.body),status:async()=>assert.fail()});const screen=new DistributedScreenController(c,{changed:()=>{throw Error('render');},accepted:()=>{throw Error('navigate');}});
 assert.equal(await screen.room('r','leave-room'),true);assert.equal(screen.state.status,'accepted');assert.equal(screen.state.busy,false);screen.dispose();
});

test('legacy lobby aliases select table versus engine lanes explicitly',async()=>{
 const a=setup({submit:async r=>receipt(r.body),status:async()=>assert.fail()});await a.screen.lobby(view(),'/join');assert.equal(a.c.request.body.command,'join-seat');assert.equal(a.c.request.target.kind,'table');a.screen.dispose();
 const b=setup({submit:async r=>receipt(r.body),status:async()=>assert.fail()});await b.screen.lobby(view(),'/next-deal',{deal_number:2});assert.equal(b.c.request.body.command,'NEXT_DEAL');assert.equal(b.c.request.body.expected_revision,8);b.screen.dispose();
});
test('invalid room fields are rejected before journaling an unresolved request',async()=>{
 const f=setup({submit:async()=>assert.fail(),status:async()=>assert.fail()});assert.equal(await f.screen.createRoom('  ','private'),false);assert.equal(f.c.request,null);assert.match(f.screen.state.error,/Invalid/);f.screen.dispose();
});
