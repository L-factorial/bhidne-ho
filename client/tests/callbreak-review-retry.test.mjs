import test from 'node:test';
import assert from 'node:assert/strict';
import { GameCommandClient } from '../src/multiplayer/GameCommandClient.ts';
import { DistributedGameCommandClient } from '../src/multiplayer/DistributedGameCommandClient.ts';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
const conflict='The turn changed. Your view has been refreshed; try again.';
const signal=()=>new AbortController().signal;
function initial(){return {room_id:'room',table_id:'table',table_revision:1,durable_game_id:'game',match_id:'match',game_type:'callbreak',status:'playing',
 game:{revision:1,phase:'HAND_REVIEW'},deal:{deal_number:1,attempt:1},private:{hand:['2H','3C'],can_accept_hand:true,can_claim_redeal:true}};}
function setup(kind,action,{failRead=false}={}){
 let state=initial(),reads=0;const sent=[];
 const read=async()=>{reads++;if(failRead&&reads===2)throw Error('read failed');return structuredClone(state);};
 const send=async request=>{
  sent.push(structuredClone(request));const result=await action(state,request,sent.length);
  return {command_id:request.command_id,status:result?'rejected':'accepted',revision:state.game.revision,...(result?{detail:result}:{})};
 };
 const client=kind==='local'?new GameCommandClient({snapshot:read,action:async request=>({...structuredClone(state),action_ack:await send(request)})}):
 new DistributedGameCommandClient(new DurableCommandClient({submit:async r=>{const outcome=await send(r.body);return {command_id:outcome.command_id,lane_id:'lane',sequence:sent.length,status:outcome.status,outcome,status_reference:{lane_id:'lane',command_id:outcome.command_id}};},status:async()=>assert.fail()}),read,s=>s);
 return {client,sent,state};
}
for(const kind of ['local','distributed']){
 for(const command of ['ACCEPT_HAND','CLAIM_REDEAL'])test(`${kind}: concurrent ${command} retries against fresh revision and a new ID`,async()=>{
  const f=setup(kind,(state,r,n)=>{state.game.revision++;return n===1?conflict:null;});
  f.client.submit(f.state,command);const result=await f.client.refresh(signal());
  assert.equal(result.error,'');assert.equal(f.sent.length,2);assert.equal(f.sent[0].expected_revision,1);assert.equal(f.sent[1].expected_revision,2);
  assert.notEqual(f.sent[0].command_id,f.sent[1].command_id);assert.equal(f.client.pending,false);
 });
 for(const changed of ['accepted','redealing','newAttempt'])test(`${kind}: resolves ${changed} without another mutation`,async()=>{
  const f=setup(kind,(state)=>{state.game.revision++;if(changed==='accepted')state.private.can_accept_hand=false;
   if(changed==='redealing')state.game.phase='AWAITING_REDEAL';if(changed==='newAttempt'){state.deal.attempt++;state.private.hand=['AS'];}return conflict;});
  f.client.submit(f.state,changed==='accepted'?'ACCEPT_HAND':'CLAIM_REDEAL');assert.equal((await f.client.refresh(signal())).error,'');assert.equal(f.sent.length,1);
 });
 for(const changed of ['match','hand','ineligible','otherError'])test(`${kind}: does not hide ${changed} rejection or retry it`,async()=>{
  const f=setup(kind,state=>{state.game.revision++;if(changed==='match')state.match_id='other';if(changed==='hand')state.private.hand=['AS'];if(changed==='ineligible')state.private.can_claim_redeal=false;return changed==='otherError'?'No longer seated.':conflict;});
  f.client.submit(f.state,'CLAIM_REDEAL');assert.ok((await f.client.refresh(signal())).error);assert.equal(f.sent.length,1);
 });
 test(`${kind}: bounded retry under sustained conflicts`,async()=>{
  const f=setup(kind,state=>{state.game.revision++;return conflict;});f.client.submit(f.state,'ACCEPT_HAND');assert.ok((await f.client.refresh(signal())).error);assert.equal(f.sent.length,6);
 });
 test(`${kind}: read failure retains rejected intention until safe revalidation`,async()=>{
  const f=setup(kind,(state,r,n)=>{state.game.revision++;return n===1?conflict:null;},{failRead:true});f.client.submit(f.state,'ACCEPT_HAND');
  await assert.rejects(f.client.refresh(signal()),/read failed/);assert.equal(f.client.pending,true);
  assert.equal((await f.client.refresh(signal())).error,'');assert.equal(f.sent.length,2);
 });
}

for(const kind of ['local','distributed'])test(`${kind}: lost review response retains its original ID and revision`,async()=>{
 const f=setup(kind,(state,r,n)=>{if(n===1){state.game.revision++;throw Error('lost response');}return null;});
 f.client.submit(f.state,'ACCEPT_HAND');await assert.rejects(f.client.refresh(signal()),/lost response/);
 assert.equal(f.client.pending,true);assert.equal((await f.client.refresh(signal())).error,'');
 assert.deepEqual(f.sent[0],f.sent[1]);
});
for(const kind of ['local','distributed'])test(`${kind}: stale projection is not used for a replacement command`,async()=>{
 const f=setup(kind,()=>conflict);f.client.submit(f.state,'ACCEPT_HAND');assert.ok((await f.client.refresh(signal())).error);assert.equal(f.sent.length,1);
});
