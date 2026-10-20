import test from 'node:test';
import assert from 'node:assert/strict';
import {OutgoingChat} from '../src/multiplayer/outgoingChat.ts';
const message={sender_id:'me',sender_name:'You',text:'Hello'};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
test('bubble appears before network completion and history push replaces it without a duplicate',async()=>{
 let complete,called;
 const chat=new OutgoingChat(()=>{});
 assert.ok(chat.send('room',message,(id,text)=>{called={id,text};return new Promise(resolve=>complete=resolve);},true));
 const local=chat.rows('room',[]);assert.equal(local.length,1);assert.equal(local[0].delivery,'sending');assert.equal(local[0].text,'Hello');
 const saved={...message,id:'server',command_id:called.id,sent_at:Date.now()};
 assert.equal(chat.rows('room',[saved]).length,1);assert.equal(chat.rows('room',[saved])[0].id,'server');assert.ok(chat.blocked,'in-flight send still owns its slot');
 complete(saved);await flush();assert.equal(chat.blocked,false);assert.deepEqual(chat.rows('room',[saved]),[saved]);
 assert.deepEqual(chat.rows('room',[]),[],'history removal must not resurrect acknowledged messages');
});
test('uncertain send retries its original ID, recipient and text; double taps cannot duplicate it',async()=>{
 const calls=[];let attempt=0,finish;
 const chat=new OutgoingChat(()=>{});
 chat.send('alice',message,async(id,text)=>{calls.push({id,text});if(attempt++===0)throw Error('Connection lost');return new Promise(resolve=>finish=()=>resolve({...message,id:'saved',command_id:id,sent_at:Date.now()}));},true);
 await flush();let row=chat.rows('alice',[])[0];assert.equal(row.delivery,'confirming');assert.ok(row.can_retry);
 assert.deepEqual(chat.rows('bob',[]),[]);assert.equal(chat.send('bob',message,async()=>{},true),false);
 chat.retry(row.retry_id);chat.retry(row.retry_id);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 finish();await flush();assert.equal(chat.rows('alice',[])[0].delivery,undefined);
});
test('definitive rejection retries on the same bubble with a fresh command attempt',async()=>{
 const ids=[];let attempt=0;
 const chat=new OutgoingChat(()=>{});
 chat.send('room',message,async id=>{ids.push(id);if(attempt++===0)throw Object.assign(Error('Rate limited'),{status:429});return {...message,id:'sent',command_id:id,sent_at:Date.now()};},true);
 await flush();const local=chat.rows('room',[])[0];assert.equal(local.delivery,'failed');assert.ok(local.can_retry);
 chat.retry(local.retry_id);await flush();assert.notEqual(ids[0],ids[1]);assert.equal(chat.rows('room',[]).length,1);assert.equal(chat.blocked,false);
});
test('legacy ambiguous failures cannot blindly resend non-idempotent messages',async()=>{
 let count=0;const chat=new OutgoingChat(()=>{});
 chat.send('room',message,async()=>{count++;throw Error('Unknown response');},false);
 await flush();const row=chat.rows('room',[])[0];assert.equal(row.delivery,'confirming');assert.equal(row.can_retry,false);
 chat.retry(row.retry_id);assert.equal(count,1);
});
test('confirmed response stays visible until history includes it; identical texts stay separate',async()=>{
 const chat=new OutgoingChat(()=>{});
 const send=async(id,text)=>({...message,text,id:`saved-${id}`,command_id:id,sent_at:Date.now()});
 chat.send('room',message,send,true);await flush();chat.send('room',message,send,true);await flush();
 const rows=chat.rows('room',[]);assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);
 assert.equal(chat.rows('room',rows).length,2);
});
