const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL || 'http://127.0.0.1:8096';
async function api(path,user,body) {
 const r=await fetch(site+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;
}
const button=(p,name)=>p.getByRole('button',{name,exact:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const kind of ['marriage','callbreak']) {
   const users=[];for(let i=0;i<5;i++)users.push(await api('/auth/signup',null,{username:`seats_${kind}_${Date.now()}_${i}`,password:'Seat-layout-test-123'}));
   const room=await api('/rooms',users[0],{name:'Spatial seats'});for(const user of users)await api(`/rooms/${room.room_id}/enter`,user,{});
   const root=`/test-games/${room.room_id}`,game=await api(root,users[0],{game_type:kind,player_count:5});
   for(const user of users.slice(1))await api(root+'/join',user,{match_id:game.match_id});
   if(kind==='marriage')await api(root+'/table/lock',users[0],{match_id:game.match_id});
   await api(root+'/start',users[0],{match_id:game.match_id,play_mode:'manual'});
   const snapshot=await api(root,users[0]);
   snapshot.players.forEach((p,i)=>{p.display_name=`Player ${i+1} with a very long display name`;p.connected=i!==2;});
   const roster=[...snapshot.players],dealPlayers=[...snapshot.deal?.players || []],marriagePlayers=[...snapshot.marriage?.public.players || []];
   snapshot.game.phase='PLAYING';snapshot.game.turn.player_id=1;
   if(kind==='callbreak') {
    snapshot.private.hand=['2H','3H','4S','5C','6D'];snapshot.private.legal_cards=['2H','3H'];snapshot.private.can_accept_hand=false;snapshot.private.can_claim_redeal=false;
    snapshot.game.current_trick={trick_number:1,plays:[],complete:false,winner:null};
   } else {snapshot.marriage.public.current_player_id='1';}
   const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
   await context.addInitScript(({user,room,site,kind})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room,game:kind})),{user:users[0],room,site,kind});
   let commands=0;
   await context.route(site+root+'**',async route=>{
    if(route.request().url().includes('/action'))commands++;
    await route.fulfill({json:snapshot});
   });
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(site);await page.getByRole('button',{name:/^Return to table ·/}).click();
   const table=page.getByTestId(kind==='marriage'?'marriage-player-grid':'card-table');
   for(const count of kind==='marriage'?[2,3,4,5]:[4,5]) {
    snapshot.players=roster.slice(0,count);snapshot.capacity=count;
    if(kind==='marriage')snapshot.marriage.public.players=marriagePlayers.slice(0,count);
    else snapshot.deal.players=dealPlayers.slice(0,count);
    snapshot.game.revision++;
    await page.waitForFunction(({id,count})=>document.querySelectorAll(`[data-testid="${id}"] [data-testid^="table-seat-"]`).length===count,{id:kind==='marriage'?'marriage-player-grid':'card-table',count});
    for(const viewport of [{width:320,height:640},{width:390,height:844},{width:1280,height:900}]) {
     await page.setViewportSize(viewport);await page.waitForTimeout(150);
     const bounds=await table.boundingBox();
     const seats=await table.locator('[data-testid^="table-seat-"]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
     assert.equal(seats.length,count);
     for(const [i,a]of seats.entries()) {
      assert.ok(a.x>=0 && a.x+a.width<=viewport.width,'seat stays in viewport');
      for(const b of seats.slice(i+1))assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y,'no seat overlap');
     }
     assert.ok(seats[0].y>bounds.y+bounds.height/2,'local player sits below the shared area');
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page scrolling');
    }
   }
   if(kind==='callbreak') {
    await page.setViewportSize({width:390,height:844});await button(page,'Expand your card area').click();
    await button(page,'Flip all cards').click();await page.getByRole('radio',{name:'Card grid view',exact:true}).click();
    assert.ok(await button(page,'Select 2H').isEnabled());assert.ok(await button(page,'Select 4S').isDisabled());
    await button(page,'Select 2H').click();assert.equal(commands,0,'card selection is local');await button(page,'Play 2H').waitFor();
    snapshot.game.current_trick.plays=[2,3,4,5].map((player_id,i)=>({player_id,card:['2S','3S','4S','5S'][i]}));snapshot.game.revision++;
    await page.waitForFunction(()=>document.querySelectorAll('[data-testid="trick-card"]').length===4);
    const trickCards=await page.getByTestId('trick-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    for(const [i,a]of trickCards.entries())for(const b of trickCards.slice(i+1))assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y,'trick faces do not overlap');
    for(const viewport of [{width:320,height:568},{width:320,height:640},{width:390,height:844}]) {
     await page.setViewportSize(viewport);await page.waitForTimeout(150);
     const bounds=await table.boundingBox(), hand=await page.getByTestId('callbreak-mobile-hand').boundingBox();
     const trick=await page.getByTestId('current-trick-area').boundingBox();
     assert.ok(bounds.y+bounds.height<=hand.y+1,'all seats remain above open hand');
     assert.ok(trick.y+trick.height<=hand.y,'central trick remains above hand');
     await page.screenshot({path:`/tmp/callbreak-spatial-${viewport.width}.png`});
    }
   } else {
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/marriage-spatial.png'});
    const seat=page.getByTestId('marriage-player-3');assert.match(await seat.getAttribute('aria-label'),/disconnected/);
    await seat.click();await page.getByTestId('marriage-player-details').waitFor();await button(page,'Close player details').click();
   }
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${kind}: spatial seats, supported counts, long names, responsive table and private hand`);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
