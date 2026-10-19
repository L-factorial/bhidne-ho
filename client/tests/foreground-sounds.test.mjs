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
test('joins, departures, start, round and personal win have distinct cues',()=>{
 const s=base();assert.equal(gameSound(s,{...s,players:[...s.players,{user_id:'u3',player_id:3}]}),'joined');
 assert.equal(gameSound(s,{...s,players:s.players.slice(0,1)}),'left');
 assert.equal(gameSound({...s,status:'waiting'},s),'started');
 assert.equal(gameSound(s,{...s,round_review:{deal_number:1}}),'round');
 assert.equal(gameSound(s,{...s,game:{...s.game,finished:true,winners:[1]}}),'won');
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
test('all nine cues have distinct patterns and bundled native WAV assets',()=>{
 assert.equal(new Set(Object.values(soundCues).map(c=>JSON.stringify([c.notes,c.duration]))).size,9);
 for(const name of Object.keys(soundCues)){
  const wav=fs.readFileSync(new URL(`../assets/sounds/${name}.wav`,import.meta.url));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
  assert.ok(wav.length>1000);
 }
});
test('Marriage public declarations sound for other players, not your own',()=>{
 const s={...base(),game_type:'marriage',marriage:{public:{players:[{player_id:'1',tunnela_declared:false},{player_id:'2',tunnela_declared:false}]},private:null}};
 const next={...s,game:{...s.game,revision:2},marriage:{...s.marriage,public:{players:[s.marriage.public.players[0],{player_id:'2',tunnela_declared:true}]}}};
 assert.equal(gameSound(s,next),'move');
 assert.equal(gameSound(s,{...next,marriage:{...s.marriage,public:{players:[{player_id:'1',tunnela_declared:true},s.marriage.public.players[1]]}}}),null);
});
test('Flush round winners receive the shared personal win cue',()=>{
 const s=base();assert.equal(gameSound(s,{...s,game_type:'flush',flush:{public:{settlement:{winner_ids:['1']}}}}),'won');
});
