// Run with a legacy-mode local web export; APIs are intercepted, no player messages are sent.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8099';
async function fixture(browser,{width=390,kind=null,inRoom=false,transfer=null,failEntry=false,cardTheme='kathmandu',actor='u0',shared={theme:'kathmandu',controller:'u0'}}={}){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(12000);
 const room={room_id:'room',name:'Chat room',creator_id:'u0',members:['u0','u1'],connected_members:['u0','u1']};
 const friends=Array.from({length:8},(_,i)=>({user_id:'f'+i,display_name:'Friend '+i,username:'friend'+i}));
 const snapshot=(kind||transfer)?JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_DIR||'/private/tmp',`bhidne-social-${kind||transfer}.json`))):null;
 // Dealt fixtures exercise each hidden-card renderer.
 if(kind==='flush'){snapshot.flush.public.status='in_progress';snapshot.flush.public.players.forEach(p=>p.card_count=3);}
 if(kind==='callbreak')snapshot.private.hand=['AS','2S','3S','4S','5S','6S','7S','8S','9S','10S','JS','QS','KS'];
 let accepted=false;const errors=[],writes=[];
 const projected=()=>snapshot?{...snapshot,card_theme:shared.theme,card_theme_controller_id:shared.controller,can_change_card_theme:actor===shared.controller}:null;
 await context.addInitScript(({site,room,kind,inRoom,cardTheme,actor})=>{if(!localStorage.getItem('bhidne.card-theme.v1'))localStorage.setItem('bhidne.card-theme.v1',cardTheme);localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:actor,token:'mock'},room:inRoom||kind?room:null,game:kind}));},{site,room,kind,inRoom,cardTheme,actor});
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 await context.route(site+'/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname;let body=[];
  if(p==='/'||p.startsWith('/_expo/')||p.startsWith('/assets/')||p==='/favicon.ico')return route.continue();
  if(request.method()==='POST')writes.push(p);
  if(p==='/auth/me'||p==='/me/profile')body={user_id:actor,display_name:actor==='u0'?'Owner':'Other player',username:actor};
  else if(p==='/me/community-rules'){if(request.method()==='POST')accepted=true;body={accepted,version:'2026-10-01',muted_until:null};}
  else if(p==='/friends')body={friends,incoming:[],outgoing:[],online_friend_ids:['f0','f1']};
  else if(p==='/rooms')body=[room];
  else if(p==='/rooms/room'||p==='/rooms/room/enter')body={...room,is_member:true};
  else if(p==='/notifications')body=[{id:'n1',kind:'chat',actor:friends[0],read:false,created_at:Date.now(),payload:{room_id:'room',room_name:'Chat room',table_name:'Friday table',scope:'room'}}];
  else if(p==='/active-tables'&&transfer)body=[{room_id:'room',room_name:room.name,match_id:snapshot.match_id,name:snapshot.table_name||'Friday table',game_type:transfer,status:'waiting',players:1,capacity:4,current_user:{can_join:true}}];
  else if(p==='/test-games/room/card-theme'){if(actor!==shared.controller)return route.fulfill({status:403,json:{detail:'Only the current dealer can change the card theme.'}});shared.theme=request.postDataJSON().card_theme;body=projected();}
  else if(p.startsWith('/test-games/room')){if(transfer){await new Promise(r=>setTimeout(r,1000));if(failEntry)return route.fulfill({status:503,json:{detail:'Fixture table unavailable'}});}body=projected()||{room_id:'room',game_type:'flush',status:'ended',tables:[],players:[]};}
  await route.fulfill({json:body});
 });
 await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(raw=>{const c=JSON.parse(raw);ws.send(JSON.stringify(c.type==='HEARTBEAT'?{type:'HEARTBEAT_ACK'}:{type:'TABLE_SOCIAL_ACK',room_id:'room',match_id:snapshot?.match_id,command_id:c.command_id,status:'accepted',messages:[]}));});});
 await page.goto(site);return {page,context,errors,writes,room,shared};
}
async function agree(page){await page.getByRole('heading',{name:'Community rules',exact:true}).waitFor();await page.getByRole('button',{name:'I agree to these rules',exact:true}).click();await page.getByRole('heading',{name:'Community rules',exact:true}).waitFor({state:'hidden'});}

