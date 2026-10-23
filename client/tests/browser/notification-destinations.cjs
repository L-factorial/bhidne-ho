// Local notification, room and game fixtures only; no real accounts or writes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./game-stats.cjs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const scope of (process.env.TEST_NOTIFICATION_SCOPES||'room,table,stale,settlement_requested,settlement_accepted').split(',')){
  const f=await fixture(browser,'callbreak',4,390),{page}=f;
  const snapshot=JSON.parse(fs.readFileSync(path.join(process.env.FIXTURE_DIR||'/private/tmp/bhidne-stats-fixtures','callbreak-4.json')));
  const notice={id:'notification-'+scope,kind:scope.startsWith('settlement_')?scope:'chat',read:false,actor:{user_id:'u1',display_name:'Friend'},created_at:Date.now(),payload:{scope:scope==='room'?'room':'table',room_id:'room',...(scope==='room'?{}:{match_id:scope==='stale'?'old-match':snapshot.match_id})}};
  if(scope.startsWith('settlement_'))notice.payload={room_id:'room',batch_id:'batch',transfer_id:'transfer',amount:100};
  await page.route('**/rooms/room/ledger',route=>route.fulfill({json:{players:{},balances:[],tables:[],personal_settlements:[]}}));
  await page.route('**/notifications',route=>route.fulfill({json:[notice]}));
  await page.route('**/notifications/read',route=>route.fulfill({status:204}));
  await page.route('**/rooms/room',route=>route.fulfill({json:{room_id:'room',name:'Stats room',members:['u0','u1'],tables:[{match_id:snapshot.match_id,game_type:'callbreak',status:'playing'}]}}));
  await page.getByRole('button',{name:'Back to lobby',exact:true}).first().evaluate(el=>el.click());
  await page.getByRole('button',{name:/^Notifications, 1 unread$/}).click();
  await page.getByRole('button',{name:scope.startsWith('settlement_')?'Ledger & settlements':scope==='room'?'Open room':'Open table',exact:true}).click();
  if(scope.startsWith('settlement_'))await page.getByTestId('room-ledger').waitFor();
  else if(scope==='room')await page.getByTestId('room-chat-window').waitFor();
  else if(scope==='table')await page.getByTestId('table-chat-panel').waitFor();
  else{
   await page.getByRole('alert').filter({hasText:'no longer available'}).waitFor();
   await page.getByRole('button',{name:'Open room',exact:true}).click();
   await page.getByTestId('room-hero').waitFor();
  }
  assert.deepEqual(f.errors,[]);await f.context.close();console.log('PASS notification destination: '+scope);
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
