// Isolated regular-flow regression; no real accounts or game writes.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const count of [2,3,4,5,6]){
  const f=await fixture(browser,'marriage',count,390,false,s=>{
   s.marriage.public.manual_maal_cut=true;s.marriage.public.maal_selected=count===6;
   s.marriage.public.current_player_id='1';s.marriage.public.phase='must_draw';s.marriage.public.tunnela_declaration_pending=false;
   for(const p of s.marriage.public.players){p.route='unqualified';p.has_seen_maal=false;p.shown_melds=[];p.tunnela_declared=true;}
   s.marriage.private.maal=null;s.marriage.private.actions={kinds:['draw','fold'],drawable_sources:['stock','discard'],discardable_card_ids:[],blocked_sources:[]};
  });
  const {page}=f;const table=page.getByTestId('marriage-maal-spot');await table.waitFor();
  assert.equal(await table.getByTestId('marriage-card-back').count(),count===6?1:0);
  assert.equal(await page.getByTestId('marriage-table-cut-maal').count(),0);
  assert.equal(await page.getByTestId('marriage-table-skip-maal').count(),0);
  f.change(s=>{s.game.revision++;s.marriage.public.revision++;s.marriage.public.maal_selected=true;s.marriage.public.players[0].route='normal';s.marriage.public.players[0].has_seen_maal=true;s.marriage.private.maal={tiplu:{rank:7,suit:'H'},jhiplu:{rank:6,suit:'H'},poplu:{rank:8,suit:'H'}};});
  const modal=page.getByTestId('marriage-see-maal-step');await modal.waitFor();
  await modal.getByTestId('marriage-see-maal-card').click();await modal.getByText('7',{exact:true}).waitFor();
  assert.equal(await page.getByTestId('marriage-cut-maal').count(),0);
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log(`PASS ${count}: initial slot, regular private reveal, no Cut/Skip controls.`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
