// Local fixtures only: no live table mutations.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {fixture} = require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const count of [4,5]) for(const width of [320,390,1280]){
   const f=await fixture(browser,'callbreak',count,width,false,s=>{
    s.game.current_trick={trick_number:3,complete:false,plays:[{player_id:2,card:'JS'},{player_id:3,card:'2S'}]};
    s.session={required_actions:[],controls:[],idle_deadline:Date.now()/1000+120,expired_at:null,removal_reason:null};
   });const {page}=f;
   await page.getByTestId('game-stats-toggle').click();
   const summary=page.getByTestId('callbreak-summary');await summary.waitFor();
   assert.equal(await page.getByTestId('game-stats-overlay').getByRole('tab').count(),0);
   assert.equal(await summary.getByTestId(/^summary-round-/).count(),7);
   const values=await summary.getByTestId(/^summary-score-/).evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,x:n.children[1].getBoundingClientRect().x,id:n.dataset.testid,color:getComputedStyle(n.children[0]).color})));
   for(let player=1;player<=count;player++){
    const column=values.filter(v=>v.id.endsWith('-'+player));assert.ok(column.every(v=>Math.abs(v.x-column[0].x)<1),'decimal fields align across rows');
   }
   assert.ok(values.some(v=>v.text.startsWith('−')),'fixture has negative scores');
   await page.screenshot({path:`/private/tmp/game-refactor-summary-${count}-${width}.png`});
   await page.getByTestId('game-stats-close').click();
   const timer=await page.getByTestId('game-session-status').boundingBox(),header=await page.getByTestId('callbreak-header').boundingBox();assert.ok(timer.y>header.y+header.height);
   const collapsed=page.getByTestId('hand-attention-collapsed');if(await collapsed.isVisible())await collapsed.click();
   await page.getByTestId('callbreak-hand-trick-summary').waitFor();
   assert.equal(await page.getByTestId('hand-trick-2').textContent(),'J♠');
   const lead=await page.getByTestId('hand-trick-2').evaluate(n=>getComputedStyle(n).borderColor),other=await page.getByTestId('hand-trick-3').evaluate(n=>getComputedStyle(n).borderColor);assert.notEqual(lead,other);
   await page.getByTestId('hand-attention-expanded').click();
   await page.screenshot({path:`/private/tmp/game-refactor-table-${count}-${width}.png`});
   await page.getByRole('button',{name:'Table menu',exact:true}).click();
   assert.equal(await page.getByTestId('callbreak-menu-drawer').getByRole('button',{name:'Stats',exact:true}).count(),0);
   assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);
   await page.screenshot({path:`/private/tmp/game-refactor-callbreak-${count}-${width}.png`});await f.context.close();console.log(`PASS Call Break ${count}/${width}: summary, aligned decimal fields, compact lead card, timer and drawer`);
  }
  for(const kind of ['callbreak','marriage','flush']){
   const f=await fixture(browser,kind,4,390,false,s=>{
    s.status='waiting';s.is_creator=true;s.table.phase='OPEN';s.game=null;s.deal=null;
    if(s.flush_settings)s.flush_settings.locked=false;
   });const {page}=f;
   await page.getByRole('button',{name:'Table menu',exact:true}).click();
   const drawer=page.getByTestId(kind+'-menu-drawer');assert.equal(await drawer.getByRole('button',{name:'Stats',exact:true}).count(),0);
   await drawer.getByRole('button',{name:'Game rules config',exact:true}).click();
   const proposal=page.getByRole('button',{name:'Propose changes',exact:true});await proposal.waitFor();
   const bounds=await proposal.boundingBox();assert.ok(bounds.height>=52&&bounds.width>250);
   if(kind==='callbreak'){
    const config=page.getByTestId('callbreak-rules-config');
    await config.getByRole('radio',{name:'Any',exact:true}).click();
    await config.getByRole('switch',{name:'No spade, no game',exact:true}).click();
    await config.getByRole('radio',{name:'At least Jack',exact:true}).click();
    assert.equal(await config.getByRole('radio',{name:'At least Jack',exact:true}).getAttribute('aria-checked'),'true');
    await proposal.click();assert.ok(f.writes.includes('/test-games/room/settings'));
   }
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind}: no drawer Stats, consistent proposal action and rule config`);
  }
  const f=await fixture(browser,'marriage',4,390,false,s=>{
   s.marriage.public.players[0].has_seen_maal=true;
   s.marriage.private.maal={tiplu:{rank:7,suit:'H'},jhiplu:{rank:6,suit:'H'},poplu:{rank:8,suit:'H'}};
  });const {page}=f;const step=page.getByTestId('marriage-see-maal-step');await step.waitFor();
  assert.ok(await step.getByRole('button',{name:'Continue',exact:true}).isDisabled());
  await page.getByTestId('marriage-see-maal-card').click();await step.getByRole('button',{name:'Continue',exact:true}).click();await step.waitFor({state:'hidden'});
  assert.equal(await page.getByTestId('marriage-maal-spot').getAttribute('aria-expanded'),'true');
  await page.getByTestId('marriage-maal-spot').click();assert.equal(await page.getByTestId('marriage-maal-spot').getAttribute('aria-expanded'),'false');await page.getByTestId('marriage-maal-spot').click();assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS Marriage: see maal step, continue, subsequent flip/unflip without server writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
