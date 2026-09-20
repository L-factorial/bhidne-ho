// Requires fixtures exported by scripts/social_browser_fixtures.py and a web export.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const site = process.env.TEST_WEB_URL || 'http://localhost:8087';
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  for (const kind of ['callbreak','marriage','flush']) {
   const snapshot = JSON.parse(fs.readFileSync(`/tmp/bhidne-social-${kind}.json`));
   const room = {room_id:'room',name:'Social room',members:['u0','u1','u2','u3'],connected_members:['u0','u1','u2','u3']};
   if (kind === 'callbreak') {
    snapshot.game.phase='PLAYING'; snapshot.game.turn={player_id:1}; snapshot.game.current_trick={trick_number:1,plays:[],complete:false};
    snapshot.private={hand:['AS','KS','QH','2C'],legal_cards:['AS','KS'],can_accept_hand:false,can_claim_redeal:false};
    snapshot.deal={deal_number:1,attempt:1,dealer:1,tricks_completed:0,tricks_required:13,tricks:[],players:snapshot.players.map(p=>({player_id:p.player_id,bid:2,tricks_won:0,cards_remaining:4}))};
   }
   snapshot.players.forEach((p,i)=>p.display_name=['Ram','Hari','Krishna','Shiva'][i]);
   let socket;
   const commands=[], gameplay=[], history=[], errors=[];
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
   await context.addInitScript(({room,site,kind})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:{user_id:'u0',token:'mock'},room,game:kind})),{room,site,kind});
   await context.route(site+'/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/' || path.startsWith('/_expo/') || path.startsWith('/assets/') || path==='/favicon.ico')return route.continue();
    let data=[];
    if(path==='/rooms') data=[room];
    if(path.startsWith('/test-games/')) {data=snapshot;if(path.endsWith('/action'))gameplay.push(route.request().postDataJSON());}
    await route.fulfill({json:data});
   });
   await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{
    socket=ws; ws.send(JSON.stringify({type:'CONNECTED'}));
    ws.onMessage(raw=>{
     const command=JSON.parse(raw);
     if(command.type==='HEARTBEAT'){ws.send(JSON.stringify({type:'HEARTBEAT_ACK'}));return;}
     commands.push(command);
     const ack={type:'TABLE_SOCIAL_ACK',room_id:'room',match_id:snapshot.match_id,command_id:command.command_id,status:'accepted'};
     if(command.type==='TABLE_CHAT_HISTORY')ack.messages=history;
     if(command.type==='TABLE_CHAT_SEND') {
      const message={type:'TABLE_CHAT_MESSAGE',id:command.command_id,room_id:'room',match_id:snapshot.match_id,sender_id:'u0',sender_player_id:1,sender_name:'Ram',text:command.payload.text,sent_at:Date.now()};
      history.push(message);ws.send(JSON.stringify(message));ack.message=message;
     }
     ws.send(JSON.stringify(ack));
    });
   });
   const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(site);await page.getByRole('button',{name:/Return to table/}).first().click();
   const button=name=>page.getByRole('button',{name,exact:true});
   const pill=page.getByTestId('game-social-controls');await pill.waitFor();
   await button('Table menu').click();
   await page.getByTestId(kind+'-menu-drawer').getByRole('button',{name:'Table Chat',exact:true}).click();
   await page.getByTestId('table-chat-panel').waitFor();
   await page.getByTestId(kind+'-menu-drawer').waitFor({state:'hidden'});
   await page.keyboard.press('Escape');assert.ok(await pill.isVisible(),'Escape closes chat without leaving the game');
   assert.equal(await page.getByTestId('table-chat-panel').count(),0);
   await button('Table Chat').click();await page.getByLabel('Table message',{exact:true}).fill('Nice hand');await button('Send table message').click();
   await page.getByTestId('table-chat-messages').getByText('Nice hand',{exact:true}).waitFor();
   assert.equal(commands.filter(c=>c.type==='TABLE_CHAT_SEND').length,1);
   // Exercise the shared composer under constrained available height, without pretending
   // a browser viewport resize is an actual native keyboard test.
   for (let i=0;i<35;i++) socket.send(JSON.stringify({type:'TABLE_CHAT_MESSAGE',id:`scroll-${i}`,room_id:'room',match_id:snapshot.match_id,sender_id:'u1',sender_player_id:2,sender_name:'Hari',text:`Earlier message ${i}`,sent_at:Date.now()}));
   for (const viewport of [{width:390,height:844},{width:390,height:480},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);
    const input=page.getByLabel('Table message',{exact:true});
    assert.equal(await button('Send table message').isDisabled(),true);
    await input.fill('x'.repeat(510));
    assert.equal((await input.inputValue()).length,500);
    await page.getByText('500/500',{exact:true}).waitFor();
    await input.fill('Keyboard layout check\nSecond line\nThird line\nFourth line');
    const composer=page.getByTestId('table-chat-composer');
    await composer.waitFor();
    await page.waitForTimeout(150);
    const a=await input.boundingBox(), b=await button('Send table message').boundingBox(), panel=await page.getByTestId('table-chat-panel').boundingBox();
    assert.ok(a.x+a.width<=b.x && Math.abs(a.y+a.height-b.y-b.height)<2,'input and Send share one composer row');
    assert.ok(b.y+b.height<=panel.y+panel.height && panel.y>=0 && panel.y+panel.height<=viewport.height,'Send and header stay within the available viewport');
    const list=page.getByTestId('table-chat-messages');
    assert.ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight),'message list remains scrollable');
    await list.evaluate(el=>{el.scrollTop=0;});
    await button('Send table message').click();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Table message"]').value==='');
    assert.equal(await input.evaluate(el=>document.activeElement===el),true,'sending preserves input focus');
    await button('Close table chat').click();
    await page.getByTestId('table-chat-panel').waitFor({state:'hidden'});
    await pill.getByRole('button',{name:/^Table Chat/}).click();
    await page.getByTestId('table-chat-panel').waitFor();
   }
   await page.setViewportSize({width:390,height:844});
   await button('Close table chat').click();
   socket.send(JSON.stringify({type:'TABLE_CHAT_MESSAGE',id:'incoming',room_id:'room',match_id:snapshot.match_id,sender_id:'u1',sender_player_id:2,sender_name:'Hari',text:'Hello table',sent_at:Date.now()}));
   await page.getByTestId('table-chat-unread').waitFor();await page.getByTestId('seat-social-2').getByText('Hello table').waitFor();
   await page.getByRole('button',{name:'Table Chat, 1 unread',exact:true}).click();assert.equal(await page.getByTestId('table-chat-unread').count(),0);await button('Close table chat').click();
   await button('Poke a player').click();
   assert.equal(await page.getByRole('button',{name:/^Poke Ram/}).count(),0);
   await page.getByRole('button',{name:/^Poke Hari/}).click();
   assert.equal(commands.filter(c=>c.type==='TABLE_POKE_SEND').length,1);
   assert.equal(commands.find(c=>c.type==='TABLE_POKE_SEND').payload.recipient_player_id,2);
   await button('Poke a player').click(); await page.mouse.click(10,100);
   assert.equal(await page.getByRole('button',{name:/^Poke Hari/}).count(),0);
   if(kind==='callbreak') {
    await button('Flip all cards').click();await button('Select AS').click();
   }
   socket.send(JSON.stringify({type:'ROOM_POKE',id:'poke',room_id:'room',match_id:snapshot.match_id,sender_id:'u1',sender_player_id:2,recipient_id:'u0',recipient_player_id:1,scope:'private',text:'👋',expires_at:Date.now()+5000}));
   await page.getByTestId('seat-social-1').waitFor();
   if(kind==='callbreak')assert.ok(await button('Play AS').isVisible());
   assert.equal(gameplay.length,0,'social interactions must never submit gameplay commands');
   for(const viewport of [{width:390,height:844},{width:320,height:568},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);await page.waitForTimeout(200);
    const dock=page.getByTestId(kind==='callbreak'?'callbreak-mobile-hand':kind==='marriage'?'marriage-mobile-hand':'flush-hand-dock');
    if(await dock.count()) {
     const p=await pill.boundingBox(),d=await dock.boundingBox();
     assert.ok(p.y+p.height <= d.y-10,`${kind}: pill stays above the hand`);
     assert.ok(p.y>=0 && p.x>=0 && p.x+p.width<=viewport.width,`${kind}: pill stays in viewport`);
    }
   }
   await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(300);
   if(kind === 'callbreak' || kind === 'marriage') {
    if(await button('Collapse your card area').count()) await button('Collapse your card area').click();
    await page.waitForTimeout(200);
    const before=await pill.boundingBox();
    await button('Expand your card area').click();await page.waitForTimeout(250);
    const after=await pill.boundingBox();assert.ok(after.y<before.y,'pill follows expanded hand');
    const dock=await page.getByTestId(kind+'-mobile-hand').boundingBox();assert.ok(after.y+after.height<=dock.y-10);
    if(kind==='marriage') await button('Collapse your card area').click();
   }
   for(const mode of ['dark','light']) {await page.emulateMedia({colorScheme:mode});await page.screenshot({path:`/tmp/social-${kind}-${mode}.png`});}
   snapshot.table.current_user.is_seated=false; snapshot.table.current_user.is_queued=true;
   snapshot.your_player_id=null; snapshot.table.current_user.seat_id=null;
   await page.waitForTimeout(1200);
   await button('Table Chat').click();
   await page.getByText('Waiting players can read. Take a seat to chat.').waitFor();
   assert.equal(await button('Send table message').count(),0);await button('Close table chat').click();
   assert.ok(await button('Poke a player').isDisabled());
   snapshot.table.current_user.is_queued=false; await page.waitForTimeout(1200);
   assert.equal(await pill.count(),0,'unrelated spectators have no table social controls');
   assert.deepEqual(errors,[]);
   await context.close(); console.log(kind+' social UI passed');
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
