const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8099';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280])for(const empty of [false,true]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  const session={user_id:'u0',token:'mock'},room={room_id:'r',name:'Ekraj room',creator_id:'u0',members:['u0'],visibility:'public'};
  const tables=[{room_id:'r',room_name:room.name,match_id:'older',name:'Old flush',game_type:'flush',status:'waiting',players:1,seated_players:[{seat_id:0,display_name:'Ekraj'}],capacity:10,current_user:{can_join:true},created_at:1},
   {room_id:'r',room_name:room.name,match_id:'newer',name:'Full marriage',game_type:'marriage',status:'playing',players:5,capacity:5,current_user:{can_join:false},created_at:3}];
  let invites=[{id:'invite',room_id:'r',room_name:room.name,match_id:'invited',table_name:'Invited Call Break',game_type:'callbreak',created_at:5,seated:1,capacity:4,seat_available:true}];
  const writes=[],searches=[];
  await context.addInitScript(({site,session})=>{if(!sessionStorage.getItem('bhidne.session.v1:'+site))sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session,room:null,game:null}));},{site,session});
  await context.route(site+'/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path==='/'||path.startsWith('/_expo/')||path.startsWith('/assets/')||path==='/favicon.ico')return route.continue();
   let result=[];
   if(req.method()==='POST')writes.push({path,body:req.postDataJSON()});
   if(path==='/auth/me')result={user_id:'u0',display_name:'Ekraj',username:'ekraj'};
   else if(path==='/rooms')result=req.method()==='POST'?room:(empty?[]:[room]);
   else if(path==='/active-tables')result=tables.filter(t=>t.match_id!=='invited');
   else if(path==='/test-games/invitations')result=invites;
   else if(path==='/test-games/invitations/invite/decline'){invites=[];result={};}
   else if(path==='/players/search'||path==='/players/directory'){
    const query=new URL(req.url()).searchParams.get('q');searches.push(query);
    if(query==='slow'){await new Promise(resolve=>setTimeout(resolve,500));result=[{user_id:'slow',display_name:'Slow Player'}];}
    else result=[{user_id:'u1',display_name:'Sigma',username:'sigma'},{user_id:'u0',display_name:'Sigma Self',username:'sigma-self'}];
   }
   else if(path==='/rooms/r')result=room;
   else if(path==='/rooms/r/enter')result=room;
   else if(path==='/test-games/r'&&req.method()==='POST')result={room_id:'r',match_id:'created',game_type:'callbreak',players:[],status:'waiting',tables:[],capacity:5};
   else if(path==='/test-games/r')result={room_id:'r',match_id:'created',game_type:'callbreak',players:[],status:'empty',tables:[],capacity:4};
   await route.fulfill({json:result});
  });
  await context.routeWebSocket(site.replace('http','ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.goto(site);
  const feed=page.getByTestId('active-games');await feed.getByTestId('play-table-invited').waitFor();
  assert.deepEqual(await feed.getByTestId(/^play-table-/).evaluateAll(nodes=>nodes.map(n=>n.dataset.testid)),['play-table-invited','play-table-newer','play-table-older']);
  const nav=page.getByTestId('lobby-navigation');assert.deepEqual(await nav.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))),['Home','Friends','Chat']);
  await feed.getByRole('button',{name:'Watch · Full marriage',exact:true}).waitFor();await feed.getByRole('button',{name:'Join · Old flush',exact:true}).waitFor();
  const oldCard=feed.getByTestId('play-table-older');
  assert.equal(await oldCard.locator('img').count(),1);
  const joinButton=oldCard.getByRole('button',{name:'Join · Old flush',exact:true});
  const discardButton=oldCard.getByRole('button',{name:'Discard · Old flush',exact:true});
  const joinRect=await joinButton.boundingBox(),discardRect=await discardButton.boundingBox();
  assert.ok(discardRect.y>=joinRect.y+joinRect.height);
  assert.ok(Math.abs(discardRect.x-joinRect.x)<2);
  const borders=await Promise.all([joinButton,discardButton].map(button=>button.evaluate(node=>getComputedStyle(node).borderColor)));
  assert.deepEqual(borders,['rgb(213, 161, 42)','rgb(213, 161, 42)']);
  assert.equal(await feed.getByText('Open',{exact:true}).count(),0);assert.equal(await feed.getByText('Share',{exact:true}).count(),0);
  await feed.getByRole('button',{name:'Discard · Invited Call Break',exact:true}).click();await feed.getByTestId('play-table-invited').waitFor({state:'hidden'});
  await page.reload();await feed.getByTestId('play-table-older').waitFor();assert.equal(await feed.getByTestId('play-table-invited').count(),0);
  await page.screenshot({path:`/private/tmp/bhidne-play-feed-${width}.png`,fullPage:true});
  const createBounds=await feed.getByTestId('play-create-table').boundingBox(),filterBounds=await feed.getByRole('tab',{name:/^All/}).boundingBox();const headingBounds=await feed.getByRole('heading',{name:'Available tables',exact:true}).boundingBox();assert.ok(createBounds.y+createBounds.height<=headingBounds.y);assert.ok(headingBounds.y+headingBounds.height<=filterBounds.y);
  assert.equal(await feed.getByTestId('play-players-older').getByText('E',{exact:true}).count(),1);
  const nameStyles=await feed.getByTestId('play-table-older').evaluate(node=>['Ekraj room','Old flush'].map(text=>{const element=[...node.querySelectorAll('*')].find(el=>el.textContent===text);const style=getComputedStyle(element);return {color:style.color,fontStyle:style.fontStyle};}));assert.ok(nameStyles.every(style=>style.fontStyle==='italic'));assert.notEqual(nameStyles[0].color,nameStyles[1].color);
  assert.equal(await feed.getByTestId('play-create-table').evaluate(node=>getComputedStyle(node).boxShadow),'none');
  assert.ok(await feed.getByTestId(/^play-table-/).evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().right<=innerWidth))); 
  await page.getByRole('tab',{name:'Rooms',exact:true}).click();await page.getByRole('tab',{name:'Your rooms',exact:true}).waitFor();await page.getByRole('tab',{name:/Friends.*rooms/,exact:true}).click();
  await page.getByRole('tab',{name:'Create Room or Join',exact:true}).waitFor();await page.getByRole('tab',{name:'Play',exact:true}).click();
  await feed.getByRole('button',{name:'Create your own game table',exact:true}).click();
  const sheet=page.getByTestId('create-game-table');await sheet.waitFor();
  assert.equal(await sheet.getByRole('tab').count(),3);assert.equal(await sheet.getByRole('tab').locator('img').count(),3);assert.equal(await sheet.getByText(/Choose a game, name your table/).count(),0);
  assert.equal(await sheet.getByRole('button',{name:'Select room',exact:true}).count(),empty?0:1);
  await sheet.getByRole('tab',{name:'Call Break',exact:true}).click();
  const four=sheet.getByRole('radio',{name:'4 players',exact:true}),five=sheet.getByRole('radio',{name:'5 players',exact:true});
  assert.equal(await four.getAttribute('aria-checked'),'true');await five.click();assert.equal(await five.getAttribute('aria-checked'),'true');
  await sheet.getByRole('tab',{name:'Marriage',exact:true}).click();assert.equal(await sheet.getByRole('radio').count(),0);
  if(empty){await sheet.getByRole('tab',{name:'Call Break',exact:true}).click();if(width===390)await four.click();}
  const chosen=empty?'callbreak':'marriage';
  await sheet.getByLabel('Table name',{exact:true}).fill('Friday table');
  const input=sheet.getByLabel('Find player to invite',{exact:true});
  await input.fill('si');await page.waitForTimeout(400);assert.equal(searches.length,0);assert.equal(await sheet.getByTestId('invite-player-suggestions').count(),0);
  await input.fill('sig');await sheet.getByRole('button',{name:'Invite Sigma',exact:true}).waitFor();assert.equal(await sheet.getByRole('button',{name:'Invite Sigma Self',exact:true}).count(),0);
  await sheet.getByRole('button',{name:'Invite Sigma',exact:true}).click();assert.equal(await input.inputValue(),'');await sheet.getByTestId('selected-invite-players').waitFor();
  await input.fill('sig');await page.waitForTimeout(400);assert.equal(await sheet.getByRole('button',{name:'Invite Sigma',exact:true}).count(),0);
  await sheet.getByRole('button',{name:'Remove Sigma',exact:true}).click();await sheet.getByRole('button',{name:'Invite Sigma',exact:true}).waitFor();
  await input.fill('slow');await page.waitForTimeout(300);await input.fill('sig');await page.waitForTimeout(700);assert.equal(await sheet.getByRole('button',{name:'Invite Slow Player',exact:true}).count(),0);
  await sheet.getByRole('button',{name:'Invite Sigma',exact:true}).click();
  const suggestionBounds=await input.boundingBox(),selectedBounds=await sheet.getByTestId('selected-invite-players').boundingBox();assert.ok(selectedBounds.y>=suggestionBounds.y+suggestionBounds.height);
  await page.screenshot({path:`/private/tmp/bhidne-play-lobby-${width}-${empty?'default':'existing'}.png`});
  await sheet.getByRole('button',{name:'Create table',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="create-game-table"]'));
  const creation=writes.find(w=>w.path==='/test-games/r');assert.deepEqual(creation.body,{game_type:chosen,...(empty?{player_count:width===390?4:5}:{}),name:'Friday table',invitees:['u1'],notify_room:true});
  const roomCreation=writes.find(w=>w.path==='/rooms');assert.equal(!!roomCreation,empty);if(empty)assert.equal(roomCreation.body.name,'Ekraj-Room');
  await page.evaluate(({site,session,room})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session,room,game:'marriage'})),{site,session,room});
  await page.goto(site);await page.getByRole('button',{name:'Create table',exact:true}).click();
  await page.getByRole('heading',{name:'Create table',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Select room',exact:true}).count(),0);
  await page.getByRole('tab',{name:'Marriage',exact:true}).locator('img').waitFor({state:'attached'});assert.equal(await page.getByRole('tab',{name:'Marriage',exact:true}).locator('img').count(),1);
  await page.getByRole('tab',{name:'Marriage',exact:true}).click();assert.equal(await page.getByRole('radio').count(),0);
  await page.getByRole('tab',{name:'Flush',exact:true}).click();assert.equal(await page.getByRole('radio').count(),0);
  await page.getByRole('tab',{name:'Call Break',exact:true}).click();await page.getByRole('radio',{name:'5 players',exact:true}).click();
  const roomInput=page.getByLabel('Find player to invite',{exact:true});await roomInput.fill('sig');await page.getByRole('button',{name:'Invite Sigma',exact:true}).click();
  await page.getByRole('button',{name:'Remove Sigma',exact:true}).click();await roomInput.fill('sig');await page.getByRole('button',{name:'Invite Sigma',exact:true}).click();
  await page.getByLabel('Table name',{exact:true}).fill('Room table');
  await page.screenshot({path:`/private/tmp/bhidne-room-create-${width}.png`});
  await page.getByRole('button',{name:'Create this table',exact:true}).click();
  await page.waitForTimeout(300);
  assert.deepEqual(writes.filter(w=>w.path==='/test-games/r').at(-1).body,{game_type:'callbreak',player_count:5,name:'Room table',invitees:['u1'],notify_room:true});
  assert.deepEqual(errors,[]);console.log(`${width}px ${empty?'default':'existing'} room: feed, navigation, default room, 4/5 choice, live suggestions, stale cancellation and removable invitees passed`);
  await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
