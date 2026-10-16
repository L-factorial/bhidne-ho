// Touch gestures and polling use isolated snapshots; no production access.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const f=await fixture(browser,'marriage',4,390,false,s=>{s.marriage.public.tunnela_declaration_pending=false;s.marriage.private.maal=null;Object.assign(s.marriage.public.players[0],{route:'unqualified',has_seen_maal:false,shown_melds:[],initial_tunnelas:[]});s.marriage.private.actions.kinds=['draw','fold'];s.marriage.public.phase='must_draw';});
 const page=f.page,closed=page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
 const cards=page.getByTestId('marriage-hand').locator('[data-testid^="marriage-hand-card-"]');
 const ids=()=>cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.testid));
 const touch=await f.context.newCDPSession(page);
 async function drag(){const a=await cards.nth(0).boundingBox(),b=await cards.nth(2).boundingBox();const start={x:a.x+a.width/2,y:a.y+a.height/2},end={x:b.x+b.width/2,y:b.y+b.height/2};await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=15;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/15,y:start.y+(end.y-start.y)*i/15}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(350);}
 const initial=await ids();await drag();const changed=await ids();assert.notDeepEqual(initial,changed);
 await page.getByRole('tab',{name:'Sequence / Tunnela',exact:true}).click();const sorted=await ids();await drag();assert.deepEqual(await ids(),sorted);
 await page.getByRole('tab',{name:'Your view',exact:true}).click();assert.deepEqual(await ids(),changed);
 f.change(s=>{s.marriage.public.players[0].has_seen_maal=true;s.marriage.public.players[0].route='normal';s.marriage.private.maal={tiplu:{rank:8,suit:'D'},jhiplu:{rank:7,suit:'D'},poplu:{rank:9,suit:'D'}};});f.notify();
 await page.getByTestId('marriage-see-maal-step').waitFor();await page.getByTestId('marriage-see-maal-card').click();await page.getByTestId('marriage-see-maal-step').getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByTestId('marriage-view-tabs').waitFor({state:'detached'});
 const after=await ids();await drag();assert.notDeepEqual(await ids(),after);assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS touch: personal reorder, automatic-view drag blocked, personal order retained, live Maal transition removes tabs, post-Maal drag');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
