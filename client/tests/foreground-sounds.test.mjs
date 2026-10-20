import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gameSound} from '../src/notifications/gameSound.ts';
import {SoundQueue,soundCues} from '../src/notifications/soundCues.ts';
const base=()=>({match_id:'m',status:'playing',game_type:'callbreak',your_player_id:1,players:[{user_id:'u1',player_id:1},{user_id:'u2',player_id:2}],
  game:{revision:1,finished:false,winners:[],phase:'PLAYING',turn:{player_id:2}},log:[]});
test('hydration, remount, stale updates and unchanged polls are silent',()=>{
 const s=base();assert.equal(gameSound(null,s),null);assert.equal(gameSound(s,s),null);
 assert.equal(gameSound(s,{...s,match_id:'other'}),null);
 assert.equal(gameSound(s,{...s,game:{...s.game,revision:0}}),null);
});
test('turn supersedes another player move and own moves stay silent',()=>{
 const s=base(),next={...s,game:{...s.game,revision:2},log:[{event:'CARD_PLAYED',revision:2,payload:{player_id:2}}]};
 assert.equal(gameSound(s,next),'move');
 assert.equal(gameSound(s,{...next,game:{...next.game,turn:{player_id:1}}}),'turn');
 assert.equal(gameSound(s,{...next,log:[{event:'CARD_PLAYED',revision:2,payload:{player_id:1}}]}),null);
});
test('joins, departures, start, round completion have cues',()=>{
 const s=base();assert.equal(gameSound(s,{...s,players:[...s.players,{user_id:'u3',player_id:3}]}),'joined');
 assert.equal(gameSound(s,{...s,players:s.players.slice(0,1)}),'left');
 assert.equal(gameSound({...s,status:'waiting'},s),'started');
 assert.equal(gameSound(s,{...s,round_review:{deal_number:1}}),'round');
 assert.equal(gameSound(s,{...s,game:{...s.game,finished:true,winners:[1]}}),'round');
 assert.equal(gameSound(s,{...s,game:{...s.game,finished:true,winners:[2]}}),'round');
});
test('Marriage and Flush use attributed public moves, never private cards',()=>{
 const s=base(),next={...s,game:{...s.game,revision:2}};
 assert.equal(gameSound(s,{...next,game_type:'marriage',marriage:{public:{},private:null,moves:[{revision:2,kind:'CARD_DRAWN',player_id:'2'}]}}),'move');
 assert.equal(gameSound(s,{...next,game_type:'flush',flush:{public:{},private:null,history:[{revision:2,kind:'BET_PLACED',player_id:'2'}]}}),'move');
 assert.equal(gameSound(s,{...next,game_type:'flush',flush:{public:{},private:null,history:[{revision:2,kind:'BET_PLACED',player_id:'1'}]}}),null);
});
test('queue coalesces simultaneous cues, deduplicates, and cancels background work',async()=>{
 const q=new SoundQueue(),played=[];
 q.request('move','move',()=>played.push('move'));q.request('turn','turn',()=>played.push('turn'));
 await new Promise(resolve=>setTimeout(resolve,90));assert.deepEqual(played,['turn']);
 q.request('turn','turn',()=>played.push('duplicate'));q.request('move','new-move',()=>played.push('overlap'));
 await new Promise(resolve=>setTimeout(resolve,90));assert.deepEqual(played,['turn']);
 q.cancel();q.request('won','win',()=>played.push('win'));q.cancel();
 await new Promise(resolve=>setTimeout(resolve,90));assert.deepEqual(played,['turn']);
});
test('all cues have distinct patterns and bundled native WAV assets',()=>{
 assert.equal(new Set(Object.values(soundCues).map(c=>JSON.stringify([c.notes,c.duration]))).size,Object.keys(soundCues).length);
 for(const name of Object.keys(soundCues)){
  const wav=fs.readFileSync(new URL(`../assets/sounds/${name}.wav`,import.meta.url));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
  assert.ok(wav.length>1000);
 }
});
test('Marriage skipping declarations stays silent',()=>{
 const s={...base(),game_type:'marriage',marriage:{public:{players:[{player_id:'1',tunnela_declared:false},{player_id:'2',tunnela_declared:false}]},private:null}};
 const next={...s,game:{...s.game,revision:2},marriage:{...s.marriage,public:{players:[s.marriage.public.players[0],{player_id:'2',tunnela_declared:true}]}}};
 assert.equal(gameSound(s,next),null);
 assert.equal(gameSound(s,{...next,marriage:{...s.marriage,public:{players:[{player_id:'1',tunnela_declared:true},s.marriage.public.players[1]]}}}),null);
});
test('Flush round winners receive the shared finish cue',()=>{
 const s=base();assert.equal(gameSound(s,{...s,game_type:'flush',flush:{public:{settlement:{winner_ids:['1']}}}}),'round');
});

