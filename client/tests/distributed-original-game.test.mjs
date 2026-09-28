import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
import { DistributedGameCommandClient } from '../src/multiplayer/DistributedGameCommandClient.ts';
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
 let request,submits=0;
 const command=new DurableCommandClient({submit:async r=>{request=r;submits++;return receipt(r,'pending');},status:async()=>receipt(request)});
 const client=new DistributedGameCommandClient(command,async()=>view,s=>s);
 client.submit(view,'PLAY_CARD');await assert.rejects(client.refresh(signal()),/confirm/);
 assert.equal(client.pending,true);await command.reconcile();
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
