// Isolated snapshots/requests only; no real players or game writes.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${({11:'J',12:'Q',13:'K',14:'A'})[rank]||rank}${suit}`,card_type:'standard',rank,suit,deck_index:deck});
const man={card_id:'MAN:0',card_type:'man',rank:null,suit:null,deck_index:null};
const normal=[...[2,3,4,5,6].map(r=>card(r,'C')),...[2,3,4,5,6].map(r=>card(r,'H')),...Array.from({length:11},(_,i)=>card(i+2,'S')),man];
const dublees=[...Array.from({length:8},(_,i)=>[card(i+2,'C'),card(i+2,'C',1)]).flat(),...[2,4,6,8,10].map(r=>card(r,'D')),man];
function configure(hand,offTurn=false,beforeDraw=false){return s=>{
 s.marriage.public.phase=beforeDraw?'must_draw':'must_discard';s.marriage.public.current_player_id=offTurn?'2':'1';s.marriage.public.tunnela_declaration_pending=false;
 for(const p of s.marriage.public.players){p.route='unqualified';p.has_seen_maal=false;p.shown_melds=[];p.tunnela_declared=true;p.initial_tunnelas=[];}
 s.marriage.private.hand=beforeDraw?hand.slice(0,21):hand;s.marriage.private.maal=null;
 s.marriage.private.actions={kinds:offTurn?['fold']:beforeDraw?['draw','fold','show_initial_melds']:['fold','discard','finish'],drawable_sources:beforeDraw?['stock','discard']:[],discardable_card_ids:beforeDraw?[]:hand.map(c=>c.card_id),blocked_sources:[]};
 s.game.phase=beforeDraw?'MUST_DRAW':'MUST_DISCARD';s.game.turn.player_id=offTurn?2:1;
};}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280])for(const [kind,hand] of [['normal',normal],['dublee',dublees]]){
   const f=await fixture(browser,'marriage',4,width,false,configure(hand)),{page}=f;
   const closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
   await page.getByTestId('marriage-win-eligibility').getByRole('button').click();
   const panel=page.getByTestId('marriage-win-preview');await panel.waitFor();
   const win=panel.getByRole('button',{name:'Win without seeing maal',exact:true});assert.ok(await win.isEnabled());
   assert.equal(await page.getByTestId('marriage-see-maal-step').count(),0);
   if(kind==='dublee')assert.equal(await panel.getByText('Remaining in your hand · 5 cards',{exact:true}).count(),1);
   const posted=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/action'));
   await win.click();const request=(await posted).postDataJSON();
   assert.equal(request.command,'FINISH');assert.ok(request.payload.discard_card_id);
   const groups=kind==='dublee'?request.payload.pairs:request.payload.melds,ids=groups.flatMap(g=>g.card_ids);
   assert.equal(ids.length,kind==='dublee'?16:21);assert.equal(new Set(ids).size,ids.length);assert.ok(!ids.includes(request.payload.discard_card_id));
   assert.ok(!ids.includes('MAN:0'));assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind} ${width}: unseen winning preview and exact final-discard payload.`);
  }
  for(const hand of [normal,dublees]){
   const f=await fixture(browser,'marriage',4,390,false,configure(hand,true)),{page}=f;
   const closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
   await page.getByTestId('marriage-win-eligibility').getByRole('button').click();
   assert.ok(await page.getByTestId('marriage-win-preview').getByRole('button',{name:'Win without seeing maal',exact:true}).isDisabled());
   assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  }
  const f=await fixture(browser,'marriage',4,390,false,configure(normal,false,true));
  const closed=f.page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
  assert.ok(await f.page.getByTestId('marriage-win-eligibility').getByRole('button').isDisabled());
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS no unseen finish before draw or off-turn.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
