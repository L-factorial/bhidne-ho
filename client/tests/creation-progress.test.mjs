import test from 'node:test';
import assert from 'node:assert/strict';
import {creationProgress} from '../src/multiplayer/creationProgress.ts';
import {CommandJournal} from '../src/multiplayer/CommandJournal.ts';
const table={target:{kind:'room',room_id:'r'},body:{command_id:'same-id',command:'create-table',payload:{name:'Table',game_type:'flush'}}};
test('creation cards restore identity from durable storage and distinguish rejection from uncertainty',()=>{
 const data=new Map(),store={read:k=>data.get(k)??null,write:(k,v)=>data.set(k,v)};
 let journal=new CommandJournal(store,'alice','device');
 journal.bind('ui-table-control').save({request:table,receipt:null});journal.close();
 journal=new CommandJournal(store,'alice','device');const restored=journal.bind('ui-table-control').load();
 assert.deepEqual(creationProgress(restored.request,restored.receipt),{id:'same-id',kind:'table',roomId:'r',name:'Table',gameType:'flush',matchId:undefined});
 assert.equal(creationProgress(table,{status:'rejected'}),null);
 assert.equal(creationProgress(table,{status:'accepted',outcome:{match_id:'m'}}).matchId,'m');
 assert.equal(creationProgress({...table,body:{...table.body,command:'lock'}},null),null);
 const room={target:{kind:'catalog'},body:{command_id:'room-id',command:'create-room',payload:{name:'Family'}}};
 assert.equal(creationProgress(room,null).kind,'room');
 assert.equal(creationProgress(null,null),null);journal.close();
});

test('default-room game continuation persists across restart independently of command slots',()=>{
 const data=new Map(),store={read:k=>data.get(k)??null,write:(k,v)=>data.set(k,v)};
 let journal=new CommandJournal(store,'alice','device');
 const flow={id:'flow',defaultName:'Alice-Room',room:null,payload:{game_type:'flush',invitees:[],notify_room:true}};
 journal.saveCreationFlow(flow);journal.close();journal=new CommandJournal(store,'alice','device');
 assert.deepEqual(journal.creationFlow,flow);assert.deepEqual(journal.slots,[]);
 journal.saveCreationFlow({...flow,room:{room_id:'r',name:'Alice-Room',members:['alice']}});
 journal.close();journal=new CommandJournal(store,'alice','device');
 assert.equal(journal.creationFlow.room.room_id,'r');journal.saveCreationFlow(null);assert.equal(journal.creationFlow,null);
 assert.throws(()=>journal.saveCreationFlow({...flow,payload:{game_type:'invalid'}}),/Invalid creation flow/);journal.close();
});
