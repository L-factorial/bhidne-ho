// Run against an exported web build. All game responses are controlled fixtures.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://localhost:8087';
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const room = { room_id: 'hand-ui', name: 'Hand UI', members: ['u0','u1','u2','u3'], connected_members: ['u0','u1','u2','u3'] };
  const players = room.members.map((user_id,i) => ({ user_id, player_id:i+1, display_name:['Ram','Hari','Krishna','Shiva'][i] }));
  let turn = 2, revision = 1, trick = 1, hand = ['AS','KS','2S','3S','QH','2H','5H','9H','2C','3C','5D','6D','JD'], reject = false;
  const commands = [], errors = [];
  function snapshot() { return { room_id:room.room_id, match_id:'m1', status:'playing', capacity:players.length, game_type:'callbreak', players, your_player_id:1,
   tables:[{match_id:'m1',name:'Call Break',game_type:'callbreak',phase:'PLAYING',players:4,capacity:4,current_user:{is_seated:true}}],
   game:{revision,phase:'PLAYING',finished:false,winners:[],turn:{player_id:turn},current_trick:{trick_number:trick,plays:[],complete:false},scores_tenths:[0,0,0,0]},
   deal:{deal_number:1,attempt:1,dealer:1,tricks_completed:0,tricks_required:13,tricks:[],players:players.map(p=>({player_id:p.player_id,bid:2,tricks_won:0,cards_remaining:hand.length}))},
   private:{hand,legal_cards:turn===1?['AS','KS']:[],can_accept_hand:false,can_claim_redeal:false} }; }
  await context.addInitScript(({room,site}) => sessionStorage.setItem(`bhidne.session.v1:${site}`, JSON.stringify({session:{user_id:'u0',token:'mock'},room,game:'callbreak'})),{room,site});
  await context.route(site+'/**', async route => {
   const path = new URL(route.request().url()).pathname;
   if(path === '/' || path.startsWith('/_expo/') || path.startsWith('/assets/') || path === '/favicon.ico') return route.continue();
   let response = path === '/rooms' ? [room] : [];
   if(path.startsWith('/test-games/')) {
    const body = route.request().postDataJSON();
    if(path.endsWith('/action')) {
     commands.push(body);
     if(!reject) { hand = hand.filter(c => c !== body.payload.card); turn=2; revision++; }
     response = {...snapshot(), action_ack:{command_id:body.command_id,status:reject?'rejected':'accepted',revision,detail:reject?'Move rejected':undefined}};
    } else response = snapshot();
   }
   await route.fulfill({json:response});
  });
  await context.routeWebSocket(site.replace(/^http/,'ws')+'/**', ws => { ws.send(JSON.stringify({type:'CONNECTED'})); ws.onMessage(()=>ws.send(JSON.stringify({type:'HEARTBEAT_ACK'}))); });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_WEB_URL || 'http://localhost:8087');
  await page.waitForTimeout(1500);
  await page.getByRole('button',{name:/Return to table/}).first().click();
  const button = name => page.getByRole('button',{name,exact:true});
  await button('Expand your card area').waitFor();
  turn=1; revision++;
  await button('Collapse your card area').waitFor();
  assert.equal(await page.getByText('Your turn · Choose a card to play',{exact:true}).count(),0);
  await button('Collapse your card area').click();
  await page.waitForTimeout(2200);
  assert.ok(await button('Expand your card area').isVisible());
  await button('Expand your card area').click();
  await button('Flip all cards').click();
  assert.equal(await button('Hide cards').count(),0);
  await button('Hand options').click(); await button('Hide cards').click(); await button('Show cards').click();
  await button('Hand options').click();
  assert.ok(await button('Select QH').isDisabled());
  await button('Select AS').click(); assert.equal(commands.length,0);
  reject=true; await button('Play AS').click(); await page.getByText('Move rejected',{exact:true}).first().waitFor();
  assert.ok(await button('Collapse your card area').isVisible());
  reject=false; await button('Select AS').click(); await button('Play AS').click();
  await button('Expand your card area').waitFor();
  assert.equal(commands.length,2);
  turn=1; trick++; revision++;
  await button('Collapse your card area').waitFor();
  for (const size of [{width:320,height:568},{width:390,height:844},{width:1280,height:900}]) {
   await page.setViewportSize(size);
   await page.waitForTimeout(150);
   const seat = await page.getByTestId('your-seat').boundingBox();
   const dock = await page.getByTestId('callbreak-mobile-hand').boundingBox();
   assert.ok(seat.y+seat.height <= dock.y+1, 'hand does not cover local seat');
   assert.ok(dock.y+dock.height <= size.height+1);
   if(process.env.HAND_SCREENSHOTS) await page.screenshot({path:`${process.env.HAND_SCREENSHOTS}/callbreak-hand-${size.width}.png`});
  }
  players.push({ user_id:'u4', player_id:5, display_name:'Sita' }); room.members.push('u4'); room.connected_members.push('u4'); revision++;
  await page.setViewportSize({width:390,height:844});
  await page.getByText('Sita',{exact:true}).waitFor();
  for (const mode of ['dark','light']) {
   await page.emulateMedia({colorScheme:mode});
   assert.ok(await button('Collapse your card area').isVisible());
   const seat = await page.getByTestId('your-seat').boundingBox();
   const dock = await page.getByTestId('callbreak-mobile-hand').boundingBox();
   assert.ok(seat.y+seat.height <= dock.y+1);
   if(process.env.HAND_SCREENSHOTS) await page.screenshot({path:`${process.env.HAND_SCREENSHOTS}/callbreak-hand-five-${mode}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('Call Break hand browser checks passed');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
