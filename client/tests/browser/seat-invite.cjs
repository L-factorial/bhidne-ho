// Isolated snapshots and intercepted API requests; no real invitations.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const kind of ['callbreak','marriage','flush'])for(const width of [320,390,1280]){
   const f=await fixture(browser,kind,4,width,false,s=>{
    s.status='waiting';s.game=null;delete s.deal;delete s.private;delete s.marriage;delete s.flush;
    s.players=s.players.slice(0,2);s.capacity=4;s.is_creator=true;
    s.table.phase='OPEN';s.table.seated_players=s.table.seated_players.slice(0,2).map((p,i)=>({...p,position_id:i+1}));
    s.table.current_user.can_start=true;if(s.flush_settings)s.flush_settings.locked=false;
   });
   const {page}=f,invites=[];
   await page.route('**/players/search?*',route=>route.fulfill({json:[{user_id:'user-alice',username:'alice',display_name:'Alice'},{user_id:'user-alicia',username:'alicia',display_name:'Alicia'},...Array.from({length:10},(_,i)=>({user_id:`user-ali-${i}`,username:`ali${i+1}`,display_name:`Alison ${i+1}`}))]}));
   page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/table/invite-position'))invites.push(r.postDataJSON());});
   for(const position of [3,4]){
    await page.getByTestId(`invite-seat-${position}`).click();
    const popover=page.getByTestId('seat-invite-popover');await popover.waitFor();
    await page.waitForTimeout(150);
    const box=await popover.boundingBox();
    assert.ok(box.width<=228&&box.height<=130,JSON.stringify({kind,width,box}));
    assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=page.viewportSize().height);
    assert.equal(await popover.getByRole('textbox').count(),1);
    assert.equal(await popover.getByRole('button').count(),0);
    assert.equal(await page.getByText('Players can receive invitations while seated elsewhere.',{exact:false}).count(),0);
    if(position===4)await page.screenshot({path:`/private/tmp/seat-invite-${kind}-${width}-side.png`});
    await page.getByTestId('seat-invite-dismiss').click({position:{x:4,y:4}});
    await popover.waitFor({state:'hidden'});
   }
   await page.getByTestId('invite-seat-3').click();
   const input=page.getByTestId('seat-invite-input');
   await input.fill('ali');
   const alice=page.getByTestId('seat-invite-player-user-alice');
   await alice.waitFor();await page.waitForTimeout(450);
   assert.equal(invites.length,0,'typing must not send an invitation');
   assert.equal(await page.getByTestId('seat-invite-send').count(),0);
   assert.equal(await page.getByTestId('seat-invite-results').getByRole('button').count(),12);
   const results=page.getByTestId('seat-invite-results');
   assert.equal(Math.round((await results.boundingBox()).height),132,'show exactly three compact rows');
   assert.ok(await results.evaluate(el=>el.scrollHeight>el.clientHeight),'result list must scroll');
   await results.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await page.getByTestId('seat-invite-player-user-ali-9').scrollIntoViewIfNeeded();
   await results.evaluate(el=>{el.scrollTop=0;});
   await page.screenshot({path:`/private/tmp/seat-invite-${kind}-${width}.png`});
   if(kind==='flush'&&width===390){
    await page.evaluate(()=>{const viewport=window.visualViewport;Object.defineProperty(viewport,'height',{configurable:true,get:()=>380});viewport.dispatchEvent(new Event('resize'));});
    await page.waitForTimeout(300);
    const keyboardBox=await page.getByTestId('seat-invite-popover').boundingBox();assert.ok(keyboardBox.y+keyboardBox.height<=380,'popover must stay above the keyboard');
   }
   await alice.click();await page.getByTestId('seat-invite-popover').waitFor({state:'hidden'});
   assert.equal(invites.length,1);assert.equal(invites[0].recipient,'user-alice');assert.equal(invites[0].position_id,3);assert.equal(invites[0].recipients,undefined);
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind} ${width}: compact inward seat popover, scrollable results, explicit recipient and one send.`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
