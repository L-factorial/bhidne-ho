const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const f=await fixture(browser,'marriage',4,width),{page}=f;
  const collapsed=page.getByTestId('hand-attention-collapsed'),expanded=page.getByTestId('hand-attention-expanded');
  if(await expanded.isVisible())await expanded.click();await collapsed.waitFor();await page.waitForTimeout(200);
  const geometry=async()=>({area:await page.getByTestId('marriage-play-area').boundingBox(),table:await page.getByTestId('marriage-player-grid').boundingBox()});
  const before=await geometry();await collapsed.click();await expanded.waitFor();await page.waitForTimeout(200);
  assert.deepEqual(await geometry(),before);
  const hand=await page.getByTestId(width<900?'marriage-mobile-hand':'marriage-desktop-hand').boundingBox();assert.ok(hand.y<before.area.y+before.area.height);
  await expanded.click();await collapsed.waitFor();await page.waitForTimeout(200);assert.deepEqual(await geometry(),before);
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log(`PASS Marriage ${width}: hand overlays without shrinking table`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