const marriageState=()=>({...base(),game_type:'marriage',marriage:{public:{status:'playing',players:[{player_id:'1',initial_tunnelas:[],shown_melds:[],has_seen_maal:false},{player_id:'2',initial_tunnelas:[],shown_melds:[],has_seen_maal:false}]},private:{hand:[],actions:{kinds:[]}}}});
test('accepted public Marriage declarations reach declarer, opponents and spectators, with declaration over turn priority',()=>{
 for(const viewer of [1,2,null]){
  const before={...marriageState(),your_player_id:viewer},next=structuredClone(before);next.game.revision++;next.game.turn.player_id=viewer;
  next.marriage.public.players[0].initial_tunnelas=[{meld_type:'tunnela',card_ids:['a','b','c']}];
  assert.equal(gameSound(before,next),'tunnelaDeclaration');assert.equal(gameSound(next,next),null);
  const qualified=structuredClone(next);qualified.game.revision++;qualified.marriage.public.players[0].has_seen_maal=true;qualified.marriage.public.players[0].shown_melds=[{meld_type:'sequence',card_ids:['d','e','f']}];
  assert.equal(gameSound(next,qualified),'maalDeclaration');assert.equal(gameSound(qualified,qualified),null);
  qualified.marriage.public.status='finished';qualified.game.finished=true;
  assert.equal(gameSound(next,qualified),'round','finish supersedes declaration');
 }
});
test('private detection, selecting and Maal viewing alone do not create sounds',()=>{
 const before=marriageState(),next=structuredClone(before);next.marriage.private={actions:{kinds:[]},hand:['a','a','a'],maal:{tiplu:'secret'}};
 assert.equal(gameSound(before,next),null);assert.equal(gameSound(null,next),null);
});
test('each Call Break review and Flush settlement has one shared finish cue',()=>{
 const s=base(),review={...s,round_review:{deal_number:1}};
 assert.equal(gameSound(s,review),'round');assert.equal(gameSound(review,review),null);
 assert.equal(gameSound(review,{...review,game:{...review.game,finished:true}}),null,'final scores do not replay an already announced round');
 assert.equal(gameSound(review,{...review,round_review:{deal_number:2}}),'round');
 const flush={...s,game_type:'flush',flush:{public:{round_number:1,settlement:null}}};
 const done={...flush,flush:{public:{round_number:1,settlement:{winner_ids:['1']}}}};
 assert.equal(gameSound(flush,done),'round');assert.equal(gameSound(done,done),null);
 assert.equal(gameSound(done,{...done,flush:{public:{round_number:2,settlement:{winner_ids:['2']}}}}),'round');
});
test('later-turn Maal showing and subsequent seen transition both notify every viewer once',()=>{
 for(const viewer of [1,2,null]){
  const before={...marriageState(),your_player_id:viewer};
  const shown=structuredClone(before);shown.game.revision++;
  shown.marriage.public.players[0].shown_melds=[{meld_type:'sequence',card_ids:['a','b','c']}];
  assert.equal(gameSound(before,shown),'maalDeclaration');
  assert.equal(gameSound(shown,shown),null);
  const seen=structuredClone(shown);seen.game.revision++;
  seen.marriage.public.players[0].has_seen_maal=true;
  assert.equal(gameSound(shown,seen),'maalDeclaration');
  assert.equal(gameSound(seen,seen),null);
 }
});
