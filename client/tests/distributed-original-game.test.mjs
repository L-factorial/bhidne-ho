import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
import { DistributedGameCommandClient, GameConfirmationPending } from '../src/multiplayer/DistributedGameCommandClient.ts';
const view={room_id:'room',table_id:'table',match_id:'match',table_revision:9,durable_game_id:'game',game:{revision:3}};
const signal=()=>new AbortController().signal;
function receipt(request,status='accepted') {
 const command_id=request.body.command_id;
 return {command_id,lane_id:'lane',sequence:1,status,status_reference:{lane_id:'lane',command_id},
  outcome:status==='pending'?null:{command_id,status,revision:4,detail:status==='rejected'?'Not your turn.':null}};
}
test('original game controls retain the old round/ID/revision across ambiguous response and selection change',async()=>{
 let original,submits=0,current=view;
 const command=new DurableCommandClient({submit:async request=>{
  submits++;if(!original){original=request;throw Error('lost response');}
  assert.deepEqual(request,original);return receipt(request);
 },status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>current,s=>s);
 assert.equal(client.submit(view,'DRAW_CARD',{source:'stock'}),true);
 await assert.rejects(client.refresh(signal()),/lost response/);
 current={...view,match_id:'new-match',durable_game_id:'new-game',game:{revision:0}};
 assert.equal(client.submit(current,'DRAW_CARD'),false);
 assert.equal((await client.refresh(signal())).snapshot.match_id,'new-match');
 assert.equal(original.body.expected_revision,3);assert.equal(original.target.game_id,'game');
 assert.equal(submits,2);assert.equal(client.pending,false);
});
test('pending admission is not UI success; background acceptance is consumed once',async()=>{
 let request,submits=0,accepted=false;
 const command=new DurableCommandClient({submit:async r=>{request=r;submits++;return receipt(r,'pending');},status:async()=>receipt(request,accepted?'accepted':'pending')});
 const client=new DistributedGameCommandClient(command,async()=>view,s=>s);
 client.submit(view,'PLAY_CARD');await assert.rejects(client.refresh(signal()),GameConfirmationPending);
 assert.equal(client.pending,true);accepted=true;await command.reconcile();
 assert.equal(client.pending,true);await client.refresh(signal());
 assert.equal(client.pending,false);assert.equal(submits,1);
});
test('projection failure after acceptance never repeats the mutation',async()=>{
 let submits=0,reads=0;
 const command=new DurableCommandClient({submit:async r=>{submits++;return receipt(r);},status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>{if(++reads===1)throw Error('read failed');return view;},s=>s);
 client.submit(view,'PLAY_CARD');await assert.rejects(client.refresh(signal()),/read failed/);
 assert.equal(client.pending,true);await client.refresh(signal());assert.equal(submits,1);
});
test('rejection preserves the original message and permits the next intention after observation',async()=>{
 const command=new DurableCommandClient({submit:async r=>receipt(r,'rejected'),status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>view,s=>s);
 client.submit(view,'PLAY_CARD');assert.equal((await client.refresh(signal())).error,'Not your turn.');
 assert.equal(client.submit(view,'PLAY_CARD'),true);
});

test('delivered outcome confirms promptly without status polling or resubmission',async()=>{
 let request,submits=0,statuses=0;
 const command=new DurableCommandClient({submit:async r=>{request=r;submits++;setTimeout(()=>command.acceptCommitted('lane',receipt(r).outcome),50);return receipt(r,'pending');},status:async()=>{statuses++;return receipt(request);}});
 const client=new DistributedGameCommandClient(command,async()=>view,s=>s);
 client.submit(view,'BET');const start=Date.now();
 assert.equal((await client.refresh(signal())).error,'');
 assert.ok(Date.now()-start<900);assert.equal(submits,1);assert.equal(statuses,0);assert.equal(client.pending,false);
});
test('screen waits for background reconciliation and cancellation retains original intent',async()=>{
 let finish,request;
 const command=new DurableCommandClient({submit:r=>{request=r;return new Promise(resolve=>finish=resolve);},status:async()=>receipt(request)});
 const client=new DistributedGameCommandClient(command,async()=>view,s=>s);
 client.submit(view,'BET');const background=command.reconcile();await new Promise(r=>setImmediate(r));
 const controller=new AbortController();const refresh=client.refresh(controller.signal);controller.abort();
 await assert.rejects(refresh,/aborted/);assert.equal(client.pending,true);
 finish(receipt(request));await background;await client.refresh(signal());assert.equal(client.pending,false);
});
test('screen consumes background acceptance without competing reconciliation',async()=>{
 let finish,request,submits=0;
 const command=new DurableCommandClient({submit:r=>{request=r;submits++;return new Promise(resolve=>finish=resolve);},status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>view,s=>s);
 client.submit(view,'BET');const background=command.reconcile();await new Promise(r=>setImmediate(r));
 const refreshing=client.refresh(signal());finish(receipt(request));await background;
 assert.equal((await refreshing).error,'');assert.equal(submits,1);assert.equal(client.pending,false);
});
test('delivered outcome arriving before admission is retained without trusting an unknown inbox sequence',async()=>{
 let release,request;
 const command=new DurableCommandClient({submit:r=>{request=r;return new Promise(resolve=>release=resolve);},status:async()=>assert.fail()});
 command.begin({kind:'game'},{command:'BET',payload:{}});
 const pending=command.reconcile();await new Promise(r=>setImmediate(r));
 command.acceptCommitted('lane',receipt(request).outcome);
 assert.equal(command.latest,null);release(receipt(request,'pending'));
 assert.equal((await pending).status,'accepted');assert.equal(command.pending,false);
});
test('a delivered committed snapshot satisfies confirmation without a duplicate read',async()=>{
 const command=new DurableCommandClient({submit:async r=>receipt(r),status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>assert.fail('duplicate snapshot read'),s=>s);
 client.submit(view,'BET');client.observe({...view,game:{revision:4}});
 assert.equal((await client.refresh(signal())).snapshot.game.revision,4);
});


test('distributed declarations journal the original phase through reconnect and restoration',async()=>{
 let saved=null,original=null,current={...view,game_type:'marriage',
  marriage:{public:{declaration_phase_id:'match:initial-tunnelas'}}};
 const persistence={load:()=>saved,save:value=>{saved=structuredClone(value);},check:()=>{}};
 const transport={submit:async request=>{
  if(!original){original=structuredClone(request);throw Error('response lost');}
  assert.deepEqual(request,original);return receipt(request);
 },status:async()=>assert.fail()};
 const commands=new DurableCommandClient(transport,{persistence});
 const client=new DistributedGameCommandClient(commands,async()=>current,s=>s);
 const payload={melds:[]};
 assert.equal(client.submit(current,'DECLARE_TUNNELAS',payload),true);
 payload.melds.push({changed:true});
 await assert.rejects(client.refresh(signal()),/response lost/);
 current={...current,game:{revision:4},marriage:{public:{declaration_phase_id:null}}};
 const restored=new DistributedGameCommandClient(new DurableCommandClient(transport,{persistence}),async()=>current,s=>s);
 await restored.refresh(signal());
 assert.deepEqual(original.body.payload,{melds:[],declaration_phase_id:'match:initial-tunnelas'});
 assert.equal(original.body.expected_revision,3);
 assert.equal(restored.pending,false);
});

for (const reviewCommand of ['ACCEPT_HAND', 'CLAIM_REDEAL']) {
 test(`distributed ${reviewCommand} restores the original hand review scope`,async()=>{
  let saved=null,original=null,current={...view,game_type:'callbreak',
   game:{revision:3,hand_review_phase_id:'match:1:1:hand-review'}};
  const persistence={load:()=>saved,save:value=>{saved=structuredClone(value);},check:()=>{}};
  const transport={submit:async request=>{
   if(!original){original=structuredClone(request);throw Error('response lost');}
   assert.deepEqual(request,original);return receipt(request);
  },status:async()=>assert.fail()};
  const client=new DistributedGameCommandClient(new DurableCommandClient(transport,{persistence}),async()=>current,s=>s);
  assert.equal(client.submit(current,reviewCommand,{}),true);
  await assert.rejects(client.refresh(signal()),/response lost/);
  current={...current,game:{revision:5,hand_review_phase_id:'match:1:2:hand-review'}};
  const restored=new DistributedGameCommandClient(new DurableCommandClient(transport,{persistence}),async()=>current,s=>s);
  await restored.refresh(signal());
  assert.deepEqual(original.body.payload,{hand_review_phase_id:'match:1:1:hand-review'});
  assert.equal(original.body.expected_revision,3);
  assert.equal(restored.pending,false);
 });
}

for(const detail of ['The hand changed. Your view has been refreshed; try again.','Refresh the game before retrying.']){
 test(`Flush bet conflicts resolve silently after a fresh snapshot: ${detail}`,async()=>{
  let submits=0,reads=0;
  const initial={...view,game_type:'flush'};
  const latest={...initial,game:{revision:4}};
  const command=new DurableCommandClient({submit:async r=>{
   submits++;return {...receipt(r,'rejected'),outcome:{...receipt(r,'rejected').outcome,detail}};
  },status:async()=>assert.fail()});
  const client=new DistributedGameCommandClient(command,async()=>{
   reads++;return reads===1?initial:latest;
  },s=>s);
  assert.equal(client.submit(initial,'BET',{amount:10}),true);
  await assert.rejects(client.refresh(signal()),GameConfirmationPending);
  assert.equal(client.pending,true);
  assert.equal(client.submit(latest,'BET',{amount:20}),false);
  const result=await client.refresh(signal());
  assert.equal(result.error,'');assert.equal(result.snapshot,latest);
  assert.equal(client.pending,false);assert.equal(submits,1);
  assert.deepEqual(command.request.body.payload,{amount:10});
 });
}
test('Flush bet conflict retains receipt across a failed refresh and a round change',async()=>{
 let submits=0,reads=0;
 const initial={...view,game_type:'flush'};
 const latest={...initial,match_id:'next-match',game:{revision:0}};
 const command=new DurableCommandClient({submit:async r=>{
  submits++;return {...receipt(r,'rejected'),outcome:{...receipt(r,'rejected').outcome,detail:'The hand changed. Your view has been refreshed; try again.'}};
 },status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>{if(++reads===1)throw Error('offline');return latest;},s=>s);
 client.submit(initial,'BET',{amount:10});
 await assert.rejects(client.refresh(signal()),/offline/);assert.equal(client.pending,true);
 assert.equal((await client.refresh(signal())).error,'');assert.equal(submits,1);assert.equal(client.pending,false);
});

for(const detail of [
 'The turn changed. Your view has been refreshed; try again.',
 'Refresh game state before retrying.',
 'Dealer selection is not active.',
 'Wait for your turn to pick a dealer card.',
 'That card has already been picked.',
 'Request belongs to another deal attempt.',
]){
 test(`dealer pick conflict refreshes silently without selecting another card: ${detail}`,async()=>{
  let submits=0,reads=0;
  const initial={...view,game_type:'callbreak'};
  const latest={...initial,game:{revision:4,phase:'SELECTING_DEALER'}};
  const command=new DurableCommandClient({submit:async r=>{
   submits++;return {...receipt(r,'rejected'),outcome:{...receipt(r,'rejected').outcome,detail}};
  },status:async()=>assert.fail()});
  const client=new DistributedGameCommandClient(command,async()=>++reads===1?initial:latest,s=>s);
  client.submit(initial,'PICK_DEALER_CARD',{position:17});
  await assert.rejects(client.refresh(signal()),GameConfirmationPending);
  assert.equal(client.pending,true);
  assert.equal(client.submit(latest,'PICK_DEALER_CARD',{position:18}),false);
  const result=await client.refresh(signal());
  assert.equal(result.error,'');assert.equal(result.snapshot,latest);
  assert.equal(client.pending,false);assert.equal(submits,1);
  assert.deepEqual(command.request.body.payload,{position:17});
 });
}
test('dealer pick network recovery retains ID and position through a changed match',async()=>{
 let original,submits=0;
 const initial={...view,game_type:'callbreak'};
 const latest={...initial,match_id:'next-match',game:{revision:0}};
 const command=new DurableCommandClient({submit:async r=>{
  submits++;
  if(!original){original=r;throw Error('response lost');}
  assert.deepEqual(r,original);
  return {...receipt(r,'rejected'),outcome:{...receipt(r,'rejected').outcome,detail:'The turn changed. Your view has been refreshed; try again.'}};
 },status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>latest,s=>s);
 client.submit(initial,'PICK_DEALER_CARD',{position:17});
 await assert.rejects(client.refresh(signal()),/response lost/);
 assert.equal(client.pending,true);
 assert.equal((await client.refresh(signal())).error,'');
 assert.equal(client.pending,false);assert.equal(submits,2);
 assert.deepEqual(original.body.payload,{position:17});
});
test('unrecognized dealer errors are not mistaken for recoverable selection conflicts',async()=>{
 const command=new DurableCommandClient({submit:async r=>({...receipt(r,'rejected'),outcome:{...receipt(r,'rejected').outcome,detail:'Reclaim your seat before playing.'}}),status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>({...view,game_type:'callbreak'}),s=>s);
 client.submit(view,'PICK_DEALER_CARD',{position:17});
 assert.equal((await client.refresh(signal())).error,'Reclaim your seat before playing.');
});

test('ending the table resolves dealer conflict even when its game projection is removed',async()=>{
 const initial={...view,game_type:'callbreak'};
 const ended={...initial,status:'ended',game:undefined};
 const command=new DurableCommandClient({submit:async r=>({...receipt(r,'rejected'),outcome:{...receipt(r,'rejected').outcome,detail:'Dealer selection is not active.'}}),status:async()=>assert.fail()});
 const client=new DistributedGameCommandClient(command,async()=>ended,s=>s);
 client.submit(initial,'PICK_DEALER_CARD',{position:17});
 assert.equal((await client.refresh(signal())).error,'');assert.equal(client.pending,false);
});
