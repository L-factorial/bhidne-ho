const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8096';
async function api(path, user, body) {
  const response = await fetch(site + path, {method: body ? 'POST' : 'GET', headers: {'Content-Type':'application/json', ...(user ? {Authorization:`Bearer ${user.token}`} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
}
(async () => {
 const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
 try {
  const users=[];for(let i=0;i<4;i++) users.push(await api('/auth/signup',null,{username:`ended_${Date.now()}_${i}`,password:'Ended-table-test-123'}));
  for(const kind of ['flush','marriage','callbreak']) for(const started of [false,true]) {
   const room=await api('/rooms',users[0],{name:`Ended ${kind}`});
   for(const user of users) await api(`/rooms/${room.room_id}/enter`,user,{});
   const root=`/test-games/${room.room_id}`;
   const game=await api(root,users[0],{game_type:kind,player_count:4});
   for(const user of users.slice(1)) await api(root+'/join',user,{match_id:game.match_id});
   if(started) {
    if(kind!=='callbreak') await api(root+'/table/lock',users[0],{match_id:game.match_id});
    await api(root+'/start',users[0],{match_id:game.match_id,play_mode:'manual',...(kind==='flush'?{rules_revision:game.flush_settings.rules_revision}:{})});
   }
   const ctx=await browser.newContext({viewport:{width:390,height:844}});
   await ctx.addInitScript(({user,room,kind,site})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room,game:kind})),{user:users[0],room,kind,site});
   const page=await ctx.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(site);await page.getByRole('button',{name:/^Return to table ·/}).click();
   const header=page.getByTestId(kind==='flush'?'flush-mobile-header':`${kind}-header`);await header.waitFor();
   await header.evaluate(el=>{globalThis.savedHeader=el;});const headerBounds=await header.boundingBox();
   await page.getByRole('button',{name:'Table menu',exact:true}).click();
   const drawer=page.getByTestId(`${kind}-menu-drawer`);await drawer.waitFor();
   assert.equal(await drawer.getByRole('button',{name:'Copy Invite Link',exact:true}).isEnabled(),true);
   const endLabel=kind==='flush'?'End table':'End game';
   await drawer.getByRole('button',{name:endLabel,exact:true}).click();
   await page.getByRole('button',{name:`${endLabel} for everyone`,exact:true}).click();
   await page.getByTestId('ended-table-notice').waitFor();
   assert.equal(await header.evaluate(el=>el===globalThis.savedHeader),true,'same header mounted after ending');
   assert.deepEqual(await header.boundingBox(),headerBounds);
   await drawer.getByText(/players · ended/).waitFor();
   assert.equal(await drawer.getByRole('button',{name:'Copy Invite Link',exact:true}).isDisabled(),true);
   assert.equal(await drawer.getByRole('button',{name:'Poke the table',exact:true}).isDisabled(),true);
   assert.equal(await drawer.getByRole('button',{name:endLabel,exact:true}).isDisabled(),true);
   await page.getByRole('button',{name:'Close table menu',exact:true}).click();await drawer.waitFor({state:'hidden'});
   for(const viewport of [{width:390,height:844},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);await page.waitForTimeout(300);
    const notice=await page.getByTestId('ended-table-notice').boundingBox();
    assert.ok(notice.y>=0 && notice.y+notice.height<=viewport.height,'ended notice stays visible');
    await page.screenshot({path:`/tmp/ended-${kind}-${started}-${viewport.width}.png`});
    await page.getByRole('button',{name:'Table menu',exact:true}).click();await drawer.waitFor();
    assert.equal(await drawer.getByRole('button',{name:'Copy Invite Link',exact:true}).isDisabled(),true);
    await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
   }
   assert.equal((await api(root,users[0])).status,'ended');
   await page.getByTestId('ended-table-notice').getByRole('button',{name:'Back to room',exact:true}).click();
   await page.getByTestId('room-toolbar').waitFor();
   await ctx.close();console.log(`PASS ${kind}: ended ${started?'during play':'before start'}, consistent header/drawer, disabled sharing/actions, room navigation`);
  }
  assert.deepEqual(errors,[]);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
