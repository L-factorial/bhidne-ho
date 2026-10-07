import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gameAttention} from '../src/notifications/gameAttention.ts';
const base={match_id:'m',status:'playing',your_player_id:1,game:{phase:'BIDDING',turn:{player_id:1},revision:1}};
test('turns are immediate and keep their animation identity through polls',()=>{
  const cue=gameAttention(base);
  assert.equal(cue.detail,'common.attention_bid'); assert.equal(cue.required,true);
  assert.equal(cue.key,gameAttention({...base,remaining_ms:10,game:{...base.game,revision:2}}).key);
  assert.equal(gameAttention({...base,your_player_id:null}),null);
  assert.equal(gameAttention({...base,status:'ended'}),null);
  assert.equal(gameAttention({...base,game:{...base.game,phase:'PLAYING'}}).detail,'common.attention_play');
});
const card=(rank,copy=0)=>({card_id:`${copy}:${rank}`,card_type:'standard',rank,suit:'S'});
const marriage=(hand,kinds=[],extra={})=>({...base,game_type:'marriage',game:null,marriage:{public:{current_player_id:'2',players:[{player_id:'1',route:'unqualified',shown_melds:[],has_seen_maal:false}],...extra},private:{player_id:'1',hand,actions:{kinds},maal:null}}});
test('declaration is required even out of turn; declaration gate suppresses suggestions',()=>{
  const s=marriage([],['declare_tunnelas'],{tunnela_declaration_pending:true});
  assert.equal(gameAttention(s).detail,'common.attention_declare_detail');
  s.marriage.private.actions.kinds=[]; assert.equal(gameAttention(s),null);
});
test('private hand opportunities remain optional and give priority to required moves',()=>{
  const s=marriage(Array.from({length:7},(_,i)=>[card(i+1),card(i+1,1)]).flat());
  assert.equal(gameAttention(s).title,'common.attention_dublee'); assert.equal(gameAttention(s).required,false);
  s.marriage.public.current_player_id='1';s.marriage.private.actions.kinds=['draw'];
  assert.equal(gameAttention(s).detail,'common.attention_draw');
  assert.ok(gameAttention(s).opportunities.includes('common.attention_maal'));
  s.marriage.private=null; assert.equal(gameAttention(s),null);
});
test('shown cards are excluded; folded players receive no hand suggestions',()=>{
  const s=marriage([1,2,3,4,5,6,7,8,9].map(x=>card(x)));
  assert.equal(gameAttention(s).title,'common.attention_maal');
  s.marriage.public.players[0].shown_melds=[{card_ids:['0:1','0:2','0:3']}];assert.equal(gameAttention(s),null);
  s.marriage.public.players[0].folded=true; assert.equal(gameAttention(s),null);
});
test('Marriage detection requires the authorized maal identities',()=>{
  const s=marriage([card(4),card(5),card(6)]);
  assert.equal(gameAttention(s),null);
  s.marriage.private.maal={tiplu:{rank:5,suit:'S'},jhiplu:{rank:4,suit:'S'},poplu:{rank:6,suit:'S'}};
  assert.equal(gameAttention(s).title,'common.attention_marriage');
});
test('Flush side show requires the target and an authorized response',()=>{
  const s={...base,game_type:'flush',flush:{public:{current_player_id:'2',pending_side_show:{target_id:'1'}},private:{actions:{kinds:['accept_side_show']}}}};
  assert.equal(gameAttention(s).detail,'common.attention_side_show');
  s.flush.private.actions.kinds=[]; assert.equal(gameAttention(s),null);
});

test('round settlement takes precedence over stale turn fields',()=>{
  const s={...base,game_type:'flush',flush:{public:{round_number:2,settlement:{winner_ids:['1']},current_player_id:'1'},private:{actions:{kinds:['bet']}}}};
  assert.equal(gameAttention(s).title,'common.attention_round');
  assert.equal(gameAttention(s).required,false);
  assert.notEqual(gameAttention(s).key,gameAttention({...s,flush:{...s.flush,public:{...s.flush.public,round_number:3}}}).key);
});

test('local eligibility results drive header cues without heuristic false positives',()=>{
  const s=marriage([card(4),card(5),card(6)]);
  const none={marriage:false,maal:false,tunnela:false};
  assert.equal(gameAttention(s,{...none,marriage:true}).title,'common.attention_marriage');
  assert.equal(gameAttention(s,{...none,maal:true}).title,'common.attention_maal');
  s.marriage.private.maal={tiplu:{rank:5,suit:'S'},jhiplu:{rank:4,suit:'S'},poplu:{rank:6,suit:'S'}};
  assert.equal(gameAttention(s,none),null,'the existing eligibility solver takes precedence over face heuristics');
});

test('local tunnela detection accompanies declaration and required turns retain priority',()=>{
  const local={marriage:false,maal:false,tunnela:true};
  const s=marriage([],['declare_tunnelas'],{tunnela_declaration_pending:true});
  const declaration=gameAttention(s,local);
  assert.equal(declaration.required,true);
  assert.ok(declaration.opportunities.includes('common.attention_tunnela'));
  s.marriage.public.tunnela_declaration_pending=false;
  s.marriage.private.actions.kinds=['draw'];
  s.marriage.public.current_player_id='1';
  const turn=gameAttention(s,{marriage:true,maal:true,tunnela:false});
  assert.equal(turn.detail,'common.attention_draw');
  assert.deepEqual(turn.opportunities,['common.attention_marriage','common.attention_maal']);
});

test('local detection cannot expose cues for spectators, folded players or ended tables',()=>{
  const local={marriage:true,maal:true,tunnela:true};
  const s=marriage([]);
  s.marriage.public.players[0].folded=true;
  assert.equal(gameAttention(s,local),null);
  s.marriage.public.players[0].folded=false;
  assert.equal(gameAttention({...s,status:'ended'},local),null);
  assert.equal(gameAttention({...s,marriage:{...s.marriage,private:null}},local),null);
});
