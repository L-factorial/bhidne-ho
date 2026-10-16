// Real rendered table bounds against the header/card-bar space, with no live writes.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const out='/private/tmp/bhidne-table-fit';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const [width,height] of [[320,568],[390,844],[844,390],[1280,900]])for(const kind of ['flush','marriage','callbreak'])for(const count of (width===320||width===390?(kind==='flush'?[2,3,4,5]:kind==='marriage'?[2,3,4,5,6]:[4,5]):[4])){
  const f=await fixture(browser,kind,count,width,false,s=>{if(kind==='callbreak'){s.game.phase='BIDDING';s.game.turn={player_id:1,action:'PLACE_BID',pending_players:[1]};s.deal.phase='BIDDING';s.private.game=s.game;s.private.hand=['AS','KS','QH'];}}),{page}=f;
  await page.setViewportSize({width,height});const header=page.getByTestId('hand-area-header');await header.waitFor();
  const toggle=header.getByTestId(/^hand-attention-/);if(await toggle.getAttribute('data-testid')==='hand-attention-expanded')await toggle.click();await page.waitForTimeout(500);
  const viewport=page.getByTestId(kind+'-play-viewport'),surface=page.getByTestId('table-surface-'+kind);
  const v=await viewport.boundingBox(),t=await surface.boundingBox(),bar=await header.boundingBox();
  assert.ok(v.height>0);assert.ok(t.y>=v.y-2&&t.y+t.height<=v.y+v.height+2,`${kind} ${width}x${height}: table ${JSON.stringify(t)} outside ${JSON.stringify(v)}`);
  assert.ok(t.x>=v.x-2&&t.x+t.width<=v.x+v.width+2);
  assert.ok(t.y+t.height<=bar.y+2,`${kind}: table spills under collapsed hand`);
  const fitted=await viewport.getByTestId(kind+'-play-viewport-fitted').boundingBox();assert.ok(fitted.height<=v.height+2);
  await page.screenshot({path:`${out}/${kind}-${count}-${width}x${height}.png`});
  await toggle.click();await page.waitForTimeout(200);const after=await surface.boundingBox();for(const key of ['x','y','width','height'])assert.ok(Math.abs(after[key]-t[key])<2,`${kind}: expanded hand moved table ${key}`);
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log('PASS fitted, stable table',kind,count,width,height);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
