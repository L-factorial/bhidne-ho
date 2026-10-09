const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./game-stats.cjs');
const base=()=>({server_now:Date.now()/1000,idle_deadline:null,expired_at:null,removal_reason:null,
  controls:[],required_actions:[],replacement_offer:null,reclaim:null});
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
  let passed=0;
  try{
    for(const width of [320,390,1280]){
      for(const kind of ['callbreak','marriage','flush']){
        const item=await fixture(browser,kind,4,width,false,s=>{
          s.session={...base(),required_actions:[{seat_id:1,user_id:'u0',deadline:Date.now()/1000+25}]};
        });
        const bar=item.page.getByTestId('game-session-status');
        assert.match(await bar.textContent(),/left to act/);
        const box=await bar.boundingBox();assert(box.x>=0 && box.x+box.width<=width+1);
        assert(box.height<=221);
        await item.page.getByTestId('game-stats-toggle').click();
        assert(await bar.isVisible());
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
      await item.page.getByText(reason==='expired'?/expired after 30 minutes/:/timed out after 3 minutes/).waitFor();
      assert.deepEqual(item.errors,[]);assert.deepEqual(item.writes,[]);
      await item.context.close();passed++;
    }
    console.log(`${passed} session UI cases passed.`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
