import assert from 'node:assert/strict';
import {DistributedGameCommandClient} from '../client/src/multiplayer/DistributedGameCommandClient.ts';
import {TableSocialChannel} from '../client/src/multiplayer/TableSocialChannel.ts';
import {OriginalDistributedRuntime} from '../client/src/multiplayer/OriginalDistributedRuntime.ts';
import {createJournalOwner} from '../client/src/multiplayer/JournalOwner.ts';
const base=process.env.ORIGINAL_UI_TEST_URL;
if(!base||!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('A disposable localhost gateway is required.');
const runtimes:any[]=[];
async function raw(path:string,session:any,body?:object,signal?:AbortSignal,method?:string){const r=await fetch(base+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal});const text=await r.text();if(!r.ok)throw Error(`${r.status}: ${text}`);return text?JSON.parse(text):undefined;}
async function retry<T>(fn:()=>Promise<T>):Promise<T>{for(let n=0;;n++)try{return await fn();}catch(e){if(n===3||!String(e).match(/confirmation|confirm|reconciliation|already being/))throw e;await new Promise(r=>setTimeout(r,1000));}}
async function player(i:number){
 const a=await raw('/auth/signup',null,{username:'adapter_'+Date.now()+'_'+i,password:'local-test-password-42',email:`adapter-${i}@example.test`,display_name:'Adapter '+i});
 // Test accounts follow the same explicit consent flow as the Profile UI.
 const rules=await raw('/me/community-rules',a);
 assert.equal(rules.accepted,false);
 await raw('/me/community-rules',a,{version:rules.version,accepted:true});
 assert.equal((await raw('/me/community-rules',a)).accepted,true);
 const memory=new Map<string,string>();
 const owner=createJournalOwner({read:k=>memory.get(k)??null,write:(k,v)=>{memory.set(k,v);}},a.user_id,()=>{});
 const rt=new OriginalDistributedRuntime(owner,base+'/distributed',a,{install(){},remove(){},error(){}});
 rt.connectRequests(raw as any);runtimes.push(rt);
 return {a,rt,request:(path:string,body?:object,method?:any)=>retry(()=>rt.api!.request<any>(path,a,body,undefined,method))};
}
try {
const players=await Promise.all([0,1,2,3].map(player)),[host,guest]=players;
await host.request('/friends/requests/'+guest.a.user_id,{});await guest.request('/friends/requests/'+host.a.user_id+'/accept',{});
assert.equal((await host.request('/friends')).friends.length,1);
const sent=await host.request('/friends/'+guest.a.user_id+'/messages',{text:'Original direct chat'});assert.equal(sent.text,'Original direct chat');assert.equal((await guest.request('/friends/'+host.a.user_id+'/messages')).at(-1).text,sent.text);
await host.request('/notifications/read',{});console.log('PASS friendship, direct chat, notification read');
// A lobby-only user must hear public creation/deletion without subscribing to
// the room, and an invited user must hear private changes on their own lane.
let lobbySignals=0;const stopLobby=guest.rt.root.observeActivity(()=>lobbySignals++);
await guest.rt.root.reconnect();await new Promise(r=>setTimeout(r,1000));
const waitSignal=async(previous:number)=>{const end=Date.now()+5000;while(lobbySignals<=previous){assert.ok(Date.now()<end,'Lobby signal missing');await new Promise(r=>setTimeout(r,20));}};
let before=lobbySignals;
const publicRoom=await host.rt.roomActions.create(host.a,{name:'Public signal',visibility:'public',invitees:[]});host.rt.acknowledgeRoomAction(host.rt.roomCommandId!);
await waitSignal(before);before=lobbySignals;
await host.rt.roomActions.remove(host.a,publicRoom.room_id);host.rt.acknowledgeRoomAction(host.rt.roomCommandId!);await waitSignal(before);
stopLobby();
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
 if(kind==='flush') {
   const delivered=new Map<string,any>();
   const stop=participants.map(p=>p.rt.root.observeSnapshot((view:any)=>{if(view.snapshot)delivered.set(p.a.user_id,view.snapshot);}));
   await Promise.all(participants.map(p=>p.rt.root.select({room:room.room_id,table:v.table_id,chat:['room_chat','table_chat']})));
   const until=async(check:()=>boolean)=>{const limit=Date.now()+5000;while(!check()){assert.ok(Date.now()<limit,'WebSocket update timed out');await new Promise(r=>setTimeout(r,20));}};
   await until(()=>delivered.size===participants.length);
   for(const [action,payload] of [['DEAL_CARDS',{}],['CUT_DECK',{position:26}]] as const) {
     let acted=false;
     for(const p of participants) {
       const snapshot=await p.request('/test-games/'+room.room_id+'?match_id='+v.match_id);
       if(!snapshot.flush.private.actions.kinds.includes(action.toLowerCase()))continue;
       const client=new DistributedGameCommandClient<any>(p.rt.root.session.command('original-game-actions'),
         signal=>p.rt.api!.request('/test-games/'+room.room_id+'?match_id='+v.match_id,p.a,undefined,signal),
         view=>({...view,room_id:room.room_id}));
       const started=Date.now();
       assert.equal(client.submit(snapshot,action,payload),true);
       const result=await client.refresh(new AbortController().signal);
       assert.equal(result.error,'');assert.ok(result.snapshot.game.revision>snapshot.game.revision);
       await until(()=>participants.every(other=>delivered.get(other.a.user_id)?.game?.revision>=result.snapshot.game.revision));
       assert.ok(Date.now()-started<2500,'Move delivery took too long');
       console.log('TIMING',action,Date.now()-started,'ms for both players');
       acted=true;break;
     }
     assert.ok(acted,'Expected an eligible Flush player for '+action);
   }
   stop.forEach(dispose=>dispose());
   await Promise.all(participants.map(p=>p.rt.root.select(null)));
 }
 const channel=new TableSocialChannel();host.rt.api!.attachSocial(channel);host.rt.api!.selectedRoom=room.room_id;
 const reaction=await channel.request('TABLE_POKE_SEND',v.match_id,{reaction:'clap',recipient_player_id:v.players.find((p:any)=>p.user_id===guest.a.user_id).player_id},new AbortController().signal);
 assert.equal(reaction.status,'accepted');
 console.log('PASS',kind,'create, seat, chat, lock/start, private game reads, active reaction');
 await host.request('/test-games/'+room.room_id+'/end',{match_id:v.match_id});
 const ledger=await host.request('/rooms/'+room.room_id+'/ledger');assert.ok(ledger);
 for(const p of participants.slice(1)){await retry(()=>p.rt.roomActions.leave(p.a,room.room_id));p.rt.acknowledgeRoomAction(p.rt.roomCommandId!);}
 console.log('PASS',kind,'end, ledger, departure');
}
}finally{for(const rt of runtimes)rt.close();}
