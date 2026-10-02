const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL || 'http://127.0.0.1:4188';
assert.ok(['localhost','127.0.0.1'].includes(new URL(site).hostname));
// Run against a local Expo export with EXPO_PUBLIC_RUNTIME_MODE=legacy.
// API responses are fixtures; no requests reach a live account or backend.
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let friends=[{user_id:'friend1',display_name:'Ekraj',username:'ekraj'},{user_id:'friend2',display_name:'Suman',username:'suman'}];
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   if(p.startsWith('/assets/')||p.includes('/_expo/')||p==='/'||p==='/favicon.ico')return route.continue();
   const result=p==='/public/policy'?{ready:true,operator:'Lfactorial',contact:'prajwal@lfactorial.com',minimum_age:18,backups:'No configured database backups.'}:
    p==='/auth/signin'?{user_id:'me',token:'local-ui-fixture'}:
    p==='/auth/me'?{user_id:'me',username:'review',display_name:'Review'}:
    p==='/auth/safety/capabilities'?{blocking:true,reporting:true}:
    p==='/me/community-rules'?{accepted:true,version:'1',muted_until:null}:
    p==='/friends'?{friends,incoming:[{user_id:'req',display_name:'Incoming',username:'incoming'}],outgoing:[],online_friend_ids:['friend2']}:
    p==='/players/search'?[{user_id:'new',display_name:'Prajwal',username:'prajwal'}]:
    p.endsWith('/messages')?[{id:'own',sender_id:'me',recipient_id:'friend1',text:'My own message',sent_at:Date.now()},{id:'other',sender_id:'friend1',recipient_id:'me',text:'Hello from Ekraj',sent_at:Date.now()}]:
    p==='/auth/social/providers'?{providers:[]}:
    p==='/me/phrases'?{items:[]}:
    p==='/rooms'?[]:
    p==='/auth/deletion/capabilities'?{enabled:false}:{};
   if(p==='/friends/friend1'&&route.request().method()==='DELETE')friends=friends.filter(f=>f.user_id!=='friend1');
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(site);
  await page.getByText('Play together. Stay connected.',{exact:true}).waitFor();
  for(const label of ['Privacy','Terms','Community rules','Support']){
   await page.getByRole('link',{name:label,exact:true}).click();
   const back=page.getByRole('button',{name:'Back',exact:true});await back.waitFor();
   assert.equal(await back.count(),1);assert.ok((await back.boundingBox()).y<150);
   await back.click();
  }
  await page.screenshot({path:`/private/tmp/bhidne-welcome-review-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Sign in or sign up',exact:true}).click();
  await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();
  await page.getByRole('button',{name:'Forgot username or password?',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Delete account',exact:true}).count(),0);
  await page.getByLabel('Username',{exact:true}).fill('review');await page.getByLabel('Password',{exact:true}).fill('Fixture-password-123');await page.getByRole('button',{name:'Sign in',exact:true}).last().click();
  await page.getByRole('tab',{name:'Friends',exact:true}).click();
  await page.getByText('Ekraj',{exact:true}).waitFor();
  await page.getByLabel('Find players').fill('prajwal');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByText('Prajwal',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Player actions · Ekraj',exact:true}).click();
  await page.getByRole('button',{name:'⚑ Report player',exact:true}).click();
  await page.getByRole('heading',{name:'Report player',exact:true}).waitFor();
  await page.getByTestId('room-sheet-close').click();
  await page.getByRole('button',{name:'Player actions · Ekraj',exact:true}).click();
  await page.getByRole('button',{name:'⊘ Block player',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).last().click();
  await page.getByRole('button',{name:'Player actions · Ekraj',exact:true}).click();
  await page.getByRole('button',{name:'Remove friend',exact:true}).waitFor();
  await page.screenshot({path:`/private/tmp/bhidne-friends-review-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Message',exact:true}).first().click();
  await page.getByText('Hello from Ekraj',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Message actions',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Report message',exact:true}).count(),0);
  await page.getByRole('button',{name:'Message actions',exact:true}).click();
  await page.getByRole('button',{name:'🚩 Report message',exact:true}).click();
  await page.getByRole('heading',{name:'Report message',exact:true}).waitFor();
  await page.getByTestId('room-sheet-close').last().click();
  await page.screenshot({path:`/private/tmp/bhidne-chat-review-${width}.png`,fullPage:true});
  await page.getByTestId('room-sheet-close').click();
  await page.getByRole('button',{name:'Player actions · Ekraj',exact:true}).click();
  await page.getByRole('button',{name:'Remove friend',exact:true}).click();
  await page.getByText('Ekraj',{exact:true}).waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);console.log('PASS UI review at '+width);await context.close();
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
