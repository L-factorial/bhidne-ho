import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accounts,random,shuffle,move,thinkDelay,validateGame,validateLedger} from './model.mts';
test('account pool rejects duplicates and real-user names',()=>{
 const rows=Array.from({length:4},(_,i)=>({username:`load_${i}`,password:'test-password-42'}));
 assert.throws(()=>accounts('{\"password\":\"secret'),/^Error: Invalid account JSON on line 1$/);
 assert.equal(accounts(rows.map(r=>JSON.stringify(r)).join('\n')).length,4);
 assert.throws(()=>accounts([...rows,rows[0]].map(r=>JSON.stringify(r)).join('\n')));
 rows[0].username='real_person';assert.throws(()=>accounts(rows.map(r=>JSON.stringify(r)).join('\n')));
});
test('seeded shuffle is repeatable without losing accounts',()=>{
 const source=Array.from({length:100},(_,i)=>i);const a=shuffle([...source],random(42));
 assert.deepEqual(a,shuffle([...source],random(42)));assert.notDeepEqual(a,source);assert.equal(new Set(a).size,100);
});
test('Call Break chooses only legal cards for the pending player',()=>{
 const view={game_type:'callbreak',your_player_id:2,game:{turn:{action:'PLAY_CARD',pending_players:[2]}},private:{legal_cards:['AS','2H']}};
 const rng=random(9);const seen=new Set();for(let i=0;i<100;i++){const action=move(view,rng,3)!;assert.equal(action.command,'PLAY_CARD');seen.add(action.payload.card);}assert.deepEqual(seen,new Set(['AS','2H']));
 assert.equal(move({...view,your_player_id:1},rng,3),null);
});
test('Call Break advances dealer selection using only available positions',()=>{
 const view={game_type:'callbreak',your_player_id:2,game:{turn:{action:'PICK_DEALER_CARD',pending_players:[2]},dealer_selection:{available_positions:[4,7,12]}}};
 const rng=random(9),seen=new Set();
 for(let i=0;i<100;i++){
  const action=move(view,rng,0)!;
  assert.equal(action.command,'PICK_DEALER_CARD');
  assert(view.game.dealer_selection.available_positions.includes(action.payload.position));
  seen.add(action.payload.position);
 }
 assert.equal(seen.size,3);
 assert.equal(move({...view,your_player_id:1},rng,0),null);
});
test('Flush honors required bet and eventually folds; preparation varies',()=>{
 const v={game_type:'flush',flush:{private:{actions:{kinds:['bet'],required_bet:16}}}};
 assert.deepEqual(move(v,random(1),0),{command:'BET',payload:{amount:16}});
 v.flush.private.actions.kinds=['fold','bet'];assert.equal(move(v,random(1),81)?.command,'FOLD');
 v.flush.private.actions.kinds=['cut_deck','skip_cut'];const rng=random(1),seen=new Set();for(let i=0;i<100;i++){const a=move(v,rng,0)!;seen.add(a.command);if(a.command==='CUT_DECK')assert(a.payload.position>=1&&a.payload.position<=51);}assert.equal(seen.size,2);
});
test('Marriage uses available draw/discard IDs and bounded fold',()=>{
 const v:any={game_type:'marriage',marriage:{private:{actions:{kinds:['draw','fold'],drawable_sources:['stock']}}}};
 assert.deepEqual(move(v,random(1),2),{command:'DRAW_CARD',payload:{source:'stock'}});
 v.marriage.private.actions={kinds:['discard','fold'],discardable_card_ids:['physical-1']};assert.deepEqual(move(v,random(1),3),{command:'DISCARD_CARD',payload:{card_id:'physical-1'}});
 assert.equal(move(v,random(1),81)?.command,'FOLD');
});
test('terminal validation rejects disagreement and non-zero-sum results',()=>{
 const v={match_id:'m',your_player_id:1,game_type:'marriage',game:{finished:true,winners:[1]},marriage:{public:{scores:{players:[{net_points:5},{net_points:-5}]}}}};
 validateGame([v,{...v,your_player_id:2}]);assert.throws(()=>validateGame([v,{...v,game:{finished:true,winners:[2]}}]));
 assert.throws(()=>validateGame([{...v,marriage:{public:{scores:{players:[{net_points:5}]}}}}]));
});
test('ledger rejects missing, duplicate, incorrect payouts and respects tied placement',()=>{
 const v={game_type:'marriage',table_id:'t',players:[{player_id:1,user_id:'a'},{player_id:2,user_id:'b'}],marriage:{public:{scores:{players:[{player_id:'1',net_points:5},{player_id:'2',net_points:-5}]}}}};
 const game={game_id:'g',game_type:'marriage',balances:[{player_id:'a',amount:5},{player_id:'b',amount:-5}]};const ledger={balances:game.balances,tables:[{table_id:'t',games:[game]}]};
 assert(validateLedger(v,ledger));assert.equal(validateLedger(v,{...ledger,tables:[]}),false);
 assert.equal(validateLedger(v,{...ledger,tables:[{table_id:'t',games:[game,game]}]}),false);
 assert.throws(()=>validateLedger(v,{...ledger,tables:[{table_id:'t',games:[{...game,balances:[{player_id:'a',amount:6},{player_id:'b',amount:-6}]}]}]}));
 const tied={...v,game_type:'callbreak',game:{scores_tenths:[1,1,2,3]}};assert(validateLedger(tied,{balances:[],tables:[]}));assert.throws(()=>validateLedger(tied,ledger));
});
test('Flush round can finish while its continuing table game is unfinished',()=>{
 const v={game_type:'flush',match_id:'m',your_player_id:1,game:{finished:false,winners:[1]},flush:{public:{status:'finished',players:[{total_contribution:5},{total_contribution:5}],settlement:{winner_ids:['1'],payouts:[{player_id:'1',amount:10}]},round_results:[{net_changes:[{amount:5},{amount:-5}]}]},private:{actions:{kinds:['start_next_round']}}}};
 assert.equal(move(v,random(1),0),null);validateGame([v]);
});

test('normal delays stay below one second and rare late delays use a separate range',()=>{
 assert.deepEqual(thinkDelay(()=>0,0),{delayed:false,ms:50});
 assert.deepEqual(thinkDelay(()=>0,.005),{delayed:true,ms:2000});
 const rng=random(42);let late=0;for(let i=0;i<10000;i++){const d=thinkDelay(rng,.005);if(d.delayed){late++;assert(d.ms>=2000&&d.ms<5000);}else assert(d.ms>=50&&d.ms<500);}assert(late>20&&late<80);
});
test('Call Break next deal carries the completed deal identity',()=>{
 assert.deepEqual(move({game_type:'callbreak',round_review:{can_continue:true,deal_number:3}},random(1),60),{command:'NEXT_DEAL',payload:{deal_number:3}});
});
test('Call Break zero-value placement payments treat zero normally',()=>{
 const v={game_type:'callbreak',table_id:'t',game:{scores_tenths:[40,30,20,10]},settings:{payments:[0,0,0,0]},players:[1,2,3,4].map(i=>({player_id:i,user_id:'p'+i}))};
 assert(validateLedger(v,{tables:[{table_id:'t',games:[{game_id:'g',game_type:'callbreak',balances:[]}]}],balances:[]}));
});
