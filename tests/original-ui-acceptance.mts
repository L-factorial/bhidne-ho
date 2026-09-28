import assert from 'node:assert/strict';
import {OriginalDistributedRuntime} from '../client/src/multiplayer/OriginalDistributedRuntime.ts';
import {createJournalOwner} from '../client/src/multiplayer/JournalOwner.ts';
const base=process.env.ORIGINAL_UI_TEST_URL;
if(!base||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('A disposable localhost gateway is required.');
const runtimes:any[]=[];
async function raw(path:string,session:any,body?:object,signal?:AbortSignal,method?:string){const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal});const text=await r.text();if(!r.ok)throw Error(`${r.status}: ${text}`);return text?JSON.parse(text):undefined;}
async function retry<T>(fn:()=>Promise<T>):Promise<T>{for(let n=0;;n++)try{return await fn();}catch(e){if(n===3||!String(e).match(/confirmation|confirm|reconciliation|already being/))throw e;await new Promise(r=>setTimeout(r,1000));}}
async function player(i:number){const a=await raw('/auth/signup',null,{username:'adapter_'+Date.now()+'_'+i,password:'local-test-password-42',display_name:'Adapter '+i});const memory=new Map<string,string>();const owner=createJournalOwner({read:k=>memory.get(k)??null,write:(k,v)=>{memory.set(k,v);}},a.user_id,()=>{});const rt=new OriginalDistributedRuntime(owner,base+'/distributed',a,{install(){},remove(){},error(){}});rt.connectRequests(raw as any);runtimes.push(rt);return {a,rt,request:(path:string,body?:object,method?:any)=>retry(()=>rt.api!.request<any>(path,a,body,undefined,method))};}
try {
const players=await Promise.all([0,1,2,3].map(player)),[host,guest]=players;
await host.request('/friends/requests/'+guest.a.user_id,{});await guest.request('/friends/requests/'+host.a.user_id+'/accept',{});
assert.equal((await host.request('/friends')).friends.length,1);
const sent=await host.request('/friends/'+guest.a.user_id+'/messages',{text:'Original direct chat'});assert.equal(sent.text,'Original direct chat');assert.equal((await guest.request('/friends/'+host.a.user_id+'/messages')).at(-1).text,sent.text);
await host.request('/notifications/read',{});console.log('PASS friendship, direct chat, notification read');
for(const kind of ['marriage','flush','callbreak']){
 const room=await retry(()=>host.rt.roomActions.create(host.a,{name:'Adapter '+kind,visibility:'private',invitees:players.slice(1).map(p=>p.a.user_id)}));host.rt.acknowledgeRoomAction(host.rt.roomCommandId!);
 for(const p of players.slice(1)){await retry(()=>p.rt.roomActions.enter(p.a,room.room_id));p.rt.acknowledgeRoomAction(p.rt.roomCommandId!);}
 let v=await host.request('/test-games/'+room.room_id,{game_type:kind,player_count:kind==='callbreak'?4:kind==='flush'?10:2,name:'Original '+kind});
 const participants=kind==='callbreak'?players:players.slice(0,2);
 for(const p of participants.slice(1))await p.request('/test-games/'+room.room_id+'/join',{match_id:v.match_id});
 const msg=await host.request('/rooms/'+room.room_id+'/chat',{text:'Original room chat'});assert.equal(msg.text,'Original room chat');
 const target={kind:'table_chat',room_id:room.room_id,table_id:v.table_id};const chat=await retry(()=>host.rt.api!.sendMessage(target,'Original table chat',new AbortController().signal));assert.equal(chat.text,'Original table chat');
 if(kind!=='callbreak')v=await host.request('/test-games/'+room.room_id+'/table/lock',{match_id:v.match_id});
 v=await host.request('/test-games/'+room.room_id+'/start',{match_id:v.match_id,play_mode:'manual',...(kind==='flush'?{rules_revision:v.flush_settings.rules_revision}:{})});
 assert.equal(v.table.phase,'STARTED');assert.ok(v.game);for(const p of participants)assert.equal((await p.request('/test-games/'+room.room_id+'?match_id='+v.match_id)).game.revision,v.game.revision);
 console.log('PASS',kind,'create, seat, chat, lock/start, private game reads');
 await host.request('/test-games/'+room.room_id+'/end',{match_id:v.match_id});
 const ledger=await host.request('/rooms/'+room.room_id+'/ledger');assert.ok(ledger);
 for(const p of participants.slice(1)){await retry(()=>p.rt.roomActions.leave(p.a,room.room_id));p.rt.acknowledgeRoomAction(p.rt.roomCommandId!);}
 console.log('PASS',kind,'end, ledger, departure');
}
}finally{for(const rt of runtimes)rt.close();}
