// Isolated local fixtures: no real account creation or profile writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
assert.ok(['localhost','127.0.0.1'].includes(new URL(site).hostname));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280])for(const mode of ['save','skip','signin']){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
  let saved=null,failSave=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('bhidne.language','en'));
  await page.route(site+'/**',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   let json=[];
   if(p==='/auth/signup'||p==='/auth/signin')json={user_id:'new-user',token:'fixture'};
   else if(p==='/auth/me'||p==='/me/profile')json={user_id:'new-user',display_name:'New Player',username:'new_player',avatar_url:saved?`preset:${saved}`:null};
   else if(p==='/me/profile/avatar'){
    if(request.method()==='PATCH'){
     writes.push(request.postDataJSON());
     if(failSave){failSave=false;return route.fulfill({status:503,json:{detail:'Try again'}});}
     saved=request.postDataJSON().avatar_id;
    }
    json={avatar_id:saved,avatar_url:saved?`preset:${saved}`:null};
   }
   else if(p==='/auth/recovery/email')json={enabled:true,password_account:true,pending_email:null,verified_email:'new@example.test'};
   else if(p==='/me/community-rules')json={accepted:true,version:'2026-10-01',muted_until:null};
   else if(p==='/friends')json={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
   else if(p==='/public/policy')json={ready:true,minimum_age:18};
   else if(p==='/auth/social/browser/providers'||p==='/auth/social/providers')json={providers:[]};
   await route.fulfill({json});
  });
  await page.goto(site);
  await page.getByRole('button',{name:'Sign in or sign up',exact:true}).click();
  if(mode!=='signin')await page.getByRole('button',{name:'Sign up',exact:true}).click();
  await page.getByRole('button',{name:mode==='signin'?'Continue with username or email':'Sign up with username or email',exact:true}).click();
  await page.getByLabel(mode==='signin'?'Username or email':'Username',{exact:true}).fill('new_player');
  await page.getByLabel('Password',{exact:true}).fill('original-password');
  if(mode!=='signin'){
   await page.getByLabel('Email',{exact:true}).fill('new@example.test');
   await page.getByLabel('Confirm password',{exact:true}).fill('original-password');
   await page.getByRole('checkbox',{name:'I agree to the community rules',exact:true}).click();
  }
  await page.getByRole('button',{name:mode==='signin'?'Sign in':'Create account',exact:true}).last().click();
  if(mode==='signin'){
   await page.getByRole('tab',{name:'Home',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Skip for now',exact:true}).count(),0);
  }else{
   const picker=page.getByTestId('profile-avatar-picker');await picker.waitFor();
   if(mode==='skip')await picker.getByRole('button',{name:'Skip for now',exact:true}).click();
   else{
    const choice=picker.getByTestId('avatar-choice-male_01');await choice.click();
    await picker.getByRole('alert').waitFor();await choice.click();
   }
   await picker.waitFor({state:'hidden'});
   await page.getByRole('tab',{name:'Home',exact:true}).waitFor();
   assert.equal(saved,mode==='save'?'male_01':null);
   assert.equal(writes.length,mode==='save'?2:0);
   await page.reload();await page.getByRole('tab',{name:'Home',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Skip for now',exact:true}).count(),0);
  }
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${mode} ${width}`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
