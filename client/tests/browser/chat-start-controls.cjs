const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {for(const kind of ['flush','marriage','callbreak'])for(const width of [320,390,1280]){
  const f=await fixture(browser,kind,4,width,false,s=>{
   s.status='waiting';s.game=null;s.deal=null;s.private=null;s[kind]=null;s.round_review=null;
   s.table.phase='OPEN';s.table.current_user.can_start=true;s.is_creator=true;
  });
  const start=f.page.getByRole('button',{name:'Start game',exact:true});
  await start.waitFor();await start.evaluate(el=>new Promise((resolve,reject)=>{const t=setInterval(()=>{if(el.getAttribute('aria-disabled')!=='true'){clearInterval(t);resolve();}},50);setTimeout(()=>{clearInterval(t);reject(new Error('Start remains disabled'));},8000);}));assert.equal(await start.isDisabled(),false);
  assert.equal(await f.page.getByRole('button',{name:'Lock players',exact:true}).count(),0);
  let calls=0,release;
  await f.context.route(site+'/test-games/room/start',async route=>{
   calls++;await new Promise(resolve=>{release=resolve;});await route.fulfill({status:409,json:{detail:'Test rejection'}});
  });
  await start.click();const pending=f.page.getByRole('button',{name:'Starting game…',exact:true});
  await pending.waitFor();assert.equal(await pending.isDisabled(),true);assert.equal(calls,1);
  release();await start.waitFor();await start.evaluate(el=>new Promise((resolve,reject)=>{const t=setInterval(()=>{if(el.getAttribute('aria-disabled')!=='true'){clearInterval(t);resolve();}},50);setTimeout(()=>{clearInterval(t);reject(new Error('Start remains disabled'));},8000);}));assert.equal(await start.isDisabled(),false);
  assert.deepEqual(f.errors,[]);await f.context.close();
  const other=await fixture(browser,kind,4,width,false,s=>{
   s.is_creator=false;s.can_end_table=false;s.status='waiting';s.game=null;s.deal=null;s.private=null;s[kind]=null;s.round_review=null;
   s.table.phase='OPEN';s.table.current_user.seat_id=2;s.table.current_user.can_start=false;
  });
  assert.equal(await other.page.getByRole('button',{name:'Start game',exact:true}).count(),0);
  await other.page.getByText(/Waiting for .* to start\./).waitFor();
  await other.page.getByRole('button',{name:'Table menu',exact:true}).click();
  const menu=other.page.getByTestId(`${kind}-menu-drawer`);
  const end=menu.getByRole('button',{name:'End game, Only the creator can end the game.',exact:true});
  await end.waitFor();assert.equal(await end.isDisabled(),true);
  assert.deepEqual(other.errors,[]);await other.context.close();
  const chat=await fixture(browser,kind,4,width,false,undefined,[{type:'TABLE_CHAT_MESSAGE',id:'chat-test',sender_id:'u1',sender_name:'Friend',text:'A table message',ephemeral:true,sent_at:Date.now()}]);
  await chat.page.getByRole('button',{name:'Table menu',exact:true}).click();
  await chat.page.getByTestId(`${kind}-menu-drawer`).getByRole('button',{name:'Table Chat',exact:true}).click();
  const panel=chat.page.getByTestId('table-chat-panel');await panel.getByText('A table message',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'Report player',exact:true}).count(),0);
  await panel.getByRole('button',{name:'Message actions',exact:true}).click();
  const report=chat.page.getByRole('button',{name:'🚩 Report player',exact:true});
  await report.waitFor();
  await report.click();
  await chat.page.getByText('Friend',{exact:true}).last().waitFor();
  assert.deepEqual(chat.errors,[]);await chat.context.close();
  if(width===390&&kind!=='flush'){
   let next;const replay=await fixture(browser,kind,4,width,false,s=>{
    s.status='finished';s.game.finished=true;s.table.phase='COMPLETED';s.table.current_user.can_next_match=true;
    next=structuredClone(s);next.match_id='next-fixture';next.status='waiting';next.game=null;next.deal=null;next.private=null;next[kind]=null;
    next.table.phase='OPEN';next.table.current_user.can_start=true;next.table.current_user.can_next_match=false;
   });
   const calls=[];
   await replay.context.route(site+'/test-games/room/table/next-match',async route=>{calls.push(['next-match',route.request().postDataJSON()]);await route.fulfill({json:next});});
   await replay.context.route(site+'/test-games/room/start',async route=>{calls.push(['start',route.request().postDataJSON()]);await route.fulfill({status:409,json:{detail:'Start rejected'}});});
   await replay.page.getByRole('button',{name:'Play again',exact:true}).click();
   await replay.page.getByRole('button',{name:'Start game',exact:true}).waitFor();
   assert.deepEqual(calls.map(c=>c[0]),['next-match','start']);assert.equal(calls[1][1].match_id,'next-fixture');
   assert.deepEqual(replay.errors,[]);await replay.context.close();
  }
  console.log(`PASS ${kind} ${width}: one-step start, busy/rejection recovery, observer cue and disabled end`);
 }} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
