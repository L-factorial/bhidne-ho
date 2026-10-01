/** Node 22.18+; no additional npm packages. See README.md. */
import {parseArgs} from 'node:util';
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {setMaxListeners} from 'node:events';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {OriginalDistributedRuntime} from '../../client/src/multiplayer/OriginalDistributedRuntime.ts';
import {DistributedGameCommandClient,GameConfirmationPending} from '../../client/src/multiplayer/DistributedGameCommandClient.ts';
import {TableSocialChannel} from '../../client/src/multiplayer/TableSocialChannel.ts';
import {createJournalOwner} from '../../client/src/multiplayer/JournalOwner.ts';
import {accounts,random,shuffle,choice,move,finished,thinkDelay,validateGame,validateLedger} from './model.mts';
const {values:o}=parseArgs({options:{mode:{type:'string',default:'run'},url:{type:'string'},accounts:{type:'string',default:'.loadtest/accounts.jsonl'},count:{type:'string',default:'20000'},users:{type:'string',default:'1000'},seconds:{type:'string',default:'3600'},ramp:{type:'string',default:'300'},drain:{type:'string',default:'180'},seed:{type:'string',default:'42'},late:{type:'string',default:'0.005'},games:{type:'string',default:'callbreak,flush,marriage'},output:{type:'string',default:'.loadtest/results'},'max-games':{type:'string',default:'0'}}});
const number=(key:keyof typeof o,min:number,max:number,integer=true)=>{const n=Number(o[key]);assert(Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n)),`Invalid --${key}`);return n;};
const count=number('count',4,1000000),users=number('users',4,20000),seconds=number('seconds',1,86400),ramp=number('ramp',0,86400),drain=number('drain',1,3600),seed=number('seed',0,4294967295),late=number('late',0,.1,false),maxGames=number('max-games',0,10000000);
assert(users%4===0,'--users must be a multiple of four');
const kinds=o.games!.split(',');assert(kinds.length&&kinds.every(k=>['callbreak','flush','marriage'].includes(k)),'Invalid --games');
const file=resolve(o.accounts!);
if(o.mode==='generate') {
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const prefix=`load_${Date.now().toString(36)}`;
  writeFileSync(file,Array.from({length:count},(_,i)=>JSON.stringify({username:`${prefix}_${i}`,password:randomBytes(24).toString('base64url')})).join('\n')+'\n',{flag:'wx',mode:0o600});
  console.log(`Generated ${count} accounts in ${file}; no server requests made.`);process.exit(0);
}
assert(['run','provision'].includes(o.mode!),'Invalid --mode');assert(o.url,'--url is required');
const target=new URL(o.url!);assert(['http:','https:'].includes(target.protocol)&&!target.username&&!target.password&&!target.search&&!target.hash,'Invalid target URL');
const base=o.url!.replace(/\/$/,'');const pool=shuffle(accounts(readFileSync(file,'utf8')),random(seed));
assert(users<=pool.length,'Not enough accounts for --users');
const accountCount=pool.length;
const out=resolve(o.output!);mkdirSync(out,{recursive:true,mode:0o700});
const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex');const report=resolve(out,runId+'.json');const events=resolve(out,runId+'.jsonl');
writeFileSync(events,'',{flag:'wx',mode:0o600});
const counters:Record<string,number>={};const timing:Record<string,{count:number;sum:number;max:number;buckets:number[]}>={};
function inc(name:string){counters[name]=(counters[name]??0)+1;}
const limits=[50,100,250,500,1000,2000,5000,10000,30000,60000,Infinity];
function latency(name:string,ms:number){const s=timing[name]??={count:0,sum:0,max:0,buckets:limits.map(()=>0)};s.count++;s.sum+=ms;s.max=Math.max(s.max,ms);s.buckets[limits.findIndex(n=>ms<=n)]++;}
function event(value:object){appendFileSync(events,JSON.stringify({at:new Date().toISOString(),...value})+'\n');}
const active=new Set<any>(),used=new Set<string>();let stopping=false;const hard=new AbortController();setMaxListeners(0,hard.signal);
const sleep=(ms:number)=>new Promise<void>(r=>{const done=()=>{clearTimeout(t);hard.signal.removeEventListener('abort',done);r();};const t=setTimeout(done,ms);hard.signal.addEventListener('abort',done,{once:true});if(hard.signal.aborted)done();});
let interruptTimer:any;
function interrupt(){stopping=true;if(!interruptTimer)interruptTimer=setTimeout(()=>{hard.abort();for(const p of [...active])close(p);},drain*1000);}
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
async function fetcher(input:any,init:any={}) {
  const began=performance.now();let code='network';
  try {const response=await fetch(input,{...init,signal:AbortSignal.any([hard.signal,AbortSignal.timeout(30000),...(init.signal?[init.signal]:[])])});code=String(response.status);return response;}
  finally{inc(`http.${code}`);latency('http_headers',performance.now()-began);}
}
async function raw(path:string,session:any,body?:object,signal?:AbortSignal,method?:string) {
  const r=await fetcher(base+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal});
  // Never emit response bodies, passwords, tokens or private hands to logs.
  if(!r.ok)throw Object.assign(Error(`HTTP ${r.status}`),{status:r.status});return r.status===204?undefined:r.json();
}
async function provision() {
  let index=0;
  const results=await Promise.allSettled(Array.from({length:8},async()=>{
    while(index<pool.length&&!stopping){
      const account=pool[index++];
      try {
        try {await raw('/auth/signin',null,account);inc('accounts.existing');}
        catch(error){if((error as any).status!==401)throw error;await raw('/auth/signup',null,{...account,email:account.email??`${account.username}@loadtest.example.test`,display_name:account.username});inc('accounts.created');}
        if(index%100===0)console.log(JSON.stringify({processed:index,...counters}));
      } catch(error){stopping=true;throw error;}
    }
  }));
  const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
  if(index<pool.length)throw Error('Provisioning interrupted');
}
async function player(account:any) {
  const a=await raw('/auth/signin',null,account);used.add(account.username);
  // Dedicated synthetic accounts follow the same posting prerequisite as the UI.
  const rules=await raw('/me/community-rules',a,undefined,hard.signal);
  if(!rules.accepted)await raw('/me/community-rules',a,{version:rules.version,accepted:true},hard.signal);
  assert.equal((await raw('/me/community-rules',a,undefined,hard.signal)).accepted,true,'Community rules acceptance was not saved');
  const memory=new Map<string,string>();const owner=createJournalOwner({read:k=>memory.get(k)??null,write:(k,v)=>{memory.set(k,v);}},a.user_id,()=>{});
  const rt=new OriginalDistributedRuntime(owner,base+'/distributed',a,{install(){},remove(){},error(_lane,_error,source){inc(`background.${source??'delivery'}.error`);}},{fetcher:fetcher as any});
  rt.connectRequests(raw as any);
  const p:any={a,rt,owner,memory,view:null,readAt:0,gameClient:null};active.add(p);
  rt.root.observeSnapshot((v:any)=>{if(v.snapshot){p.view=v.snapshot;p.readAt=Date.now();inc('snapshots.delivered');p.gameClient?.observe(v.snapshot);}});
  p.request=async(path:string,body?:object,method?:any)=>{const start=performance.now();const label=path.split('?')[0].split('/').map(part=>/^(user-)?[a-f0-9-]{32,36}$/.test(part)?':id':part).join('/');try{const value=await rt.api!.request(path,a,body,hard.signal,method);inc(body||method?'ui.write.ok':'ui.read.ok');inc(`route.${method??(body?'POST':'GET')}.${label}`);return value;}catch(error){(error as any).action=path;throw error;}finally{latency('ui_action',performance.now()-start);}};
  return p;
}
async function roomAction(p:any,method:string,...args:any[]) {const result=await (p.rt.roomActions as any)[method](p.a,...args);p.rt.acknowledgeRoomAction(p.rt.roomCommandId);inc(`room.${method}`);return result;}
function close(p:any){p.rt.close();p.owner.close();active.delete(p);}
async function scenario(group:any[],rng:()=>number,worker:number) {
  const ps:any[]=[];let room:any,v:any,stage='login';let succeeded=false;
  try {
    // Sequential acquisition ensures partial login failures still close every runtime.
    for(const account of group)ps.push(await player(account));
    const [host,...guests]=ps;const kind=choice(kinds,rng);event({type:'scenario',worker,kind});
    stage='friendship';
    for(const guest of guests){await host.request('/friends/requests/'+guest.a.user_id,{});await guest.request('/friends/requests/'+host.a.user_id+'/accept',{});}
    await host.request('/friends/'+guests[0].a.user_id+'/messages',{text:'Load test message'});await guests[0].request('/notifications/read',{});
    stage='room';const visibility=rng()<.5?'public':'private';
    room=await roomAction(host,'create',{name:`Load ${runId.slice(11,19)} ${worker}`,visibility,invitees:guests.map(p=>p.a.user_id)});
    event({type:'resource',worker,room_id:room.room_id});
    for(const guest of shuffle([...guests],rng)) {
      if(rng()<.5){const invitations=await guest.request('/room-invitations');const invitation=invitations.find((i:any)=>i.room_id===room.room_id);assert(invitation,'Missing room invitation');await guest.request(`/room-invitations/${invitation.id}/accept`,{});}
      await roomAction(guest,'enter',room.room_id);
    }
    await host.request('/rooms');await host.request('/memberships');
    if(rng()<.2){await roomAction(guests[0],'leave',room.room_id);if(visibility==='private')await host.request(`/rooms/${room.room_id}/invitations`,{invitees:[guests[0].a.user_id]});await roomAction(guests[0],'enter',room.room_id);inc('room.rejoin');}
    if(rng()<.2){await host.request(`/rooms/${room.room_id}`,{visibility:visibility==='public'?'private':'public'},'PATCH');inc('room.visibility');}
    stage='table';
    const invite=rng()<.5;
    v=await host.request('/test-games/'+room.room_id,{game_type:kind,player_count:4,name:'Load table',invitees:invite?guests.map(p=>p.a.user_id):[]});
    event({type:'resource',worker,room_id:room.room_id,table_id:v.table_id,match_id:v.match_id});
    for(const guest of shuffle([...guests],rng)) {
      if(invite){const invitations=await guest.request('/test-games/invitations');const invitation=invitations.find((i:any)=>i.table_id===v.table_id);assert(invitation,'Missing table invitation');const answer=rng()<.15?'decline':'accept';await guest.request(`/test-games/invitations/${invitation.id}/${answer}`,{});inc(`table.invitation.${answer}`);}
      await guest.request('/test-games/'+room.room_id+'/join',{match_id:v.match_id});
    }
    if(rng()<.25){const guest=choice(guests,rng);await guest.request(`/test-games/${room.room_id}/leave`,{match_id:v.match_id});await guest.request(`/test-games/${room.room_id}/join`,{match_id:v.match_id});inc('table.rejoin');}
    await host.request(`/rooms/${room.room_id}/chat`,{text:'Load test room chat'});
    await host.rt.api.sendMessage({kind:'table_chat',room_id:room.room_id,table_id:v.table_id},'Load test table chat',hard.signal);inc('chat.table');
    if(kind!=='callbreak')v=await host.request(`/test-games/${room.room_id}/table/lock`,{match_id:v.match_id});
    v=await host.request(`/test-games/${room.room_id}/start`,{match_id:v.match_id,play_mode:'manual',...(kind==='flush'?{rules_revision:v.flush_settings.rules_revision}:{})});
    if(rng()<.5){const channel=new TableSocialChannel();host.rt.api.attachSocial(channel);host.rt.api.selectedRoom=room.room_id;await channel.request('TABLE_POKE_SEND',v.match_id,{reaction:'clap',recipient_player_id:v.players.find((p:any)=>p.user_id===guests[0].a.user_id).player_id},hard.signal);inc('table.reaction');}
    const read=(p:any)=>p.request(`/test-games/${room.room_id}?match_id=${v.match_id}`);
    stage='play';
    for(const p of ps){p.view=await read(p);p.readAt=Date.now();p.gameClient=new DistributedGameCommandClient<any>(p.rt.root.session.command('load-game'),()=>read(p),view=>({...view,room_id:room.room_id}));await p.rt.root.select({room:room.room_id,table:v.table_id,chat:['room_chat','table_chat']});}
    let steps=0,lastProgress=Date.now(),revision=v.game.revision,previousCommit=performance.now();
    while(!hard.signal.aborted) {
      const newest=ps.reduce((a,p)=>p.view.game.revision>a.game.revision?p.view:a,ps[0].view);
      if(finished(newest))break;
      assert(Date.now()-lastProgress<60000,'Game stalled for 60 seconds');assert(steps<2000,'Game action bound exceeded');
      if(newest.game.revision>revision){revision=newest.game.revision;lastProgress=Date.now();}
      let selected:any;
      for(const p of shuffle([...ps],rng)){if(p.view.game.revision<revision)continue;const action=move(p.view,rng,steps);if(action){selected={p,action};break;}}
      if(!selected){await sleep(25);for(const p of ps)if(Date.now()-p.readAt>2000){p.view=await read(p);p.readAt=Date.now();inc('snapshots.fallback');}continue;}
      const {p,action}=selected;const {delayed,ms:delay}=thinkDelay(rng,late);inc(delayed?'moves.deliberately_late':'moves.fast');
      const decision=performance.now();await sleep(delay);if(hard.signal.aborted)break;
      const nextMs=performance.now()-previousCommit;latency(delayed?'late_next_command_ms':'fast_next_command_ms',nextMs);if(!delayed&&nextMs>1000)inc('moves.fast_over_1s');
      assert(p.gameClient.submit(p.view,action.command,action.payload),'Command slot busy');latency(delayed?'late_dispatch_ms':'fast_dispatch_ms',performance.now()-decision);
      const start=performance.now();let result:any;
      for(;;){try{result=await p.gameClient.refresh(hard.signal);break;}catch(e){if(!(e instanceof GameConfirmationPending)||performance.now()-start>30000)throw e;await sleep(100);}}
      assert.equal(result.error,'',`Gameplay ${action.command} rejected: ${result.error}`);assert(result.snapshot.game.revision>p.view.game.revision||result.snapshot.game.revision>revision,'Revision did not advance');
      p.view=result.snapshot;p.readAt=Date.now();revision=result.snapshot.game.revision;lastProgress=Date.now();previousCommit=performance.now();steps++;inc(`game.${kind}.${action.command}`);latency('move_confirm_ms',performance.now()-start);
    }
    assert(!hard.signal.aborted,'Drain deadline reached');
    stage='validation';const views=[];for(const p of ps)views.push(await read(p));v=views[0];validateGame(views);
    const deadline=Date.now()+30000;
    while(!validateLedger(v,await host.request(`/rooms/${room.room_id}/ledger`))){assert(Date.now()<deadline,'Finalized ledger missing');await sleep(250);}
    inc(`games.${kind}.validated`);event({type:'validated',worker,kind,match_id:v.match_id,steps});
    stage='cleanup';
    for(const p of ps)await p.rt.root.select(null);
    if(kind!=='flush'){v=await host.request(`/test-games/${room.room_id}/next-match`,{match_id:v.match_id});inc('table.rematch');event({type:'cleanup-rematch',worker,room_id:room.room_id,table_id:v.table_id,match_id:v.match_id});}
    await host.request(`/test-games/${room.room_id}/end`,{match_id:v.match_id});
    for(const p of guests)await roomAction(p,'leave',room.room_id);
    await roomAction(host,'remove',room.room_id);
    for(const p of guests)await host.request('/friends/'+p.a.user_id,undefined,'DELETE');
    succeeded=true;inc('scenarios.completed');
  } catch(error) {
    inc('scenarios.failed');event({type:'failure',worker,stage,action:(error as any)?.action,reason:(error as any)?.constructor?.name.match(/^(GameRequestError|RoomActionRejected)$/)?(error as any).message:undefined,room_id:room?.room_id,match_id:v?.match_id,error_type:(error as any)?.constructor?.name,http_status:(error as any)?.status,assertion:(error as any)?.code==='ERR_ASSERTION'?(error as any).message.split('\n')[0]:undefined});
    for(const p of ps)writeFileSync(resolve(out,`${runId}-${worker}-${p.a.user_id}.journal.json`),JSON.stringify(Object.fromEntries(p.memory)),{mode:0o600});
    // Keep ambiguous commands/resources for inspection, never replace command IDs
    // or recycle these users into a competing scenario.
  } finally {for(const p of ps)close(p);}
  return succeeded;
}
const began=Date.now();let completed=0,started=0;
const percentiles=()=>Object.fromEntries(Object.entries(timing).map(([name,s])=>[name,Object.fromEntries([50,95,99].map(q=>{let seen=0;const bucket=s.buckets.findIndex(n=>{seen+=n;return seen>=s.count*q/100;});return [`p${q}_upper_ms`,Number.isFinite(limits[bucket])?limits[bucket]:'>60000'];}))]));
const snapshot=()=>({run_id:runId,target:base,mode:o.mode,seed,duration_seconds:seconds,ramp_seconds:ramp,drain_seconds:drain,late_probability:late,game_types:kinds,elapsed_seconds:(Date.now()-began)/1000,account_pool:accountCount,unique_accounts:used.size,configured_concurrency:users,active_users:active.size,counters,timing,percentiles:percentiles(),bucket_upper_ms:limits.map(n=>Number.isFinite(n)?n:'infinity')});
const progress=setInterval(()=>{writeFileSync(report,JSON.stringify(snapshot(),null,2),{mode:0o600});console.log(JSON.stringify({seconds:Math.round((Date.now()-began)/1000),active:active.size,unique:used.size,completed,failures:counters['scenarios.failed']??0}));},10000);
let hardTimer:any;
try {
  if(o.mode==='provision')await provision();
  else {
    const deadline=began+seconds*1000;hardTimer=setTimeout(()=>{stopping=true;hard.abort();for(const p of [...active])close(p);},(seconds+drain)*1000);
    await Promise.all(Array.from({length:users/4},async(_,worker)=>{
      const rng=random(seed+worker+1);await sleep(ramp*1000*worker/(users/4));
      while(!stopping&&Date.now()<deadline&&(!maxGames||started<maxGames)) {
        if(pool.length<4){await sleep(100);continue;}
        const group=pool.splice(0,4);started++;
        if(await scenario(group,rng,worker)){completed++;pool.push(...shuffle(group,rng));}
        else if(pool.length<4&&active.size===0)break;
      }
    }));
    if(!completed)inc('run.no_completed_games');
  }
} catch(error){inc('run.fatal');event({type:'fatal',error_type:(error as any)?.constructor?.name,http_status:(error as any)?.status});}
finally{clearInterval(progress);clearTimeout(hardTimer);clearTimeout(interruptTimer);for(const p of [...active])close(p);writeFileSync(report,JSON.stringify(snapshot(),null,2),{mode:0o600});console.log(`Report: ${report}`);}
process.exitCode=counters['scenarios.failed']||counters['run.fatal']||counters['run.no_completed_games']?1:0;
