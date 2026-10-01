const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8197';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  const password='Session-test-123',username=`session_${Date.now()}`;
  const create=await fetch(site+'/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,email:'session@example.test',display_name:'Session Player'})});assert.equal(create.status,201);
  await page.goto(site);await page.getByRole('button',{name:'Sign in or create account',exact:true}).click();await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();
  async function login(accountName=username) {
   await page.getByLabel('Username',{exact:true}).fill(accountName);await page.getByLabel('Password',{exact:true}).fill(password);
   const response=page.waitForResponse(r=>r.url().endsWith('/auth/signin')&&r.status()===200);
   await page.getByRole('button',{name:'Sign in',exact:true}).last().click();const session=await(await response).json();
   await page.getByRole('button',{name:'Open profile',exact:true}).waitFor();return session;
  }
  async function openLogin() {await page.getByRole('button',{name:'Sign in or create account',exact:true}).click();await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();}
  async function logout() {await page.getByRole('button',{name:'Open profile',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();}
  console.log('Checking session restoration');
  let session=await login();await page.reload();await page.getByRole('button',{name:'Open profile',exact:true}).waitFor();
  console.log('Checking expiry');
  // Revocation elsewhere returns this screen to login, including clearing passwords.
  await fetch(site+'/auth/signout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`},body:'{}'});
  await page.getByText('Your session has ended. Please sign in again.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();
  assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');
  session=await login();
  console.log('Checking online logout');
  const revoked=page.waitForResponse(r=>r.url().endsWith('/auth/signout'));
  await logout();await revoked;
  assert.equal((await fetch(site+'/auth/me',{headers:{Authorization:`Bearer ${session.token}`}})).status,401);
  await page.reload();await openLogin();await page.getByLabel('Password',{exact:true}).waitFor();
  console.log('Checking offline logout');
  session=await login();await page.route('**/auth/signout',route=>route.abort());await logout();
  await page.getByText('Signed out in this app. Server sign-out could not be confirmed. The previous session may remain valid until it expires or you reset your password.',{exact:true}).waitFor();
  await openLogin();await page.getByLabel('Password',{exact:true}).waitFor();
  await page.unroute('**/auth/signout');
  console.log('Checking storage failure');
  const secondName=username+'_other';
  const second=await fetch(site+'/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:secondName,password,email:'other@example.test',display_name:'Other Player'})});assert.equal(second.status,201);
  await login(secondName);await page.getByRole('button',{name:'Open profile',exact:true}).click();
  await page.getByTestId('profile-identity').getByRole('heading',{name:'Other Player',exact:true}).waitFor();
  assert.equal(await page.getByText('Session Player',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await openLogin();
  // Saving can fail while reading remains available: never restore the old account.
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(!globalThis.allowSessionWrite && k.startsWith('bhidne.session.v1:'))throw Error('simulated storage failure');return original.call(this,k,v);};});
  await login();await page.getByText('You are signed in for now, but this device could not save your login. You may need to sign in again after restarting.',{exact:true}).waitFor();
  await page.evaluate(()=>{globalThis.allowSessionWrite=true;});
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('You are signed in for now, but this device could not save your login. You may need to sign in again after restarting.',{exact:true}).waitFor({state:'hidden'});
  await page.evaluate(()=>{const original=Storage.prototype.removeItem;Storage.prototype.removeItem=function(k){if(!globalThis.allowSessionClear && k.startsWith('bhidne.session.v1:'))throw Error('simulated deletion failure');return original.call(this,k);};});
  await logout();await page.getByText('The saved login could not be erased. It may remain after restarting. Unlock your device and tap Retry to erase it.',{exact:true}).waitFor();
  await openLogin();await page.getByLabel('Password',{exact:true}).waitFor();
  await page.evaluate(()=>{globalThis.allowSessionClear=true;});await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.reload();await openLogin();await page.getByLabel('Password',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS session restart, expiry, online/offline logout, storage failure and return to sign-in');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
