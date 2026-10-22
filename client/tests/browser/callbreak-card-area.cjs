// Local fixtures only: full-hand fit, explicit arrangements and guarded throws.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8119';
const cards=['2S','7S','AS','3C','KC','2H','5H','QH','AH','4D','8D','JD','KD'];
async function drag(page,source,dx,dy){
 const box=await source.boundingBox();const x=box.x+box.width/2,y=box.y+12;
 const touch=await page.context().newCDPSession(page);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=15;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/15,y:y+dy*i/15}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();await page.waitForTimeout(200);
}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [320,390,1280]){
  const f=await fixture(browser,'callbreak',4,width,false,s=>{s.private.hand=cards;s.private.legal_cards=['2S'];s.game.turn.player_id=1;});
  const p=f.page,hand=p.getByTestId('player-hand');
  const collapsed=p.getByTestId('hand-attention-collapsed');if(await collapsed.isVisible())await collapsed.click();
  await hand.getByRole('button',{name:'Flip all cards',exact:true}).click();
  await p.getByTestId('callbreak-hand-trick-summary').waitFor();
  assert.equal(await p.getByTestId(/^hand-trick-/).count(),4,'current-play box retained for every player');
  const order=()=>hand.getByTestId(/^callbreak-hand-card-/).evaluateAll(nodes=>nodes.map(n=>n.dataset.testid.replace('callbreak-hand-card-','')));
  const auto=await order();
  await hand.getByRole('button',{name:'Hide cards',exact:true}).click();
  assert.equal(await hand.getByRole('button',{name:'Select 2S',exact:true}).count(),0,'hidden cards do not expose their identities');
  await hand.getByRole('button',{name:'Show cards',exact:true}).first().click();assert.deepEqual(await order(),auto);
  for(const mode of ['Card grid','Arc']){
   await hand.getByRole('radio',{name:mode,exact:true}).click();await p.waitForTimeout(250);
   const fit=await hand.evaluate(node=>{
    const stage=node.querySelector('[data-testid="callbreak-card-stage"]').getBoundingClientRect();
    const footer=node.querySelector('[data-testid="callbreak-hand-footer"]').getBoundingClientRect();
    const bounds=[...node.querySelectorAll('[data-testid^="callbreak-hand-card-"]')].map(n=>n.getBoundingClientRect());
    return {footer:footer.bottom<=innerHeight,within:bounds.every(b=>b.left>=stage.left-1&&b.right<=stage.right+1&&b.top>=stage.top-1&&b.bottom<=stage.bottom+1)};
   });assert.equal(fit.footer,true,`${width} ${mode}: footer visible`);assert.equal(fit.within,true,`${width} ${mode}: entire hand fits`);
  }
  await hand.getByRole('radio',{name:'Card grid',exact:true}).click();
  await hand.getByRole('tab',{name:'My arrangement',exact:true}).click();
  assert.deepEqual(await order(),cards);
  await hand.getByRole('tab',{name:'Auto Arrangement',exact:true}).click();assert.deepEqual(await order(),auto);
  await hand.getByRole('button',{name:'Select 3C',exact:true}).click({force:true});
  assert.equal(await hand.getByRole('button',{name:'Play selected card',exact:true}).isDisabled(),true);
  await hand.getByRole('button',{name:'Select 2S',exact:true}).click();await p.waitForTimeout(250);
  await hand.getByTestId('callbreak-selected-card-arrow').waitFor();
  await p.screenshot({path:`/private/tmp/bhidne-callbreak-${width}-grid.png`,fullPage:true});
  await hand.getByRole('radio',{name:'Arc',exact:true}).click();await p.waitForTimeout(250);
  const point=await hand.getByTestId('callbreak-hand-card-2S').evaluate(node=>{
   const b=node.getBoundingClientRect();
   for(let y=b.top+3;y<b.bottom-3;y+=3)for(let x=b.left+3;x<b.right-3;x+=3){
    if(document.elementFromPoint(x,y)?.closest('[data-testid^="callbreak-hand-card-"]')===node)return {x,y};
   }
  });assert.ok(point,'legal card is reachable in arc');await p.mouse.click(point.x,point.y);await p.waitForTimeout(100);
  await p.screenshot({path:`/private/tmp/bhidne-callbreak-${width}-arc.png`,fullPage:true});
  // Grid gives a stable touch surface for checking actual gesture transport.
  await hand.getByRole('radio',{name:'Card grid',exact:true}).click();
  const before=await order();
  const a=await hand.getByTestId('callbreak-hand-card-7S').boundingBox(),b=await hand.getByTestId('callbreak-hand-card-2S').boundingBox();
  await drag(p,hand.getByTestId('callbreak-hand-card-7S'),b.x-a.x,0);
  assert.notDeepEqual(await order(),before,'horizontal drag rearranges locally');
  assert.equal(await hand.getByRole('tab',{name:'My arrangement',exact:true}).getAttribute('aria-selected'),'true');
  await hand.getByRole('tab',{name:'Auto Arrangement',exact:true}).click();
  const attempts=[];
  await p.route(site+'/test-games/room/action',async route=>{attempts.push(route.request().postDataJSON());await route.fulfill({status:409,json:{detail:'Not your turn'}});});
  await drag(p,hand.getByTestId('callbreak-hand-card-3C'),0,-200);assert.equal(attempts.length,0,'illegal throw blocked');
  await drag(p,hand.getByTestId('callbreak-hand-card-2S'),0,-45);assert.equal(attempts.length,0,'short movement does not play');
  await drag(p,hand.getByTestId('callbreak-hand-card-2S'),0,-200);
  for(let i=0;!attempts.length&&i<50;i++)await p.waitForTimeout(100);
  assert.equal(attempts.length,1,'deliberate upward throw submits once');assert.equal(attempts[0].payload.card,'2S');
  await p.waitForTimeout(300);
  await hand.getByRole('button',{name:'Select 2S',exact:true}).click();
  await hand.getByRole('button',{name:'Play selected card',exact:true}).click();
  for(let i=0;attempts.length<2&&i<50;i++)await p.waitForTimeout(100);
  assert.equal(attempts.length,2,'bottom button also submits the selected card');
  f.change(s=>{s.game.revision++;s.game.turn.player_id=2;});await p.waitForTimeout(1400);
  await drag(p,hand.getByTestId('callbreak-hand-card-2S'),0,-200);
  assert.equal(attempts.length,2,'other-player turn blocks a legal-card throw');
  assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${width}: fit, arrangements, selection, local reorder, button, illegal/short/valid/other-turn throws`);
 }
 const f=await fixture(browser,'callbreak',4,320,false,s=>{s.private.hand=cards;s.private.legal_cards=[];s.game.phase='BIDDING';s.game.turn.player_id=1;s.deal.players[0].bid=null;s.game.current_trick=null;});
 const p=f.page;await p.setViewportSize({width:320,height:568});
 const collapsed=p.getByTestId('hand-attention-collapsed');if(await collapsed.isVisible())await collapsed.click();
 await p.getByRole('button',{name:'Flip all cards',exact:true}).click();
 await p.getByRole('button',{name:'Increase bid',exact:true}).click();await p.getByRole('button',{name:'Increase bid',exact:true}).click();
 const bid=p.getByRole('button',{name:'Bid',exact:true});
 assert.ok((await bid.boundingBox()).y+(await bid.boundingBox()).height<=568,'bid button visible on short phone');
 assert.ok((await p.getByTestId('callbreak-hand-footer').boundingBox()).y+(await p.getByTestId('callbreak-hand-footer').boundingBox()).height<=568,'view controls visible on short phone');
 await p.screenshot({path:'/private/tmp/bhidne-callbreak-320-bidding.png',fullPage:true});
 let sent;await p.route(site+'/test-games/room/action',async route=>{sent=route.request().postDataJSON();await route.fulfill({status:409,json:{detail:'Your bid is already recorded.'}});});
 await bid.click();for(let i=0;!sent&&i<50;i++)await p.waitForTimeout(100);
 assert.equal(sent.command,'PLACE_BID');assert.equal(sent.payload.amount,3);assert.deepEqual(f.errors,[]);await f.context.close();
 console.log('PASS 320x568: full-hand bidding and fixed bottom controls; correct bid payload');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exit(1)});
