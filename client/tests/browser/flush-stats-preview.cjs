const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const out=process.env.SCREENSHOT_DIR||'/private/tmp/flush-stats';fs.mkdirSync(out,{recursive:true});
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
for(const width of [320,390,1280])for(const count of [2,4,5]){
 const f=await fixture(browser,'flush',count,width,false,s=>{s.flush.public.round_results=[{net_changes:s.flush.public.players.map((p,i)=>({player_id:p.player_id,amount:i%2?-4:13}))}];}),p=f.page;
 const expanded=p.getByTestId('hand-attention-expanded');if(await expanded.isVisible())await expanded.click();
 await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(400);
 for(let i=1;i<=count;i++){
 const stat=p.getByTestId('flush-stats-'+i);const b=await stat.boundingBox();
 const icon=await p.getByTestId('flush-visibility-'+i).boundingBox();assert.ok(Math.abs((icon.y+icon.height/2)-(b.y+b.height/2))<2);assert.ok(icon.x+icon.width<=b.x);assert.equal(await stat.evaluate(n=>getComputedStyle(n).borderTopWidth),'0px');
 for(let j=1;j<=count;j++)if(i!==j)assert.ok(!overlaps(b,await p.getByTestId('flush-seat-'+j).boundingBox()),`stats ${i} collide with seat ${j}: ${width}/${count}`);
 assert.ok(!overlaps(b,await p.getByTestId('flush-pot').locator('..').boundingBox()),`stats ${i} ${JSON.stringify(b)} collide with pot ${JSON.stringify(await p.getByTestId('flush-pot').locator('..').boundingBox())} ${width}/${count}`);
 }
 if(count===4){await p.screenshot({path:`${out}/table-${width}.png`});await p.getByTestId('hand-attention-collapsed').click();
 const stats=await p.getByTestId('flush-stats-hand').boundingBox(),seen=await p.getByTestId('flush-hand-visibility').locator('> div').last().boundingBox();assert.ok(stats.x<seen.x);assert.match(await p.getByTestId('flush-stats-hand').innerText(),/Session gain :.*\nBet in this game :/s);await p.screenshot({path:`${out}/my-card-${width}.png`});}
 assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${width}/${count}`);
}
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
