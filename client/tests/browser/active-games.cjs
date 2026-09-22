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
  let attempts=0;
  await page.route(site+'/active-tables',route=>++attempts===1?route.abort('failed'):route.continue());
  await page.goto(site);
  await page.getByRole('tab',{name:'Active games',exact:true}).click();
  for(const label of ['All','Flush','Marriage','Call Break'])await page.getByRole('tab',{name:`${label} games`,exact:true}).waitFor();
  await page.getByRole('tab',{name:'Flush games',exact:true}).click();
  await page.getByTestId(`table-card-${flush.match_id}`).waitFor();
  assert.equal(await page.getByTestId(`table-card-${cb.match_id}`).count(),0);
  await page.getByRole('tab',{name:'All games',exact:true}).click();
  await page.getByRole('button',{name:'Join queue · Full Flush',exact:true}).waitFor();
  assert.ok(attempts>=2);
  assert.equal(await page.getByTestId('active-games-error').count(),0,'brief failure recovers without an error banner');
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
  assert.equal(await page.getByTestId(/^table-card-/).first().getAttribute('data-testid'),`table-card-${cb.match_id}`,'own table sorts first');
  await api(root+'/end',users[1],{match_id:marriage.match_id});
  await page.getByRole('button',{name:'Refresh active games',exact:true}).click();
  await page.getByTestId(`table-card-${marriage.match_id}`).waitFor({state:'hidden'});
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});await page.screenshot({path:`/tmp/active-games-${width}.png`,fullPage:true});}
  await page.route(site+'/active-tables',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Refresh active games',exact:true}).click();
  await page.getByTestId('active-games-error').waitFor();
  await page.getByTestId(`table-card-${cb.match_id}`).waitFor();
  await page.unroute(site+'/active-tables');
  await page.route(site+'/active-tables',route=>route.fulfill({json:[]}));
  await page.getByRole('button',{name:'Retry active games',exact:true}).click();
  await page.getByTestId('active-games-empty').waitFor();
  assert.equal(await page.getByTestId('active-games-empty').count(),1);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/active-games-empty.png'});
  await page.getByRole('button',{name:'Browse rooms',exact:true}).click();
  await page.getByRole('heading',{name:'Your rooms',exact:true}).waitFor();
  await page.unroute(site+'/active-tables');
  await page.route(site+'/active-tables',route=>route.abort('failed'));
  await page.getByRole('tab',{name:'Active games',exact:true}).click();
  await page.getByTestId('active-games-error').waitFor();
  assert.equal(await page.getByRole('tab',{name:'All games',exact:true}).innerText(),'All','failed initial load must not claim zero tables');
  assert.equal(await page.getByTestId('active-games-empty').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS Active games: filters, priority, watch/queue/seat/return, ended filtering, responsive layout, retries and empty/error states');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
