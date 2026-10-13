const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const kind of ['callbreak','marriage','flush'])for(const spectator of [false,true]){
  const f=await fixture(browser,kind,4,390,spectator,s=>{
   if(!spectator){s.status='waiting';s.game=null;s.deal=null;s.private=null;s[kind]=null;s.round_review=null;s.table.phase='OPEN';s.table.current_user.can_start=true;s.is_creator=true;}
  });
  const own=f.page.getByRole('button',{name:/^Choose avatar,/});
  if(spectator)assert.equal(await own.count(),0);
  else{
   await f.page.route('**/me/profile/avatar',route=>route.fulfill({json:{avatar_id:null,avatar_url:null}}));
   await own.locator('[aria-label="Anonymous player profile"]').first().click();
   const picker=f.page.getByTestId('profile-avatar-picker');await picker.waitFor();
   await picker.getByTestId('room-sheet-close').click();await picker.waitFor({state:'hidden'});
  }
  assert.deepEqual(f.errors,[]);assert.ok(f.writes.every(p=>!p.endsWith('/action')));
  await f.context.close();console.log(`PASS ${kind}: ${spectator?'spectator cannot edit seats':'waiting seat opens and dismisses picker'}`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
