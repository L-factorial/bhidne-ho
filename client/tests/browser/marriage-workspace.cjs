// Controlled snapshots exercise presentation and command boundaries, not game rules.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8096';
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function api(path, user, body) {
  const r = await fetch(site + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const stamp = Date.now(), users = [];
    for (let i=0;i<2;i++) users.push(await api('/auth/signup',null,{username:`workspace_${stamp}_${i}`,password:'Workspace-test-123'}));
    const room=await api('/rooms',users[0],{name:'Marriage workspace'});
    for(const user of users) await api(`/rooms/${room.room_id}/enter`,user,{});
    const root=`/test-games/${room.room_id}`;
    const game=await api(root,users[0],{game_type:'marriage',player_count:2});
    await api(root+'/join',users[1],{match_id:game.match_id});
    await api(root+'/table/lock',users[0],{match_id:game.match_id});
    await api(root+'/start',users[0],{match_id:game.match_id});
    const state=await api(root,users[0]), pub=state.marriage.public, mine=state.marriage.private;
    const pairs=Array.from({length:7},(_,i)=>({meld_type:'dublee',card_ids:[`D0:${i+2}H`,`D1:${i+2}H`]}));
    const card=id=>({card_id:id,card_type:'standard',rank:Number(id.slice(3,-1)),suit:id.slice(-1),deck_index:Number(id[1])});
    mine.hand=[...pairs.flatMap(p=>p.card_ids),...Array.from({length:7},(_,i)=>`D0:${i+2}S`)].map(card);
    mine.maal=null; pub.current_player_id='2'; pub.phase='must_draw';
    mine.actions={kinds:[],drawable_sources:[],discardable_card_ids:[],blocked_sources:[]};
    state.marriage.moves=[];
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(({user,room,site})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room,game:'marriage'})),{user:users[0],room,site});
    const commands=[];let reject=false, releaseRejection;
    const publish=()=>{state.game.revision++;pub.revision=state.game.revision;};
    await context.route(site+root+'**',async route=>{
      if(route.request().url().includes('/action')) {
        const action=route.request().postDataJSON();commands.push(action);
        if(reject) { await new Promise(resolve=>{releaseRejection=resolve;}); return route.fulfill({status:422,json:{detail:'Discard rejected for test'}}); }
        if(action.command==='DRAW_CARD') {
          assert.deepEqual(action.payload,{source:'stock'});
          mine.hand.push(card('D2:9C'));pub.phase='must_discard';pub.players[0].hand_count=22;
          mine.actions={kinds:['discard','show_dublees'],drawable_sources:[],discardable_card_ids:mine.hand.map(c=>c.card_id),blocked_sources:[]};
          state.marriage.moves.push({sequence:1,revision:state.game.revision+1,kind:'CARD_DRAWN',player_id:'1',source:'stock',card:null});
        } else if(action.command==='DISCARD_CARD') {
          const discarded=mine.hand.find(c=>c.card_id===action.payload.card_id);
          mine.hand=mine.hand.filter(c=>c.card_id!==action.payload.card_id);pub.top_discard=discarded;pub.players[0].hand_count=21;pub.current_player_id='2';pub.phase='must_draw';
          mine.actions={kinds:[],drawable_sources:[],discardable_card_ids:[],blocked_sources:[]};
          state.marriage.moves.push({sequence:2,revision:state.game.revision+1,kind:'CARD_DISCARDED',player_id:'1',source:null,card:discarded});
        } else if(action.command==='SHOW_DUBLEES') {
          assert.deepEqual(action.payload,{pairs});pub.players[0].route='dublee';pub.players[0].shown_melds=pairs;pub.players[0].has_seen_maal=true;
          mine.maal={tiplu:{rank:8,suit:'C'},jhiplu:{rank:7,suit:'C'},poplu:{rank:9,suit:'C'}};
          mine.actions={kinds:['finish'],drawable_sources:[],discardable_card_ids:[],blocked_sources:[]};
        } else if(action.command==='FINISH') {state.status='finished';pub.status='finished';pub.winner='1';pub.current_player_id=null;}
        else throw new Error(action.command);
        publish();state.action_ack={match_id:state.match_id,command_id:action.command_id,status:'accepted',revision:state.game.revision};
      }
      await route.fulfill({json:state});
    });
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto(site);await page.getByRole('button',{name:/^Return to table ·/}).click();
    const sheet=page.getByTestId('marriage-mobile-hand');
    await button(page,'Expand your card area').getByText('Your cards · 21',{exact:true}).waitFor();
    assert.ok((await sheet.boundingBox()).height<=64);
    assert.ok(await page.getByTestId('marriage-stock-spot').isDisabled());
    assert.ok(await page.getByTestId('marriage-discard-spot').isDisabled());
    await button(page,'Collapse your card area').click();const peek=(await sheet.boundingBox()).height;
    await button(page,'Expand your card area').click();assert.ok((await sheet.boundingBox()).height>peek);
    assert.equal(await page.getByTestId('marriage-hand').getByRole('button',{name:'Hidden card',exact:true}).count(),21);
    assert.equal(await button(page,'Reveal next card').count(),0);
    await button(page,'Reveal cards').click();assert.equal(await button(page,'Reveal cards').count(),0);
    publish();await page.waitForTimeout(1200);assert.ok(await button(page,'Collapse your card area').isVisible(),'waiting polls preserve manual expansion');
    pub.current_player_id='1';mine.actions={kinds:['draw'],drawable_sources:['stock'],discardable_card_ids:[],blocked_sources:[]};publish();
    await button(page,'Expand your card area').waitFor();
    await sheet.getByText('Your turn · Draw a card',{exact:true}).waitFor();
    assert.ok(await page.getByTestId('marriage-discard-spot').isDisabled());
    await page.getByTestId('marriage-stock-spot').click();
    await button(page,'Collapse your card area').waitFor();
    await sheet.getByText('Your turn · Choose a card to discard',{exact:true}).waitFor();
    assert.equal(await page.getByTestId('marriage-hand').getByRole('button').count(),22);
    assert.ok(await page.getByTestId('marriage-stock-spot').isDisabled());
    for(const viewport of [{width:360,height:640},{width:390,height:844}]) {
      await page.setViewportSize(viewport);await page.waitForTimeout(100);
      const cards=await page.getByTestId('marriage-hand').getByRole('button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x};}));
      assert.ok(cards.every(c=>c.width>=58 && c.height>=86 && c.x>=0 && c.x+c.width<=viewport.width));
      const bounds=await sheet.boundingBox();assert.ok(bounds.y>viewport.height*.2 && bounds.y+bounds.height<=viewport.height+1);
    }
    assert.equal(await page.getByTestId('marriage-hand-footer').count(),0,'no empty action footer before selection');
    const picked=page.getByTestId('marriage-hand').getByRole('button').first();const before=await picked.boundingBox();
    await picked.click();assert.equal(commands.length,1,'selecting does not submit');
    assert.ok((await picked.boundingBox()).y<before.y,'selection raises the card');
    const action=page.getByTestId('marriage-discard-action'), footer=page.getByTestId('marriage-hand-footer');
    await picked.click();assert.equal(await footer.count(),0,'deselecting removes the action');
    await picked.click();
    const other=page.getByTestId('marriage-hand').getByRole('button').nth(1);await other.click();
    assert.equal(await page.getByTestId('marriage-hand').locator('[aria-pressed="true"]').count(),1);
    assert.match(await action.innerText(),/Discard 2♥/);
    for(const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:700}]) {
      await page.setViewportSize(viewport);
      // Simulate the inset already applied by the game's safe-area container.
      await page.getByTestId('live-game-backdrop').evaluate(el=>{el.style.paddingBottom='34px';});
      await page.waitForTimeout(100);
      const bounds=await action.boundingBox(), sheetBounds=await sheet.boundingBox();
      assert.ok(bounds.y>=sheetBounds.y && bounds.y+bounds.height<=viewport.height-34,'action stays above the bottom safe area');
      await page.getByTestId('marriage-hand-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
      assert.deepEqual(await action.boundingBox(),bounds,'scrolling does not move the footer');
      await button(page,'Sort · suit').click();await button(page,'Sort · rank').click();
      assert.equal(await action.isVisible(),true,'sorting preserves the selected action');
      await button(page,'Collapse your card area').click();
      await button(page,'Expand your card area').click();
    }
    await page.screenshot({path:'/tmp/marriage-workspace-discard.png'});
    reject=true;
    await action.evaluate(el=>{el.click();el.click();});
    for(let n=0;!releaseRejection && n<100;n++) await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(releaseRejection);assert.ok(await action.isDisabled());
    assert.equal(commands.filter(c=>c.command==='DISCARD_CARD').length,1,'rapid clicks submit once');
    await button(page,'Collapse your card area').click();releaseRejection();
    await page.getByTestId('marriage-hand-footer').getByText('Discard rejected for test',{exact:true}).waitFor();
    assert.ok(await button(page,'Collapse your card area').isVisible());
    reject=false;await page.getByTestId('marriage-discard-action').click();
    await button(page,'Expand your card area').waitFor();
    await button(page,'Expand your card area').getByText('Your cards · 21',{exact:true}).waitFor();
    assert.equal(commands.filter(c=>c.command==='DISCARD_CARD').length,2);
    // Reuse known groups to exercise declarations, qualification, and finish.
    mine.hand=[...pairs.flatMap(p=>p.card_ids),...Array.from({length:8},(_,i)=>`D0:${i+2}S`)].map(card);
    pub.current_player_id='1';pub.phase='must_discard';mine.actions={kinds:['discard','show_dublees'],drawable_sources:[],discardable_card_ids:mine.hand.map(c=>c.card_id),blocked_sources:[]};publish();
    await button(page,'Collapse your card area').waitFor();
    await button(page,'Arrange').click();await button(page,'Review seven Dublees').click();
    await page.getByTestId('marriage-meld-preview').getByRole('button',{name:'Show seven Dublees',exact:true}).click();
    await page.getByTestId('marriage-meld-preview').waitFor({state:'hidden'});
    await page.getByTestId('marriage-shown-melds').waitFor({state:'hidden'});
    await button(page,'Collapse your card area').click();
    await page.getByTestId('marriage-maal-spot').getByText('8♣',{exact:true}).waitFor();
    await page.getByTestId('marriage-maal-spot').click();await page.getByTestId('marriage-maal-details').waitFor();await button(page,'Close Maal').click();
    await page.setViewportSize({width:1280,height:900});
    await page.getByTestId('marriage-hand').getByRole('button').first().waitFor();
    assert.equal(await page.getByTestId('marriage-hand').getByRole('button').count(),8,'committed melds remain outside the private workspace');
    await button(page,'Finish round').click();await page.getByText(/wins!/).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS Marriage workspace: three snaps, manual inspection, legal draw sources, 22-card layout, explicit discard/rejection, declaration, private Maal, finish and desktop');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
