const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8099';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280])for(const empty of [false,true]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  const session={user_id:'u0',token:'mock'},room={room_id:'r',name:'Ekraj room',creator_id:'u0',members:['u0'],visibility:'public'};
  const tables=[{room_id:'r',room_name:room.name,match_id:'older',name:'Old flush',game_type:'flush',status:'waiting',players:1,capacity:10,current_user:{can_join:true},created_at:1},
   {room_id:'r',room_name:room.name,match_id:'newer',name:'Full marriage',game_type:'marriage',status:'playing',players:5,capacity:5,current_user:{can_join:false},created_at:3}];
  let invites=[{id:'invite',room_id:'r',room_name:room.name,match_id:'invited',table_name:'Invited Call Break',game_type:'callbreak',created_at:5,seated:1,capacity:4,seat_available:true}];
  const writes=[];
  await context.addInitScript(({site,session})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session,room:null,game:null})),{site,session});
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
   else if(path==='/players/directory')result=[{user_id:'u1',display_name:'Sigma'}];
   else if(path==='/rooms/r/enter')result=room;
   else if(path==='/test-games/r'&&req.method()==='POST')result={match_id:'created'};
   else if(path==='/test-games/r')result={room_id:'r',match_id:'created',game_type:'flush',players:[],status:'waiting',tables:[],capacity:10};
   await route.fulfill({json:result});
  });
  await context.routeWebSocket(site.replace('http','ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'})));});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.goto(site);
  const feed=page.getByTestId('active-games');await feed.getByTestId('play-table-invited').waitFor();
  assert.deepEqual(await feed.getByTestId(/^play-table-/).evaluateAll(nodes=>nodes.map(n=>n.dataset.testid)),['play-table-invited','play-table-newer','play-table-older']);
  const nav=page.getByTestId('lobby-navigation');assert.deepEqual(await nav.getByRole('tab').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))),['Home','Friends','Chat']);
  await feed.getByRole('button',{name:'Watch · Full marriage',exact:true}).waitFor();await feed.getByRole('button',{name:'Join · Old flush',exact:true}).waitFor();
  assert.equal(await feed.getByText('Open',{exact:true}).count(),0);assert.equal(await feed.getByText('Share',{exact:true}).count(),0);
  await feed.getByRole('button',{name:'Discard · Invited Call Break',exact:true}).click();await feed.getByTestId('play-table-invited').waitFor({state:'hidden'});
  await page.reload();await feed.getByTestId('play-table-older').waitFor();assert.equal(await feed.getByTestId('play-table-invited').count(),0);
  await page.screenshot({path:`/private/tmp/bhidne-play-feed-${width}.png`,fullPage:true});
  const createBounds=await feed.getByTestId('play-create-table').boundingBox(),filterBounds=await feed.getByRole('tab',{name:/^All/}).boundingBox();assert.ok(createBounds.y+createBounds.height<=filterBounds.y);
  assert.ok(await feed.getByTestId(/^play-table-/).evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().right<=innerWidth))); 
  await page.getByRole('tab',{name:'Rooms',exact:true}).click();await page.getByRole('tab',{name:'Your rooms',exact:true}).waitFor();await page.getByRole('tab',{name:/Friends.*rooms/,exact:true}).click();
  await page.getByRole('tab',{name:'Create Room or Join',exact:true}).waitFor();await page.getByRole('tab',{name:'Play',exact:true}).click();
  await feed.getByRole('button',{name:'Create your own game table',exact:true}).click();
  const sheet=page.getByTestId('create-game-table');await sheet.waitFor();
  await sheet.getByRole('tab',{name:'Marriage',exact:true}).click();await sheet.getByRole('tab',{name:'Flush',exact:true}).click();
  await sheet.getByLabel('Table name',{exact:true}).fill('Friday table');
  await sheet.getByLabel('Find player to invite',{exact:true}).fill('sigma');await sheet.getByRole('button',{name:'Search players',exact:true}).click();
  await sheet.getByRole('button',{name:'Invite Sigma',exact:true}).click();
  await page.screenshot({path:`/private/tmp/bhidne-play-lobby-${width}-${empty?'default':'existing'}.png`});
  await sheet.getByRole('button',{name:'Create table',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="create-game-table"]'));
  const creation=writes.find(w=>w.path==='/test-games/r');assert.deepEqual(creation.body,{game_type:'flush',player_count:10,name:'Friday table',invitees:['u1'],notify_room:true});
  const roomCreation=writes.find(w=>w.path==='/rooms');assert.equal(!!roomCreation,empty);if(empty)assert.equal(roomCreation.body.name,'Ekraj room');
  assert.deepEqual(errors,[]);console.log(`${width}px ${empty?'default':'existing'} room: feed, navigation, discard, overlay and invitation payload passed`);
  await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
