// Isolated browser fixtures; never sends messages or writes to a live service.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
const widths=(process.env.TEST_WIDTHS||'320,390,1280').split(',').map(Number);
const output=process.env.SCREENSHOT_DIR||'/private/tmp/bhidne-chat-table-preview';
require('node:fs').mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const kind of ['callbreak','marriage','flush'])for(const width of widths){
   const f=await fixture(browser,kind,4,width,false,s=>{s.table_id='table-current';s.table.table_id='table-current';});
   const rows=[{player_id:'u0',amount:15},{player_id:'u1',amount:-15},{player_id:'former',amount:0}];
   await f.context.route(site+'/rooms/room/ledger',route=>route.fulfill({json:{players:{u0:'Ekraj',u1:'Sigma',former:'Former player'},balances:[],tables:[
    {table_id:'table-current',balances:rows,record_balances:rows,games:[{game_id:'first',balances:[{player_id:'u0',amount:20},{player_id:'u1',amount:-20}]},{game_id:'second',balances:[{player_id:'u0',amount:-5},{player_id:'u1',amount:5}]}]},
    {table_id:'other-table',balances:[{player_id:'stranger',amount:999}],games:[]}
   ]}}));
   await f.page.getByTestId('table-summary-toggle').click();
   const summary=f.page.getByTestId('table-summary');await summary.getByTestId('table-summary-totals').waitFor();
   assert.match(await summary.innerText(),/Former player/);assert.equal(await summary.getByText('999',{exact:true}).count(),0);
   assert.equal(await summary.getByTestId('table-summary-game-1').getByTestId('result-value-u0-0').innerText(),'+20');
   assert.equal(await summary.getByTestId('table-summary-game-2').getByTestId('result-value-u0-0').innerText(),'-5');
   if(width===390)await f.page.screenshot({path:`${output}/${kind}-table-summary.png`});
   await summary.getByRole('button',{name:'Close',exact:true}).click();
   await f.page.getByTestId('game-stats-toggle').click();await f.page.getByTestId('game-stats-overlay').waitFor();
   assert.deepEqual(f.errors,[]);await f.context.close();
  }
  for(const width of widths){
   const f=await fixture(browser,'marriage',4,width,false,s=>{
    const own=s.marriage.public.players[0];own.route='normal';own.has_seen_maal=true;own.shown_melds=[{meld_type:'sequence',card_ids:['D0:2S','D0:3S','D0:4S']}];
    s.marriage.private.maal={tiplu:{rank:3,suit:'D'},jhiplu:{rank:2,suit:'D'},poplu:{rank:4,suit:'D'}};
    s.marriage.public.current_player_id='1';s.marriage.public.phase='must_draw';
   });
   // Dismiss the normal Maal announcement before opening the hand.
   const announcement=f.page.getByTestId('marriage-announcement');
   if(await announcement.count())await announcement.getByRole('button',{name:'Back to table',exact:true}).click();
   const maal=f.page.getByTestId('marriage-see-maal-step');await maal.waitFor();await maal.getByTestId('marriage-see-maal-card').click();await maal.getByRole('button',{name:'Continue',exact:true}).click();
   const expand=f.page.getByTestId('hand-attention-collapsed');if(await expand.count())await expand.click();
   const reveal=f.page.getByRole('button',{name:'Reveal cards',exact:true});if(await reveal.count())await reveal.click();
   const shown=f.page.getByRole('button',{name:'View shown sequence',exact:true});await shown.waitFor();
   const eligibility=f.page.getByTestId('marriage-win-eligibility');await eligibility.waitFor();
   const a=await shown.boundingBox(),b=await eligibility.boundingBox();assert.ok(a.x+a.width<=b.x+1);assert.ok(Math.abs(a.y-b.y)<12);
   if(width===390)await f.page.screenshot({path:`${output}/marriage-button-row.png`});
   assert.deepEqual(f.errors,[]);await f.context.close();
  }
  for(const width of widths){
   const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[],writes=[];
   page.on('pageerror',e=>errors.push(e.message));
   await context.addInitScript(site=>{
    localStorage.setItem('bhidne.language','en');
    sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'}}));
   },site);
   const friend={user_id:'u1',display_name:'Sigma',username:'sigma'};
   await context.route(site+'/**',async route=>{
    const req=route.request(),p=new URL(req.url()).pathname;
    if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
    let body=[];
    if(p==='/auth/me'||p==='/me/profile')body={user_id:'u0',display_name:'Ekraj',username:'ekraj'};
    else if(p==='/auth/safety/capabilities')body={blocking:false,reporting:true};
    else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
    else if(p==='/rooms')body=[{room_id:'room',name:'Chat room',creator_id:'u0',members:['u0','u1'],connected_members:['u0','u1']}];
    else if(p==='/rooms/room'||p==='/rooms/room/enter')body={room_id:'room',name:'Chat room',creator_id:'u0',members:['u0','u1'],connected_members:['u0','u1'],is_member:true};
    else if(p==='/rooms/room/members')body=[{user_id:'u0',display_name:'Ekraj'},friend];
    else if(p==='/rooms/room/chat')body=[{id:'room-message',sender_id:'u1',sender_name:'Sigma',text:'Room hello',sent_at:Date.now()}];
    else if(p==='/friends')body={friends:[friend,{user_id:'u2',display_name:'Ray',username:'ray'}],incoming:[],outgoing:[],online_friend_ids:['u2']};
    else if(p==='/friends/conversations')body=[{id:'old',user_id:'u1',sender_id:'u1',text:'Hello Ekraj',sent_at:Date.now()}];
    else if(p==='/friends/u1/messages'){
     if(req.method()==='POST'){writes.push(req.postDataJSON());body={id:'sent',sender_id:'u0',recipient_id:'u1',text:req.postDataJSON().text,sent_at:Date.now()};}
     else body=[{id:'old',sender_id:'u1',recipient_id:'u0',text:'Hello Ekraj',sent_at:Date.now()}];
    }
    await route.fulfill({json:body});
   });
   await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(raw=>{const message=JSON.parse(raw);if(message.type==='HEARTBEAT')ws.send(JSON.stringify({type:'HEARTBEAT_ACK'}));});});
   await page.goto(site);await page.getByRole('tab',{name:'Chat',exact:true}).click();
   await page.getByTestId('chat-friend-search').waitFor();
   assert.equal(await page.getByText('Chat privately with your online friends.',{exact:true}).count(),0);
   await page.getByTestId('chat-table-separator').waitFor();
   await page.getByTestId('chat-friend-search').fill('not-a-friend');assert.equal(await page.getByRole('button',{name:'Chat with Sigma',exact:true}).count(),0);
   await page.getByTestId('chat-friend-search').fill('ray');await page.getByRole('button',{name:'Chat with Ray',exact:true}).waitFor();
   await page.getByTestId('chat-friend-search').fill('sig');await page.getByRole('button',{name:'Chat with Sigma',exact:true}).waitFor();
   if(width===390){await page.getByTestId('chat-friend-search').fill('');await page.screenshot({path:`${output}/lobby-chat.png`});await page.getByTestId('chat-friend-search').fill('sig');}
   // Menu is independent of its enclosing conversation button.
   await page.getByRole('button',{name:'Player actions · Sigma',exact:true}).click();
   assert.equal(await page.getByRole('textbox',{name:'Message Sigma',exact:true}).count(),0);
   await page.getByRole('button',{name:'Message',exact:true}).click();
   const input=page.getByRole('textbox',{name:'Message Sigma',exact:true});await input.fill('Offline hello');
   const send=page.getByRole('button',{name:'Send privately',exact:true});assert.equal(await send.isDisabled(),false);const response=page.waitForResponse(r=>r.url()===site+'/friends/u1/messages'&&r.request().method()==='POST');await send.click();await response;
   await page.getByText('Offline hello',{exact:true}).waitFor();assert.deepEqual(writes,[{text:'Offline hello'}]);
   const time=page.getByTestId('chat-message-time').first();assert.equal(await time.evaluate(el=>getComputedStyle(el).fontSize),'10px');
   const timeBox=await time.boundingBox(),menuBox=await page.getByRole('button',{name:'Message actions',exact:true}).boundingBox();assert.ok(timeBox.y>=menuBox.y+menuBox.height);
   if(width===390)await page.screenshot({path:`${output}/offline-friend-chat.png`});
   await context.addInitScript(site=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'},room:{room_id:'room',name:'Chat room',creator_id:'u0',members:['u0','u1']}})),site);
   await page.reload();await page.screenshot({path:`${output}/room-entry.png`});await page.getByTestId('room-toolbar').getByRole('button',{name:'Room chat',exact:true}).click();
   const roomChat=page.getByTestId('room-chat-window');await roomChat.getByTestId('chat-table-separator').waitFor();
   await roomChat.getByText('Room hello',{exact:true}).waitFor();
   const people=await roomChat.getByTestId('room-chat-people').boundingBox(),history=await roomChat.getByTestId('room-chat-history').boundingBox();
   assert.ok(people.y+people.height<=history.y+1);
   if(width===390)await page.screenshot({path:`${output}/room-chat.png`});
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log(`Table summaries, Marriage row, room chat and offline friend chat passed at ${widths.join(', ')} pixels.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
