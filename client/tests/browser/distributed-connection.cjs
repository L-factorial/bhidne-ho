// Local distributed-original export; every API and WebSocket request is mocked.
// No production accounts, rooms, games, or commands are accessed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const site=(process.env.TEST_WEB_URL || 'http://127.0.0.1:8102').replace(/\/$/,'');
assert.ok(['localhost','127.0.0.1'].includes(new URL(site).hostname));
const snapshot=JSON.parse(fs.readFileSync((process.env.VIEW_FIXTURES || '/private/tmp/socket-browser-views')+'/callbreak.json'));
const user={user_id:snapshot.players[0].user_id,token:'socket-fixture-token'};
const room={room_id:snapshot.room_id,name:'Socket fixture',creator_id:user.user_id,visibility:'private',
 members:snapshot.players.map(p=>p.user_id),connected_members:snapshot.players.map(p=>p.user_id)};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const errors=[],external=[],reads=[],sockets=[];
 let rejectChat=false;
 try{
  await context.addInitScript(({site,user,room})=>{
   localStorage.setItem('bhidne.language','en');
   sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room,game:'callbreak'}));
  },{site,user,room});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   if(url.origin!==site){external.push(url.origin);return route.abort();}
   if(p==='/' || p.startsWith('/_expo/') || p.startsWith('/assets/') || p==='/favicon.ico')return route.continue();
   let body=[];
   if(p==='/distributed/streams/recipient')body={lane_id:'personal',target:{kind:'recipient',recipient_id:user.user_id.slice(5)}};
   else if(p==='/distributed/streams/social')body={items:[],next_lane_id:null};
   else if(p==='/distributed/streams/open'){const target=req.postDataJSON();body={lane_id:target.kind,target};}
   else if(p.includes('/history/'))body={items:[],next_sequence:null};
   else if(p.includes('/legacy/'))body={items:[],next_cursor:null};
   else if(p==='/distributed/ui/rooms')body={items:[room],next_room_id:null};
   else if(p==='/distributed/ui/memberships')body={items:[{...room,role:'owner'}],next_room_id:null};
   else if(p==='/distributed/ui/active-tables')body={items:[],next_room_id:null};
   else if(p.endsWith('/members'))body={items:snapshot.players,next_user_id:null};
   else if(p==='/distributed/room-invitations')body={items:[],next_id:null};
   else if(p==='/distributed/table-invitations')body={items:[],next_table_id:null};
   else if(p==='/distributed/friends')body={friends:[],incoming:[],outgoing:[]};
   else if(p===`/distributed/ui/rooms/${room.room_id}/game`){reads.push(Date.now());body=snapshot;}
   else if(p===`/distributed/rooms/${room.room_id}`){reads.push(Date.now());body={room_id:room.room_id,snapshot,tables:snapshot.tables};}
   else if(p===`/distributed/ui/rooms/${room.room_id}`)body={...room,is_member:true};
   else if(p==='/auth/me' || p==='/me/profile')body={...user,username:'socket_fixture',display_name:'Socket Fixture'};
   else if(p==='/me/community-rules')body={version:'fixture',accepted:true,rules:[]};
   else if(p==='/auth/deletion/capabilities')body={enabled:false};
   await route.fulfill({json:body});
  });
  await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{
   const entry={ws,subscriptions:new Map(),pings:0};sockets.push(entry);
   ws.onMessage(raw=>{
    const m=JSON.parse(raw);
    if(m.type==='AUTH')ws.send(JSON.stringify({type:'READY'}));
    if(m.type==='PING'){entry.pings++;ws.send(JSON.stringify({type:'PONG'}));}
    if(m.type==='SUBSCRIBE'){
     if(rejectChat && m.lane_id.endsWith('_chat'))return ws.send(JSON.stringify({type:'STREAM_CLOSED',subscription_id:m.subscription_id}));
     entry.subscriptions.set(m.subscription_id,m.lane_id);
     ws.send(JSON.stringify({type:'SUBSCRIBED',subscription_id:m.subscription_id,lane_id:m.lane_id,cursor:0}));
    }
    if(m.type==='UNSUBSCRIBE')entry.subscriptions.delete(m.subscription_id);
    if(m.type==='ACK')ws.send(JSON.stringify({type:'ACKED',subscription_id:m.subscription_id,scanned_sequence:m.scanned_sequence,cursor:m.scanned_sequence}));
   });
  });
  await page.goto(site);await page.getByTestId('room-hero').waitFor();
  await page.waitForFunction(()=>document.body.innerText.includes('Socket fixture'));
  const until=async predicate=>{const end=Date.now()+15000;while(!predicate()){assert.ok(Date.now()<end,'fixture timed out');await page.waitForTimeout(50);}};
  await until(()=>sockets[0]?.subscriptions.size>=6);await page.waitForTimeout(500);
  assert.equal(sockets.length,1,'initial room/table selection shares the authenticated socket');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await until(()=>sockets[0].pings>0);await page.waitForTimeout(500);
  assert.equal(sockets.length,1,'foreground/online health check keeps a healthy socket');
  console.log('PASS mounted UI: room/table selection and online recovery retain one socket');
  await page.waitForTimeout(26000);
  const socket=sockets[0],game=[...socket.subscriptions].find(([,lane])=>lane==='game');assert.ok(game);
  const before=reads.length;snapshot.game.revision++;
  socket.ws.send(JSON.stringify({type:'DELIVERY_PAGE',subscription_id:game[0],lane_id:'game',after_sequence:0,
   scanned_sequence:1,has_more:false,events:[{event_id:'fixture-move',lane_id:'game',sequence:1,
    event_type:'GAME_STATE_CHANGED',event_version:1,payload:{}}]}));
  await until(()=>reads.length>before);await page.waitForTimeout(500);const refreshed=reads.length;
  await page.waitForTimeout(6500);
  assert.equal(reads.length,refreshed,'the old fallback deadline must not fetch again after an event refresh');
  console.log('PASS mounted UI: event near the fallback deadline postpones the old scheduled poll');
  await page.waitForTimeout(24500);
  assert.equal(reads.length,refreshed+1,'fallback resumes 30 seconds after the event refresh if no further updates arrive');
  console.log('PASS mounted UI: fallback polling resumes after 30 seconds without updates');
  rejectChat=true;const chat=[...socket.subscriptions].find(([,lane])=>lane==='table_chat');assert.ok(chat);
  socket.ws.send(JSON.stringify({type:'STREAM_CLOSED',subscription_id:chat[0]}));
  await page.getByText('Updating chat…',{exact:true}).waitFor();
  assert.equal(sockets.length,1);assert.equal(await page.getByText(/Reconnecting/).count(),0);
  rejectChat=false;await page.getByText('Updating chat…',{exact:true}).waitFor({state:'hidden'});
  console.log('PASS mounted UI: isolated chat recovery does not reconnect gameplay');
  socket.ws.close({code:1001,reason:'fixture disconnect'});await until(()=>sockets.length===2);
  await until(()=>sockets[1].subscriptions.size>=6);await page.waitForTimeout(1700);
  assert.equal(await page.getByText(/Reconnecting/).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS mounted UI: genuine disconnect replaces socket and restores subscriptions');
 }catch(error){console.error({errors,external,reads:reads.length,sockets:sockets.length});throw error;}
 finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
