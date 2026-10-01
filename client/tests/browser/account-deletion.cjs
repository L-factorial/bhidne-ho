const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8197';
async function request(path, body, token) {
 return fetch(site+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
}
async function mail(purpose, username) {
 for(let i=0;i<120;i++) {
  const rows=fs.readFileSync(process.env.RECOVERY_TEST_MAILBOX,'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const value=rows.find(v=>v.purpose===purpose&&v.email===username+'@example.test');
  if(value)return value;
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('Missing local test email '+purpose);
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const username='delete_'+Date.now(),password='Delete-test-123';
  const user=await(await request('/auth/signup',{username,password,email:username+'@example.test',display_name:'Deletion Player'})).json();
  await page.goto(site);await page.getByRole('button',{name:'Sign in or sign up',exact:true}).click();await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).last().click();
  await page.getByRole('button',{name:'Open profile',exact:true}).click();
  await page.getByRole('button',{name:'Delete account',exact:true}).click();
  await page.getByRole('heading',{name:'Delete account',exact:true}).waitFor();
  await page.getByRole('button',{name:'Choose language',exact:true}).last().click();
  await page.getByRole('radio',{name:'नेपाली',exact:true}).click();
  await page.getByRole('button',{name:'भाषा छान्नुहोस्',exact:true}).last().click();
  await page.getByRole('radio',{name:'English',exact:true}).click();
  await page.getByRole('button',{name:'Choose theme',exact:true}).last().click();
  await page.getByTestId('table-theme-heritage').click();
  await page.getByRole('button',{name:'Close themes',exact:true}).last().click();
  const confirm=page.getByRole('button',{name:'Confirm account deletion',exact:true});
  assert.equal(await confirm.isDisabled(),true);
  await page.getByLabel('Current password',{exact:true}).fill('incorrect');
  await page.getByLabel('Type DELETE to confirm',{exact:true}).fill('DELETE');
  await confirm.click();await page.getByText('The password or confirmation link is invalid or expired.',{exact:true}).waitFor();
  await page.getByLabel('Current password',{exact:true}).fill(password);await confirm.click();
  await page.getByText('Deletion requested. Account access has been disabled. Cleanup is pending; keep this page to check its status.',{exact:true}).waitFor();
  assert.equal((await fetch(site+'/auth/me',{headers:{Authorization:`Bearer ${user.token}`}})).status,401);
  await page.reload();await page.goto(site+'/delete-account');
  await page.getByText('Deletion requested. Account access has been disabled. Cleanup is pending; keep this page to check its status.',{exact:true}).waitFor();
  // A separate browser context exercises a signed-out, verified-mail request.
  const publicPage=await browser.newPage({viewport:{width:390,height:844}});publicPage.on('pageerror',e=>errors.push(e.message));
  const publicName=username+'_mail';
  const account=await(await request('/auth/signup',{username:publicName,password,email:publicName+'@example.test'})).json();
  const verification=await mail('verify_email',publicName);
  assert.equal((await request('/auth/recovery/verify',{token:verification.token})).status,200);
  await publicPage.goto(site+'/delete-account');
  await publicPage.getByLabel('Username',{exact:true}).fill(publicName);
  await publicPage.getByLabel('Email',{exact:true}).fill(publicName+'@example.test');
  await publicPage.getByRole('button',{name:'Send deletion link',exact:true}).click();
  await publicPage.getByText('If the username and verified email match, a deletion link will arrive. Opening the link does not delete the account.',{exact:true}).waitFor();
  const proof=await mail('delete_account',publicName);
  await publicPage.goto(site+'/delete-account#delete_account='+proof.token);
  await publicPage.getByLabel('Type DELETE to confirm',{exact:true}).waitFor();
  assert.equal(new URL(publicPage.url()).hash,'');
  assert.equal((await fetch(site+'/auth/me',{headers:{Authorization:`Bearer ${account.token}`}})).status,200);
  await publicPage.getByLabel('Type DELETE to confirm',{exact:true}).fill('DELETE');
  await publicPage.getByRole('button',{name:'Confirm account deletion',exact:true}).click();
  await publicPage.getByText('Deletion requested. Account access has been disabled. Cleanup is pending; keep this page to check its status.',{exact:true}).waitFor();
  assert.equal((await fetch(site+'/auth/me',{headers:{Authorization:`Bearer ${account.token}`}})).status,401);
  assert.deepEqual(errors,[]);console.log('PASS profile deletion, proof rejection, language/theme, reload status and private email confirmation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
