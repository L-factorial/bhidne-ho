// Isolated dealer conflict: loading feedback spans response and snapshot recovery.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8127';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of [390,1280]){
   let initial;
   const f=await fixture(browser,'callbreak',4,width,false,s=>{
    s.game.phase='SELECTING_DEALER';s.game.revision=0;s.game.turn.player_id=1;
    s.game.dealer_selection={complete:false,current_player:1,dealer:null,available_positions:Array.from({length:52},(_,i)=>i),picks:[]};
    initial=structuredClone(s);
   });
   const p=f.page,flip=p.getByTestId('dealer-flip-card');
   await flip.waitFor();assert.equal(await flip.isEnabled(),true);
   let finishAction,finishRead,started=false,submits=0,chosen;
   const actionGate=new Promise(resolve=>finishAction=resolve),readGate=new Promise(resolve=>finishRead=resolve);
   const latest=structuredClone(initial);latest.game.revision=1;latest.game.turn.player_id=2;
   latest.game.dealer_selection.current_player=2;
   await p.route(site+'/test-games/room**',async route=>{
    if(new URL(route.request().url()).pathname.endsWith('/action')){
     submits++;started=true;const request=route.request().postDataJSON();chosen=request.payload.position;
     assert.equal(request.command,'PICK_DEALER_CARD');
     latest.game.dealer_selection.picks=[{player_id:1,position:chosen,card:'2S'}];
     latest.game.dealer_selection.available_positions=latest.game.dealer_selection.available_positions.filter(i=>i!==chosen);
     await actionGate;
     return route.fulfill({json:{...initial,action_ack:{command_id:request.command_id,status:'rejected',revision:1,detail:'The turn changed. Your view has been refreshed; try again.'}}});
    }
    if(!started)return route.fallback();
    await readGate;return route.fulfill({json:latest});
   });
   const before=await flip.boundingBox();await flip.click();
   const line=flip.getByTestId('activity-line');await line.waitFor();
   assert.equal(await flip.isDisabled(),true);
   const during=await flip.boundingBox();assert.equal(during.width,before.width);assert.equal(during.height,before.height);
   const opacity=[];
   for(let i=0;i<4;i++){opacity.push(await line.locator(':scope > div').evaluate(n=>Number(getComputedStyle(n).opacity)));await p.waitForTimeout(250);}
   assert.ok(Math.max(...opacity)-Math.min(...opacity)>.1,'fading line animates');
   finishAction();await p.waitForTimeout(500);
   assert.equal(await line.isVisible(),true,'line stays while refreshed snapshot is pending');
   assert.equal(await p.getByRole('alert').count(),0);
   await p.screenshot({path:`/private/tmp/bhidne-dealer-recovery-${width}.png`});
   finishRead();await p.getByTestId('dealer-pick-1').waitFor();await line.waitFor({state:'hidden'});
   assert.equal(await flip.isDisabled(),true,'the next player owns the turn');
   assert.equal(await p.getByRole('alert').count(),0);assert.equal(submits,1);
   assert.deepEqual(f.errors,[]);await f.context.close();
   console.log(`PASS ${width}: fading stable button, silent snapshot recovery, one pick, next-player turn`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
