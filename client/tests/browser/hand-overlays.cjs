// Synthetic fixtures only. Compare the actual table before/after hand expansion.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,390,1280])for(const kind of ['marriage','flush','callbreak']){
   const f=await fixture(browser,kind,4,width,false,s=>{if(kind==='callbreak'){s.game.phase='BIDDING';s.game.turn={player_id:1,action:'PLACE_BID',pending_players:[1]};s.deal.phase='BIDDING';s.private.game=s.game;s.private.hand=['AS','KS','QH'];}});
   const {page}=f;
   const table=page.getByTestId(kind==='marriage'?'marriage-player-grid':kind==='flush'?'flush-arena':'callbreak-play-viewport');
   const header=page.getByTestId('hand-area-header');
   await header.waitFor();
   // Normalize to collapsed, then measure both expansion directions.
   const expand=header.getByTestId(/^hand-attention-/);
   if(await expand.getAttribute('data-testid')==='hand-attention-expanded')await expand.click();
   await page.waitForTimeout(300);
   const before=await table.boundingBox();
   await expand.click();await page.waitForTimeout(400);
   const after=await table.boundingBox();
   for(const key of ['x','y','width','height'])assert.ok(Math.abs(before[key]-after[key])<2,`${kind} ${width}: ${key} changed ${before[key]} -> ${after[key]}`);
   if(kind==='marriage'){
    if(width===390)await page.screenshot({path:'/private/tmp/bhidne-marriage-expanded-overlay.png'});
    const sheet=page.getByTestId(width<900?'marriage-mobile-hand':'marriage-desktop-hand');
    const box=await sheet.boundingBox();assert.ok(box.height>page.viewportSize().height*.5,`Marriage expansion too short: ${box.height}`);
    const controls=page.getByTestId('marriage-hand-controls');
    const maal=controls.getByTestId('marriage-maal-eligibility'),win=controls.getByTestId('marriage-win-eligibility');
    if(await maal.count()&&await win.count())assert.ok(Math.abs((await maal.boundingBox()).y-(await win.boundingBox()).y)<2);
   }
   await expand.click();await page.waitForTimeout(300);
   const collapsed=await table.boundingBox();assert.ok(Math.abs(collapsed.height-before.height)<2);
   assert.deepEqual(f.errors,[]);
   await page.getByTestId('header-home-logo').last().click();
   await page.getByTestId('game-stats-toggle').waitFor({state:'hidden'});
   assert.deepEqual(f.errors,[]);
   console.log(`PASS ${kind} ${width}: stable table, overlay, logo navigation`);
   await f.context.close();
  }
  const context=await browser.newContext();const page=await context.newPage();
  await page.goto(process.env.TEST_WEB_URL||'http://127.0.0.1:8108');
  await page.getByRole('button',{name:'Sign in or sign up',exact:true}).first().click();
  await page.getByTestId('header-home-logo').click();
  await page.getByRole('button',{name:'Sign in or sign up',exact:true}).first().waitFor();
  console.log('PASS signed-out logo returns home');await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