async function loadedArtwork(page,id){
 const art=page.getByTestId('card-back-art-'+id);await art.first().waitFor({state:'attached'});assert.ok(await art.count()>0,'hidden cards render '+id);
 await page.waitForFunction(id=>Array.from(document.querySelectorAll(`[data-testid="card-back-art-${id}"] img, img[data-testid="card-back-art-${id}"]`)).every(img=>img.complete&&img.naturalWidth>0),id);
}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [390,1280]){
  const f=await fixture(browser,{width}),{page}=f;
  await page.getByRole('button',{name:'Create your own game table',exact:true}).click();
  const form=page.getByTestId('create-game-table');await form.waitFor();
  await form.getByRole('button',{name:'Choose card theme',exact:true}).click();
  const picker=form.getByTestId('card-theme-picker');assert.equal(await picker.getByRole('radio').count(),10);
  await picker.getByRole('radio',{name:'Rara Lake',exact:true}).click();
  await page.waitForFunction(()=>localStorage.getItem('bhidne.card-theme.v1')==='rara');
  assert.equal(await picker.getByRole('radio',{name:'Rara Lake',exact:true}).getAttribute('aria-checked'),'true');
  if(process.env.SCREENSHOT_DIR){await picker.getByRole('radio',{name:'Mount Everest',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`bhidne-card-picker-${width}.png`)});}
  await form.getByRole('button',{name:'Close create table',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Create your own game table',exact:true}).click();
  await page.getByTestId('create-card-theme-selector').getByText('Rara Lake',{exact:true}).waitFor();
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,[]);await f.context.close();console.log('PASS create picker and reload persistence '+width);
 }
 for(const kind of ['flush','callbreak','marriage'])for(const width of [390,1280]){
  const f=await fixture(browser,{kind,width}),{page}=f;
  await page.getByRole('button',{name:/Return to table/}).first().click();
  const header=page.getByTestId(new RegExp('^'+kind+'-(mobile-)?header$'));await header.waitFor();
  await loadedArtwork(page,'kathmandu');
  await header.getByRole('button',{name:'Table menu',exact:true}).click();
  await page.getByTestId(kind+'-menu-settings').getByRole('button',{name:'Choose card theme',exact:true}).click();
  const picker=page.getByTestId('game-card-theme-sheet');await picker.waitFor();
  assert.equal(await picker.getByRole('radio').count(),10);
  const themeBefore=await page.evaluate(()=>document.documentElement.dataset.themeFamily);
  for(const [id,name] of [['everest','Mount Everest'],['lumbini','Lumbini']]){
   await picker.getByRole('radio',{name,exact:true}).click();await loadedArtwork(page,id);
   await loadedArtwork(page,id);
  }
  await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
  await loadedArtwork(page,'lumbini');if(process.env.SCREENSHOT_DIR&&kind==='flush')await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`bhidne-card-backs-${width}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.dataset.themeFamily),themeBefore);
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.writes,['/test-games/room/card-theme','/test-games/room/card-theme']);assert.equal(await page.evaluate(()=>localStorage.getItem('bhidne.card-theme.v1')),'kathmandu');await f.context.close();console.log('PASS '+kind+' menu sends shared theme changes '+width);
 }
 for(const kind of ['flush','callbreak','marriage']){
  const shared={theme:'everest',controller:'u0'};
  const observer=await fixture(browser,{kind,actor:'u1',cardTheme:'lumbini',shared});
  await observer.page.getByRole('button',{name:/Return to table/}).first().click();await loadedArtwork(observer.page,'everest');
  const owner=await fixture(browser,{kind,shared});await owner.page.getByRole('button',{name:/Return to table/}).first().click();
  await observer.page.getByRole('button',{name:'Table menu',exact:true}).click();await observer.page.getByRole('button',{name:'Choose card theme',exact:true}).click();
  const observerPicker=observer.page.getByTestId('game-card-theme-sheet');assert.equal(await observerPicker.getByRole('radio').count(),10);assert.ok(await observerPicker.getByRole('radio',{name:'Rara Lake',exact:true}).isDisabled());
  await owner.page.getByRole('button',{name:'Table menu',exact:true}).click();await owner.page.getByRole('button',{name:'Choose card theme',exact:true}).click();
  await owner.page.getByTestId('game-card-theme-sheet').getByRole('radio',{name:'Rara Lake',exact:true}).click();
  await loadedArtwork(owner.page,'rara');await loadedArtwork(observer.page,'rara');
  assert.deepEqual(observer.writes,[]);assert.equal(await observer.page.evaluate(()=>localStorage.getItem('bhidne.card-theme.v1')),'lumbini');
  shared.controller='u1';
  await observerPicker.getByRole('radio',{name:'Pokhara',exact:true}).click();await loadedArtwork(owner.page,'pokhara');await loadedArtwork(observer.page,'pokhara');
  assert.ok(await owner.page.getByTestId('game-card-theme-sheet').getByRole('radio',{name:'Rara Lake',exact:true}).isDisabled());
  assert.deepEqual(owner.errors,[]);assert.deepEqual(observer.errors,[]);await owner.context.close();await observer.context.close();console.log('PASS '+kind+' shared theme sync, read-only observer, and control handoff');
 }
 const f=await fixture(browser,{kind:'flush',cardTheme:'__proto__',shared:{theme:'everest',controller:'u0'}});await f.page.getByRole('button',{name:/Return to table/}).first().click();await loadedArtwork(f.page,'everest');assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS authoritative table theme overrides invalid device preference');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
