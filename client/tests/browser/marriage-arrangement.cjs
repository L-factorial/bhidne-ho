const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [320,1280])for(const count of [2,3,4,5,6]){
   const f=await fixture(browser,'marriage',count,width,false,s=>{
    s.marriage.private.maal=null;s.marriage.public.players[0].has_seen_maal=false;
    s.marriage.public.players[0].route='unqualified';s.marriage.public.tunnela_declaration_pending=false;
    s.marriage.private.actions.kinds=['draw'];s.marriage.public.phase='must_draw';
   });
   const closed=f.page.getByTestId('hand-attention-collapsed');if(await closed.isVisible())await closed.click();
   const sequence=f.page.getByRole('tab',{name:'Arrange Sequence / Tunnela',exact:true});await sequence.waitFor();
   const dublee=f.page.getByRole('tab',{name:'Arrange Dublee',exact:true});
   assert.equal(await dublee.count(),count>=4?1:0);
   assert.equal(await sequence.getByText('Arrange',{exact:true}).count(),1);
   if(count>=4){
    assert.ok(Math.abs((await sequence.boundingBox()).y-(await dublee.boundingBox()).y)<2);
    await dublee.click();assert.equal(await dublee.getAttribute('aria-selected'),'true');
    await sequence.click();assert.equal(await sequence.getAttribute('aria-selected'),'true');
   }
   const label=sequence.getByText('Sequence / Tunnela',{exact:true});
   const sizes=await label.evaluate(node=>({label:parseFloat(getComputedStyle(node).fontSize),heading:parseFloat(getComputedStyle(node.previousElementSibling).fontSize),opacity:getComputedStyle(node).opacity}));
   assert.ok(sizes.label<sizes.heading);assert.ok(Number(sizes.opacity)<1);
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${count} players at ${width}: arrangement tabs and hierarchy`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
