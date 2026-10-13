const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./game-stats.cjs');
const base=()=>({server_now:Date.now()/1000,idle_deadline:null,expired_at:null,removal_reason:null,
  controls:[],required_actions:[],replacement_offer:null,reclaim:null});
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{channel:'chrome'})});
  let passed=0;
  try{
    for(const width of [320,390,1280]){
      for(const kind of ['callbreak','marriage','flush']){
        const item=await fixture(browser,kind,4,width,false,s=>{
          s.session={...base(),required_actions:[{seat_id:1,user_id:'u0',deadline:Date.now()/1000+160}]};
        });
        const bar=item.page.getByTestId('game-session-clock');await bar.waitFor();
        assert.match(await bar.getAttribute('aria-label'),/action due in/);
        assert.equal(await item.page.getByTestId('game-session-status').count(),0);
        assert.equal(await bar.getByTestId('session-countdown').evaluate(el=>getComputedStyle(el).fontVariantNumeric),'tabular-nums');
        const box=await bar.boundingBox();assert(box.x>=0 && box.x+box.width<=width+1);
        assert(box.height<=40);
        const left=await item.page.getByTestId('game-stats-toggle').boundingBox(),right=await item.page.getByTestId('table-summary-toggle').boundingBox();
        assert(left.x+left.width<=box.x && box.x+box.width<=right.x,'clock stays between summary buttons');
        const toolbar=await item.page.getByTestId('game-summary-toolbar').boundingBox();assert(Math.abs(box.x+box.width/2-toolbar.x-toolbar.width/2)<1,'clock is centered');
        const table=await item.page.getByTestId(`table-surface-${kind}`).boundingBox();assert(table.y>=toolbar.y+toolbar.height-1,'toolbar stays above the game table');
        if(width===390)await item.page.screenshot({path:`/private/tmp/bhidne-summary-clock-${kind}.png`});
        if(width===320){
          await item.page.addStyleTag({content:'[data-testid="game-summary-toolbar"] [dir="auto"] {font-size:20px !important;line-height:29px !important}'});
          const a=await item.page.getByTestId('game-stats-toggle').boundingBox(),b=await bar.boundingBox(),c=await item.page.getByTestId('table-summary-toggle').boundingBox();
          assert(a.x+a.width<=b.x && b.x+b.width<=c.x,'larger text remains clear of the clock');
          assert(await item.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        }
        await item.page.getByTestId('game-stats-toggle').click();
        assert(await bar.isVisible());
        const panel=await item.page.getByTestId('game-stats-overlay').boundingBox(),badge=await bar.boundingBox();assert(panel.y>=badge.y+badge.height,'clock remains above the summary overlay');
        assert.deepEqual(item.errors,[]);assert.deepEqual(item.writes,[]);
        await item.context.close();passed++;
      }
      for(const state of ['offer','auto','pending']){
        const item=await fixture(browser,'callbreak',4,width,state==='offer',s=>{
          s.session={...base(),controls:[{seat_id:1,user_id:state==='auto'?'u0':'u4',original_user_id:'u0',
            mode:state==='auto'?'auto':'replacement',disconnected_at:null,return_pending:state==='pending'}]};
          if(state==='offer')s.session.replacement_offer={seat_id:1,expires_at:Date.now()/1000+60};
          else s.session.reclaim={seat_id:1,pending:state==='pending'};
        });
        const bar=item.page.getByTestId('game-session-status');
        const box=await bar.boundingBox();assert(box.x>=0 && box.x+box.width<=width+1 && box.height<=221);
        if(state==='offer'){
          assert.match(await bar.textContent(),/settlement remain with the original participant/);
          await item.page.getByRole('button',{name:'Accept temporary seat'}).click();
          assert(item.writes.some(p=>p.endsWith('/table/accept-live-seat')));
        }else if(state==='auto'){
          assert.match(await bar.textContent(),/Auto play/);
          await item.page.getByRole('button',{name:'Resume my seat'}).click();
          assert(item.writes.some(p=>p.endsWith('/table/reclaim-seat')));
        }else{
          assert.match(await bar.textContent(),/end of this trick/);
          assert.equal(await item.page.getByRole('button',{name:'Resume my seat'}).count(),0);
        }
        assert.deepEqual(item.errors,[]);
        await item.context.close();passed++;
      }
    }
    for(const state of ['idle','warning','waiting','none']){
      const item=await fixture(browser,'callbreak',4,390,false,s=>{
        s.session={...base()};
        if(state==='idle')s.session.idle_deadline=Date.now()/1000+1800;
        if(state==='warning')s.session.required_actions=[{seat_id:1,user_id:'u0',deadline:Date.now()/1000+25}];
        if(state==='waiting')s.session.required_actions=[{seat_id:1,user_id:'u0',deadline:Date.now()/1000-1}];
      });
      const clock=item.page.getByTestId('game-session-clock');
      if(state==='none')assert.equal(await clock.count(),0);
      else{
        await clock.waitFor();const time=item.page.getByTestId('session-countdown');
        if(state==='waiting'){assert.equal(await time.textContent(),'0:00');assert.match(await clock.getAttribute('aria-label'),/Waiting for server/);}
        else if(state==='warning'){assert.match(await clock.getAttribute('aria-label'),/left to act/);assert.equal(await time.evaluate(el=>getComputedStyle(el).color),'rgb(255, 157, 171)');}
        else{
          assert.match(await clock.getAttribute('aria-label'),/inactivity/);
          const before=await time.textContent();await item.page.waitForFunction(before=>document.querySelector('[data-testid="session-countdown"]').textContent!==before,before);
        }
      }
      assert.deepEqual(item.errors,[]);assert.deepEqual(item.writes,[]);await item.context.close();passed++;
    }
    for(const reason of ['expired','removed']){
      const item=await fixture(browser,'callbreak',4,320,false,s=>{s.session=base();});
      item.change(s=>{
        s.game.revision++;
        if(reason==='expired'){
          s.status='ended';s.table.phase='ENDED';s.table.seated_players=[];s.tables=[];
          s.session.expired_at=Date.now()/1000;
        }else{
          s.your_player_id=null;s.private=null;s.session.removal_reason='ACTION_TIMEOUT';
          s.table.seated_players=s.table.seated_players.filter(p=>p.user_id!=='u0');
        }
      });
      await item.page.getByTestId('live-game-overlay').waitFor({state:'hidden'});
      try{await item.page.getByText(reason==='expired'?/expired after 30 minutes/:/timed out after 3 minutes/).waitFor();}
      catch(error){await item.page.screenshot({path:`/private/tmp/bhidne-summary-clock-${reason}.png`});console.error(await item.page.locator('body').innerText());throw error;}
      assert.deepEqual(item.errors,[]);assert.deepEqual(item.writes,[]);
      await item.context.close();passed++;
    }
    console.log(`${passed} session UI cases passed.`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
