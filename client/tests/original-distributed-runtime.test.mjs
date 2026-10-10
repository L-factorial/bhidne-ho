import test from 'node:test';
import assert from 'node:assert/strict';
import { OriginalDistributedRuntime, originalDistributedOwner } from '../src/multiplayer/OriginalDistributedRuntime.ts';
import { createJournalOwner } from '../src/multiplayer/JournalOwner.ts';
const account={user_id:'alice',token:'secret'}, callbacks={install(){},remove(){},error(){}};
const room='a'.repeat(32);
const input={name:'Room',visibility:'private',invitees:[]};
function store() { const data=new Map();return {read:k=>data.get(k)??null,write:(k,v)=>data.set(k,v)}; }
function runtime(storage,fetcher) {
 const owner=createJournalOwner(storage,account.user_id,()=>{});
 const value=new OriginalDistributedRuntime(owner,'https://host/distributed',account,callbacks,{fetcher});
 return {value,close(){value.close();owner.close();}};
}
test('reload recovers the same creation and retires it only after navigation acknowledges',async()=>{
 const storage=store();let request,submissions=0;
 const fetcher=async(url,options)=>{
  const body=JSON.parse(options.body);submissions++;
  if(!request){request=body;throw Error('response lost');}
  assert.deepEqual(body,request);
  return {ok:true,json:async()=>({command_id:body.command_id,status:'accepted',room_id:room})};
 };
 let r=runtime(storage,fetcher);
 await assert.rejects(r.value.roomActions.create(account,input),/response lost/);r.close();
 r=runtime(storage,fetcher);
 const recovered=await r.value.recoverRoomAction();assert.equal(recovered.roomId,room);
 assert.deepEqual(await r.value.recoverRoomAction(),recovered);
 assert.throws(()=>r.value.roomActions.enter(account,room),/confirmation/);
 r.value.acknowledgeRoomAction(r.value.roomCommandId);r.close();
 r=runtime(storage,fetcher);
 assert.equal(await r.value.recoverRoomAction(),null);assert.equal(submissions,2);r.close();
});
test('unknown outcomes cannot be retired and logout ignores late success',async()=>{
 const storage=store();let finish;
 const r=runtime(storage,async(_url,options)=>new Promise(resolve=>{
  finish=()=>resolve({ok:true,json:async()=>({command_id:JSON.parse(options.body).command_id,status:'accepted',room_id:room})});
 }));
 const pending=r.value.roomActions.create(account,input);
 assert.throws(()=>r.value.acknowledgeRoomAction(r.value.roomCommandId),/not confirmed/);
 await new Promise(resolve=>setImmediate(resolve));
 const rejected=assert.rejects(pending);r.close();finish();await rejected;
 assert.throws(()=>r.value.roomActions.enter(account,room),/closed/);
});
test('logout while acquiring the account lock never installs a stale runtime',async()=>{
 let finish,released=0,created=0;
 const controller=originalDistributedOwner(()=>new Promise(resolve=>finish=resolve));
 const pending=controller.select('alice',()=>{created++;assert.fail('stale runtime installed');});
 controller.close();finish(createJournalOwner(store(),'alice',()=>released++));
 assert.equal(await pending,null);assert.equal(created,0);assert.equal(released,1);
});

test('game creation resumes default-room continuation after restart without duplicating room or table',async()=>{
 const storage=store(),commands=[],rooms=[];
 let loseRoom=true;
 const fetcher=async(url,options)=>{
   const data=JSON.parse(options.body);
   if(url.endsWith('/rooms')){
     rooms.push(data);
     if(loseRoom){loseRoom=false;throw Error('room reply lost');}
     return {ok:true,json:async()=>({command_id:data.command_id,status:'accepted',room_id:room})};
   }
   commands.push(data);
   const command_id=data.body.command_id;
   return {ok:true,json:async()=>({command_id,lane_id:'lane',sequence:commands.length,status:'accepted',status_reference:{command_id,lane_id:'lane'},outcome:{command_id,status:'accepted',...(data.body.command==='create-table'?{match_id:'match',table_id:'table'}:{})}})};
 };
 let r=runtime(storage,fetcher);r.value.root.readGameView=async()=>({status:'empty',table:{current_user:{}},match_id:'match'});
 r.value.connectRequests(async()=>({}));
 await assert.rejects(r.value.createGame(null,'Alice-Room',{game_type:'flush',invitees:[],notify_room:true}),/room reply lost/);
 const flowId=r.value.creationFlow.id;r.close();
 r=runtime(storage,fetcher);r.value.root.readGameView=async()=>({status:'empty',table:{current_user:{}},match_id:'match'});
 r.value.connectRequests(async()=>({}));
 try{
  for(let i=0;i<100&&r.value.creationFlow;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(r.value.creationFlow,null);assert.equal(rooms.length,2);assert.equal(rooms[0].command_id,rooms[1].command_id);
  assert.equal(commands.filter(c=>c.body.command==='create-table').length,1);assert.ok(flowId);
 }finally{r.close();}
});

test('root workflow blocks duplicate creation and logout ignores late success',async()=>{
 const storage=store();let finish;
 const r=runtime(storage,async(_url,options)=>new Promise(resolve=>{
   finish=()=>{const data=JSON.parse(options.body),id=data.body.command_id;resolve({ok:true,json:async()=>({command_id:id,lane_id:'lane',sequence:1,status:'accepted',status_reference:{command_id:id,lane_id:'lane'},outcome:{command_id:id,status:'accepted'}})});};
 }));
 r.value.root.readGameView=async()=>({status:'empty',table:{current_user:{}},match_id:'match'});
 r.value.connectRequests(async()=>({}));
 const pending=r.value.createGame({room_id:room,name:'Room',members:['alice']},'Alice-Room',{game_type:'flush'});

 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.value.creationFlow.room.room_id,room);
  await assert.rejects(r.value.roomActions.create(account,input),/confirmation/);
  assert.throws(()=>r.value.roomActions.enter(account,room),/confirmation/);
 await assert.rejects(r.value.createGame(null,'Another',{game_type:'flush'}),/confirmation/);
 r.close();finish();assert.equal(await pending,null);
});
