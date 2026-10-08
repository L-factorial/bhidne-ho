// Run with a legacy-mode local web export; APIs are intercepted, no player messages are sent.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8099';
async function fixture(browser,{width=390,kind=null,inRoom=false,transfer=null,failEntry=false}={}){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);
 const room={room_id:'room',name:'Chat room',creator_id:'u0',members:['u0','u1'],connected_members:['u0','u1']};
 const friends=Array.from({length:8},(_,i)=>({user_id:'f'+i,display_name:'Friend '+i,username:'friend'+i}));
 const snapshot=(kind||transfer)?JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_DIR||'/private/tmp',`bhidne-social-${kind||transfer}.json`))):null;
 let accepted=false;const errors=[],writes=[];
 await context.addInitScript(({site,room,kind,inRoom})=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room:inRoom||kind?room:null,game:kind}));},{site,room,kind,inRoom});
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 await context.route(site+'/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname;let body=[];
  if(p==='/'||p.startsWith('/_expo/')||p.startsWith('/assets/')||p==='/favicon.ico')return route.continue();
  if(request.method()==='POST')writes.push(p);
  if(p==='/auth/me'||p==='/me/profile')body={user_id:'u0',display_name:'Owner',username:'owner'};
  else if(p==='/me/community-rules'){if(request.method()==='POST')accepted=true;body={accepted,version:'2026-10-01',muted_until:null};}
  else if(p==='/friends')body={friends,incoming:[],outgoing:[],online_friend_ids:['f0','f1']};
  else if(p==='/rooms')body=[room];
  else if(p==='/rooms/room'||p==='/rooms/room/enter')body={...room,is_member:true};
  else if(p==='/notifications')body=[{id:'n1',kind:'chat',actor:friends[0],read:false,created_at:Date.now(),payload:{room_id:'room',room_name:'Chat room',table_name:'Friday table',scope:'room'}}];
  else if(p==='/active-tables'&&transfer)body=[{room_id:'room',room_name:room.name,match_id:snapshot.match_id,name:snapshot.table_name||'Friday table',game_type:transfer,status:'waiting',players:1,capacity:4,current_user:{can_join:true}}];
  else if(p.startsWith('/test-games/room')){if(transfer){await new Promise(r=>setTimeout(r,1000));if(failEntry)return route.fulfill({status:503,json:{detail:'Fixture table unavailable'}});}body=snapshot||{room_id:'room',game_type:'flush',status:'ended',tables:[],players:[]};}
  await route.fulfill({json:body});
 });
 await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(raw=>{const c=JSON.parse(raw);ws.send(JSON.stringify(c.type==='HEARTBEAT'?{type:'HEARTBEAT_ACK'}:{type:'TABLE_SOCIAL_ACK',room_id:'room',match_id:snapshot?.match_id,command_id:c.command_id,status:'accepted',messages:[]}));});});
 await page.goto(site);return {page,context,errors,writes,room};
}
async function agree(page){await page.getByRole('heading',{name:'Community rules',exact:true}).waitFor();await page.getByRole('button',{name:'I agree to these rules',exact:true}).click();await page.getByRole('heading',{name:'Community rules',exact:true}).waitFor({state:'hidden'});}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,1280]){
  const f=await fixture(browser,{width}),{page}=f;
  await page.getByText('Bhidne Ho ?',{exact:true}).waitFor();
  await page.getByTestId('lobby-navigation').getByRole('tab',{name:'Chat',exact:true}).click();await agree(page);
  await page.getByText('Online friends',{exact:true}).waitFor();
  assert.equal(await page.getByTestId('friends-list').getByRole('button',{name:'Message',exact:true}).count(),2);
  assert.equal(await page.getByRole('textbox',{name:'Find players',exact:true}).count(),0);
  await page.getByTestId('friends-list').getByRole('button',{name:'Message',exact:true}).first().click();await page.getByRole('button',{name:'Close private chat',exact:true}).click();
  await page.getByTestId('lobby-navigation').getByRole('tab',{name:'Friends',exact:true}).click();
  const list=page.getByTestId('friends-list');await list.getByText('Friend 0',{exact:true}).waitFor();assert.equal(await list.getByRole('button',{name:'Message',exact:true}).count(),6);
  await page.getByRole('button',{name:'More',exact:true}).click();assert.equal(await list.getByRole('button',{name:'Message',exact:true}).count(),8);assert.ok((await list.boundingBox()).height<=420);
  await page.getByRole('button',{name:'Open profile',exact:true}).click();const profile=page.getByTestId('profile-screen');await profile.waitFor();await profile.getByTestId('friends-list').getByText('Friend 0',{exact:true}).waitFor();assert.equal(await profile.getByTestId('friends-list').getByRole('button',{name:'Message',exact:true}).count(),6);await profile.getByRole('button',{name:'More',exact:true}).click();assert.equal(await profile.getByTestId('friends-list').getByRole('button',{name:'Message',exact:true}).count(),8);
  await profile.getByRole('button',{name:'Back from profile',exact:true}).click();await page.getByRole('button',{name:/^Notifications/}).click();await page.getByText('Friend 0 sent you a chat message',{exact:true}).waitFor();await page.getByText('Chat room → Friday table',{exact:true}).waitFor();await page.getByRole('button',{name:'Close notifications',exact:true}).click();assert.deepEqual(f.errors,[]);console.log('PASS lobby Chat/Friends, acceptance/resume and six-friend lists at '+width);await f.context.close();
 }
 for(const kind of ['flush','callbreak','marriage']){
  const f=await fixture(browser,{kind,width:kind==='callbreak'?1280:390}),{page}=f;
  await page.getByRole('button',{name:/Return to table/}).first().click();const header=page.getByTestId(new RegExp('^'+kind+'-(mobile-)?header$'));await header.waitFor();
  assert.equal(await header.getByRole('button').count(),2);assert.equal(await header.getByText('Bhidne Ho ?',{exact:true}).count(),0);await header.getByTestId(kind+'-header-location').getByText(/Chat room →/).waitFor();
  const buttons=await header.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));assert.deepEqual(buttons,['Back to lobby','Table menu']);
  await header.getByRole('button',{name:'Table menu',exact:true}).click();const menu=page.getByTestId(kind+'-menu-settings');await menu.getByRole('button',{name:'Choose theme',exact:true}).waitFor();await menu.getByRole('button',{name:'Choose language',exact:true}).waitFor();await menu.getByRole('button',{name:'Share table link or code',exact:true}).waitFor();await menu.getByRole('button',{name:'Open profile',exact:true}).click();await page.getByTestId('profile-screen').waitFor();await page.getByRole('button',{name:'Back from profile',exact:true}).click();
  await page.getByTestId('game-social-controls').getByRole('button',{name:'Table Chat',exact:true}).click();await agree(page);await page.getByTestId('table-chat-panel').waitFor();assert.deepEqual(f.errors,[]);console.log('PASS '+kind+' header/menu and rules return to game chat');await f.context.close();
 }
 const f=await fixture(browser,{inRoom:true}),{page}=f;await page.getByRole('button',{name:'Room chat',exact:true}).click();await agree(page);await page.getByTestId('room-chat-window').waitFor();assert.deepEqual(f.errors,[]);console.log('PASS room chat rules acceptance/resume');await f.context.close();

 for(const failEntry of [false,true]){
  const f=await fixture(browser,{transfer:'flush',failEntry}),{page}=f;
  await page.getByTestId('active-games').getByRole('button',{name:/^Join ·/}).click();
  await page.getByTestId('table-transfer').getByText('Taking you to your game table…',{exact:true}).waitFor();
  if(failEntry){await page.getByTestId('table-transfer').waitFor({state:'hidden'});await page.getByRole('button',{name:'Retry loading tables',exact:true}).waitFor();}
  else{const header=page.getByTestId('flush-mobile-header');await header.waitFor();await page.getByTestId('table-transfer').waitFor({state:'hidden'});await header.getByRole('button',{name:'Back to lobby',exact:true}).click();await header.waitFor({state:'hidden'});assert.equal(await page.getByTestId('table-transfer').count(),0);assert.ok(f.writes.every(p=>!p.endsWith('/leave')));}
  assert.deepEqual(f.errors,[]);console.log('PASS table transfer '+(failEntry?'error recovery':'entry/back without leaving'));await f.context.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
