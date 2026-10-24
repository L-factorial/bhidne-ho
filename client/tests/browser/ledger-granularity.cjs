// Local app with isolated account, ledger and notification fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const site=process.env.TEST_WEB_URL||'http://127.0.0.1:8119';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage();page.setDefaultTimeout(12000);
  const users={u0:'Prajwal',u1:'Sita',u2:'Amit'};
  const rows=(a,b,c)=>[{player_id:'u0',amount:a},{player_id:'u1',amount:b},{player_id:'u2',amount:c}];
  const incoming={batch_id:'b2',transfer_id:'receive',table_id:'t1',payer_id:'u2',payee_id:'u0',amount:15,status:'MARKED_PAID'};
  const paid={batch_id:'b3',transfer_id:'old',table_id:'t1',payer_id:'u0',payee_id:'u1',amount:5,status:'RESOLVED'};
  const preview={payer_id:'u0',payee_id:'u1',amount:30};
  const ledger={room_name:'Friday cards',players:users,balances:rows(20,-5,-15),personal_settlements:[incoming,paid],tables:[
   {table_id:'t1',table_name:'Evening table',game_type:'flush',created_at:'2026-10-22T01:00:00Z',game_count:2,balances:rows(-20,35,-15),record_balances:rows(-20,35,-15),transactions:[incoming,paid],suggested_transfers:[preview],games:[
    {game_id:'g1',game_type:'flush',created_at:'2026-10-22T01:10:00Z',settled:true,record_balances:rows(10,5,-15)},
    {game_id:'g2',game_type:'flush',created_at:'2026-10-22T01:20:00Z',settled:false,record_balances:rows(-30,30,0)}]},
   {table_id:'t2',table_name:'Weekend table',game_type:'marriage',created_at:'2026-10-21T00:00:00Z',game_count:1,balances:rows(40,-40,0),record_balances:rows(40,-40,0),transactions:[],suggested_transfers:[{payer_id:'u1',payee_id:'u0',amount:40}],games:[{game_id:'g3',game_type:'marriage',created_at:'2026-10-21T00:30:00Z',record_balances:rows(40,-40,0)}]}]};
  const notice={id:'notice1',kind:'settlement_requested',actor:{user_id:'u2',display_name:'Amit'},created_at:Date.now(),read:false,payload:{room_id:'r1',table_id:'t1',batch_id:'b2',transfer_id:'receive',amount:15,room_name:'Friday cards',table_name:'Evening table'}};
  const writes=[],errors=[];let notifications=[notice];page.on('pageerror',e=>errors.push(e.message));
  const room={room_id:'r1',name:'Friday cards',creator_id:'u0',members:['u0','u1','u2'],connected_members:['u0'],is_member:true};
  await context.addInitScript(site=>{localStorage.setItem('bhidne.language','en');sessionStorage.setItem('bhidne.session.v1:'+site,JSON.stringify({session:{user_id:'u0',token:'fixture'},room:null,game:null}));},site);
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   if(url.origin!==site)return route.abort();
   if(p==='/'||p.startsWith('/assets/')||p.startsWith('/_expo/')||p==='/favicon.ico')return route.continue();
   let body=[];
   if(p==='/ledger/rooms')body={items:[{room_id:'r1',name:'Friday cards'}],next_room_id:null};
   else if(p==='/rooms')body=[room];
   else if(p==='/rooms/r1'||p==='/rooms/r1/enter')body=room;
   else if(p==='/rooms/r1/ledger')body=ledger;
   else if(p==='/rooms/r1/ledger/settlements'&&req.method()==='POST'){
    writes.push(p);const created={...preview,table_id:'t1',batch_id:'new',transfer_id:'newpay',status:'OPEN'};
    ledger.tables[0].suggested_transfers=[];ledger.tables[0].transactions.push(created);ledger.personal_settlements.push(created);body={};
   }else if(p.includes('/ledger/settlements/')&&req.method()==='POST'){
    writes.push(p);if(p.endsWith('/mark-paid'))ledger.personal_settlements.find(row=>row.transfer_id==='newpay').status='MARKED_PAID';
    if(p.endsWith('/confirm'))incoming.status='RESOLVED';body={};
   }else if(p==='/notifications/read') {notifications=[];body={};}
   else if(p==='/notifications')body=notifications;
   else if(p.startsWith('/test-games/r'))body={room_id:'r1',status:'empty',tables:[]};
   else if(p==='/auth/me')body={user_id:'u0',username:'prajwal',display_name:'Prajwal'};
   else if(p==='/me/community-rules')body={accepted:true,version:'2026-10-01',muted_until:null};
   else if(p==='/friends')body={friends:[],incoming:[],outgoing:[],online_friend_ids:[]};
   else if(p==='/auth/safety/capabilities')body={blocking:false,reporting:false};
   await route.fulfill({json:body});
  });
  await context.routeWebSocket(site.replace(/^http/,'ws')+'/**',ws=>{ws.send(JSON.stringify({type:'CONNECTED'}));ws.onMessage(raw=>{if(JSON.parse(raw).type==='HEARTBEAT')ws.send(JSON.stringify({type:'HEARTBEAT_ACK'}));});});
  const shot=async name=>{if(width===390){
    await page.setViewportSize({width,height:name.includes('my-payments')||name.includes('pending')||name.includes('settled')?1750:1100});
    await page.waitForTimeout(350);
    const panel=page.getByTestId('room-sheet');
    if(await panel.isVisible())await panel.screenshot({path:`/private/tmp/bhidne-ledger-${name}.png`});
    else await page.screenshot({path:`/private/tmp/bhidne-ledger-${name}.png`});
  }};
  await page.goto(site);await page.getByTestId('lobby-navigation').getByRole('tab',{name:'Ledger',exact:true}).click();
  await page.getByTestId('pending-ledger-room-r1').click();const sheet=page.getByTestId('room-sheet');await sheet.waitFor();
  assert.deepEqual(await sheet.getByRole('tab').allTextContents(),['Balances','Table ledgers','My settlement']);
  const balances=sheet.getByTestId('ledger-balances');await balances.waitFor();assert.match(await balances.innerText(),/\+20/);await shot('01-balances');
  await sheet.getByRole('tab',{name:'Table ledgers',exact:true}).click();await sheet.getByText('Created',{exact:false}).first().waitFor();await shot('02-tables');
  await sheet.getByTestId('ledger-table-card-t1').getByRole('button').click();const detail=sheet.getByTestId('ledger-table-detail');await detail.waitFor();
  assert.deepEqual(await detail.getByRole('tab').allTextContents(),['Entire session','Games breakdown','My settlement']);
  await detail.getByTestId('ledger-balances').waitFor();assert.match(await detail.innerText(),/-20/);await shot('03-session');
  await detail.getByRole('tab',{name:'Games breakdown',exact:true}).click();assert.equal(await detail.getByTestId('ledger-balances').count(),0);await shot('04-games');
  await detail.getByTestId('ledger-game-g2').getByRole('button').click();await detail.getByTestId('ledger-balances').waitFor();await shot('05-game-expanded');
  await detail.getByRole('tab',{name:'My settlement',exact:true}).click();
  const tableSettlement=detail.getByTestId('ledger-table-settlement');await tableSettlement.getByRole('button',{name:'Settle',exact:true}).waitFor();
  assert.equal(await tableSettlement.getByTestId('ledger-transfer').count(),3);
  assert.equal(await tableSettlement.getByText('Friday cards / Weekend table',{exact:true}).count(),0);
  await tableSettlement.getByRole('button',{name:'Accept settlement',exact:true}).waitFor();
  assert.equal(await tableSettlement.getByRole('button',{name:'Settled',exact:true}).isDisabled(),true);
  assert.equal(writes.length,0);await shot('table-my-payments');
  await detail.getByRole('button',{name:'Back to table ledgers',exact:true}).click();await sheet.getByRole('tab',{name:'My settlement',exact:true}).click();await shot('06-my-tables');
  const personal=sheet.getByTestId('ledger-personal-table-t1');await personal.getByRole('button').click();await personal.getByRole('button',{name:'Settle',exact:true}).waitFor();
  assert.equal(writes.length,0);assert.equal(await personal.getByRole('button',{name:'Settled',exact:true}).isDisabled(),true);await shot('07-my-payments');
  await personal.getByRole('button',{name:'Settle',exact:true}).click();await personal.getByText('Awaiting acceptance',{exact:true}).first().waitFor();
  await personal.getByRole('button',{name:'Settle',exact:true}).waitFor({state:'hidden'});assert.equal(writes.length,2);await shot('08-pending');
  await personal.getByRole('button',{name:'Accept settlement',exact:true}).click();await personal.getByRole('button',{name:'Accept settlement',exact:true}).waitFor({state:'hidden'});
  assert.equal(await personal.getByRole('button',{name:'Settled',exact:true}).count(),2);await shot('09-settled');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.getByTestId('room-sheet-close').click();
  // Show the notification entry using a new pending request fixture.
  incoming.status='MARKED_PAID';notifications=[notice];
  const bell=page.getByRole('button',{name:/notifications/i}).first();await bell.click();
  await page.getByText('Amit requested settlement confirmation',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Accept settlement',exact:true}).count(),0);
  const acceptNotice=page.getByRole('button',{name:'Ledger & settlements',exact:true});
  await acceptNotice.waitFor();await shot('10-notification');
  assert.equal(await acceptNotice.innerText(),'');
  const noticeRow=acceptNotice.locator('..').locator('..');
  const rowBox=await noticeRow.boundingBox(), actionsBox=await acceptNotice.locator('..').boundingBox();
  assert.ok(Math.abs(rowBox.y+rowBox.height/2-actionsBox.y-actionsBox.height/2)<2);
  assert.ok(rowBox.x+rowBox.width-actionsBox.x-actionsBox.width<=10);
  for(const button of await noticeRow.getByRole('button').all()) {
   assert.equal(await button.innerText(),'');assert.equal(await button.locator('svg').count(),1);
  }
  assert.equal(await noticeRow.getByRole('button').count(),1);
  const writesBeforeOpen=writes.length;
  await acceptNotice.click();await page.getByTestId('room-sheet').waitFor();
  assert.equal(writes.length,writesBeforeOpen);assert.equal(incoming.status,'MARKED_PAID');
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: all ledger views, payment creation/request/acceptance, disabled settled records, notifications, no browsing writes`);
  await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
