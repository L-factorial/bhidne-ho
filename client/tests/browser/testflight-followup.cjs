// Isolated snapshots: no production accounts, tables or messages are changed.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const width of [320,390,1280]) for(const kind of ['callbreak','marriage','flush']) {
   const f=await fixture(browser,kind,4,width,false,s=>{if(kind==='flush'){s.flush.public.current_player_id=s.flush.private.player_id;s.flush.private.actions.kinds=['bet','see_cards','fold'];s.flush.private.actions.required_bet=1;s.flush.private.actions.maximum_bet=100;}}),{page}=f;
   const expanded=page.getByTestId('hand-attention-expanded');if(await expanded.count())await expanded.click();
   const header=page.getByTestId('hand-area-header');await header.waitFor();
   const dock=page.getByTestId(kind==='marriage'?(width<900?'marriage-mobile-hand':'marriage-desktop-hand'):kind==='callbreak'?'callbreak-mobile-hand':'flush-hand-dock');
   const surface=page.getByTestId(`table-surface-${kind}`);
   const table=await surface.boundingBox(),hand=await dock.boundingBox();
   assert.ok(table.y+table.height<=hand.y-6,`${kind} table must leave separation: ${JSON.stringify({table,hand})}`);
   assert.ok(table.height>300,`${kind} table fills available vertical area`);
   assert.equal(await page.getByTestId(/^attention-ray-/).count(),0);
   assert.ok(await dock.getByTestId('hand-area-outline').isVisible());
   for(const action of ['chat','poke']){
    const control=await header.getByTestId(`collapsed-${action}`).boundingBox();
    assert.ok(control.x>=hand.x&&control.x+control.width<=hand.x+hand.width+1);
   }
   if(kind==='callbreak'){
    for(const face of await page.getByTestId('trick-card').all()){
     const box=await face.boundingBox();
     const texts=await face.locator('div[dir="auto"]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
     assert.ok(texts.every(t=>t.y>=box.y&&t.y+t.height<=box.y+box.height+1),'rank and suit stay inside the face');
    }
   }
   await page.screenshot({path:`/private/tmp/followup-${kind}-${width}-collapsed.png`});
   await page.getByTestId('hand-attention-collapsed').click();await expanded.waitFor();
   for(const action of ['chat','poke'])assert.ok(await header.getByTestId(`collapsed-${action}`).isVisible());
   assert.equal(await page.getByTestId('game-social-controls').count(),0);
   if(kind==='marriage'){
    const row=page.getByTestId('marriage-hand-draw');await row.waitFor();
    const cards=await row.getByRole('button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
    assert.equal(cards.length,3);assert.ok(cards.every(c=>Math.abs(c.y-cards[0].y)<1));
    const bounds=await row.boundingBox();assert.ok(cards.every(c=>c.x>=bounds.x&&c.x+c.width<=bounds.x+bounds.width));
    assert.equal(await page.getByTestId('marriage-own-shown-cards').count(),0);
   }
   if(kind==='flush'){
    const colors=await page.getByTestId('flush-actions').getByRole('button').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
    assert.ok(colors.length>1);assert.equal(new Set(colors).size,1,'turn choices have equal emphasis');
   }
   await page.screenshot({path:`/private/tmp/followup-${kind}-${width}-expanded.png`});
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind} ${width}: gap, outline, shared controls, bounded cards/piles`);
  }
  for(const kind of ['callbreak','marriage','flush']){
   const f=await fixture(browser,kind,4,390,false,s=>{
    s.status='waiting';s.table.phase='OPEN';s.game=null;s.deal=null;s.private=null;
    if(kind==='marriage')s.marriage=null;
    if(kind==='flush')s.flush=null;
   });
   const bar=f.page.getByTestId('waiting-hand-area');await bar.waitFor();
   assert.ok(await bar.getByTestId('hand-attention-collapsed').isDisabled());
   for(const action of ['chat','poke'])await bar.getByTestId(`collapsed-${action}`).waitFor();
   assert.equal(await f.page.getByTestId('game-social-controls').count(),0);
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind}: disabled pregame tray with social controls`);
  }
  {
   const f=await fixture(browser,'flush',4,390,false,s=>{s.game.finished=true;});
   const glow=f.page.getByTestId('attention-glow');await glow.waitFor();
   await glow.waitFor({state:'hidden',timeout:7000});
   assert.equal(await f.page.getByTestId(/^attention-ray-/).count(),0);
   assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS Flush: finite attention glow disappears after pulsation');
  }
  for(const route of ['normal','dublee']){
   const f=await fixture(browser,'marriage',4,390,false,s=>{
    const own=s.marriage.public.players.find(p=>p.player_id===s.marriage.private.player_id);
    own.has_seen_maal=true;own.route=route;
    own.shown_melds=[{meld_type:route==='normal'?'pure_sequence':'dublee',card_ids:route==='normal'?['D0:2H','D0:3H','D0:4H']:['D0:2H','D1:2H']}];
    own.initial_tunnelas=[{meld_type:'tunnela',card_ids:['D0:5H','D1:5H','D2:5H']}];
   });
   const {page}=f;const expanded=page.getByTestId('hand-attention-expanded');if(!await expanded.count())await page.getByTestId('hand-attention-collapsed').click();
   const controls=page.getByTestId('marriage-recorded-declarations');
   const name=route==='normal'?'View shown sequence':'View shown Dublee';await controls.getByRole('button',{name,exact:true}).click();
   await page.getByTestId('marriage-own-shown-cards').waitFor();
   await page.getByRole('button',{name:/Close/,exact:false}).last().click();
   await controls.getByRole('button',{name:'View shown Tunnela',exact:true}).click();await page.getByTestId('marriage-own-shown-cards').waitFor();
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS Marriage ${route}: recorded declaration viewer`);
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
