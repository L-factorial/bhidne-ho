// Run against a local memory-runtime server and web export.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
async function api(path,user,body){
 const r=await fetch(site+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.ok(r.ok,await r.clone().text());return r.json();
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const stamp=Date.now(), users=[];
  for(let i=0;i<3;i++)users.push(await api('/auth/signup',null,{username:'tabs_'+stamp+'_'+i,password:'Lobby-test-123'}));
  const [viewer,friend,stranger]=users;
  await api('/friends/requests/'+friend.user_id,viewer,{});
  await api('/friends/requests/'+viewer.user_id+'/accept',friend,{});
  const own=await api('/rooms',viewer,{name:'Owned private'});
  const joined=await api('/rooms',stranger,{name:'Joined private',invitees:[viewer.user_id]});
  await api('/rooms/'+joined.room_id+'/enter',viewer,{});
  const friendPublic=await api('/rooms',friend,{name:'Friend public',visibility:'public'});
  const friendPrivate=await api('/rooms',friend,{name:'Friend private'});
  const strangerPublic=await api('/rooms',stranger,{name:'Stranger public',visibility:'public'});
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  await ctx.addInitScript(({site,viewer})=>sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:viewer,room:null,game:null})),{site,viewer});
  const page=await ctx.newPage();page.setDefaultTimeout(10000);await page.goto(site);
  await page.getByTestId('active-games').waitFor();
  await page.getByTestId('active-games-empty').waitFor();
  assert.equal(await page.getByTestId('active-games-empty').getByRole('button',{name:'Create room',exact:true}).count(),1);
  const tab=name=>page.getByRole('tab',{name,exact:true}), card=r=>page.getByTestId('room-card-'+r.room_id);
  await tab('Your rooms').click();
  await card(own).waitFor();await card(joined).waitFor();
  assert.equal(await card(friendPublic).count(),0);
  await tab('Friends’ rooms').click();
  await card(friendPublic).waitFor();
  assert.equal(await card(friendPrivate).count(),0);
  assert.equal(await card(strangerPublic).count(),0);
  await page.getByRole('button',{name:'Join Friend public',exact:true}).click();
  await page.getByRole('button',{name:'Back to lobby',exact:true}).click();
  await card(friendPublic).waitFor();
  await tab('Recent').click();await card(friendPublic).waitFor();
  await tab('Your rooms').click();await card(friendPublic).waitFor();
  await tab('Friends’ rooms').click();
  await page.getByRole('button',{name:'Browse all public rooms →',exact:true}).click();
  await card(strangerPublic).waitFor();
  assert.equal(await card(friendPrivate).count(),0);
  console.log('PASS active games default, owned/joined rooms, friend-only public rooms, recent, public directory');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
