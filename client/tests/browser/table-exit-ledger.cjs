// Isolated commands and ledger reads; no live games, accounts or settlement writes.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture}=require('./game-stats.cjs');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8119';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
for(const [kind,operation,empty] of [...['callbreak','marriage','flush'].flatMap(kind=>['leave','end'].map(operation=>[kind,operation,false])),['flush','leave',true]]){
 let current;
 const f=await fixture(browser,kind,4,390,false,s=>{
  s.table_id='target-table';s.durable_game_id='target-game';
  s.table.current_user.can_abandon_match=false;s.table.current_user.can_leave_seat=true;
  current=s;
 });const {page}=f;
 let fail=true,calls=0,ledgerReads=0,release;
 const balances=[{player_id:'u0',amount:10},{player_id:'u1',amount:-10}];
 const entry=id=>({table_id:id,table_name:id,game_type:kind,game_count:1,balances,games:[{game_id:id==='target-table'?'target-game':'other-game',game_type:kind,settled:false,balances}],transactions:[],suggested_transfers:[]});
 await page.route(site+'/rooms/room/ledger',route=>{ledgerReads++;return route.fulfill({json:{players:{u0:'You',u1:'Friend'},balances,tables:empty?[]:kind==='flush'&&operation==='end'&&ledgerReads===1?[entry('other-table')]:[entry('other-table'),entry('target-table')],personal_settlements:[]}});});
 await page.route(site+'/test-games/room**',async route=>{
  if(route.request().method()==='POST'){
   calls++;
   if(fail){fail=false;return route.fulfill({status:503,json:{detail:'Try again.'}});}
   await new Promise(resolve=>{release=resolve;});
   current={...current,status:operation==='end'?'ended':current.status,your_player_id:null};
  }
  return route.fulfill({json:current});
 });
 const menu=page.getByTestId(kind+'-menu-drawer');
 async function submit(){
  if(!await menu.isVisible())await page.getByRole('button',{name:'Table menu',exact:true}).click();
  if(operation==='leave'){await menu.getByRole('button',{name:'Leave Table',exact:true}).click();}
  else {
   await menu.getByRole('button',{name:kind==='flush'?'End table':'End game',exact:true}).click();
   await page.getByRole('button',{name:kind==='flush'?'End table for everyone':'End game for everyone',exact:true}).click();
  }
 }
 const failed=page.waitForResponse(r=>r.status()===503);await submit();await failed;await page.waitForTimeout(200);
 assert.equal(ledgerReads,0,'failed exit must not open ledger');assert.ok(await page.getByTestId('live-game-overlay').isVisible());
 await submit();for(let attempt=0;!release && attempt<100;attempt++)await page.waitForTimeout(25);assert.ok(release,'exit request reached server');
 assert.equal(ledgerReads,0,'unconfirmed exit must not open ledger');release();
 const ledger=page.getByTestId('room-ledger');await ledger.waitFor();
 assert.equal(await ledger.getByRole('tab',{name:'Table Balances',exact:true}).getAttribute('aria-selected'),'true');
 if(!empty){
 const target=ledger.getByTestId('ledger-table-card-target-table');await target.getByTestId('ledger-balances').first().waitFor();
 assert.equal(await ledger.locator('[data-testid^="ledger-table-card-"]').first().getAttribute('data-testid'),'ledger-table-card-target-table');
 assert.equal(await ledger.getByTestId('ledger-table-card-other-table').getByTestId('ledger-balances').count(),0);
 }else {assert.equal(await ledger.locator('[data-testid^="ledger-table-card-"]').count(),0);}
 assert.equal(calls,2);assert.deepEqual(f.errors,[]);
 await page.getByTestId('room-sheet-close').click();await page.getByTestId('room-sheet').waitFor({state:'hidden'});
 await f.context.close();console.log('PASS',kind,operation,empty?'empty-history ledger remains dismissible':'failure/pending/success, matching room/table, dismissible ledger');
}
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
