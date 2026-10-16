// Isolated qualifying hands; verifies route selection, group rows and remaining cards.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const out=process.env.SCREENSHOT_DIR||'/private/tmp/bhidne-maal-routes';fs.mkdirSync(out,{recursive:true});
const card=(rank,suit,deck=0)=>({card_id:`D${deck}:${({11:'J',12:'Q',13:'K',14:'A'})[rank]||rank}${suit}`,rank,suit,deck_index:deck,card_type:'standard'});
const hand=[...[2,3,4,5,6].flatMap(r=>[card(r,'S'),card(r,'S',1)]),...[8,9,10,11,12].flatMap(r=>[card(r,'H'),card(r,'H',1)]),card(2,'C')];
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,320,1280])for(const count of [3,4]){
  const f=await fixture(browser,'marriage',count,width,false,s=>{
   const pub=s.marriage.public;pub.tunnela_declaration_pending=false;pub.current_player_id='1';pub.phase='must_draw';
   pub.players.forEach(p=>Object.assign(p,{route:'unqualified',has_seen_maal:false,shown_melds:[],initial_tunnelas:[],tunnela_declared:true}));
   s.marriage.private.hand=hand;s.marriage.private.maal=null;s.marriage.private.actions={kinds:['draw','fold','show_initial_melds',...(count>=4?['show_dublees']:[])],drawable_sources:['stock','discard'],discardable_card_ids:[],blocked_sources:[]};
  });const page=f.page,closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
  await page.getByTestId('marriage-maal-eligibility').getByRole('button').click();
  const panel=page.getByTestId('marriage-maal-preview');await panel.waitFor();
  const overlay=await page.getByTestId('marriage-maal-overlay').boundingBox(),handBox=await page.getByTestId(width<900?'marriage-mobile-hand':'marriage-desktop-hand').boundingBox();
  assert.ok(overlay.x>=handBox.x+15&&overlay.y>=handBox.y+15);assert.ok(overlay.x+overlay.width<=handBox.x+handBox.width-15&&overlay.y+overlay.height<=handBox.y+handBox.height-15);
  assert.equal(await panel.getByRole('tab').count(),count===4?2:0);if(count===3){const caption=page.getByTestId('marriage-maal-route-caption');assert.equal(await caption.innerText(),'Sequence / Tunnela');assert.equal(await caption.evaluate(node=>getComputedStyle(node).textAlign),'center');}
  const groups=page.getByTestId('marriage-maal-three-groups');await groups.waitFor();
  const rows=groups.locator('[data-testid^="marriage-maal-group-"]');assert.equal(await rows.count(),3);
  for(const row of await rows.all())assert.equal(await row.locator('[aria-label^="D"]').count(),5);
  const remaining=page.getByTestId('marriage-maal-remaining');assert.equal(await remaining.locator('[aria-label^="D"]').count(),6);
  const strip=page.getByTestId('marriage-suboptions');assert.ok(await strip.getByRole('button').count()>1);
  await page.screenshot({path:`${out}/${count===4?'both-routes':'single-route'}-${width}.png`});
  await groups.evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:`${out}/groups-and-remaining-${count}-${width}.png`});
  const smaller=strip.getByRole('button',{name:/\(3-3-3\)$/}).first();await smaller.click();
  for(const row of await rows.all())assert.equal(await row.locator('[aria-label^="D"]').count(),3);
  assert.equal(await remaining.locator('[aria-label^="D"]').count(),12);
  await page.screenshot({path:`${out}/suboption-${count}-${width}.png`});
  const button=page.getByTestId('marriage-maal-overlay').getByRole('button',{name:'Confirm & show',exact:true});assert.ok(await button.isEnabled());
  if(count===4){await panel.getByRole('tab',{name:'Dublee',exact:true}).click();assert.equal(await page.getByTestId('marriage-suboptions').count(),0);assert.equal(await page.getByTestId('marriage-combinations-label').count(),0);assert.equal(await page.getByTestId('marriage-option-label').innerText(),'Option 1/120');await page.getByRole('button',{name:'Next option',exact:true}).click();assert.equal(await page.getByTestId('marriage-option-label').innerText(),'Option 2/120');assert.equal(await groups.count(),0);assert.equal(await remaining.locator('[aria-label^="D"]').count(),7);await page.screenshot({path:`${out}/dublee-${width}.png`});await panel.getByRole('tab',{name:'Sequence / Tunnela',exact:true}).click();await groups.waitFor();}
  assert.equal(await page.getByRole('button',{name:'Back to your cards',exact:true}).count(),0);
  for(const id of ['marriage-combinations-label','marriage-cards-to-show'])assert.equal(await page.getByTestId(id).evaluate(node=>getComputedStyle(node).textAlign),'center');
  assert.equal(await page.getByRole('button',{name:'Previous option',exact:true}).count(),0);
  await page.getByTestId('marriage-maal-overlay').getByRole('button',{name:'Close details',exact:true}).click();await page.getByTestId('marriage-maal-overlay').waitFor({state:'hidden'});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log(`PASS ${count} players at ${width}: route tabs, three rows, horizontal suboptions and remaining-card grid`);
 }
 for(const width of [390,320,1280]){
  const dubleeHand=['S','H'].flatMap(suit=>[2,4,6,8,10].flatMap(rank=>[card(rank,suit),card(rank,suit,1)])).concat(card(2,'C'));
  const f=await fixture(browser,'marriage',4,width,false,s=>{Object.assign(s.marriage.public,{phase:'must_draw',current_player_id:'1',tunnela_declaration_pending:false});s.marriage.public.players.forEach(p=>Object.assign(p,{route:'unqualified',has_seen_maal:false,shown_melds:[],initial_tunnelas:[]}));Object.assign(s.marriage.private,{hand:dubleeHand,maal:null,actions:{kinds:['draw','fold','show_dublees'],drawable_sources:['stock','discard'],discardable_card_ids:[],blocked_sources:[]}});});
  const {page}=f,closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();await page.getByTestId('marriage-maal-eligibility').getByRole('button').click();
  const overlay=page.getByTestId('marriage-maal-overlay');await overlay.waitFor();assert.equal(await overlay.getByRole('tab').count(),0);
  const caption=page.getByTestId('marriage-maal-route-caption');assert.equal(await caption.innerText(),'Dublee');assert.equal(await caption.evaluate(node=>getComputedStyle(node).textAlign),'center');
  const label=page.getByTestId('marriage-option-label');assert.equal(await label.innerText(),'Option 1/120');assert.equal(await page.getByTestId('marriage-suboptions').count(),0);assert.equal(await page.getByTestId('marriage-combinations-label').count(),0);
  await overlay.getByRole('button',{name:'Next option',exact:true}).click();assert.equal(await label.innerText(),'Option 2/120');await overlay.getByRole('button',{name:'Previous option',exact:true}).click();assert.equal(await label.innerText(),'Option 1/120');
  const remaining=page.getByTestId('marriage-maal-remaining');await remaining.scrollIntoViewIfNeeded();const b=await remaining.boundingBox(),touch=await f.context.newCDPSession(page),y=b.y+20,start=b.x+Math.min(b.width-20,230),end=b.x+20;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});for(let i=1;i<=15;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/15,y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(200);assert.equal(await label.innerText(),'Option 2/120');
  await page.screenshot({path:`${out}/dublee-only-${width}.png`});await overlay.getByRole('button',{name:'Close details',exact:true}).click();assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log('PASS Dublee-only caption, simple pager, arrows and swipe',width);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
