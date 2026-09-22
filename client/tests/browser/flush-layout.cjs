// Run against the local app with the memory game runtime.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { checkThemes } = require('./theme-check.cjs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8096';
async function api(path, user, body) {
  const response = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
}
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const errors = [];
 try {
  const stamp = Date.now();
  const users = [];
  for (let i=0; i<3; i++) users.push(await api('/auth/signup', null, {username:`flush_${stamp}_${i}`,password:'Flush-layout-test-123'}));
  const room = await api('/rooms', users[0], {name:'Flush layout'});
  for (const user of users) await api(`/rooms/${room.room_id}/enter`,user,{});
  const root = `/test-games/${room.room_id}`;
  let game = await api(root,users[0],{game_type:'flush',player_count:3});
  await api(root+'/flush-settings',users[0],{match_id:game.match_id,rules_revision:game.flush_settings.rules_revision,rules:{...game.flush_settings.rules,allow_side_show:true,minimum_bet_rounds_before_side_show:0}});
  for (const user of users.slice(1)) await api(root+'/join',user,{match_id:game.match_id});
  const pages=[];
  for (let i=0;i<3;i++) {
   const context=await browser.newContext({viewport:i===1?{width:1280,height:900}:{width:390,height:844}});
   await context.addInitScript(({user,room,site})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room,game:'flush'})),{user:users[i],room,site});
   const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(site);pages.push(page);
   await page.getByRole('button',{name:/^Return to table ·/}).click();
   await page.getByTestId('flush-table').waitFor();
  }
  const button=(p,name)=>p.getByRole('button',{name,exact:true});
  const owner=pages[0];
  await owner.getByTestId('flush-center-start').click();
  await owner.getByTestId('flush-center-start').filter({hasText:'Start game'}).click();
  async function current(status) {
    for (let retry=0;retry<100;retry++) {
      const state=await api(root,users[0]);
      if (state.flush && (!status || state.flush.public.status===status)) return Number(state.flush.public.current_player_id)-1;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error(`Timed out waiting for ${status}`);
  }
  let i=await current('awaiting_deal');await button(pages[i],'Deal cards').click();
  i=await current('awaiting_cut');await button(pages[i],'Skip cut').waitFor();await pages[i].reload();await pages[i].getByRole('button',{name:/^Return to table ·/}).click();await button(pages[i],'Skip cut').click();
  i=await current('in_progress');await pages[i].getByTestId('flush-own-cards').waitFor();
  await checkThemes(pages[i], 'flush-active');
  for (const p of pages) {
   assert.equal(await p.getByRole('button',{name:/^Your card \d:/}).count(),0,'blind cards remain hidden');
   assert.equal(await p.getByTestId('flush-mobile-hand').count(),0);
   const dock=await p.getByTestId('flush-hand-dock').boundingBox();
   assert.ok(dock.y+dock.height<=p.viewportSize().height+1,'dock stays in viewport');
  }
  for (const viewport of [{width:360,height:640},{width:390,height:844},{width:1280,height:900}]) {
   const p=pages[i];await p.setViewportSize(viewport);await p.waitForTimeout(150);
   const dock=await p.getByTestId('flush-hand-dock').boundingBox();
   assert.ok(dock.y+dock.height<=viewport.height+1);
   const arena=await p.getByTestId('flush-arena').boundingBox();
   const own=await p.getByTestId(`flush-seat-${i+1}`).boundingBox();
   assert.ok(Math.abs(own.x+own.width/2-arena.x-arena.width/2)<2,'own seat bottom center');
   assert.ok(own.y>arena.y+arena.height/2);
   assert.ok(await p.getByRole('button',{name:/^Bet minimum/}).isEnabled());
   const beforeState=await api(root,users[i]);
   await p.getByTestId('flush-arena').evaluate(el=>{globalThis.testFlushArena=el;});
   let socketOpens=0;const opened=()=>socketOpens++;p.on('websocket',opened);
   await button(p,'Table menu').click();
   const drawer=p.getByTestId('flush-menu-drawer');await drawer.waitFor();
   assert.deepEqual(await p.getByTestId('flush-arena').boundingBox(),arena,'drawer must not move/resize table');
   assert.deepEqual(await p.getByTestId('flush-hand-dock').boundingBox(),dock,'drawer must not move cards/actions');
   const bounds=await drawer.boundingBox();
   assert.ok(Math.abs(bounds.x + bounds.width - (viewport.width - 8)) < 1, 'menu respects its right inset');
   assert.ok(bounds.width <= 360 && bounds.width <= viewport.width * .86 + 1, 'menu fits the viewport');
   assert.equal(await p.getByText(/Your seat /).count(),0);
   await button(p,'Players & waiting queue').click();await p.getByTestId('flush-menu-players').waitFor();
   await button(p,'Players & waiting queue').click();
   await p.context().grantPermissions(['clipboard-read','clipboard-write']);
   await button(p,'Copy Invite Link').click();
   await drawer.getByText('Link copied. Paste it into any messaging app.',{exact:true}).waitFor();
   assert.deepEqual(await drawer.boundingBox(),bounds,'copy confirmation must not resize drawer');
   const invite=new URL(await p.evaluate(()=>navigator.clipboard.readText()));
   assert.equal(invite.searchParams.get('room'),room.room_id);assert.equal(invite.searchParams.get('match'),game.match_id);
   await p.waitForTimeout(250);
   await p.screenshot({path:`/tmp/flush-menu-${viewport.width}.png`});
   await button(p,'Close table menu').click();await drawer.waitFor({state:'hidden'});
   await button(p,'Table menu').click();await drawer.waitFor();
   await p.getByTestId('flush-menu-backdrop').click({position:{x:4,y:100}});await drawer.waitFor({state:'hidden'});
   await button(p,'Table menu').click();await drawer.waitFor();await p.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
   assert.equal(await p.getByTestId('flush-arena').evaluate(el=>el===globalThis.testFlushArena),true,'same mounted arena');
   assert.equal(socketOpens,0,'menu must not reconnect websocket');p.off('websocket',opened);
   assert.deepEqual((await api(root,users[i])).flush,beforeState.flush,'menu must not change game state');
   await p.screenshot({path:`/tmp/flush-layout-${viewport.width}.png`});
  }
  // Static seat indicators and a finite cue replace looping text animations.
  for (const p of pages) {
   assert.equal(await p.getByTestId('flush-active-turn').count(),1);
   await p.waitForTimeout(900);
   assert.equal(await p.getByTestId('flush-turn-cue').evaluate(el=>getComputedStyle(el).opacity),'0');
   await p.getByTestId('flush-turn-cue').evaluate(el=>{
    globalThis.turnCueChanges=0;
    new MutationObserver(()=>{if(Number(el.style.opacity)>0)globalThis.turnCueChanges++;}).observe(el,{attributes:true,attributeFilter:['style']});
   });
  }
  // Rejection leaves the actions visible and retryable.
  await pages[i].route('**/test-games/*/action',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'Test rejected bet'})}));
  await pages[i].getByRole('button',{name:/^Bet minimum/}).click();
  await pages[i].getByText('Test rejected bet',{exact:true}).waitFor();
  await pages[i].unroute('**/test-games/*/action');
  const first=i;
  for (let step=0;step<3;step++) {
   i=(first+step)%3;const p=pages[i];
   await button(p,'See cards').waitFor();
   await p.waitForTimeout(900);
   if(step>0) assert.ok(await p.evaluate(()=>globalThis.turnCueChanges)>0,'a new personal turn must briefly cue');
   await p.evaluate(()=>globalThis.turnCueChanges=0);
   await button(p,'See cards').click();await button(p,'Press and hold to see cards').waitFor();
   await p.waitForTimeout(900);
   assert.equal(await p.evaluate(()=>globalThis.turnCueChanges),0,'seeing cards must not repeat the turn cue');
   assert.match(await p.getByRole('button',{name:/^Bet minimum/}).innerText(),/^Bet ·/);
   const peek=button(p,'Press and hold to see cards');await peek.hover();await p.mouse.down();
   await p.getByRole('button',{name:/^Your card 1:/}).waitFor();
   assert.equal(await p.getByRole('button',{name:/^Your card \d:/}).count(),3);await p.mouse.up();
   await p.getByRole('button',{name:/^Bet minimum/}).click();
   await p.getByRole('button',{name:/^Bet minimum/}).waitFor({state:'hidden'});
  }
  await button(pages[first],'Request side-show').click();
  const target=(first+2)%3, observer=(first+1)%3;
  await button(pages[target],'Decline side-show').waitFor();
  assert.match(await pages[target].getByTestId('flush-hand-dock').innerText(),/Accept or decline/);
  await button(pages[target],'Accept side-show').click();
  for (const index of [first,target]) {
   const p=pages[index];await p.getByTestId('flush-private-comparison').waitFor();
   assert.equal(await pages[observer].getByTestId('flush-private-comparison').count(),0);
   for (let card=1;card<=3;card++) await button(p,`Flip opponent card ${card}`).click();
   await button(p,'Continue').click();
  }
  i=await current();await pages[i].getByRole('button',{name:/^Show ·/}).click();
  for (const p of pages) await p.getByTestId('flush-show-overlay').waitFor();
  const state=await api(root,users[0]);const reveal=Number(state.flush.public.pending_show.target_id)-1;
  await pages[reveal].getByTestId('flush-show-overlay').getByRole('button',{name:'Reveal cards',exact:true}).click();
  for (const p of pages) {await p.getByTestId('flush-round-result').waitFor();await button(p,'Close final show').click();}
  await owner.getByTestId('flush-center-start').waitFor();
  await button(owner,'Table menu').click();await button(owner,'Rules').click();await owner.getByTestId('flush-rules').waitFor();await button(owner,'Close Flush rules').click();
  await button(owner,'Table menu').click();await button(owner,'Bet history').click();await owner.getByTestId('flush-bet-grid').waitFor();await button(owner,'Close Bet').click();
  await button(owner,'Table menu').click();
  const menu=owner.getByTestId('flush-menu-drawer');
  assert.equal(await menu.getByRole('button', { name: /^Appearance,/ }).count(), 0);
  await menu.getByRole('button', { name: 'Language, English', exact: true }).click();
  await menu.getByRole('button', { name: 'Language, नेपाली', exact: true }).click();
  await button(owner,'Poke the table').click();
  await owner.getByRole('button',{name:'Close poke composer',exact:true}).click();
  await button(owner,'Table menu').click();await button(owner,'End table').click();
  await button(owner,'Keep playing').click();
  await button(owner,'Close table menu').click();
  await button(pages[2],'Table menu').click();await button(pages[2],'Leave Table').click();
  for(let retry=0;retry<100;retry++) {
    const state=await api(root,users[2]);
    if(!state.table.current_user.is_seated) break;
    if(retry===99) throw new Error('Leave Table did not release the seat');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: responsive dock, own seat, legal actions, reconnect, rejected bet, blind/seen privacy, private side-show, final show, results, rules/history');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
