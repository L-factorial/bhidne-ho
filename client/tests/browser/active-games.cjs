const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path, user, body) {
 const r = await fetch(site+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json(); assert.ok(r.ok,JSON.stringify(data)); return data;
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const users=[];for(let i=0;i<5;i++)users.push(await api('/auth/signup',null,{username:`active_${Date.now()}_${i}`,display_name:`Player ${i}`,password:'Active-games-test-123'}));
  const room=await api('/rooms',users[0],{name:'Festival friends'}), root=`/test-games/${room.room_id}`;
  for(const u of users.slice(1))await api(`/rooms/${room.room_id}/enter`,u,{});
  const flush=await api(root,users[0],{name:'Full Flush',game_type:'flush',player_count:2});
  const marriage=await api(root,users[1],{name:'Evening Marriage',game_type:'marriage',player_count:2});
  const cb=await api(root,users[2],{name:'Open Call Break',game_type:'callbreak',player_count:4});
  await api(root+'/join',users[4],{match_id:flush.match_id});
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({site,user})=>sessionStorage.setItem(`bhidne.session.v1:${site}`,JSON.stringify({session:user,room:null,game:null})),{site,user:users[3]});
  await page.goto(site);
  await page.getByRole('tab',{name:'Active games',exact:true}).click();
  for(const kind of ['flush','marriage','callbreak'])await page.getByTestId(`active-games-${kind}`).waitFor();
  await page.getByRole('button',{name:'Join queue · Full Flush',exact:true}).waitFor();
  await page.getByRole('button',{name:'Take seat · Open Call Break',exact:true}).waitFor();
  await page.getByRole('button',{name:'Watch · Evening Marriage',exact:true}).click();
  await page.getByTestId('live-game-overlay').waitFor();
  assert.equal((await api(root+`?match_id=${marriage.match_id}`,users[3])).table.current_user.is_seated,false);
  async function lobby(){await page.getByTestId('live-game-overlay').getByRole('button',{name:'Back to lobby',exact:true}).click();await page.getByTestId('live-game-overlay').waitFor({state:'hidden'});await page.getByTestId('room-hero').getByRole('button',{name:'Back to lobby',exact:true}).click();await page.getByRole('tab',{name:'Active games',exact:true}).click();}
  await lobby();
  await page.getByRole('button',{name:'Join queue · Full Flush',exact:true}).click();
  await page.getByTestId('flush-table').waitFor();
  assert.equal((await api(root+`?match_id=${flush.match_id}`,users[3])).table.current_user.is_queued,true);
  await lobby();
  await page.getByRole('button',{name:'Watch · Full Flush',exact:true}).waitFor();
  await page.getByText('Queue #1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Take seat · Open Call Break',exact:true}).click();
  await page.getByTestId('live-game-overlay').waitFor();
  assert.equal((await api(root+`?match_id=${cb.match_id}`,users[3])).table.current_user.is_seated,true);
  await lobby();
  await page.getByRole('button',{name:'Return to table · Open Call Break',exact:true}).waitFor();
  await api(root+'/end',users[1],{match_id:marriage.match_id});
  await page.getByRole('button',{name:'Refresh active games',exact:true}).click();
  await page.getByTestId(`table-card-${marriage.match_id}`).waitFor({state:'hidden'});
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});await page.screenshot({path:`/tmp/active-games-${width}.png`,fullPage:true});}
  assert.deepEqual(errors,[]);
  console.log('PASS Active games: grouping, watch, queue, seat, return, ended filtering, responsive layout');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
