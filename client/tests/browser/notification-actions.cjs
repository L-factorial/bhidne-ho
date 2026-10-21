// All account, notification and chat calls are intercepted local fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280]){
  const f=await fixture(browser,'callbreak',4,width),{page}=f;
  const friends=[{user_id:'u1',display_name:'Friend One'},{user_id:'u2',display_name:'Friend Two'}];
  const notices=friends.map((actor,i)=>({id:'notice-'+i,kind:'chat',read:false,actor,created_at:Date.now(),payload:{scope:'direct'}}));
  let fail=true;const reads=[];
  await page.route('**/notifications',route=>route.fulfill({json:notices}));
  await page.route('**/notifications/read',async route=>{
   const {ids}=route.request().postDataJSON();assert.ok(Array.isArray(ids),'must read specific IDs');
   if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Read temporarily unavailable'}});}
   reads.push(...ids);notices.forEach(n=>{if(ids.includes(n.id))n.read=true;});
   await route.fulfill({status:204});
  });
  await page.route('**/friends',route=>route.fulfill({json:{friends,incoming:[],outgoing:[]}}));
  await page.route('**/friends?*',route=>route.fulfill({json:{friends,incoming:[],outgoing:[],online_friend_ids:['u1','u2']}}));
  await page.route('**/friends/conversations',route=>route.fulfill({json:[]}));
  await page.route('**/friends/*/messages',route=>route.fulfill({json:[]}));
  await page.getByRole('button',{name:'Back to lobby',exact:true}).first().evaluate(el=>el.click());
  await page.getByRole('button',{name:/^Notifications, 2 unread$/}).waitFor();
  await page.getByRole('button',{name:/^Notifications/}).click();
  const acknowledged=page.waitForResponse(response=>new URL(response.url()).pathname==='/notifications/read'&&response.status()===204);
  await page.getByRole('button',{name:'Chat',exact:true}).first().click();
  await page.getByRole('heading',{name:'Chat with Friend One',exact:true}).waitFor();
  await acknowledged;
  await page.getByRole('button',{name:'Close private chat',exact:true}).click();
  await page.getByRole('button',{name:/^Notifications, 1 unread$/}).waitFor();
  await page.getByRole('button',{name:/^Notifications/}).click();
  assert.equal(await page.getByText('Friend One sent you a chat message',{exact:true}).count(),0);
  await page.getByText('Friend Two sent you a chat message',{exact:true}).waitFor();
  assert.ok(reads.includes('notice-0'));assert.ok(!reads.includes('notice-1'));
  assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${width}: acknowledgement failure does not block chat; retry removes only related notice`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
