// Isolated snapshots only; verifies geometry after fonts and layout settle.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [320,390,1280])for(const count of [2,4,5]){
  const f=await fixture(browser,'flush',count,width,false,s=>{
   s.flush.public.players.forEach((p,i)=>{p.status='active';p.visibility=i%2?'seen':'blind';});
  }),p=f.page;
  await p.getByTestId('flush-round').waitFor({state:'attached'});
  await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(400);
  const badges=p.getByTestId(/^flush-visibility-/);assert.equal(await badges.count(),count);
  assert.ok(await badges.evaluateAll(nodes=>nodes.every(node=>{
   const badge=node.getBoundingClientRect(),avatar=node.previousElementSibling.getBoundingClientRect();
   return badge.top>=avatar.bottom+3;
  })),'visibility icons must clear the entire avatar ring');
  assert.match(await p.getByTestId('flush-round').innerText(),/Round \d+/);
  const ids=['flush-pot','flush-round','flush-seen-bet','flush-blind-bet'];
  const styles=await Promise.all(ids.map(id=>p.getByTestId(id).evaluate(n=>({color:getComputedStyle(n).color,size:parseFloat(getComputedStyle(n).fontSize),weight:parseInt(getComputedStyle(n).fontWeight)}))));
  assert.equal(new Set(styles.map(s=>s.color)).size,4);assert.ok(styles[0].weight>=700&&styles[0].size>styles[1].size);
  const toggle=p.getByTestId('hand-attention-expanded');if(await toggle.isVisible())await toggle.click();
  if(count===4)await p.screenshot({path:`/private/tmp/bhidne-flush-status-${width}.png`});
  assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${width}px / ${count} players: separated badges, round and contrasting pot/bets`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
