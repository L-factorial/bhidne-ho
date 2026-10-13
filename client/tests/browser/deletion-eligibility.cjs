// All account requests are local fixtures; no real deletion or email delivery.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
assert.ok(['localhost','127.0.0.1'].includes(new URL(site).hostname));
const token='t'.repeat(43);
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280])for(const mode of ['signed','token']){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(12000);
  const errors=[],posts=[];let blockers=[{kind:'end_table',room_id:'my-room',table_id:'table',name:'My table'},{kind:'settle_ledger',room_id:'old-room',table_id:'old-table'}],verified=true,late=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({site,mode})=>{
   localStorage.setItem('bhidne.language','en');
   if(mode==='signed')sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'fixture',token:'fixture-token'},room:null,game:null}));
  },{site,mode});
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   assert.equal(url.origin,site);
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   if(p==='/delete-account')return route.fulfill({contentType:'text/html',body:fs.readFileSync((process.env.WEB_EXPORT_DIR||'/private/tmp/bhidne-deletion-blockers-web')+'/index.html','utf8')});
   let json={};
   if(p==='/auth/deletion/capabilities')json={enabled:true};
   else if(p==='/auth/deletion/preflight')json={ready:!blockers.length,blockers,email_verified:verified};
   else if(p==='/auth/deletion/request'){posts.push(p);json={accepted:true};assert.deepEqual(req.postDataJSON(),{current_password:'original-password'});}
   else if(p==='/auth/deletion/confirm'){
    posts.push(p);assert.deepEqual(req.postDataJSON(),{token,confirmation:'DELETE'});
    if(late){late=false;blockers=[{kind:'leave_table',room_id:'late-room',table_id:'late-table',name:'New game'}];return route.fulfill({status:409,json:{detail:{code:'deletion_leave_games',blockers}}});}
    json={status_token:'s'.repeat(43)};
   }else if(p==='/auth/deletion/status')json={status:'pending'};
   await route.fulfill({json});
  });
  await page.goto(site+'/delete-account'+(mode==='token'?'#delete_account='+token:''));
  await page.getByText('End this table you own before deleting your account.',{exact:true}).waitFor();
  await page.getByText('Settle outstanding transactions for this table before deleting your account.',{exact:true}).waitFor();
  const submit=page.getByRole('button',{name:mode==='token'?'Confirm account deletion':'Send deletion link',exact:true});
  if(mode==='signed')await page.getByLabel('Current password',{exact:true}).fill('original-password');
  else await page.getByLabel('Type DELETE to confirm',{exact:true}).fill('DELETE');
  assert.ok(await submit.isDisabled());assert.deepEqual(posts,[]);
  if(width===390&&mode==='signed')await page.screenshot({path:'/private/tmp/bhidne-deletion-blockers-page.png'});
  blockers=[];
  if(mode==='signed'){
   verified=false;await page.getByRole('button',{name:'Check again',exact:true}).click();
   await page.getByText('Verify a recovery email in Profile before requesting deletion. If you cannot access it, use account recovery first.',{exact:true}).waitFor();
   assert.ok(await submit.isDisabled());verified=true;
  }
  await page.getByRole('button',{name:'Check again',exact:true}).click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('[role=button]')).find(el=>el.textContent==='Check again')?.hasAttribute('disabled'));
  await submit.click();
  if(mode==='token'){
   await page.getByText('Leave this table before deleting your account.',{exact:true}).waitFor();assert.ok(await submit.isDisabled());
   blockers=[];await page.getByRole('button',{name:'Check again',exact:true}).click();await submit.click();
   await page.getByText('Deletion requested. Account access has been disabled. Cleanup is pending; keep this page to check its status.',{exact:true}).waitFor();
   assert.equal(posts.length,2);
  }else{
   await page.getByText('Check your verified recovery email for the deletion link. Your account stays active until you open the link and confirm deletion.',{exact:true}).waitFor();
   assert.equal(posts.length,1);assert.ok(await page.evaluate(site=>sessionStorage.getItem('bhidne.session.v1:'+site),site));
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  await page.close();console.log(`PASS ${mode} ${width}: blockers, recheck, verified email and confirmation race`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
