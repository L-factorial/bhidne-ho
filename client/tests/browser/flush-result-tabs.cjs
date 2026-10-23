// Local completed-round fixtures; no live accounts or writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [320,390,1280]){
  const f=await fixture(browser,'flush',4,width,false,s=>{
   const pub=s.flush.public;
   pub.pending_show=null;
   pub.settlement={winner_ids:['1'],payouts:[{player_id:'1',amount:15},{player_id:'2',amount:0}],salami_transfers:[],
    shown_hands:[{player_id:'1',cards:[{rank:2,suit:'C'},{rank:5,suit:'C'},{rank:7,suit:'D'}]},{player_id:'2',cards:[{rank:2,suit:'D'},{rank:3,suit:'S'},{rank:5,suit:'S'}]}]};
   pub.round_results=[{round_number:pub.round_number,net_changes:[{player_id:'1',amount:8},{player_id:'2',amount:-8}]}];
   s.flush.private.public=pub;s.flush.private.actions.kinds=[];
  });
  const {page}=f,overlay=page.getByTestId('flush-show-overlay');await overlay.waitFor();
  const hands=overlay.getByRole('tab',{name:'Shown hands',exact:true}),results=overlay.getByRole('tab',{name:'Results',exact:true});
  assert.equal(await hands.getAttribute('aria-selected'),'true');
  assert.equal(await overlay.getByTestId('flush-card-arc').count(),2);
  assert.equal(await overlay.getByTestId('flush-result-summary').count(),0);
  await page.waitForTimeout(400);await page.screenshot({path:`/private/tmp/flush-result-hands-${width}.png`});
  const headerBefore=await hands.boundingBox();
  await overlay.evaluate(node=>{for(const child of node.querySelectorAll('*')){if(getComputedStyle(child).overflowY==='auto'&&child.scrollHeight>child.clientHeight)child.scrollTop=child.scrollHeight;}});
  assert.deepEqual(await hands.boundingBox(),headerBefore,'tabs stay fixed while content scrolls');
  await results.click();await overlay.getByTestId('flush-result-summary').waitFor();
  assert.equal(await overlay.getByTestId('flush-card-arc').count(),0);
  assert.equal(await overlay.getByTestId('result-value-1-2').innerText(),'+8');
  await page.screenshot({path:`/private/tmp/flush-result-summary-${width}.png`});
  await overlay.getByRole('button',{name:'Close final show',exact:true}).click();
  const expand=page.getByTestId('hand-attention-collapsed');if(await expand.isVisible())await expand.click();
  await page.getByRole('button',{name:'View round result',exact:true}).click();
  assert.equal(await hands.getAttribute('aria-selected'),'true');
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);
  await f.context.close();console.log(`PASS Flush result tabs ${width}: hands default, summary, reopen reset`);
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
