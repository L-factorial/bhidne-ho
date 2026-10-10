const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8129';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[],writes=[];
  let name='Ekraj';
  await context.addInitScript(site=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'},room:null,game:null}));},site);
  page.on('pageerror',e=>errors.push(e.message));
  await context.route(site+'/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   let body=[];
   if(p==='/me/profile'&&req.method()==='PATCH'){writes.push(req.postDataJSON());name=req.postDataJSON().display_name;}
   if(p==='/auth/me'||p==='/me/profile')body={user_id:'u0',username:'ekraj',display_name:name};
   else if(p==='/auth/safety/capabilities')body={blocking:true,reporting:false};
   else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01'};
   else if(p==='/me/blocks')body={items:[],next_id:null};
   await route.fulfill({json:body});
  });
  await page.goto(site);await page.getByRole('button',{name:'Open profile',exact:true}).click();
  const edit=page.getByTestId('profile-name-edit');await edit.waitFor();
  assert.equal(await page.getByTestId('profile-name-input').count(),0);
  await edit.click();const input=page.getByTestId('profile-name-input'),save=page.getByTestId('profile-name-save');
  assert.ok(await save.isDisabled());await input.fill('Cancelled');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  assert.equal(await page.getByTestId('profile-name-value').innerText(),'Ekraj');
  await edit.click();assert.equal(await input.inputValue(),'Ekraj');await input.fill('Ekraj Updated');
  assert.ok(await save.isEnabled());await save.click();await page.getByTestId('profile-name-value').getByText('Ekraj Updated',{exact:true}).waitFor();
  assert.deepEqual(writes,[{display_name:'Ekraj Updated'}]);assert.equal(await input.count(),0);
  await page.getByRole('tab',{name:'Information & Support',exact:true}).click();
  const manage=page.getByTestId('manage-blocked-players');await manage.waitFor();
  const bounds=await manage.boundingBox();assert.ok(bounds.width<=width&&bounds.height>=48);
  assert.notEqual(await manage.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  await manage.click();await page.getByRole('heading',{name:'Blocked players',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS Profile ${width}: edit/cancel/save and blocked-player button`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
