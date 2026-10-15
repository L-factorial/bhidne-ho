// Exported UI with isolated hands; no live players, games or production writes.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const face=r=>({11:'J',12:'Q',13:'K',14:'A'})[r]||r;
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${face(rank)}${suit}`,card_type:'standard',rank,suit,deck_index:deck});
const hand=[...[2,3,4,5,6].map(r=>card(r,'S')),...[8,9,10,11,12].map(r=>card(r,'H')),...[0,1,2].map(d=>card(9,'D',d)),...[2,4,6,8,10,12,14].map(r=>card(r,'C')),card(2,'D')];
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280])for(const offTurn of [false,true]){
   const f=await fixture(browser,'marriage',4,width,false,s=>{
    s.marriage.public.phase='must_draw';s.marriage.public.current_player_id=offTurn?'2':'1';s.marriage.public.tunnela_declaration_pending=false;
    for(const p of s.marriage.public.players){p.route='unqualified';p.has_seen_maal=false;p.shown_melds=[];p.tunnela_declared=true;p.initial_tunnelas=[];}
    s.marriage.private.hand=hand;s.marriage.private.maal=null;
    s.marriage.private.actions={kinds:offTurn?['fold']:['draw','fold','show_initial_melds','show_dublees'],drawable_sources:offTurn?[]:['stock','discard'],discardable_card_ids:[],blocked_sources:[]};
    s.game.phase='MUST_DRAW';s.game.turn.player_id=offTurn?2:1;
   });
   const {page}=f;if(width===1280)await page.setViewportSize({width,height:1100});
   const closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
   await page.getByTestId('marriage-maal-eligibility').getByRole('button').click();
   if(width < 600 && !offTurn){
    const dock=page.getByTestId('marriage-mobile-hand');
    assert.ok(await dock.getByTestId('marriage-hand-draw').isVisible());
    assert.ok(await page.getByTestId('inline-maal-eligible').isVisible());
    const font=await page.getByTestId('inline-maal-eligible').evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
    assert.ok(font<=11);
    assert.ok(await dock.getByTestId('marriage-card-turn').isVisible());
    assert.ok(await page.getByText('Show for Maal or draw a card',{exact:true}).isVisible());
   }
   const panel=page.getByTestId('marriage-maal-preview');await panel.waitFor();
   assert.equal(await page.getByTestId('marriage-option-label').innerText(),'Option 1/1 (5-5-3)');
   assert.equal(await panel.getByText('Sequence / Tunnela',{exact:true}).count(),0);
   assert.equal(await panel.getByText('Sequence',{exact:true}).count(),0);
   assert.equal(await panel.getByText('Tunnela',{exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'Hide cards',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'Fold',exact:true}).count(),0);
   assert.ok(await panel.getByText('Cards to show · 13',{exact:true}).isVisible());
   await page.getByTestId('marriage-suboptions-toggle').click();
   const subs=page.getByTestId('marriage-suboptions');assert.equal(await subs.getByRole('button').count(),36);
   const short=subs.getByRole('button',{name:/^\d+ \(3-3-3\)$/}).first();await short.click();
   assert.ok(await panel.getByText('Cards to show · 9',{exact:true}).isVisible());
   assert.equal(await panel.getByText('Remaining in your hand · 12 cards',{exact:true}).count(),1);
   await page.getByTestId('marriage-suboption-0').click();
   assert.equal(await panel.getByText('Remaining in your hand · 8 cards',{exact:true}).count(),1);
   const show=panel.getByRole('button',{name:'Confirm & show',exact:true});
   assert.equal(await show.isEnabled(),!offTurn);
   await page.getByTestId('marriage-option-label').scrollIntoViewIfNeeded();await page.waitForTimeout(300);
   if(!offTurn)await page.screenshot({path:`/private/tmp/marriage-options-${width}.png`});
   assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();
   console.log(`PASS Marriage ${width} ${offTurn?'off-turn':'first-turn'}: full runs, 36 unique reductions, remaining cards, Show permission.`);
  }
  for(const count of [3,4]){
   const f=await fixture(browser,'marriage',count,390,false,s=>{s.marriage.private.maal=null;s.marriage.public.players[0].has_seen_maal=false;s.marriage.public.players[0].route='unqualified';s.marriage.public.tunnela_declaration_pending=false;s.marriage.private.actions.kinds=['draw'];s.marriage.public.phase='must_draw';});
   const header=f.page.getByTestId('hand-attention-collapsed');if(await header.isVisible())await header.click();
   assert.equal(await f.page.getByRole('tab',{name:'Arrange Dublee',exact:true}).count(),count>=4?1:0);
   await f.page.getByRole('tab',{name:'Arrange Sequence / Tunnela',exact:true}).waitFor();
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${count}-player Dublee tab availability.`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
