const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const site = process.env.TEST_WEB_URL || 'http://127.0.0.1:8197';
async function api(path, body, token, method) {
 const response = await fetch(site+path, {method:method || (body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.ok(response.ok, `${path}: ${response.status}`);return response.json();
}
(async()=>{
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const username='block_'+Date.now(), password='Blocking-test-123';
  const a=await api('/auth/signup',{username,password,email:username+'@example.test',display_name:'Block Owner'});
  const b=await api('/auth/signup',{username:username+'_other',password,email:username+'_other@example.test',display_name:'Block Target'});
  await page.goto(site);await page.getByRole('button',{name:'Sign in or create account',exact:true}).click();await page.getByRole('button',{name:'Continue with username or email',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill(username);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).last().click();
  await page.getByRole('button',{name:'Open profile',exact:true}).click();
  await page.getByLabel('Find players',{exact:true}).fill('Block Target');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('button',{name:'Block Block Target',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).last().click();
  assert.equal((await api('/me/blocks',undefined,a.token)).items.length,0);
  await page.getByRole('button',{name:'Block Block Target',exact:true}).click();
  await page.getByRole('button',{name:'Block player',exact:true}).click();
  await page.getByRole('button',{name:'Manage blocked players',exact:true}).click();
  await page.getByRole('button',{name:'Unblock Block Target',exact:true}).waitFor();
  assert.equal((await api('/me/blocks',undefined,a.token)).items[0].user_id,b.user_id);
  assert.equal((await api('/me/blocks',undefined,b.token)).items.length,0);
  // Reload exercises persisted server state, independent of component state.
  await page.reload();await page.getByRole('button',{name:'Open profile',exact:true}).click();
  await page.getByRole('button',{name:'Manage blocked players',exact:true}).click();
  await page.getByRole('button',{name:'Unblock Block Target',exact:true}).click();
  await page.getByText('You have not blocked anyone.',{exact:true}).waitFor();
  assert.equal((await api('/me/blocks',undefined,a.token)).items.length,0);
  await page.getByTestId('room-sheet-close').last().click();
  await page.getByRole('button',{name:'Choose language',exact:true}).last().click();
  await page.getByRole('radio',{name:'नेपाली',exact:true}).click();
  await page.getByRole('button',{name:'ब्लक गरिएका खेलाडीहरू व्यवस्थापन गर्नुहोस्',exact:true}).click();
  await page.getByText('तपाईंले कसैलाई ब्लक गर्नुभएको छैन।',{exact:true}).waitFor();
  await page.getByTestId('room-sheet-close').last().click();
  await page.getByRole('button',{name:'भाषा छान्नुहोस्',exact:true}).last().click();
  await page.getByRole('radio',{name:'English',exact:true}).click();
  await page.getByRole('button',{name:'Choose theme',exact:true}).last().click();
  await page.getByTestId('table-theme-heritage').click();
  await page.getByRole('button',{name:'Close themes',exact:true}).last().click();
  await page.getByRole('button',{name:'Manage blocked players',exact:true}).click();
  await page.getByText('You have not blocked anyone.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS mobile-width block confirmation/cancel, persisted list, unblock, owner isolation, Nepali and theme');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
