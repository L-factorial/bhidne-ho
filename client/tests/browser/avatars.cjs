// Isolated exported-app fixtures; no live accounts or messages.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const kind of ['callbreak','marriage','flush']){
   const f=await fixture(browser,kind,4,390,false,s=>{
    s.players.forEach((p,i)=>p.avatar_url=i===0?'preset:male_01':i===1?'preset:female_02':null);
    s.table.seated_players.forEach((p,i)=>p.avatar_url=i===0?'preset:male_01':i===1?'preset:female_02':null);
   },[{id:'avatar-chat',sender_id:'u1',sender_name:'Sigma',sender_avatar_url:'preset:female_02',text:'Avatar hello',sent_at:Date.now()}]);
   const {page}=f;
   await page.getByTestId('player-avatar-image').first().waitFor();
   assert.equal(await page.getByTestId('player-avatar-image').count(),2);
   for(const img of await page.getByTestId('player-avatar-image').all())assert.ok(await img.evaluate(el=>Array.from(el.querySelectorAll('img')).every(img=>img.complete&&img.naturalWidth>0)));
   await page.getByRole('button',{name:'Table Chat',exact:true}).first().click();
   await page.getByTestId('table-chat-messages').getByTestId('player-avatar-image').waitFor();
   assert.deepEqual(f.errors,[]);await f.context.close();console.log(`PASS ${kind}: seat and table chat avatars`);
  }
  const f=await fixture(browser,'callbreak',4,390);
  const {page}=f;
  await page.getByRole('button',{name:'Back to lobby',exact:true}).first().evaluate(el=>el.click());
  await page.setViewportSize({width:320,height:740});
  let saved=null,failLoad=true;const writes=[];
  await page.route('**/me/profile/avatar',async route=>{
   if(route.request().method()==='GET'&&failLoad)return route.fulfill({status:503,json:{detail:'Avatar settings temporarily unavailable.'}});
   if(route.request().method()==='PATCH'){saved=route.request().postDataJSON().avatar_id;writes.push(saved);}
   await route.fulfill({json:{avatar_id:saved,avatar_url:saved?'preset:'+saved:null}});
  });
  await page.route('**/auth/recovery/email',route=>route.fulfill({json:{enabled:true,password_account:true,verified_email:'fixture@example.test',pending_email:null}}));
  await page.getByRole('button',{name:'Open profile',exact:true}).click();
  const profile=page.getByTestId('profile-screen');await profile.getByText('Display name',{exact:true}).waitFor();
  await profile.getByTestId('profile-identity').getByRole('heading',{name:'u0',exact:true}).waitFor();
  assert.equal((await profile.getByTestId('profile-identity').innerText()).replace(/[\uE000-\uF8FF]/g,'').trim(),'u0');
  assert.equal(await profile.getByText('The name other players see at the game table.',{exact:false}).count(),0);
  assert.equal(await profile.getByTestId('recovery-email-settings').getByText('Add or replace your recovery email',{exact:false}).count(),0);
  assert.equal(await profile.getByRole('heading',{name:'u0',exact:true}).evaluate(el=>getComputedStyle(el).fontSize),await profile.getByRole('heading',{name:'Your profile',exact:true}).evaluate(el=>getComputedStyle(el).fontSize));
  const before=await profile.getByTestId('profile-name-value').boundingBox();
  await page.getByTestId('profile-avatar-edit').click();
  const picker=page.getByTestId('profile-avatar-picker');
  await picker.getByRole('button',{name:'Retry',exact:true}).waitFor();
  assert.equal(await picker.getByTestId('avatar-choice-default').isDisabled(),true);assert.deepEqual(writes,[]);
  failLoad=false;await picker.getByRole('button',{name:'Retry',exact:true}).click();
  await picker.getByRole('button',{name:'Retry',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('radio',{name:'Female',exact:true}).click();
  assert.equal(await page.getByRole('radio',{name:'Female',exact:true}).getAttribute('aria-checked'),'true');
  assert.equal(await page.getByRole('radio',{name:'Male',exact:true}).getAttribute('aria-checked'),'false');
  assert.equal(await page.locator('[data-testid^="avatar-choice-female_"]').count(),15);
  assert.equal(await page.locator('[data-testid^="avatar-choice-male_"]').count(),0);
  await page.getByTestId('avatar-choice-female_15').click();
  await page.getByTestId('profile-avatar-picker').waitFor({state:'hidden'});
  await page.getByTestId('profile-avatar-edit').getByTestId('player-avatar-image').waitFor();
  const after=await profile.getByTestId('profile-name-value').boundingBox();assert.equal(after.height,before.height);
  await page.getByRole('button',{name:'Back from profile',exact:true}).click();await profile.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Open profile',exact:true}).click();await page.getByTestId('profile-avatar-edit').getByTestId('player-avatar-image').waitFor();
  await page.getByTestId('profile-avatar-edit').click();await page.getByRole('radio',{name:'Female',exact:true,checked:true}).waitFor();
  await page.getByTestId('avatar-choice-female_15').waitFor();assert.equal(await page.getByTestId('avatar-choice-female_15').getAttribute('aria-checked'),'true');
  await page.getByTestId('avatar-choice-default').click();
  await page.getByTestId('profile-avatar-picker').waitFor({state:'hidden'});
  assert.deepEqual(writes,['female_15',null]);assert.deepEqual(f.errors,[]);
  await profile.getByRole('button',{name:'Sign out',exact:true}).click();await profile.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Sign in or sign up',exact:true}).click();
  await page.getByRole('button',{name:'Continue with username or email',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Google|Facebook|Apple/}).count(),0);
  assert.equal(await page.getByText('Social sign-in is not available yet.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();await page.getByRole('textbox',{name:'Username or email',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Google|Facebook|Apple/}).count(),0);
  await page.getByRole('button',{name:'Sign up',exact:true}).click();await page.getByRole('button',{name:'Sign up with username or email',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Google|Facebook|Apple/}).count(),0);
  await page.getByRole('button',{name:'Sign up with username or email',exact:true}).click();await page.getByRole('textbox',{name:'Email',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Google|Facebook|Apple/}).count(),0);
  assert.deepEqual(f.errors,[]);
  await f.context.close();console.log('PASS profile/auth: loading retry, overlay filters, persistence/reset, compact identity and account-only auth at 320px');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
