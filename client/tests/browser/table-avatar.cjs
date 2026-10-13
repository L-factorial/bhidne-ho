// Isolated table/profile fixtures; no live account or game writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./game-stats.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280])for(const kind of ['callbreak','marriage','flush']){
  const f=await fixture(browser,kind,4,width);
  const {page}=f;
  if(kind==='flush')await page.getByTestId('hand-attention-expanded').click();
  let saved=null,fail=true;const writes=[];
  await page.route('**/me/profile/avatar',async route=>{
   if(route.request().method()==='PATCH'){
    writes.push(route.request().postDataJSON().avatar_id);
    if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Try again'}});}
    saved=route.request().postDataJSON().avatar_id;
   }
   await route.fulfill({json:{avatar_id:saved,avatar_url:saved?'preset:'+saved:null}});
  });
  const own=page.getByRole('button',{name:/^Choose avatar,/}).first();
  await own.locator('[aria-label="Anonymous player profile"], [data-testid="player-avatar-image"]').first().click();const picker=page.getByTestId('profile-avatar-picker');
  await picker.getByTestId('avatar-choice-male_01').click();
  await picker.getByRole('alert').waitFor();assert.equal(await picker.isVisible(),true);
  await picker.getByTestId('avatar-choice-male_02').click();await picker.waitFor({state:'hidden'});
  await own.getByTestId('player-avatar-image').waitFor();
  await own.locator('[aria-label="Anonymous player profile"], [data-testid="player-avatar-image"]').first().click();await picker.locator('[data-testid="avatar-choice-male_02"][aria-checked="true"]').waitFor();
  await picker.getByTestId('avatar-choice-default').click();await picker.waitFor({state:'hidden'});
  assert.equal(await own.getByTestId('player-avatar-image').count(),0);
  await own.locator('[aria-label="Anonymous player profile"], [data-testid="player-avatar-image"]').first().click();await picker.getByTestId('room-sheet-close').click();await picker.waitFor({state:'hidden'});
  assert.deepEqual(writes,['male_01','male_02',null]);
  assert.ok(f.writes.every(p=>!p.endsWith('/action')));assert.deepEqual(f.errors,[]);
  await f.context.close();console.log(`PASS ${kind} ${width}: save failure/retry, immediate own avatar, reset and dismiss`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
