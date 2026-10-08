// Run with a legacy-mode local web export; APIs are intercepted, no player messages are sent.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8099';
async function fixture(browser,{width=390,kind=null,inRoom=false,transfer=null,failEntry=false,theme='classic',authenticated=true,stage=null,reduced=false}={}){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage();page.setDefaultTimeout(12000);
 const room={room_id:'room',name:'Chat room',creator_id:'u0',members:['u0','u1'],connected_members:['u0','u1']};
 const friends=Array.from({length:8},(_,i)=>({user_id:'f'+i,display_name:'Friend '+i,username:'friend'+i}));
 const snapshot=(kind||transfer)?JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_DIR||'/private/tmp',stage?`bhidne-flow-${stage}.json`:`bhidne-social-${kind||transfer}.json`))):null;
 let accepted=true;const errors=[],writes=[],commands=[];
 await context.addInitScript(({site,room,kind,inRoom,theme,authenticated})=>{if(!localStorage.getItem('bhidne.table-theme.v1'))localStorage.setItem('bhidne.table-theme.v1',theme);localStorage.setItem('bhidne.language','en');if(authenticated)sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room:inRoom||kind?room:null,game:kind}));},{site,room,kind,inRoom,theme,authenticated});
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 await context.route(site+'/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname;let body=[];
  if(p==='/'||p.startsWith('/_expo/')||p.startsWith('/assets/')||p==='/favicon.ico')return route.continue();
  if(request.method()==='POST'){writes.push(p);if(p.endsWith('/action'))commands.push(request.postDataJSON().command);}
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
 await page.goto(site);return {page,context,errors,writes,commands,room};
}
async function agree(page){await page.getByRole('heading',{name:'Community rules',exact:true}).waitFor();await page.getByRole('button',{name:'I agree to these rules',exact:true}).click();await page.getByRole('heading',{name:'Community rules',exact:true}).waitFor({state:'hidden'});}

(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const theme of ['classic','noir','pearl','heritage','dusk']){
  for(const [stage,label] of [['request','SideShowRequest'],['respond','Accept side-show'],['reveal','Side show']]){
   const f=await fixture(browser,{kind:'flush',theme,stage}),{page}=f;
   await page.getByRole('button',{name:/Return to table/}).first().click();
   await page.getByRole('button',{name:label,exact:true}).waitFor();
   await page.waitForFunction(label=>[...document.querySelectorAll('[role=button]')].some(el=>el.getAttribute('aria-label')===label&&el.getAttribute('aria-disabled')!=='true'),label);
   assert.equal(await page.getByTestId('active-turn-ring').count(),1);
   assert.equal(await page.getByText('TURN',{exact:true}).count(),0);
   for(const id of ['flush-round-bet-1','flush-session-net-1'])await page.getByTestId(id).waitFor();
   if(stage==='respond')await page.getByRole('button',{name:'Reject side show',exact:true}).waitFor();
   await page.screenshot({path:'/private/tmp/bhidne-game-'+theme+'-'+stage+'.png'});
   await page.getByRole('button',{name:label,exact:true}).click();
   await page.waitForFunction(()=>true);
   for(let attempt=0;attempt<30&&!f.commands.length;attempt++)await page.waitForTimeout(100);
   assert.equal(f.commands.at(-1),{request:'REQUEST_SIDE_SHOW',respond:'ACCEPT_SIDE_SHOW',reveal:'REVEAL_SIDE_SHOW'}[stage]);
   assert.deepEqual(f.errors,[]);await f.context.close();
  }
  console.log('PASS '+theme+': mobile request, response, reveal, active thumbnail border and contributions');
 }
 for(const kind of ['marriage','callbreak'])for(const width of [390,1280]){
  const f=await fixture(browser,{kind,width,reduced:true});await f.page.getByRole('button',{name:/Return to table/}).first().click();
  await f.page.getByTestId(new RegExp('^'+kind+'-(mobile-)?header$')).waitFor();
  await f.page.getByTestId('active-turn-ring').first().waitFor();
  assert.equal(await f.page.getByText('TURN',{exact:true}).count(),0);
  assert.equal(await f.page.getByText(/Copy [123]/).count(),0);
  assert.equal(await f.page.getByTestId('active-turn-ring').first().locator(':scope > div').count(),1,'reduced motion uses a static border');
  await f.page.screenshot({path:'/private/tmp/bhidne-game-'+kind+'-'+width+'.png'});
  assert.deepEqual(f.errors,[]);await f.context.close();
 }
 console.log('PASS Marriage and CallBreak player borders, reduced motion and removed copy/turn labels at mobile/desktop');
 const f=await fixture(browser,{kind:'flush',stage:'result'});await f.page.getByRole('button',{name:/Return to table/}).first().click();
 await f.page.getByTestId('flush-private-comparison').waitFor();assert.deepEqual(f.errors,[]);await f.context.close();
 console.log('PASS private comparison shown after reveal');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
