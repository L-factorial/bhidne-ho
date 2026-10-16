// Real touch gestures against isolated snapshots; no live commands or accounts.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${({11:'J',12:'Q',13:'K',14:'A'})[rank]||rank}${suit}`,rank,suit,deck_index:deck,card_type:'standard'});
const hand=[...[2,3,4,5,6,7,8].map(r=>card(r,'S')),...[8,9,10,11,12].map(r=>card(r,'H')),...[0,1,2].map(d=>card(9,'D',d)),...[2,4,6,8,10,12].map(r=>card(r,'C'))];
const out='/private/tmp/bhidne-maal-contained';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,320,1280]){
  const f=await fixture(browser,'marriage',4,width,false,s=>{Object.assign(s.marriage.public,{phase:'must_draw',current_player_id:'1',tunnela_declaration_pending:false});s.marriage.public.players.forEach(p=>Object.assign(p,{route:'unqualified',has_seen_maal:false,shown_melds:[],initial_tunnelas:[]}));Object.assign(s.marriage.private,{hand,maal:null,actions:{kinds:['draw','fold','show_initial_melds'],drawable_sources:['stock','discard'],discardable_card_ids:[],blocked_sources:[]}});});
  const {page}=f,closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();await page.getByTestId('marriage-maal-eligibility').getByRole('button').click();
  const overlay=page.getByTestId('marriage-maal-overlay'),label=page.getByTestId('marriage-option-label');await overlay.waitFor();assert.match(await label.innerText(),/^Option 1\/3/);
  const touch=await f.context.newCDPSession(page);
  async function swipe(locator,direction){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();const y=b.y+Math.min(b.height/2,30),left=b.x+30,right=b.x+Math.min(b.width-30,230);const start=direction==='left'?right:left,end=direction==='left'?left:right;await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});for(let i=1;i<=15;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/15,y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);}
  await swipe(page.getByTestId('marriage-maal-three-groups'),'left');assert.match(await label.innerText(),/^Option 2\/3/);
  await page.screenshot({path:`${out}/page-two-${width}.png`});
  await swipe(page.getByTestId('marriage-maal-three-groups'),'right');assert.match(await label.innerText(),/^Option 1\/3/);
  await swipe(page.getByTestId('marriage-suboptions'),'left');assert.match(await label.innerText(),/^Option 1\/3/);
  const strip=page.getByTestId('marriage-suboptions');assert.ok(await strip.evaluate(node=>node.scrollLeft)>0);
  const b=await overlay.boundingBox(),h=await page.getByTestId(width<900?'marriage-mobile-hand':'marriage-desktop-hand').boundingBox();assert.ok(b.x>=h.x+15&&b.y>=h.y+15&&b.x+b.width<=h.x+h.width-15&&b.y+b.height<=h.y+h.height-15);
  await page.setViewportSize({width:width<900?width+40:width-80,height:page.viewportSize().height-40});
  await page.waitForFunction(()=>{const panel=document.querySelector('[data-testid="marriage-maal-overlay"]')?.getBoundingClientRect(),hand=document.querySelector('[data-testid="'+(innerWidth<900?'marriage-mobile-hand':'marriage-desktop-hand')+'"]')?.getBoundingClientRect();return panel&&hand&&Math.abs(panel.left-hand.left-16)<2&&Math.abs(panel.top-hand.top-16)<2&&Math.abs(panel.bottom-hand.bottom+16)<2;});
  await overlay.getByRole('button',{name:'Close details',exact:true}).click();assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log('PASS contained overlay and independent page/strip touch swipes',width);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
