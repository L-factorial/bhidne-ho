const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8108';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const kind of ['flush','marriage','callbreak'])for(const width of [320,390,1280]){
  const f=await fixture(browser,kind,4,width),{page}=f;
  const submissions=[];
  await f.context.route(site+'/players/**',route=>route.fulfill({json:[{user_id:'user-busy',username:'prayash2496',display_name:'Prayash2496'}]}));
  await f.context.route(site+'/test-games/room/table/invite-table',async route=>{
   submissions.push(route.request().postDataJSON());
   await new Promise(resolve=>setTimeout(resolve,200));
   await route.fulfill({json:{status:'accepted'}});
  });
  await page.getByRole('button',{name:'Table menu',exact:true}).click();
  const menu=page.getByTestId(`${kind}-menu-drawer`);
  await menu.getByRole('button',{name:'Invite players',exact:true}).click();
  const sheet=page.getByTestId('table-invite-sheet');await sheet.waitFor();
  const send=sheet.getByRole('button',{name:'Send invitations',exact:true});assert.equal(await send.isDisabled(),true);
  await sheet.getByRole('textbox',{name:'Find player to invite',exact:true}).fill('prayash');
  await sheet.getByRole('button',{name:'Invite Prayash2496',exact:true}).click();
  assert.equal(await send.isDisabled(),false);
  await send.click();await sheet.getByText('Invitations sent.',{exact:true}).waitFor();
  assert.equal(submissions.length,1);assert.deepEqual(submissions[0].recipients,['user-busy']);assert.ok(submissions[0].match_id);
  const b=await sheet.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1);
  assert.deepEqual(f.errors,[]);
  await page.screenshot({path:`/private/tmp/bhidne-table-invite-${kind}-${width}.png`});
  await f.context.close();console.log(`PASS ${kind} ${width}: burger invite search/select/send and exact match payload`);
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
