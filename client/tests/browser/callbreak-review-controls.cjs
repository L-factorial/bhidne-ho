const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280])for(const eligible of [false,true]){
  const f=await fixture(browser,'callbreak',4,width,false,s=>{
   s.game.phase='HAND_REVIEW';s.game.turn.player_id=null;s.private.hand=['AD','2C','3H','4S','5D','6C','7H','8S'];
   s.private.legal_cards=[];s.private.can_accept_hand=true;s.private.can_claim_redeal=eligible;
  }),page=f.page;
  if(!await page.getByTestId('hand-attention-expanded').count())await page.getByTestId('hand-attention-collapsed').click();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('[role=button]')].find(n=>n.textContent==='Accept hand');return b&&b.getAttribute('aria-disabled')!=='true';},null,{timeout:15000});
  assert.ok(await page.getByRole('button',{name:'Accept hand',exact:true}).isEnabled());
  assert.equal(await page.getByRole('button',{name:'Request redeal',exact:true}).count(),eligible?1:0);
  if(eligible)assert.ok(await page.getByRole('button',{name:'Request redeal',exact:true}).isEnabled());
  await page.getByRole('button',{name:'Flip all cards',exact:true}).click();
  assert.ok(await page.getByRole('button',{name:'Accept hand',exact:true}).isEnabled());
  await page.getByRole('button',{name:'Hand options',exact:true}).click();
  const views=page.getByRole('radiogroup',{name:'Hand view',exact:true});assert.equal(await views.getByRole('radio').count(),2);
  const hand=page.getByTestId('player-hand'),order=()=>hand.locator('[data-testid^="callbreak-hand-card-"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.testid));
  for(const mode of ['Card grid view','Arc view']){
   await views.getByRole('radio',{name:mode,exact:true}).click();
   await page.getByRole('button',{name:'Group by suit',exact:true}).click();await hand.scrollIntoViewIfNeeded();
   const before=await order();assert.deepEqual(before.map(v=>v.slice(-1)),['S','S','H','H','C','C','D','D']);
   const points=await hand.evaluate(node=>{
    const result=[];
    for(const card of node.querySelectorAll('[data-testid^="callbreak-hand-card-"]')){
     const r=card.getBoundingClientRect();let point;
     for(let y=Math.max(2,r.top)+12;y<Math.min(innerHeight,r.bottom)-6&&!point;y+=8)
      for(let x=Math.max(2,r.left)+3;x<Math.min(innerWidth,r.right)-2;x+=5)
       if(document.elementFromPoint(x,y)?.closest('[data-testid^="callbreak-hand-card-"]')===card){point={x,y};break;}
     if(point)result.push(point);
    }return result;
   });assert.ok(points.length>=2);
   const from=points[0],to=points.at(-1),touch=await f.context.newCDPSession(page);
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
   for(let i=1;i<=12;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12}]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();await page.waitForTimeout(150);
   assert.notDeepEqual(await order(),before,`${mode} dragging changes local order`);
   await page.getByRole('button',{name:'Group by suit',exact:true}).click();assert.deepEqual(await order(),before);
  }
  assert.deepEqual(f.errors,[]);assert.ok(f.writes.every(p=>!p.endsWith('/action')));await f.context.close();
  console.log(`PASS Call Break ${width}px redeal=${eligible}: unflipped review, two views, drag/regroup`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
