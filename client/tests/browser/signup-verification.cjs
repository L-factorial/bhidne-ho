// Local UI fixtures only; real SQL/queue/verification is exercised by backend tests.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL || 'http://127.0.0.1:8098';
assert.ok(['localhost','127.0.0.1'].includes(new URL(site).hostname));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  let pending='signup@example.test',verified=null,resends=0;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('bhidne.language','en'));
  await page.clock.install();
  await page.route('**/*',async route=>{
   const p=new URL(route.request().url()).pathname;
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   let json=[];
   if(p==='/auth/signup') json={user_id:'signup-user',username:'signup_player',token:'local-fixture'};
   else if(p==='/auth/me'||p==='/me/profile')json={user_id:'signup-user',display_name:'Signup Player',username:'signup_player'};
   else if(p==='/auth/recovery/email'&&route.request().method()==='POST'){
    assert.equal(route.request().postDataJSON().current_password,'original-password');
    pending=route.request().postDataJSON().email; json={accepted:true};
   }
   else if(p==='/auth/recovery/email')json={enabled:true,password_account:true,pending_email:pending,verified_email:verified};
   else if(p==='/auth/recovery/email/resend'){resends++;json={accepted:true};}
   else if(p==='/me/community-rules')json={accepted:true,version:'2026-10-01',muted_until:null};
   else if(p==='/friends')json={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
   else if(p==='/rooms'||p==='/notifications'||p==='/active-tables'||p==='/memberships')json=[];
   else if(p==='/public/policy')json={ready:true,minimum_age:18};
   else if(p==='/auth/social/browser/providers'||p==='/auth/social/providers')json={providers:[]};
   await route.fulfill({json});
  });
  await page.goto(site);
  await page.getByRole('button',{name:'Sign in or sign up',exact:true}).click();
  await page.getByRole('button',{name:'Sign up',exact:true}).click();
  await page.getByRole('button',{name:'Sign up with username or email',exact:true}).click();
  for(const [label,value] of [['Username','signup_player'],['Email',pending],['Password','original-password'],['Confirm password','original-password']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('checkbox',{name:'I agree to the community rules',exact:true}).click();
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('heading',{name:'Check your email',exact:true}).waitFor({timeout:10000}).catch(async e=>{console.log(errors);console.log(await page.locator('body').innerText());throw e;});
  assert.ok(await page.getByRole('button',{name:/Resend in/}).isDisabled());
  await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll('[role=button]')).find(el=>el.textContent==='Continue to app');return button && button.getBoundingClientRect().bottom<=innerHeight;});
  await page.screenshot({path:`/tmp/bhidne-signup-verification-${width}.png`});
  for(let i=0;i<61;i++) await page.clock.fastForward(1000);
  await page.getByRole('button',{name:'Resend email',exact:true}).click();
  assert.equal(resends,1);
  await page.getByRole('button',{name:'Change email',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill('corrected@example.test');
  await page.getByLabel('Current password',{exact:true}).fill('original-password');
  await page.getByRole('button',{name:'Send verification email',exact:true}).click();
  await page.getByText('Awaiting verification: corrected@example.test',{exact:true}).waitFor();
  pending=null;verified='corrected@example.test';
  await page.clock.runFor(6000);
  await page.getByRole('heading',{name:'Email verified',exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue to app',exact:true}).click();
  await page.getByRole('heading',{name:'Email verified',exact:true}).waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS signup verification UI at '+width);
  await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
