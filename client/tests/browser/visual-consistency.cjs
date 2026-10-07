// Run with a legacy-mode local web export; APIs are intercepted, no player messages are sent.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8099';
async function fixture(browser,{width=390,kind=null,inRoom=false,transfer=null,failEntry=false,theme='classic',authenticated=true}={}){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);
 const room={room_id:'room',name:'Chat room',creator_id:'u0',members:['u0','u1'],connected_members:['u0','u1']};
 const friends=Array.from({length:8},(_,i)=>({user_id:'f'+i,display_name:'Friend '+i,username:'friend'+i}));
 const snapshot=(kind||transfer)?JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_DIR||'/private/tmp',`bhidne-social-${kind||transfer}.json`))):null;
 let accepted=false;const errors=[],writes=[];
 await context.addInitScript(({site,room,kind,inRoom,theme,authenticated})=>{if(!localStorage.getItem('bhidne.table-theme.v1'))localStorage.setItem('bhidne.table-theme.v1',theme);localStorage.setItem('bhidne.language','en');if(authenticated)sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'mock'},room:inRoom||kind?room:null,game:kind}));},{site,room,kind,inRoom,theme,authenticated});
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
 for(const theme of ['classic','noir','pearl','heritage','dusk']){
  for(const width of [390,1280]){
   const f=await fixture(browser,{width,theme}),{page}=f;
   await page.waitForFunction(id=>document.documentElement.dataset.themeFamily===id,theme);
   await page.getByTestId('lobby-navigation').getByRole('tab',{name:'Friends',exact:true}).click();
   await page.getByTestId('friends-list').getByText('Friend 0',{exact:true}).waitFor();
   assert.equal(await page.getByRole('heading',{name:'Friends',exact:true}).evaluate(el=>getComputedStyle(el).fontSize),'28px');
   await page.getByRole('button',{name:'Open profile',exact:true}).click();await page.getByTestId('profile-screen').waitFor();
   await page.getByRole('button',{name:'Choose theme',exact:true}).click();
   const picker=page.getByTestId('table-theme-picker');await picker.waitFor();
   assert.equal(await picker.getByRole('radio').count(),5);
   await picker.getByTestId('table-theme-'+theme).getByText(/✓/).waitFor();
   const next=theme==='noir'?'pearl':'noir';
   await page.getByTestId('table-theme-'+next).click();await page.waitForFunction(id=>document.documentElement.dataset.themeFamily===id,next);
   await page.getByTestId('table-theme-'+theme).click();await page.waitForFunction(id=>document.documentElement.dataset.themeFamily===id,theme);
   assert.equal(await picker.getByTestId('table-theme-'+theme).getAttribute('aria-checked'),'true');
   await page.getByRole('button',{name:'Close themes',exact:true}).click();
   await page.getByRole('button',{name:'Back from profile',exact:true}).click();
   await page.reload();await page.waitForFunction(id=>document.documentElement.dataset.themeFamily===id,theme);
   assert.equal(await page.evaluate(()=>document.documentElement.style.colorScheme),theme==='pearl'?'light':'dark');
   assert.deepEqual(f.errors,[]);await f.context.close();
  }
  for(const kind of ['flush','callbreak','marriage']){
   const f=await fixture(browser,{kind,theme}),{page}=f;
   await page.getByRole('button',{name:/Return to table/}).first().click();
   await page.getByTestId(new RegExp('^'+kind+'-(mobile-)?header$')).waitFor();
   await page.getByRole('button',{name:'Table menu',exact:true}).click();
   await page.getByTestId(kind+'-menu-settings').waitFor();
   await page.screenshot({path:'/private/tmp/bhidne-visual-'+theme+'-'+kind+'.png'});
   assert.deepEqual(f.errors,[]);await f.context.close();
  }
  const auth=await fixture(browser,{theme,authenticated:false}),ap=auth.page;
  await ap.getByRole('button',{name:'Sign in or sign up',exact:true}).click();
  await ap.getByRole('button',{name:'Continue with username or email',exact:true}).waitFor();
  assert.equal(await ap.getByRole('button',{name:'Continue with Google',exact:true}).getAttribute('aria-disabled'),'true');
  await ap.getByRole('button',{name:'Continue with username or email',exact:true}).click();
  const input=ap.getByRole('textbox',{name:'Username or email',exact:true});await input.fill('test-player');await input.focus();
  assert.equal(await input.evaluate(el=>getComputedStyle(el).fontSize),'16px');
  await ap.screenshot({path:'/private/tmp/bhidne-visual-'+theme+'-auth.png'});
  assert.deepEqual(auth.errors,[]);await auth.context.close();
  console.log('PASS '+theme+': lobby/friends/profile/theme dialog/persistence at 390/1280 and all three game menus');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
