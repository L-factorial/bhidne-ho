const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const f=await fixture(browser,'callbreak',4,width),{page}=f;
  if(!await page.getByTestId('hand-attention-expanded').count())await page.getByTestId('hand-attention-collapsed').click();
  await page.getByRole('button',{name:'Flip all cards',exact:true}).click();
  const hand=page.getByTestId('player-hand');await hand.scrollIntoViewIfNeeded();
  const point=await hand.evaluate(node=>{
   const r=node.getBoundingClientRect();
   for(let y=Math.max(0,r.top)+70;y<Math.min(innerHeight,r.bottom)-30;y+=10)for(let x=Math.max(10,r.left)+40;x<Math.min(innerWidth,r.right)-60;x+=10){
    const card=document.elementFromPoint(x,y)?.closest('[data-testid^="callbreak-hand-card-"]');
    if(card&&node.contains(card))return{x,y};
   }
   return null;
  });assert.ok(point,'find a visible fan card');
  const transforms=()=>hand.locator('[data-testid^="callbreak-hand-card-"]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.testid,getComputedStyle(n).transform])));
  const before=await transforms(),touch=await f.context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  for(let step=1;step<=10;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+step*4,y:point.y-step*2}]});
  await page.waitForTimeout(100);const during=await transforms();
  assert.ok(Object.keys(before).some(id=>before[id]!==during[id]),'card orientation updates during drag before release');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  assert.deepEqual(f.errors,[]);assert.ok(f.writes.every(p=>!p.endsWith('/action')),'rearrangement stays local');
  await f.context.close();console.log(`PASS Call Break ${width}: fan orientation follows touch drag`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
