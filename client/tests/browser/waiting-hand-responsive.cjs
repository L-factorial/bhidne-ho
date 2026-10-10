// Isolated snapshots; verifies shared waiting headers across all games.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const kind of ['flush','marriage','callbreak'])for(const width of [320,390,1280]){
  const f=await fixture(browser,kind,4,width,false,s=>{
   s.status='waiting';s.game=null;s.deal=null;s.private=null;s[kind]=null;s.round_review=null;
   s.table.phase='OPEN';
  });
  if(width===390)await f.page.addStyleTag({content:'[data-testid="waiting-hand-area"] [dir="auto"] { font-size: 24px !important; line-height: 35px !important; }'});
  const bar=f.page.getByTestId('waiting-hand-area');await bar.waitFor();
  const header=bar.getByTestId('hand-area-header');
  const box=await bar.boundingBox(),hb=await header.boundingBox();
  assert.ok(box.width>=width-70&&hb.width===box.width,`${kind}: waiting hand fills its container`);
  const cards=bar.getByTestId('hand-attention-collapsed');assert.equal(await cards.isDisabled(),true);
  assert.ok(await cards.getByText('Your cards',{exact:true}).isVisible());
  const cardBox=await cards.boundingBox();assert.ok(cardBox.width>=box.width-100,'card control reserves both social buttons');
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);
  await f.page.screenshot({path:`/private/tmp/bhidne-waiting-hand-${kind}-${width}.png`});
  await f.context.close();console.log(`PASS ${kind} ${width}: full width disabled waiting cards header`);
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
