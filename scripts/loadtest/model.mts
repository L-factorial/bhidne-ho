import assert from 'node:assert/strict';
export type Account = {username:string; password:string};
export function accounts(text:string):Account[] {
  const rows=text.trim().split('\n').map((line,index)=>{try{return JSON.parse(line);}catch{throw Error(`Invalid account JSON on line ${index+1}`);}});
  assert(rows.length>=4,'At least four JSONL accounts required');
  assert(rows.every(r=>r&&typeof r.username==='string'&&/^load_[a-z0-9_-]{1,27}$/.test(r.username)&&typeof r.password==='string'&&r.password.length>=12&&r.password.length<=128),'Use dedicated load_ accounts with passwords of at least 12 characters');
  assert.equal(new Set(rows.map(r=>r.username)).size,rows.length,'Duplicate accounts');return rows;
}
export function random(seed:number) {let n=seed>>>0;return ()=>{n=(n+0x6D2B79F5)>>>0;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
export function shuffle<T>(items:T[],rng:()=>number) {for(let i=items.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;}
export function choice<T>(items:T[],rng:()=>number):T {assert(items.length,'Empty choice');return items[Math.floor(rng()*items.length)];}
export function finished(v:any):boolean {return v.game_type==='flush'?v.flush?.public?.status==='finished':v.game?.finished===true;}
export function thinkDelay(rng:()=>number,late:number) {const delayed=rng()<late;return {delayed,ms:delayed?2000+rng()*3000:50+rng()*450};}
export type Move={command:string;payload:Record<string,any>};
export function move(v:any,rng:()=>number,steps:number):Move|null {
  const m=(command:string,payload={})=>({command,payload});
  if(finished(v))return null;
  if(v.game_type==='callbreak') {
    if(v.round_review?.can_continue)return m('NEXT_DEAL',{deal_number:v.round_review.deal_number});
    const turn=v.game?.turn;if(!turn?.pending_players?.includes(v.your_player_id))return null;
    switch(turn.action){
      case 'SHUFFLE_DECK':return m('SHUFFLE_DECK');
      case 'CUT_OR_SKIP':return rng()<.2?m('SKIP_CUT'):m('CUT_DECK',{position:1+Math.floor(rng()*51)});
      case 'START_DISTRIBUTION':return m('START_DISTRIBUTION');
      case 'REVIEW_HAND':return v.private.can_accept_hand?m('ACCEPT_HAND'):null;
      case 'PLACE_BID':return m('PLACE_BID',{amount:1+Math.floor(rng()*4)});
      case 'PLAY_CARD':return m('PLAY_CARD',{card:choice(v.private.legal_cards,rng)});
    }
    return null;
  }
  const a=v[v.game_type]?.private?.actions;if(!a)return null;
  if(v.game_type==='flush') {
    let kinds=a.kinds.filter((k:string)=>k!=='start_next_round');
    // Keep early rounds active, but allow every legal action and bounded completion.
    if(steps<12&&kinds.length>1)kinds=kinds.filter((k:string)=>k!=='fold');
    if(!kinds.length)return null;
    const k=steps>80&&kinds.includes('fold')?'fold':choice<string>(kinds,rng);
    return m(k.toUpperCase(),k==='bet'?{amount:a.required_bet}:k==='cut_deck'?{position:1+Math.floor(rng()*51)}:{});
  }
  const kinds=a.kinds;
  if(kinds.includes('declare_tunnelas'))return m('DECLARE_TUNNELAS',{melds:[]});
  if(kinds.includes('fold')&&steps>80)return m('FOLD');
  if(kinds.includes('draw'))return m('DRAW_CARD',{source:choice(a.drawable_sources,rng)});
  if(kinds.includes('discard'))return m('DISCARD_CARD',{card_id:choice(a.discardable_card_ids,rng)});
  if(kinds.includes('fold')&&String(v.game.turn.player_id)===String(v.your_player_id))return m('FOLD');
  return null;
}
export function validateGame(views:any[]) {
  const v=views[0];assert(finished(v),'Game is not complete');
  for(const other of views){assert.equal(other.match_id,v.match_id);assert.deepEqual(other.game,v.game,'Players disagree on public result');assert(other.your_player_id,'Lost player seat');}
  assert(v.game.winners.length,'Missing winners');
  if(v.game_type==='callbreak') {
    assert.equal(v.game.completed_deals,5);assert.equal(v.deal_history.length,5);
    const totals=new Map<number,number>();
    for(const deal of v.deal_history){assert(deal.complete);assert.equal(deal.players.reduce((n:number,p:any)=>n+p.tricks_won,0),13);
      for(const p of deal.players){assert.equal(p.cards_remaining,0);const score=p.tricks_won>=p.bid?p.bid*10+p.tricks_won-p.bid:-10*p.bid;assert.equal(p.score_tenths,score);totals.set(p.player_id,(totals.get(p.player_id)??0)+score);}}
    assert.deepEqual(v.game.scores_tenths,v.game.players.map((p:number)=>totals.get(p)));
    const max=Math.max(...v.game.scores_tenths);assert.deepEqual(v.game.winners,v.game.players.filter((_:any,i:number)=>v.game.scores_tenths[i]===max));
  } else if(v.game_type==='flush') {
    const p=v.flush.public;assert(p.settlement?.winner_ids.length);assert.equal(p.round_results.length,1);
    assert.equal(p.round_results[0].net_changes.reduce((n:number,r:any)=>n+r.amount,0),0);
    assert.equal(p.settlement.payouts.reduce((n:number,r:any)=>n+r.amount,0),p.players.reduce((n:number,r:any)=>n+r.total_contribution,0));
    for(const o of views)assert.deepEqual(o.flush.public,p);
  } else {
    const p=v.marriage.public;assert(p.scores?.players?.length);assert.equal(p.scores.players.reduce((n:number,r:any)=>n+r.net_points,0),0);
    for(const o of views)assert.deepEqual(o.marriage.public,p);
  }
}
export function validateLedger(v:any,ledger:any):boolean {
  const tables=ledger.tables.filter((t:any)=>t.table_id===v.table_id);
  const tied=v.game_type==='callbreak'&&new Set(v.game.scores_tenths).size!==v.game.scores_tenths.length;
  if(tied){assert.equal(tables.flatMap((t:any)=>t.games).length,0,'Tied placement must not settle');return true;}
  if(!tables.length)return false;
  const games=tables.flatMap((t:any)=>t.games);if(games.length!==1)return false;
  assert.equal(new Set(games.map((g:any)=>g.game_id)).size,games.length,'Duplicate ledger result');
  const totals=new Map<string,number>();
  for(const g of games){assert.equal(g.game_type,v.game_type);assert.equal(g.balances.reduce((n:number,b:any)=>n+b.amount,0),0);for(const b of g.balances){assert(v.players.some((p:any)=>p.user_id===b.player_id),'Foreign ledger player');totals.set(b.player_id,(totals.get(b.player_id)??0)+b.amount);}}
  // Flush and Marriage expose zero-sum net changes directly. Call Break's
  // settlement transformation is separate from its non-zero-sum game scores.
  const rows=v.game_type==='flush'?v.flush.public.round_results[0].net_changes:v.game_type==='marriage'?v.marriage.public.scores.players:null;
  if(rows)for(const r of rows){const user=v.players.find((p:any)=>String(p.player_id)===String(r.player_id)).user_id;assert.equal(totals.get(user)??0,r.amount??r.net_points);}
  if(v.game_type==='callbreak'){const ranked=v.players.map((p:any,i:number)=>({...p,score:v.game.scores_tenths[i]})).sort((a:any,b:any)=>b.score-a.score);
    let prize=0;for(let i=1;i<ranked.length;i++){const payment=v.settings.payments[i-1];assert.equal(totals.get(ranked[i].user_id)??0,0-payment);prize+=payment;}assert.equal(totals.get(ranked[0].user_id)??0,prize);}
  assert.equal(ledger.balances.reduce((n:number,b:any)=>n+b.amount,0),0);return true;
}
