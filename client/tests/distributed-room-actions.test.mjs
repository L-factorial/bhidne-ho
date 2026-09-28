import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedRoomActions, RoomActionPending, RoomActionRejected } from '../src/multiplayer/DistributedRoomActions.ts';
import { DurableCommandClient } from '../src/multiplayer/DurableCommandClient.ts';
import { CommandJournal } from '../src/multiplayer/CommandJournal.ts';
import { distributedHttpTransport } from '../src/multiplayer/DistributedHttpTransport.ts';

const account={user_id:'user-alice',token:'secret'};
const roomId='a'.repeat(32);
const input={name:'My room',visibility:'private',invitees:['user-bob']};
function receipt(r,status='accepted') {
 const command_id=r.body.command_id;
 return {lane_id:'lane',command_id,sequence:1,status,status_reference:{lane_id:'lane',command_id},
  outcome:status==='pending'?null:{command_id,status,...(status==='rejected'?{detail:'End every active table before deleting the room.'}:{})}};
}
function setup(transport,options) {
 const client=new DurableCommandClient(transport,options);
 return {client,actions:new DistributedRoomActions(account,client)};
}
test('original room actions submit durable commands without legacy requests',async()=>{
 const calls=[];
 const transport=distributedHttpTransport('https://host/distributed',account.token,async(url,options)=>{
  calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer secret');
  const body=JSON.parse(options.body);
  return {ok:true,json:async()=>url.endsWith('/rooms')?{command_id:body.command_id,status:'accepted',room_id:roomId}:receipt(body)};
 });
 const {actions}=setup(transport);
 const room=await actions.create(account,input);
 assert.deepEqual(room,{room_id:roomId,name:input.name,visibility:'private',creator_id:account.user_id,members:[account.user_id]});
 await actions.enter(account,'created');await actions.leave(account,'created');await actions.remove(account,'created');
 assert.deepEqual(calls.map(c=>c.url),['https://host/distributed/rooms',...Array(3).fill('https://host/distributed/commands')]);
 assert.deepEqual(calls.slice(1).map(c=>JSON.parse(c.options.body).body.command),['enter-room','leave-room','delete-room']);
 assert.ok(calls.every(c=>!c.options.body.includes(account.token)));
});
test('pending does not report success and retries status with the same ID',async()=>{
 let submitted,submits=0,statuses=0;
 const {actions}=setup({submit:async r=>{submitted=r;submits++;return receipt(r,'pending');},status:async reference=>{
  statuses++;assert.equal(reference.command_id,submitted.body.command_id);return receipt(submitted);
 }});
 await assert.rejects(actions.enter(account,'r'),RoomActionPending);
 await assert.rejects(actions.leave(account,'r'),RoomActionPending);
 await actions.enter(account,'r');
 assert.equal(submits,1);assert.equal(statuses,1);
});
test('a lost creation response survives reload and cannot create a different room',async()=>{
 const data=new Map(),storage={read:k=>data.get(k)??null,write:(k,v)=>data.set(k,v)};
 let first;
 const transport={submit:async r=>{
  assert.ok(data.size,'journal must be saved before network submission');
  if(!first){first=r;throw Error('response lost');}
  assert.deepEqual(r,first);return {command_id:r.body.command_id,status:'accepted',room_id:roomId};
 },status:async()=>assert.fail()};
 let journal=new CommandJournal(storage,'alice','device');
 let f=setup(transport,{persistence:journal.bind('original-room-actions')});
 await assert.rejects(f.actions.create(account,input),/response lost/);
 f.actions.dispose();f.client.close();journal.close();
 journal=new CommandJournal(storage,'alice','device');f=setup(transport,{persistence:journal.bind('original-room-actions')});
 await assert.rejects(f.actions.create(account,{...input,name:'Another room'}),RoomActionPending);
 const recovered=await f.actions.recover(account);
 assert.equal(recovered.room.room_id,roomId);assert.equal(recovered.command,'create-room');
 assert.equal(await f.actions.recover(account),null);
 f.actions.dispose();f.client.close();journal.close();
});
test('background acceptance after timeout is observed without a second mutation',async()=>{
 let r,submits=0;
 const {actions,client}=setup({submit:async value=>{submits++;r=value;return receipt(r,'pending');},status:async()=>receipt(r)});
 await assert.rejects(actions.remove(account,'r'),RoomActionPending);
 await client.reconcile();
 await actions.remove(account,'r');
 assert.equal(submits,1);
});
test('committed rejection keeps its detail and permits a later new intention',async()=>{
 const calls=[];
 const {actions}=setup({submit:async r=>{calls.push(r);return receipt(r,calls.length===1?'rejected':'accepted');},status:async()=>assert.fail()});
 await assert.rejects(actions.remove(account,'r'),e=>e instanceof RoomActionRejected&&e.message.includes('End every active table'));
 await actions.enter(account,'another');
 assert.notEqual(calls[0].body.command_id,calls[1].body.command_id);
});
test('double clicks cannot submit concurrently and input mutations cannot alter retries',async()=>{
 let finish,r,count=0;
 const {actions}=setup({submit:value=>{r=value;count++;return new Promise(resolve=>finish=resolve);},status:async()=>assert.fail()});
 const value={...input,invitees:['user-bob']};
 const work=actions.create(account,value);
 await new Promise(resolve=>setImmediate(resolve));
 value.invitees.push('user-charlie');
 await assert.rejects(actions.create(account,value),RoomActionPending);
 assert.deepEqual(r.body.payload.invitees,['user-bob']);
 finish({command_id:r.body.command_id,status:'accepted',room_id:roomId});await work;
 assert.equal(count,1);
});
test('logout disposal prevents late success without discarding the durable intention',async()=>{
 let finish,r;
 const {actions,client}=setup({submit:value=>{r=value;return new Promise(resolve=>finish=resolve);},status:async()=>assert.fail()});
 const work=actions.enter(account,'r');
 await new Promise(resolve=>setImmediate(resolve));actions.dispose();
 await assert.rejects(work,/aborted|changed/);
 finish(receipt(r));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(client.pending,true);
 await assert.rejects(actions.enter(account,'r'),/changed/);
});
test('account/token changes and invalid create input cannot submit',async()=>{
 const {actions,client}=setup({submit:async()=>assert.fail(),status:async()=>assert.fail()});
 await assert.rejects(actions.enter({...account,user_id:'user-bob'},'r'),/changed/);
 await assert.rejects(actions.enter({...account,token:'another'},'r'),/changed/);
 await assert.rejects(actions.create(account,{...input,name:' '}),/Invalid/);
 assert.equal(client.request,null);
});
