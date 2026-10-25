// Isolated API responses: no production accounts, invitations or gameplay writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8160';
const out=process.env.SCREENSHOT_DIR||'/private/tmp/bhidne-play-states';fs.mkdirSync(out,{recursive:true});
const table=(kind,id)=>({room_id:'room',room_name:'Friends Room',match_id:id,name:'Table '+id,game_type:kind,status:'waiting',phase:'OPEN',players:2,capacity:kind==='flush'?10:kind==='marriage'?6:4,seated_players:[{seat_id:0,display_name:'Sita'},{seat_id:1,display_name:'Aarav'}],current_user:{is_seated:false,can_join:true,can_watch:true}});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [320,390,1032,1280]){
  const context=await browser.newContext({viewport:{width,height:956},reducedMotion:'reduce'});let tables=[],delay;const errors=[];
  await context.addInitScript(site=>{if(!localStorage.getItem('bhidne.language'))localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'}}));},site);
  await context.route(site+'/**',async route=>{const p=new URL(route.request().url()).pathname;
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   let data=[];
   if(p==='/active-tables'){if(delay)await delay;data=tables;}
   else if(p==='/auth/me'||p==='/me/profile')data={user_id:'u0',display_name:'Sita',username:'sitademo'};
   else if(p==='/friends')data={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
   else if(p==='/me/community-rules')data={accepted:true,version:'2026-10-01',muted_until:null};
   else if(p==='/rooms')data=[{room_id:'room',name:'Friends Room',creator_id:'u0',members:['u0'],is_member:true}];
   await route.fulfill({json:data});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.clock.install();let release;delay=new Promise(r=>release=r);
  await page.goto(site);await page.getByTestId('active-games-loading').waitFor();
  assert.equal(await page.getByTestId('active-games-empty').count(),0,'pending read must not claim no tables');
  assert.equal(await page.getByTestId('active-game-filters').count(),0);
  delay=null;release();await page.getByRole('heading',{name:'Who’s up for a game?',exact:true}).waitFor();
  assert.equal(await page.getByTestId('active-games-heading').count(),0);assert.equal(await page.getByTestId('active-game-filters').count(),0);
  assert.equal(await page.getByRole('button',{name:'Create game table',exact:true}).count(),1,'one in-card Create action');
  assert.equal(await page.getByTestId('play-create-table').count(),0);
  const createBox=await page.getByRole('button',{name:'Create game table',exact:true}).boundingBox();
  const browseBox=await page.getByRole('button',{name:'Browse rooms',exact:true}).boundingBox();
  assert.equal(createBox.width,browseBox.width);assert.equal(createBox.height,browseBox.height);
  assert.equal(createBox.x,browseBox.x);assert.ok(createBox.y+createBox.height<browseBox.y);
  const artwork=page.getByTestId(/^empty-tables-artwork-/);
  const theme=await artwork.getAttribute('data-testid');
  assert.match(theme,/^empty-tables-artwork-(kathmandu|everest|boudhanath|pokhara|pashupatinath|chitwan|bhaktapur|rara|lumbini|annapurna)$/);
  await artwork.locator('img').first().waitFor({state:'attached'});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid^="empty-tables-artwork-"] img')].length===3&&[...document.querySelectorAll('[data-testid^="empty-tables-artwork-"] img')].every(img=>img.complete&&img.naturalWidth>0));
  await page.clock.fastForward(15100);
  assert.equal(await artwork.getAttribute('data-testid'),theme,'polling keeps the chosen theme stable');
  await page.screenshot({path:path.join(out,`empty-${width}.png`)});
  tables=[table('flush','1'),table('marriage','2'),table('callbreak','3')];
  await page.clock.fastForward(15100);await page.getByTestId('play-table-1').waitFor();
  await page.getByTestId('active-games-heading').waitFor();assert.equal(await page.getByTestId('active-games-empty').count(),0);
  assert.equal(await page.getByTestId(/^play-table-/).count(),3);
  assert.equal(await page.getByTestId('game-icon-flush').locator('svg').count(),1);
  for(const kind of ['flush','marriage','callbreak'])assert.equal(await page.getByTestId('game-icon-'+kind).locator('image').count(),0,'vector icon replaces old bitmap');
  await page.screenshot({path:path.join(out,`available-${width}.png`)});
  await page.getByRole('tab',{name:'Flush games',exact:true}).click();
  tables=tables.filter(t=>t.game_type!=='flush');await page.getByRole('button',{name:'Refresh active games',exact:true}).click();
  await page.getByRole('heading',{name:'No Flush tables right now',exact:true}).waitFor();
  await page.getByTestId('active-game-filters').waitFor();assert.equal(await page.getByTestId(/^play-table-/).count(),0);
  assert.equal(await page.getByRole('button',{name:'Create game table',exact:true}).count(),1);
  await page.screenshot({path:path.join(out,`filtered-${width}.png`)});
  await page.getByRole('button',{name:'View all games',exact:true}).click();await page.getByTestId('play-table-2').waitFor();
  await page.getByRole('tab',{name:'Call Break games',exact:true}).click();tables=[];await page.getByRole('button',{name:'Refresh active games',exact:true}).click();
  await page.getByRole('heading',{name:'Who’s up for a game?',exact:true}).waitFor();
  tables=[table('marriage','4')];await page.clock.fastForward(15100);await page.getByTestId('play-table-4').waitFor();
  assert.equal(await page.getByRole('tab',{name:'All games',exact:true}).getAttribute('aria-selected'),'true','a fully empty feed resets the stale filter');
  await page.getByTestId('play-create-table').click();await page.getByTestId('create-game-table').waitFor();
  for(const kind of ['flush','marriage','callbreak'])await page.getByTestId('create-game-choices').getByTestId('game-icon-'+kind).locator('svg').waitFor();
  const ids=await page.locator('svg defs [id]').evaluateAll(ns=>ns.map(n=>n.id));assert.equal(new Set(ids).size,ids.length,'SVG gradients have unique IDs across multiple icons');
  await page.screenshot({path:path.join(out,`create-icons-${width}.png`)});
  await page.getByRole('button',{name:'Close Create game',exact:true}).click();await page.clock.fastForward(600);await page.getByTestId('create-game-table').waitFor({state:'hidden'});
  assert.ok(await page.getByTestId('active-games').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'no horizontal overflow');
  if(width===390){
   tables=[];await page.getByRole('button',{name:'Refresh active games',exact:true}).click();await page.clock.fastForward(500);await page.getByRole('button',{name:'Browse rooms',exact:true}).waitFor().catch(async e=>{await page.screenshot({path:path.join(out,'browse-failure.png')});console.error(await page.locator('body').innerText());throw e;});
   await page.getByRole('button',{name:'Browse rooms',exact:true}).click();await page.getByRole('tab',{name:'Friends’ rooms',exact:true}).waitFor();
   await page.evaluate(()=>localStorage.setItem('bhidne.language','ne'));await page.reload();await page.getByRole('heading',{name:'एक खेल खेल्ने हो?',exact:true}).waitFor();
   await page.screenshot({path:path.join(out,'empty-nepali.png')});
  }
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS Play feed ${width}: loading/empty/available/filter/reset/background arrival, shared icons and create navigation`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
